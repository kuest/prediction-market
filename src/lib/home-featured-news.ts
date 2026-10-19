import { cacheLife, cacheTag } from 'next/cache'
import { z } from 'zod'

import type { SupportedLocale } from '@/i18n/locales'
import type { OpenRouterProviderSettings } from '@/lib/ai/market-context-config'
import type { Event, HomeFeaturedContextItem } from '@/types'

import { DEFAULT_LOCALE } from '@/i18n/locales'
import { parseOpenRouterProviderSettings } from '@/lib/ai/market-context-config'
import { requestOpenRouterCompletion, sanitizeForPrompt } from '@/lib/ai/openrouter'
import { cacheTags } from '@/lib/cache-tags'
import { HomeFeaturedEventsRepository } from '@/lib/db/queries/home-featured-events'
import { SettingsRepository } from '@/lib/db/queries/settings'
import {
  assertHomeFeaturedNewsMetadataUrlAllowed,
  fetchHomeFeaturedNewsMetadata,
} from '@/lib/home-featured-context-metadata'
import { buildHomeFeaturedNewsSearchPromptLines } from '@/lib/home-featured-news-search-prompt'
import { HOME_FEATURED_NEWS_LIMIT, HOME_FEATURED_NEWS_TTL_MS } from '@/lib/home-featured-settings'

interface HomeFeaturedNewsSearchInput {
  title: string
  slug?: string | null
  endDate?: string | null
  locale?: SupportedLocale
  newsSources?: string | null
}

const AiNewsResultSchema = z.object({
  title: z.string().nullish(),
  source: z.string().nullish(),
  url: z.string().trim().min(1),
  publishedAt: z
    .string()
    .refine((value) => Number.isFinite(Date.parse(value)))
    .nullish(),
  faviconUrl: z.string().nullish(),
})

type AiNewsResult = z.infer<typeof AiNewsResultSchema>

function parseAiNewsResults(value: string): AiNewsResult[] {
  const jsonCandidate = value.trim().startsWith('{') ? value.trim() : (value.match(/\{[\s\S]*\}/)?.[0] ?? '')
  if (!jsonCandidate) {
    return []
  }

  try {
    const parsed = JSON.parse(jsonCandidate) as { news?: unknown } | null
    return Array.isArray(parsed?.news)
      ? parsed.news.flatMap((item: unknown) => {
          const result = AiNewsResultSchema.safeParse(item)
          return result.success ? [result.data] : []
        })
      : []
  } catch {
    return []
  }
}

async function buildAiNewsMetadataFallback(item: AiNewsResult) {
  if (!item.url?.trim()) {
    return null
  }

  try {
    const url = await assertHomeFeaturedNewsMetadataUrlAllowed(item.url)
    const source = item.source?.trim() || url.hostname.replace(/^www\./, '')
    const title = item.title?.trim() || source

    return {
      title,
      source,
      url: url.toString(),
      faviconUrl: item.faviconUrl?.trim() || new URL('/favicon.ico', url.origin).toString(),
      publishedAt: item.publishedAt ?? null,
    }
  } catch {
    return null
  }
}

export async function findHomeFeaturedNews(input: HomeFeaturedNewsSearchInput, openRouter: OpenRouterProviderSettings) {
  const prompt = [
    'Find recent news article URLs that explain the real-world topic behind one prediction market home context card.',
    'Use live web search. Return JSON only with this shape: {"news":[{"title":"article headline","source":"publisher","url":"https://...","publishedAt":"2026-07-04T12:00:00Z"}]}',
    'Critical relevance rules:',
    '- The phrase "prediction market" describes our product only. Do not search for or return articles about prediction markets, betting, exchanges, Polymarket, Kalshi, regulation, or the app itself unless the event title is explicitly about those things.',
    ...buildHomeFeaturedNewsSearchPromptLines().map((line) => `- ${line}`),
    '- Search for the event title, named entities, and close real-world variants. For yes/no markets, look for reporting that helps understand the likelihood of the event outcome.',
    '- Treat source hints as publication/domain hints. If a hint is an RSS feed, homepage, sitemap, section URL, or article URL, infer the publication/domain and search broadly within or around that source.',
    '- Prefer directly relevant article pages published recently. Avoid homepages, RSS feeds, search pages, tag pages, and social profile pages.',
    '- Before returning a result, verify it is about the event topic itself and not generic prediction-market industry news.',
    `- Do not invent URLs. Return at most ${HOME_FEATURED_NEWS_LIMIT} results.`,
    `Event title: ${input.title}`,
    `Event end date: ${input.endDate ?? 'Not provided'}`,
    `Return headlines in language: ${input.locale ?? DEFAULT_LOCALE}`,
    `Event slug: ${input.slug ?? 'Not provided'}`,
    `Source hints: ${input.newsSources ?? 'Not provided'}`,
  ].join('\n\n')

  const content = await requestOpenRouterCompletion(
    [
      {
        role: 'system',
        content:
          'You are a careful news researcher. Return compact valid JSON only. Relevance is more important than count.',
      },
      {
        role: 'user',
        content: sanitizeForPrompt(prompt),
      },
    ],
    {
      apiKey: openRouter.apiKey,
      model: openRouter.model,
      temperature: 0.1,
      maxTokens: 1600,
      webSearch: true,
      webSearchContextSize: 'high',
    },
  )

  const rawResults = parseAiNewsResults(content)
  const seenUrls = new Set<string>()
  const metadataResults = await Promise.allSettled(
    rawResults.slice(0, HOME_FEATURED_NEWS_LIMIT).map(async (item) => {
      try {
        const metadata = await fetchHomeFeaturedNewsMetadata(item.url)
        return {
          ...metadata,
          title: item.title?.trim() || metadata.title,
          source: item.source?.trim() || metadata.source,
          publishedAt: item.publishedAt ?? metadata.publishedAt,
        }
      } catch {
        const fallback = await buildAiNewsMetadataFallback(item)
        if (fallback) {
          return fallback
        }

        throw new Error('Could not fetch URL metadata.')
      }
    }),
  )
  const items = metadataResults.flatMap((result) => {
    if (result.status !== 'fulfilled') {
      return []
    }
    if (seenUrls.has(result.value.url)) {
      return []
    }

    seenUrls.add(result.value.url)
    return [result.value]
  })

  return items
}

async function readSavedHomeFeaturedNews(featuredId: string, eventId: string, locale: SupportedLocale) {
  'use cache'
  cacheLife({ stale: 0, revalidate: 60, expire: 300 })
  cacheTag(cacheTags.homeFeaturedEvents, cacheTags.settings)

  async function readLocale(savedLocale: SupportedLocale) {
    const { data, error } = await HomeFeaturedEventsRepository.listContextItems([featuredId], savedLocale, {
      eventIdsByFeaturedId: new Map([[featuredId, eventId]]),
      itemType: 'news',
    })
    if (error) {
      throw new Error(error)
    }
    return data?.get(featuredId) ?? []
  }

  const localizedItems = await readLocale(locale)
  return localizedItems.length > 0 || locale === DEFAULT_LOCALE ? localizedItems : readLocale(DEFAULT_LOCALE)
}

export async function loadHomeFeaturedNews(
  featuredId: string,
  event: Pick<Event, 'id' | 'slug' | 'title' | 'end_date'>,
  locale: SupportedLocale,
  newsSources: string[],
  refreshMissing = false,
): Promise<HomeFeaturedContextItem[]> {
  try {
    if (!refreshMissing) {
      return await readSavedHomeFeaturedNews(featuredId, event.id, locale)
    }

    const { data: allSettings } = await SettingsRepository.getSettings()
    const openRouter = parseOpenRouterProviderSettings(allSettings ?? undefined)
    if (!openRouter.apiKey) {
      return await readSavedHomeFeaturedNews(featuredId, event.id, locale)
    }

    const { data, error } = await HomeFeaturedEventsRepository.getOrCreateContextItems(
      featuredId,
      event.id,
      locale,
      async () => {
        const news = await findHomeFeaturedNews(
          {
            title: event.title,
            slug: event.slug,
            endDate: event.end_date,
            locale,
            newsSources: newsSources.join('\n'),
          },
          openRouter,
        )
        const expiresAt = new Date(Date.now() + HOME_FEATURED_NEWS_TTL_MS)
        return news.map((item) => ({
          ...item,
          itemType: 'news' as const,
          locale,
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
          expiresAt,
          isManual: false,
        }))
      },
    )
    if (error) {
      throw new Error(error)
    }
    return data?.length ? data : await readSavedHomeFeaturedNews(featuredId, event.id, locale)
  } catch (error) {
    console.error('Failed to refresh home featured news', error)
    return refreshMissing ? readSavedHomeFeaturedNews(featuredId, event.id, locale).catch(() => []) : []
  }
}
