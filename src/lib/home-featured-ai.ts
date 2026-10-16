import type { SupportedLocale } from '@/i18n/locales'
import type { Event, HomeFeaturedEventAdminItem, HomeFeaturedSettings } from '@/types'

import { DEFAULT_LOCALE } from '@/i18n/locales'
import { rankCandidatesWithDecisionModel } from '@/lib/ai/decision-model'
import { parseOpenRouterProviderSettings } from '@/lib/ai/market-context-config'
import { requestOpenRouterCompletion, sanitizeForPrompt } from '@/lib/ai/openrouter'
import { EventRepository } from '@/lib/db/queries/event'
import { HomeFeaturedEventsRepository } from '@/lib/db/queries/home-featured-events'
import { SettingsRepository } from '@/lib/db/queries/settings'
import { buildHomeFeaturedNewsSearchPromptLines } from '@/lib/home-featured-news-search-prompt'
import {
  getHomeFeaturedSettingsFromSettings,
  HOME_FEATURED_NEWS_LIMIT,
  HOME_FEATURED_NEWS_TTL_MS,
} from '@/lib/home-featured-settings'

interface NewsHeadline {
  source: string
  title: string
  url: string
  faviconUrl?: string | null
  publishedAt: string | null
}

interface AiSelectedMarket {
  slug: string
  news?: Array<{
    title: string
    source: string
    url?: string | null
    faviconUrl?: string | null
    publishedAt?: string | null
    score?: number | null
  }>
}

interface AiResponse {
  markets?: AiSelectedMarket[]
}

function stripTags(value: string) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeBasicEntities(value: string) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
}

function extractXmlTagValue(item: string, tag: string) {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? decodeBasicEntities(stripTags(match[1] ?? '')) : ''
}

function extractHeadlinesFromXml(source: string, sourceUrl: string, body: string): NewsHeadline[] {
  const items = Array.from(body.matchAll(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi))
    .map((match) => match[0])
    .slice(0, 18)

  if (items.length === 0) {
    const title = extractXmlTagValue(body, 'title')
    return title ? [{ source, title, url: sourceUrl, publishedAt: null }] : []
  }

  return items
    .map((item) => {
      const title = extractXmlTagValue(item, 'title')
      const link = extractXmlTagValue(item, 'link') || item.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || sourceUrl
      const publishedAt =
        extractXmlTagValue(item, 'pubDate') ||
        extractXmlTagValue(item, 'published') ||
        extractXmlTagValue(item, 'updated') ||
        null

      return title
        ? {
            source,
            title,
            url: link,
            publishedAt,
          }
        : null
    })
    .filter((item): item is NewsHeadline => item !== null)
}

function normalizeHeadlineText(value: string) {
  return decodeBasicEntities(stripTags(value)).replace(/\s+/g, ' ').trim()
}

function isUsableHeadline(value: string) {
  const normalized = value.trim()
  if (normalized.length < 18 || normalized.length > 180) {
    return false
  }

  const lower = normalized.toLowerCase()
  return ![
    'advertisement',
    'cookie',
    'cookies',
    'newsletter',
    'privacy policy',
    'sign in',
    'subscribe',
    'terms of service',
  ].some((token) => lower.includes(token))
}

function pushHeadline(headlines: NewsHeadline[], seen: Set<string>, item: NewsHeadline) {
  const title = normalizeHeadlineText(item.title)
  if (!isUsableHeadline(title)) {
    return
  }

  const key = `${item.source}:${title}`.toLowerCase()
  if (seen.has(key)) {
    return
  }

  seen.add(key)
  headlines.push({
    ...item,
    title,
  })
}

function resolveHtmlLink(sourceUrl: string, href: string | null | undefined) {
  const trimmed = href?.trim()
  if (!trimmed || trimmed.startsWith('#') || /^javascript:/i.test(trimmed) || /^mailto:/i.test(trimmed)) {
    return sourceUrl
  }

  try {
    return new URL(decodeBasicEntities(trimmed), sourceUrl).toString()
  } catch {
    return sourceUrl
  }
}

function getJsonLdNodes(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap(getJsonLdNodes)
  }

  if (!value || typeof value !== 'object') {
    return []
  }

  const record = value as Record<string, unknown>
  const graphNodes = Array.isArray(record['@graph']) ? getJsonLdNodes(record['@graph']) : []

  return [record, ...graphNodes]
}

function extractString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function extractJsonLdUrl(value: unknown) {
  if (typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return extractString(record['@id']) ?? extractString(record.url)
  }

  return null
}

function extractHeadlinesFromJsonLd(source: string, sourceUrl: string, body: string) {
  const headlines: NewsHeadline[] = []
  const seen = new Set<string>()
  const scripts = Array.from(
    body.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ).slice(0, 24)

  for (const script of scripts) {
    const rawJson = decodeBasicEntities(script[1] ?? '').trim()
    if (!rawJson) {
      continue
    }

    try {
      const parsed = JSON.parse(rawJson) as unknown
      for (const node of getJsonLdNodes(parsed)) {
        if (!node || typeof node !== 'object') {
          continue
        }

        const record = node as Record<string, unknown>
        const typeValues = Array.isArray(record['@type']) ? record['@type'] : [record['@type']]
        const normalizedTypes = typeValues.map((value) => String(value ?? '').toLowerCase()).filter(Boolean)
        const isArticle = normalizedTypes.some(
          (type) => type.includes('article') || type.includes('news') || type.includes('blogposting'),
        )
        if (!isArticle) {
          continue
        }

        const title = extractString(record.headline) ?? extractString(record.name)
        if (!title) {
          continue
        }

        const publisher =
          record.publisher && typeof record.publisher === 'object'
            ? extractString((record.publisher as Record<string, unknown>).name)
            : null
        const url = extractJsonLdUrl(record.url) ?? extractJsonLdUrl(record.mainEntityOfPage) ?? sourceUrl

        pushHeadline(headlines, seen, {
          source: publisher ?? source,
          title,
          url: resolveHtmlLink(sourceUrl, url),
          publishedAt: extractString(record.datePublished) ?? extractString(record.dateModified),
        })
      }
    } catch {
      continue
    }
  }

  return headlines
}

function extractHeadlinesFromHtml(source: string, sourceUrl: string, body: string): NewsHeadline[] {
  const headlines: NewsHeadline[] = []
  const seen = new Set<string>()

  for (const headline of extractHeadlinesFromJsonLd(source, sourceUrl, body)) {
    pushHeadline(headlines, seen, headline)
  }

  const anchorMatches = Array.from(body.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)).slice(0, 500)
  for (const match of anchorMatches) {
    pushHeadline(headlines, seen, {
      source,
      title: match[2] ?? '',
      url: resolveHtmlLink(sourceUrl, match[1]),
      publishedAt: null,
    })
    if (headlines.length >= 50) {
      break
    }
  }

  if (headlines.length < 8) {
    const headingMatches = Array.from(body.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)).slice(0, 80)
    for (const match of headingMatches) {
      pushHeadline(headlines, seen, {
        source,
        title: match[1] ?? '',
        url: sourceUrl,
        publishedAt: null,
      })
    }
  }

  if (headlines.length > 0) {
    return headlines.slice(0, 36)
  }

  const title = decodeBasicEntities(
    stripTags(
      body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
        body.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
        '',
    ),
  )

  return title ? [{ source, title, url: sourceUrl, publishedAt: null }] : []
}

function resolveNewsSourceUrl(sourceUrl: string) {
  const url = new URL(sourceUrl)
  const hostname = url.hostname.replace(/^www\./, '').toLowerCase()
  const isGoogleHome = /^google\./.test(hostname) && (url.pathname === '/' || url.pathname === '')
  if (!isGoogleHome) {
    return url
  }

  const isBrazilGoogle = hostname.endsWith('.br')
  return new URL(
    isBrazilGoogle
      ? 'https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-419'
      : 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en',
  )
}

function resolveSourceFaviconUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl)
    return new URL('/favicon.ico', url.origin).toString()
  } catch {
    return null
  }
}

async function fetchSourceHeadlines(sourceUrl: string): Promise<NewsHeadline[]> {
  const trimmed = sourceUrl.trim()
  if (!trimmed) {
    return []
  }

  try {
    const normalizedSourceUrl = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : /^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(trimmed)
        ? `https://${trimmed}`
        : ''
    if (!normalizedSourceUrl) {
      return []
    }

    const url = resolveNewsSourceUrl(normalizedSourceUrl)
    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html',
        'User-Agent': 'Mozilla/5.0 (compatible; KuestBot/1.0; +https://kuest.com)',
      },
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    })

    if (!response.ok) {
      return []
    }

    const body = (await response.text()).slice(0, 2_000_000)
    const source = url.hostname.replace(/^www\./, '')
    const contentType = response.headers.get('content-type') ?? ''
    const isXml = contentType.includes('xml') || /<(?:rss|feed|item|entry)\b/i.test(body)

    const headlines = isXml
      ? extractHeadlinesFromXml(source, url.toString(), body)
      : extractHeadlinesFromHtml(source, url.toString(), body)
    const fallbackFaviconUrl = resolveSourceFaviconUrl(url.toString())

    return headlines.map((headline) => ({
      ...headline,
      faviconUrl: headline.faviconUrl ?? fallbackFaviconUrl,
    }))
  } catch {
    return []
  }
}

async function collectNewsHeadlines(sources: string[]) {
  const headlineGroups = await Promise.all(sources.slice(0, 12).map(fetchSourceHeadlines))
  const seen = new Set<string>()
  const headlines: NewsHeadline[] = []

  for (const headline of headlineGroups.flat()) {
    const key = `${headline.source}:${headline.title}`.toLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    headlines.push(headline)
  }

  return headlines.slice(0, 80)
}

function eventToPromptCandidate(event: Event) {
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    mainTag: event.main_tag,
    tags: event.tags.map((tag) => tag.slug),
    volume: event.volume,
    volume24h: event.markets.reduce((sum, market) => sum + (market.volume_24h ?? 0), 0),
    endDate: event.end_date,
    recurrence: event.series_recurrence,
    seriesSlug: event.series_slug,
    sportsLive: event.sports_live,
    sports: {
      sport: event.sports_sport_slug,
      league: event.sports_league_slug,
      teams: (event.sports_teams ?? []).map((team) => team.name).filter(Boolean),
    },
    marketTerms: event.markets.slice(0, 8).map((market) => ({
      title: market.title,
      shortTitle: market.short_title,
      question: market.question,
      outcomes: market.outcomes.map((outcome) => outcome.outcome_text).filter(Boolean),
    })),
  }
}

function normalizeNewsIdentity(value: Pick<NewsHeadline, 'source' | 'title'>) {
  return `${value.source}:${value.title}`.replace(/\s+/g, ' ').trim().toLowerCase()
}

function buildHeadlineByIdentity(headlines: NewsHeadline[]) {
  return new Map(headlines.map((headline) => [normalizeNewsIdentity(headline), headline]))
}

function safeJsonFromText(value: string): AiResponse | null {
  const trimmed = value.trim()
  const jsonCandidate = trimmed.startsWith('{') ? trimmed : (trimmed.match(/\{[\s\S]*\}/)?.[0] ?? '')

  if (!jsonCandidate) {
    return null
  }

  try {
    const parsed = JSON.parse(jsonCandidate)
    return parsed && typeof parsed === 'object' ? (parsed as AiResponse) : null
  } catch {
    return null
  }
}

function createFeaturedKey(item: Pick<HomeFeaturedEventAdminItem, 'targetType' | 'eventId' | 'seriesSlug'>) {
  return item.targetType === 'series' ? `series:${item.seriesSlug ?? ''}` : `event:${item.eventId ?? ''}`
}

function toFeaturedItem(event: Event, rank: number, source: 'manual' | 'ai'): HomeFeaturedEventAdminItem {
  const hasSeries = Boolean(event.series_slug?.trim())

  return {
    targetType: hasSeries ? 'series' : 'event',
    eventId: event.id,
    seriesSlug: hasSeries ? (event.series_slug ?? null) : null,
    title: event.title,
    slug: event.slug,
    iconUrl: event.icon_url || null,
    enabled: true,
    rank,
    source,
    startsAt: null,
    endsAt: null,
    contextMode: 'auto',
    autoRolloverEnabled: hasSeries,
    contextItems: [],
  }
}

function fallbackSelection(candidates: Event[], slotsToFill: number) {
  return candidates.slice(0, Math.max(0, slotsToFill)).map((event) => ({ slug: event.slug, news: [] }))
}

function normalizeScore(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return Math.max(0, Math.min(1, value))
}

async function resolveFeaturedItemEvents(items: HomeFeaturedEventAdminItem[], locale: SupportedLocale) {
  const resolved = await Promise.all(
    items.map(async (item) => {
      if (!item.slug) {
        return null
      }

      const { data } = await EventRepository.getEventBySlug(item.slug, '', locale)
      return data ? { item, event: data } : null
    }),
  )

  return resolved.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
}

function normalizeNewsItems(
  items: AiSelectedMarket['news'],
  allowedHeadlines?: NewsHeadline[],
  options: { requireAllowedHeadline?: boolean } = { requireAllowedHeadline: Boolean(allowedHeadlines) },
) {
  const headlineByIdentity = allowedHeadlines ? buildHeadlineByIdentity(allowedHeadlines) : null
  const requireAllowedHeadline = options.requireAllowedHeadline ?? Boolean(allowedHeadlines)

  return (items ?? [])
    .filter((item) => item.title?.trim() && item.source?.trim())
    .map((item) => {
      const authoritativeHeadline = headlineByIdentity?.get(normalizeNewsIdentity(item))
      if (requireAllowedHeadline && headlineByIdentity && !authoritativeHeadline) {
        return null
      }

      return authoritativeHeadline
        ? {
            ...authoritativeHeadline,
            url: item.url?.trim() || authoritativeHeadline.url,
            faviconUrl: item.faviconUrl ?? authoritativeHeadline.faviconUrl ?? null,
            publishedAt: item.publishedAt ?? authoritativeHeadline.publishedAt,
            score: item.score ?? null,
          }
        : item
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, HOME_FEATURED_NEWS_LIMIT)
}

const NEWS_MATCH_STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'against',
  'amid',
  'before',
  'being',
  'between',
  'could',
  'daily',
  'during',
  'from',
  'have',
  'into',
  'market',
  'markets',
  'more',
  'news',
  'over',
  'than',
  'that',
  'their',
  'there',
  'this',
  'will',
  'with',
  'would',
])

function tokenizeNewsMatchText(value: string | null | undefined) {
  return new Set(
    (value ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036F]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !NEWS_MATCH_STOP_WORDS.has(token)),
  )
}

function buildEventNewsTokens(event: Event) {
  return tokenizeNewsMatchText(
    [
      event.title,
      event.main_tag,
      event.series_slug,
      event.series_recurrence,
      event.sports_sport_slug,
      event.sports_league_slug,
      ...event.markets.map((market) => `${market.title} ${market.short_title ?? ''} ${market.question ?? ''}`),
      ...event.markets.flatMap((market) => market.outcomes.map((outcome) => outcome.outcome_text)),
      ...(event.sports_teams ?? []).map((team) => team.name ?? ''),
      ...event.tags.map((tag) => `${tag.name} ${tag.slug}`),
    ]
      .filter(Boolean)
      .join(' '),
  )
}

function matchFallbackNewsForEvent(event: Event, headlines: NewsHeadline[]) {
  const eventTokens = buildEventNewsTokens(event)
  if (eventTokens.size === 0 || headlines.length === 0) {
    return []
  }

  return headlines
    .map((headline) => {
      const headlineTokens = tokenizeNewsMatchText(`${headline.title} ${headline.source}`)
      const sharedTokens = Array.from(headlineTokens).filter((token) => eventTokens.has(token))
      const score = sharedTokens.length / Math.sqrt(Math.max(1, eventTokens.size * headlineTokens.size))

      return { headline, score, sharedCount: sharedTokens.length }
    })
    .filter((item) => item.sharedCount >= 2 || (item.sharedCount >= 1 && item.score >= 0.08) || item.score >= 0.14)
    .sort((left, right) => {
      if (right.score === left.score) {
        return right.sharedCount - left.sharedCount
      }
      return right.score - left.score
    })
    .slice(0, HOME_FEATURED_NEWS_LIMIT)
    .map(({ headline, score }) => ({
      title: headline.title,
      source: headline.source,
      url: headline.url,
      faviconUrl: headline.faviconUrl ?? null,
      publishedAt: headline.publishedAt,
      score,
    }))
}

function parsePublishedAt(value: string | null | undefined) {
  if (!value?.trim()) {
    return null
  }

  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

export async function regenerateHomeFeaturedEvents(
  locale: SupportedLocale = DEFAULT_LOCALE,
  options: { settings?: HomeFeaturedSettings } = {},
) {
  const { data: allSettings, error: settingsError } = await SettingsRepository.getSettings()
  if (settingsError) {
    return { data: null, error: 'Could not load featured market settings.' }
  }

  const settings = options.settings ?? getHomeFeaturedSettingsFromSettings(allSettings ?? undefined)
  const openRouterSettings = parseOpenRouterProviderSettings(allSettings ?? undefined)

  if (!settings.useAi) {
    return { data: null, error: 'AI highlighting is disabled.' }
  }

  const { data: manualItems, error: manualItemsError } = await HomeFeaturedEventsRepository.listAdminFeaturedEvents()
  if (manualItemsError) {
    return { data: null, error: 'Could not load current featured markets.' }
  }

  const manualFeaturedItems = (manualItems ?? []).filter((item) => item.source === 'manual')
  const slotsToFill = Math.max(0, settings.maxCards - manualFeaturedItems.length)
  const headlines = await collectNewsHeadlines(settings.newsSources)

  let filteredCandidates: Event[] = []
  let selectedMarkets: AiSelectedMarket[] = []

  if (slotsToFill > 0) {
    const { data: candidateEvents, error: candidatesError } = await EventRepository.listEvents({
      tag: 'trending',
      mainTag: 'trending',
      search: '',
      userId: '',
      bookmarked: false,
      locale,
      status: 'active',
      sortBy: 'volume_24h',
      limit: 32,
    })
    if (candidatesError || !candidateEvents) {
      return { data: null, error: 'Could not load candidate events.' }
    }

    const manualKeys = new Set(manualFeaturedItems.map(createFeaturedKey))
    const manualEventIds = new Set(manualFeaturedItems.map((item) => item.eventId).filter(Boolean))
    const manualSeriesSlugs = new Set(manualFeaturedItems.map((item) => item.seriesSlug).filter(Boolean))
    filteredCandidates = candidateEvents
      .filter((event) => {
        const item = toFeaturedItem(event, 0, 'ai')
        if (manualKeys.has(createFeaturedKey(item))) {
          return false
        }
        if (manualEventIds.has(event.id) || (event.series_slug && manualSeriesSlugs.has(event.series_slug))) {
          return false
        }

        const volume24h = event.markets.reduce((sum, market) => sum + (market.volume_24h ?? 0), 0)
        if (volume24h < settings.minVolume24h) {
          return false
        }

        if (!settings.includeSportsToday && (event.sports_live || event.sports_sport_slug)) {
          return false
        }

        if (!settings.includeNewEvents) {
          const createdAt = new Date(event.created_at).getTime()
          if (Number.isFinite(createdAt) && Date.now() - createdAt < 24 * 60 * 60 * 1000) {
            return false
          }
        }

        return true
      })
      .slice(0, 24)

    if (openRouterSettings.apiKey && openRouterSettings.decisionModel && filteredCandidates.length > 1) {
      try {
        filteredCandidates = await rankCandidatesWithDecisionModel({
          apiKey: openRouterSettings.apiKey,
          model: openRouterSettings.decisionModel,
          candidates: filteredCandidates,
          state: {
            task: 'Select strong candidates for a prediction-market home carousel.',
            locale,
            slotsToFill,
          },
          serializeCandidate: (event) => eventToPromptCandidate(event),
          buildInstructions: (_event, index) =>
            `Score candidate ${index} for featured-carousel suitability. Prefer clear, timely, publicly interesting events with enough context for a broad audience.`,
          timeoutMs: 8_000,
        })
      } catch (error) {
        console.error('Home featured decision model ranking failed:', error)
      }
    }

    selectedMarkets = fallbackSelection(filteredCandidates, slotsToFill)

    if (openRouterSettings.apiKey) {
      const prompt = [
        'Select featured prediction markets for a home carousel.',
        'Return JSON only with this shape: {"markets":[{"slug":"event-slug","news":[{"title":"headline","source":"source","url":"https://...","publishedAt":null,"score":0.8}]}]}',
        `Use no more than ${HOME_FEATURED_NEWS_LIMIT} news articles per market.`,
        `Pick at most ${slotsToFill} markets. Prefer recent volume, clear public interest, sports live/today when relevant, and news relevance.`,
        'Use live web search when available to understand the current news cycle for each candidate.',
        ...buildHomeFeaturedNewsSearchPromptLines(),
        'The phrase "prediction market" describes our product only. Do not search for or return articles about prediction markets, betting, exchanges, Polymarket, Kalshi, regulation, or the app itself unless the candidate event title is explicitly about those things.',
        'Search for each candidate event title, named entities, and close real-world variants. For yes/no markets, prefer reporting that helps understand the likelihood of the event outcome.',
        'Treat the provided source URLs as publication/domain hints. If a source is an RSS feed, homepage, sitemap, section URL, or article URL, infer the publication domain and search broadly for recent relevant articles about the candidate event title on or around that publication.',
        'Before attaching news, verify it is about the event topic itself and not generic prediction-market industry news.',
        'Do not invent market slugs or article URLs. Only use candidate slugs. Prefer article URLs over homepages, feeds, search pages, or tag pages.',
        `Candidates: ${JSON.stringify(filteredCandidates.map(eventToPromptCandidate))}`,
        `Source hints: ${JSON.stringify(settings.newsSources)}`,
        `Headlines: ${JSON.stringify(headlines)}`,
      ].join('\n\n')

      try {
        const content = await requestOpenRouterCompletion(
          [
            {
              role: 'system',
              content:
                'You rank markets and match news headlines. You never write prose. You only return compact valid JSON.',
            },
            {
              role: 'user',
              content: sanitizeForPrompt(prompt),
            },
          ],
          {
            apiKey: openRouterSettings.apiKey,
            model: openRouterSettings.model,
            temperature: 0.2,
            maxTokens: Math.max(1600, slotsToFill * 1200),
            webSearch: true,
            webSearchContextSize: 'high',
          },
        )

        const parsed = safeJsonFromText(content)
        if (Array.isArray(parsed?.markets)) {
          selectedMarkets = parsed.markets.slice(0, slotsToFill)
        }
      } catch (error) {
        console.error('Failed to regenerate home featured events with OpenRouter', error)
      }
    }
  }

  const eventBySlug = new Map(filteredCandidates.map((event) => [event.slug, event]))
  const selectedEvents: Event[] = []
  const selectedEventSlugs = new Set<string>()

  for (const selection of selectedMarkets) {
    if (selectedEvents.length >= slotsToFill) {
      break
    }

    const slug = typeof selection.slug === 'string' ? selection.slug : ''
    if (selectedEventSlugs.has(slug)) {
      continue
    }

    const event = eventBySlug.get(slug)
    if (!event) {
      continue
    }

    selectedEvents.push(event)
    selectedEventSlugs.add(event.slug)
  }

  for (const fallbackEvent of filteredCandidates) {
    if (selectedEvents.length >= slotsToFill) {
      break
    }
    if (!selectedEventSlugs.has(fallbackEvent.slug)) {
      selectedEvents.push(fallbackEvent)
      selectedEventSlugs.add(fallbackEvent.slug)
    }
  }

  const nextItems = [
    ...manualFeaturedItems,
    ...selectedEvents.map((event, index) => toFeaturedItem(event, manualFeaturedItems.length + index, 'ai')),
  ].slice(0, settings.maxCards)

  const replaceResult = await HomeFeaturedEventsRepository.replaceFeaturedEvents(
    nextItems.map((item, index) => ({
      targetType: item.targetType,
      eventId: item.eventId,
      seriesSlug: item.seriesSlug,
      enabled: item.enabled,
      rank: index,
      source: item.source,
      startsAt: item.startsAt ? new Date(item.startsAt) : null,
      endsAt: item.endsAt ? new Date(item.endsAt) : null,
      contextMode: item.contextMode,
      autoRolloverEnabled: item.autoRolloverEnabled,
    })),
  )
  if (replaceResult.error) {
    return { data: null, error: 'Could not save featured markets.' }
  }

  const { data: savedItems } = await HomeFeaturedEventsRepository.listAdminFeaturedEvents()
  const nextItemByKey = new Map(nextItems.map((item) => [createFeaturedKey(item), item]))
  const finalItems = (savedItems ?? nextItems)
    .map((item) => {
      const originalItem = nextItemByKey.get(createFeaturedKey(item))
      return originalItem
        ? {
            ...item,
            title: item.title || originalItem.title,
            slug: item.slug ?? originalItem.slug,
            iconUrl: item.iconUrl ?? originalItem.iconUrl,
          }
        : item
    })
    .slice(0, settings.maxCards)
  const displayedEvents = await resolveFeaturedItemEvents(finalItems, locale)
  const selectionBySlug = new Map<string, AiSelectedMarket>(
    selectedMarkets.map((selection) => [selection.slug, selection]),
  )

  if (openRouterSettings.apiKey && displayedEvents.length > 0) {
    const prompt = [
      'Match relevant news headlines to prediction markets already selected for a featured home carousel.',
      'Return JSON only with this shape: {"markets":[{"slug":"event-slug","news":[{"title":"headline","source":"source","url":"https://...","publishedAt":null,"score":0.8}]}]}',
      `Return every market slug that has at least one directly relevant headline. Use no more than ${HOME_FEATURED_NEWS_LIMIT} headlines per market.`,
      'Use live web search when available to find recent article URLs for markets whose provided headlines are weak or too generic.',
      ...buildHomeFeaturedNewsSearchPromptLines(),
      'The phrase "prediction market" describes our product only. Do not search for or return articles about prediction markets, betting, exchanges, Polymarket, Kalshi, regulation, or the app itself unless the market title is explicitly about those things.',
      'Search for each market title, named entities, and close real-world variants. For yes/no markets, prefer reporting that helps understand the likelihood of the event outcome.',
      'Treat the configured source URLs as publication/domain hints, not only literal RSS feeds. Search for the event title and the main market terms broadly, then prefer those sources when they have a relevant article.',
      'Before attaching news, verify it is about the market topic itself and not generic prediction-market industry news.',
      'Do not invent market slugs or URLs. Prefer specific article URLs over homepages, feeds, search pages, or tag pages.',
      `Markets: ${JSON.stringify(displayedEvents.map((entry) => eventToPromptCandidate(entry.event)))}`,
      `Source hints: ${JSON.stringify(settings.newsSources)}`,
      `Headlines: ${JSON.stringify(headlines)}`,
    ].join('\n\n')

    try {
      const content = await requestOpenRouterCompletion(
        [
          {
            role: 'system',
            content: 'You match news to prediction markets. You never write prose. You only return compact valid JSON.',
          },
          {
            role: 'user',
            content: sanitizeForPrompt(prompt),
          },
        ],
        {
          apiKey: openRouterSettings.apiKey,
          model: openRouterSettings.model,
          temperature: 0.1,
          maxTokens: Math.max(1600, displayedEvents.length * 1200),
          webSearch: true,
          webSearchContextSize: 'high',
        },
      )

      const parsed = safeJsonFromText(content)
      if (Array.isArray(parsed?.markets)) {
        for (const selection of parsed.markets) {
          selectionBySlug.set(selection.slug, selection)
        }
      }
    } catch (error) {
      console.error('Failed to refresh home featured news with OpenRouter', error)
    }
  }

  const expiresAt = new Date(Date.now() + HOME_FEATURED_NEWS_TTL_MS)

  for (const { item, event } of displayedEvents) {
    if (!item.id || item.contextMode === 'hidden' || item.contextMode === 'comments') {
      continue
    }

    const news = normalizeNewsItems(selectionBySlug.get(event.slug)?.news, headlines, { requireAllowedHeadline: false })
    const fallbackNews =
      news.length > 0 ? [] : normalizeNewsItems(matchFallbackNewsForEvent(event, headlines), headlines)
    const contextNews = news.length > 0 ? news : fallbackNews
    await HomeFeaturedEventsRepository.replaceContextItems(
      item.id,
      event.id,
      locale,
      contextNews.map((newsItem) => ({
        featuredEventId: item.id!,
        eventId: event.id,
        locale,
        itemType: 'news',
        source: newsItem.source || 'News',
        title: newsItem.title,
        url: newsItem.url ?? null,
        faviconUrl: newsItem.faviconUrl ?? null,
        publishedAt: parsePublishedAt(newsItem.publishedAt),
        relevanceScore: normalizeScore(newsItem.score),
        expiresAt,
      })),
      { preserveManual: true },
    )
  }

  return { data: finalItems, error: null }
}
