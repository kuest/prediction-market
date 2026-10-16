import { and, desc, eq, sql } from 'drizzle-orm'
import { getExtracted } from 'next-intl/server'
import { cacheLife, cacheTag } from 'next/cache'

import type { SupportedLocale } from '@/i18n/locales'
import type {
  Comment,
  Event,
  EventLiveChartConfig,
  EventSeriesEntry,
  HomeFeaturedCardKind,
  HomeFeaturedContextItem,
  HomeFeaturedContextMode,
  HomeFeaturedEventCard,
  HomeFeaturedHotTopic,
  HomeFeaturedOutcomeSummary,
  HomeFeaturedRolloverEvent,
  HomeFeaturedSideCardSettings,
  HomeFeaturedSettings,
  HomeFeaturedSportsMarketGroup,
  Market,
} from '@/types'

import { DEFAULT_LOCALE } from '@/i18n/locales'
import { cacheTags } from '@/lib/cache-tags'
import { buildCommunityApiUrl } from '@/lib/community-url'
import { OUTCOME_INDEX } from '@/lib/constants'
import { EventRepository } from '@/lib/db/queries/event'
import { HomeFeaturedEventsRepository } from '@/lib/db/queries/home-featured-events'
import { SettingsRepository } from '@/lib/db/queries/settings'
import { event_tags, events, markets, tag_translations, tags } from '@/lib/db/schema/events/tables'
import { runQuery } from '@/lib/db/utils/run-query'
import { db } from '@/lib/drizzle'
import { buildPublicEventListVisibilityCondition } from '@/lib/event-visibility'
import { resolveEventPagePath } from '@/lib/events-routing'
import { formatDollarValueLabel } from '@/lib/formatters'
import { loadHomeFeaturedNews } from '@/lib/home-featured-news'
import { findNextHomeFeaturedSeriesEvent, isHomeFeaturedEventEnded } from '@/lib/home-featured-rollover'
import { getHomeFeaturedSettingsFromSettings } from '@/lib/home-featured-settings'
import { HOME_INITIAL_EVENTS_CACHE_LIFE } from '@/lib/home-initial-events-cache'
import { resolveDisplayPrice } from '@/lib/market-chance'
import { resolvePublicRuntimeEnv } from '@/lib/public-runtime-config.shared'
import { isSportsEvent, resolveSportsEventGroupPayload } from '@/lib/sports-event-group'
import { buildHomeSportsMoneylineModel, resolveHomeSportsButtonChance } from '@/lib/sports-home-card'
import { getPublicAssetUrl } from '@/lib/storage'

const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)']
const FEATURED_COMMENTS_LIMIT = 8
const FEATURED_CONTEXT_ITEMS_PER_EVENT = 6
const MIN_COMMENTS_FOR_SERIES = 3
const CONTEXT_ITEM_TTL_MS = 30 * 60 * 1000
const FEATURED_HOT_TOPICS_TARGET_COUNT = 5
const FEATURED_HOT_TOPICS_RECENT_RESOLVED_WINDOW_MS = 36 * 60 * 60 * 1000
const FEATURED_HOT_TOPICS_FALLBACK_RESOLVED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

interface HomeFeaturedLiveSeriesData {
  config: EventLiveChartConfig | null
  seriesEvents: EventSeriesEntry[]
  nextEvent: HomeFeaturedRolloverEvent | null
}

function isNegRiskEvent(event: Event) {
  return Boolean(event.neg_risk || event.enable_neg_risk || event.neg_risk_augmented || event.neg_risk_market_id)
}

function getActiveMarkets(event: Event) {
  const activeMarkets = event.markets.filter(
    (market) => market.is_active && !market.is_resolved && !market.condition?.resolved,
  )
  return activeMarkets.length > 0 ? activeMarkets : event.markets
}

function resolveCardKind(event: Event): HomeFeaturedCardKind {
  if (isSportsEvent(event)) {
    return 'sports'
  }

  if (isNegRiskEvent(event) || getActiveMarkets(event).length > 2) {
    return 'neg-risk'
  }

  return 'standard'
}

function resolveMarketChance(market: Market) {
  if (typeof market.price === 'number' && Number.isFinite(market.price)) {
    return Math.max(0, Math.min(100, market.price * 100))
  }

  const yesOutcome = market.outcomes.find((outcome) => outcome.outcome_index === OUTCOME_INDEX.YES)
  const noOutcome = market.outcomes.find((outcome) => outcome.outcome_index === OUTCOME_INDEX.NO)
  const yesDisplayPrice = resolveDisplayPrice({
    bid: yesOutcome?.sell_price ?? null,
    ask: yesOutcome?.buy_price ?? null,
    lastTrade: null,
  })
  if (yesDisplayPrice != null) {
    return yesDisplayPrice * 100
  }

  const noDisplayPrice = resolveDisplayPrice({
    bid: noOutcome?.sell_price ?? null,
    ask: noOutcome?.buy_price ?? null,
    lastTrade: null,
  })

  return noDisplayPrice == null ? 0 : (1 - noDisplayPrice) * 100
}

function resolveOutcomeImageUrl(market: Market) {
  const metadata =
    market.metadata && typeof market.metadata === 'object' ? (market.metadata as Record<string, unknown>) : null
  const metadataImage =
    typeof metadata?.image === 'string'
      ? metadata.image
      : typeof metadata?.icon_url === 'string'
        ? metadata.icon_url
        : typeof metadata?.iconUrl === 'string'
          ? metadata.iconUrl
          : null

  return metadataImage || market.icon_url || null
}

function resolveFeaturedMarketOutcomeIndex(market: Market) {
  return (
    market.outcomes.find((outcome) => outcome.outcome_index === OUTCOME_INDEX.YES)?.outcome_index ??
    market.outcomes[0]?.outcome_index ??
    OUTCOME_INDEX.YES
  )
}

function buildTopOutcomes(event: Event, kind: HomeFeaturedCardKind): HomeFeaturedOutcomeSummary[] {
  const activeMarkets = getActiveMarkets(event)

  if (kind === 'standard') {
    const primaryMarket = activeMarkets[0]
    if (!primaryMarket) {
      return []
    }

    return primaryMarket.outcomes.slice(0, 2).map((outcome, index) => {
      const chance =
        outcome.outcome_index === OUTCOME_INDEX.NO
          ? Math.max(0, Math.min(100, 100 - resolveMarketChance(primaryMarket)))
          : resolveMarketChance(primaryMarket)

      return {
        key: `${primaryMarket.condition_id}:${outcome.outcome_index}`,
        conditionId: primaryMarket.condition_id,
        marketSlug: primaryMarket.slug,
        outcomeIndex: outcome.outcome_index,
        label: outcome.outcome_text,
        chance,
        imageUrl: null,
        color: CHART_COLORS[index % CHART_COLORS.length]!,
      }
    })
  }

  return activeMarkets
    .map((market, index) => ({
      key: market.condition_id,
      conditionId: market.condition_id,
      marketSlug: market.slug,
      outcomeIndex: resolveFeaturedMarketOutcomeIndex(market),
      label: market.short_title || market.title,
      chance: resolveMarketChance(market),
      imageUrl: resolveOutcomeImageUrl(market),
      color: CHART_COLORS[index % CHART_COLORS.length]!,
    }))
    .sort((left, right) => right.chance - left.chance)
    .slice(0, 4)
    .map((item, index) => ({
      ...item,
      color: CHART_COLORS[index % CHART_COLORS.length]!,
    }))
}

function buildPrimaryMarkets(event: Event, kind: HomeFeaturedCardKind) {
  const activeMarkets = getActiveMarkets(event)

  if (kind === 'standard') {
    return activeMarkets.slice(0, 1)
  }

  if (kind === 'sports') {
    return activeMarkets.slice(0, 6)
  }

  return activeMarkets
    .slice()
    .sort((left, right) => resolveMarketChance(right) - resolveMarketChance(left))
    .slice(0, 4)
}

function normalizeSportsMarketType(value: string | null | undefined) {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ') ?? ''
  )
}

const HOME_FEATURED_SPORTS_LINE_MARKET_LIMIT = 8

function buildSportsMarketGroups(event: Event): HomeFeaturedSportsMarketGroup[] {
  const model = buildHomeSportsMoneylineModel(event)
  const groups: HomeFeaturedSportsMarketGroup[] = []

  if (model) {
    const buttons = [
      {
        conditionId: model.team1Button.conditionId,
        label: model.team1.name,
        chance: resolveHomeSportsButtonChance(
          event.markets.find((market) => market.condition_id === model.team1Button.conditionId)?.price
            ? event.markets.find((market) => market.condition_id === model.team1Button.conditionId)!.price * 100
            : null,
          model.team1Button.outcomeIndex,
        ),
        tone: 'home' as const,
        color: model.team1Button.color,
      },
      ...(model.drawButton
        ? [
            {
              conditionId: model.drawButton.conditionId,
              label: 'Draw',
              chance: resolveHomeSportsButtonChance(
                event.markets.find((market) => market.condition_id === model.drawButton?.conditionId)?.price
                  ? event.markets.find((market) => market.condition_id === model.drawButton?.conditionId)!.price * 100
                  : null,
                model.drawButton.outcomeIndex,
              ),
              tone: 'draw' as const,
              color: model.drawButton.color,
            },
          ]
        : []),
      {
        conditionId: model.team2Button.conditionId,
        label: model.team2.name,
        chance: resolveHomeSportsButtonChance(
          event.markets.find((market) => market.condition_id === model.team2Button.conditionId)?.price
            ? event.markets.find((market) => market.condition_id === model.team2Button.conditionId)!.price * 100
            : null,
          model.team2Button.outcomeIndex,
        ),
        tone: 'away' as const,
        color: model.team2Button.color,
      },
    ]

    groups.push({ label: 'Moneyline', markets: buttons })
  }

  const compactGroups = new Map<string, Market[]>()
  for (const market of getActiveMarkets(event)) {
    const type = normalizeSportsMarketType(market.sports_market_type)
    const label =
      type.includes('spread') || type.includes('handicap')
        ? 'Spread'
        : type.includes('total') || type.includes('over under')
          ? 'Total'
          : ''

    if (!label) {
      continue
    }

    const markets = compactGroups.get(label) ?? []
    if (markets.length < HOME_FEATURED_SPORTS_LINE_MARKET_LIMIT) {
      markets.push(market)
      compactGroups.set(label, markets)
    }
  }

  for (const [label, markets] of compactGroups) {
    groups.push({
      label,
      markets: markets.map((market) => ({
        conditionId: market.condition_id,
        label: market.short_title || market.title,
        chance: resolveMarketChance(market),
        tone: 'neutral',
        color: null,
      })),
    })
  }

  return groups.slice(0, 3)
}

function resolveFeaturedSportsDisplayEvent(baseEvent: Event, eventsGroup: Event[]) {
  return (
    eventsGroup.find((event) => event.sports_parent_event_id == null) ??
    eventsGroup.find((event) => (event.sports_teams?.length ?? 0) >= 2) ??
    baseEvent
  )
}

async function resolveFeaturedSportsEventPayload(event: Event, locale: SupportedLocale) {
  return resolveSportsEventGroupPayload(event, locale, {
    warningLabel: 'featured sports event group',
    resolveDisplayEvent: resolveFeaturedSportsDisplayEvent,
  })
}

async function loadHomeFeaturedEvent(eventSlug: string, locale: SupportedLocale) {
  'use cache'
  cacheLife(HOME_INITIAL_EVENTS_CACHE_LIFE)
  cacheTag(cacheTags.event(eventSlug), cacheTags.eventsList, cacheTags.homeFeaturedEvents)

  const { data } = await EventRepository.getEventBySlug(eventSlug, '', locale)
  return data ? resolveFeaturedSportsEventPayload(data, locale) : null
}

async function loadHomeFeaturedEvents(eventSlugs: string[], locale: SupportedLocale) {
  'use cache'
  const normalizedSlugs = Array.from(new Set(eventSlugs.map((slug) => slug.trim()).filter(Boolean)))
  cacheLife(HOME_INITIAL_EVENTS_CACHE_LIFE)
  cacheTag(
    cacheTags.eventsList,
    cacheTags.homeFeaturedEvents,
    ...normalizedSlugs.map((eventSlug) => cacheTags.event(eventSlug)),
  )

  if (normalizedSlugs.length === 0) {
    return []
  }

  const { data, error } = await EventRepository.getEventsBySlugs(normalizedSlugs, '', locale)
  if (error) {
    const fallbackEvents = await Promise.all(
      normalizedSlugs.map(async (requestedSlug) => {
        const event = await loadHomeFeaturedEvent(requestedSlug, locale)
        return event ? { requestedSlug, event } : null
      }),
    )
    return fallbackEvents.filter((event): event is NonNullable<typeof event> => event !== null)
  }

  const eventsBySlug = new Map((data ?? []).map((event) => [event.slug, event]))
  const resolvedEvents = await Promise.all(
    normalizedSlugs.map(async (requestedSlug) => {
      const event = eventsBySlug.get(requestedSlug)
      return event ? { requestedSlug, event: await resolveFeaturedSportsEventPayload(event, locale) } : null
    }),
  )
  return resolvedEvents.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
}

async function loadHomeFeaturedLiveChartConfig(seriesSlug: string) {
  'use cache'
  cacheLife(HOME_INITIAL_EVENTS_CACHE_LIFE)
  cacheTag(cacheTags.eventsList, cacheTags.homeFeaturedEvents)

  return EventRepository.getLiveChartConfigBySeriesSlug(seriesSlug)
}

async function loadHomeFeaturedSeriesEvents(seriesSlug: string) {
  'use cache'
  cacheLife(HOME_INITIAL_EVENTS_CACHE_LIFE)
  cacheTag(cacheTags.eventsList, cacheTags.homeFeaturedEvents)

  return EventRepository.getSeriesEventsBySeriesSlug(seriesSlug)
}

function buildHomeFeaturedRolloverEvent(
  event: Event,
  locale: SupportedLocale,
  contextItems: HomeFeaturedContextItem[],
): HomeFeaturedRolloverEvent {
  const kind = resolveCardKind(event)
  const temporal = resolveTemporalStatus(event, locale)

  return {
    event,
    kind,
    primaryMarkets: buildPrimaryMarkets(event, kind),
    topOutcomes: buildTopOutcomes(event, kind),
    resolvedEventId: event.id,
    contextItems,
    temporalStatus: temporal.temporalStatus,
    temporalLabel: temporal.temporalLabel,
    sportsMarketGroups: kind === 'sports' ? buildSportsMarketGroups(event) : [],
  }
}

export async function getNextHomeFeaturedSeriesRolloverEvent(
  currentEventSlug: string,
  featuredId: string,
  locale: SupportedLocale = DEFAULT_LOCALE,
) {
  const { data: allSettings } = await loadHomeFeaturedSettings()
  const settings = getHomeFeaturedSettingsFromSettings(allSettings ?? undefined)
  if (!settings.enabled) {
    return null
  }
  const { data: targets } = await HomeFeaturedEventsRepository.resolvePublicTargets(settings.maxCards)
  const target = targets?.find((entry) => entry.featuredId === featuredId && entry.targetType === 'series')
  if (!target) {
    return null
  }
  const { data: currentEvent, error: currentEventError } = await EventRepository.getEventBySlug(
    currentEventSlug,
    '',
    locale,
  )
  if (currentEventError) {
    throw currentEventError
  }
  if (!currentEvent?.series_slug || currentEvent.series_slug !== target.seriesSlug) {
    return null
  }

  const { data: seriesEvents, error: seriesEventsError } = await EventRepository.getSeriesEventsBySeriesSlug(
    currentEvent.series_slug,
  )
  if (seriesEventsError) {
    throw seriesEventsError
  }

  const now = Date.now()
  const liveSeriesEntry = (seriesEvents ?? [])
    .filter((entry) => entry.status === 'active' && Date.parse(entry.end_date ?? '') > now)
    .sort((left, right) => Date.parse(left.end_date!) - Date.parse(right.end_date!))[0]
  const previousSeriesEntry = (seriesEvents ?? [])
    .filter(
      (entry) =>
        entry.status === 'resolved' ||
        entry.status === 'archived' ||
        Boolean(entry.resolved_at) ||
        Date.parse(entry.end_date ?? '') <= now,
    )
    .sort((left, right) => Date.parse(right.end_date!) - Date.parse(left.end_date!))[0]
  const isImmediatePredecessor =
    Boolean(liveSeriesEntry) &&
    currentEvent.id === previousSeriesEntry?.id &&
    isHomeFeaturedEventEnded(currentEvent, now)
  if (currentEvent.id !== target.eventId && currentEvent.id !== liveSeriesEntry?.id && !isImmediatePredecessor) {
    return null
  }

  const nextSeriesEntry = findNextHomeFeaturedSeriesEvent(seriesEvents ?? [], currentEvent, now)
  const nextEvent = nextSeriesEntry ? await loadHomeFeaturedEvent(nextSeriesEntry.slug, locale) : null
  const contextInput = {
    targetType: target.targetType,
    mode: resolveEffectiveContextMode(target.contextMode, settings.defaultContextMode),
    featuredId: target.featuredId,
    settings,
    locale,
    refreshNews: true,
  }
  const [contextItems, nextContextItems] = await Promise.all([
    isImmediatePredecessor ? [] : resolveContextItems({ ...contextInput, event: currentEvent }),
    nextEvent ? resolveContextItems({ ...contextInput, event: nextEvent }) : [],
  ])

  return {
    currentEventId: currentEvent.id,
    contextItems,
    nextEvent: nextEvent ? buildHomeFeaturedRolloverEvent(nextEvent, locale, nextContextItems) : null,
  }
}

function resolveHotTopicHref(slug: string) {
  return `/${slug.trim().toLowerCase()}`
}

export async function listHomeFeaturedHotTopics(
  locale: SupportedLocale = DEFAULT_LOCALE,
): Promise<HomeFeaturedHotTopic[]> {
  'use cache'
  cacheLife(HOME_INITIAL_EVENTS_CACHE_LIFE)
  cacheTag(cacheTags.events('guest'), cacheTags.eventsList)

  const volume24h = sql<number>`COALESCE(SUM(${markets.volume_24h}), 0)::double precision`
  const fallbackVolume = sql<number>`
    COALESCE(
      NULLIF(SUM(${markets.volume}), 0),
      COUNT(${markets.condition_id})::double precision,
      0
    )::double precision
  `
  const localizedName = sql<string>`COALESCE(${tag_translations.name}, ${tags.name})`
  interface HotTopicVolumeRow {
    slug: string
    label: string
    volume24h: number
    fallbackVolume: number
  }

  function mergeHotTopicRows(rows: HotTopicVolumeRow[], includeFallbackVolume: boolean) {
    const topicsBySlug = new Map<string, HomeFeaturedHotTopic & { score: number }>()

    for (const row of rows) {
      const slug = row.slug.trim()
      const volume24hValue = Number(row.volume24h ?? 0)
      const fallbackVolumeValue = Number(row.fallbackVolume ?? 0)
      const topicScore = volume24hValue > 0 ? volume24hValue : includeFallbackVolume ? fallbackVolumeValue : 0

      if (!slug || topicScore <= 0) {
        continue
      }

      const existing = topicsBySlug.get(slug)
      topicsBySlug.set(slug, {
        label: existing?.label ?? row.label,
        slug,
        href: resolveHotTopicHref(slug),
        volume24h: (existing?.volume24h ?? 0) + Math.max(0, volume24hValue),
        score: (existing?.score ?? 0) + topicScore,
      })
    }

    return Array.from(topicsBySlug.values())
      .sort((left, right) => right.score - left.score)
      .slice(0, FEATURED_HOT_TOPICS_TARGET_COUNT)
      .map(({ score: _score, ...topic }) => topic)
  }

  function appendMissingHotTopics(primaryTopics: HomeFeaturedHotTopic[], fallbackTopics: HomeFeaturedHotTopic[]) {
    const nextTopics = [...primaryTopics]
    const seenSlugs = new Set(primaryTopics.map((topic) => topic.slug))

    for (const topic of fallbackTopics) {
      if (seenSlugs.has(topic.slug)) {
        continue
      }

      nextTopics.push(topic)
      seenSlugs.add(topic.slug)
      if (nextTopics.length >= FEATURED_HOT_TOPICS_TARGET_COUNT) {
        break
      }
    }

    return nextTopics.sort((left, right) => right.volume24h - left.volume24h).slice(0, FEATURED_HOT_TOPICS_TARGET_COUNT)
  }

  const { data, error } = await runQuery(async () => {
    const activeRows = await db
      .select({
        slug: tags.slug,
        label: localizedName,
        volume24h,
        fallbackVolume,
      })
      .from(tags)
      .innerJoin(event_tags, eq(event_tags.tag_id, tags.id))
      .innerJoin(events, eq(events.id, event_tags.event_id))
      .innerJoin(markets, eq(markets.event_id, events.id))
      .leftJoin(tag_translations, and(eq(tag_translations.tag_id, tags.id), eq(tag_translations.locale, locale)))
      .where(
        and(
          eq(tags.is_main_category, true),
          eq(tags.is_hidden, false),
          eq(events.status, 'active'),
          eq(events.is_hidden, false),
          eq(markets.is_active, true),
          eq(markets.is_resolved, false),
          buildPublicEventListVisibilityCondition(events.id),
        ),
      )
      .groupBy(tags.id, tags.slug, tags.name, tag_translations.name)
      .orderBy(desc(volume24h))

    async function listResolvedHotTopicRows(cutoff: Date) {
      const cutoffIso = cutoff.toISOString()

      return db
        .select({
          slug: tags.slug,
          label: localizedName,
          volume24h,
          fallbackVolume,
        })
        .from(tags)
        .innerJoin(event_tags, eq(event_tags.tag_id, tags.id))
        .innerJoin(events, eq(events.id, event_tags.event_id))
        .innerJoin(markets, eq(markets.event_id, events.id))
        .leftJoin(tag_translations, and(eq(tag_translations.tag_id, tags.id), eq(tag_translations.locale, locale)))
        .where(
          and(
            eq(tags.is_main_category, true),
            eq(tags.is_hidden, false),
            eq(events.status, 'resolved'),
            eq(events.is_hidden, false),
            eq(markets.is_resolved, true),
            sql`COALESCE(${events.resolved_at}, ${events.end_date}) >= ${cutoffIso}::timestamptz`,
            buildPublicEventListVisibilityCondition(events.id),
          ),
        )
        .groupBy(tags.id, tags.slug, tags.name, tag_translations.name)
        .orderBy(desc(volume24h))
    }

    const recentResolvedCutoff = new Date(Date.now() - FEATURED_HOT_TOPICS_RECENT_RESOLVED_WINDOW_MS)
    const recentResolvedRows = await listResolvedHotTopicRows(recentResolvedCutoff)
    const primaryTopics = mergeHotTopicRows([...activeRows, ...recentResolvedRows], false)

    if (primaryTopics.length >= FEATURED_HOT_TOPICS_TARGET_COUNT) {
      return { data: primaryTopics, error: null }
    }

    const fallbackResolvedCutoff = new Date(Date.now() - FEATURED_HOT_TOPICS_FALLBACK_RESOLVED_WINDOW_MS)
    const fallbackResolvedRows = await listResolvedHotTopicRows(fallbackResolvedCutoff)
    const fallbackTopics = mergeHotTopicRows([...activeRows, ...fallbackResolvedRows], true)

    return { data: appendMissingHotTopics(primaryTopics, fallbackTopics), error: null }
  })

  if (error || !data) {
    console.error('Failed to load home featured hot topics', error)
    return []
  }

  return data
}

async function buildHomeFeaturedSideCard(input: {
  configured: HomeFeaturedSideCardSettings
  featuredEvents: HomeFeaturedEventCard[]
  hotTopics: HomeFeaturedHotTopic[]
  locale: SupportedLocale
}): Promise<HomeFeaturedSideCardSettings> {
  const { configured, featuredEvents, hotTopics, locale } = input
  const t = await getExtracted({ locale })

  function buildSlide(slide: HomeFeaturedSideCardSettings['slides'][number]) {
    if (slide.type !== 'text' || !slide.useAi) {
      return slide
    }

    const liveEvent = featuredEvents.find((item) => item.temporalStatus === 'live')
    if (liveEvent) {
      return {
        ...slide,
        title: t('Live market focus'),
        text: t('{eventTitle} is live now with {volume} total volume.', {
          eventTitle: liveEvent.event.title,
          volume: formatDollarValueLabel(liveEvent.event.volume, { maximumFractionDigits: 0 }),
        }),
        ctaLabel: slide.ctaLabel || t('Open market'),
        ctaHref: slide.ctaHref || resolveEventPagePath(liveEvent.event),
        icon: 'flame' as const,
      }
    }

    const topTopic = hotTopics[0]
    if (topTopic) {
      return {
        ...slide,
        title: t('{categoryName} leads volume', { categoryName: topTopic.label }),
        text: t('{volume} tracked across active and recently settled markets.', {
          volume: formatDollarValueLabel(topTopic.volume24h, { maximumFractionDigits: 0 }),
        }),
        ctaLabel: slide.ctaLabel || t('Explore topic'),
        ctaHref: slide.ctaHref || topTopic.href,
        icon: 'trending-up' as const,
      }
    }

    const firstEvent = featuredEvents[0]
    if (firstEvent) {
      return {
        ...slide,
        title: t('Featured market'),
        text: firstEvent.event.title,
        ctaLabel: slide.ctaLabel || t('Open market'),
        ctaHref: slide.ctaHref || resolveEventPagePath(firstEvent.event),
        icon: 'sparkles' as const,
      }
    }

    return slide
  }

  const slides = configured.slides.map(buildSlide)
  return {
    ...(slides[0] ?? configured),
    slides,
  }
}

async function loadHomeFeaturedSettings() {
  'use cache'
  cacheLife(HOME_INITIAL_EVENTS_CACHE_LIFE)
  cacheTag(cacheTags.settings)

  return SettingsRepository.getSettings()
}

export async function getHomeFeaturedSideCard(
  featuredEvents: HomeFeaturedEventCard[],
  hotTopics: HomeFeaturedHotTopic[],
  locale: SupportedLocale = DEFAULT_LOCALE,
): Promise<HomeFeaturedSideCardSettings> {
  const { data: allSettings, error: settingsError } = await loadHomeFeaturedSettings()
  if (settingsError) {
    console.error('Failed to load home featured side card settings', settingsError)
  }

  const settings = getHomeFeaturedSettingsFromSettings(allSettings ?? undefined)
  const sideCard = await buildHomeFeaturedSideCard({
    configured: settings.sideCard,
    featuredEvents,
    hotTopics,
    locale,
  })
  const slides = sideCard.slides
    .filter((slide) => slide.enabled)
    .map((slide) => ({
      ...slide,
      imageUrl: getPublicAssetUrl(slide.imagePath) ?? '',
    }))
    .filter((slide) => slide.type !== 'image' || Boolean(slide.imageUrl))

  return {
    ...sideCard,
    imageUrl: getPublicAssetUrl(sideCard.imagePath) ?? '',
    slides,
  }
}

function formatEndDateLabel(endDate: string | null, locale: SupportedLocale) {
  if (!endDate) {
    return 'Ends later'
  }

  const date = new Date(endDate)
  if (!Number.isFinite(date.getTime())) {
    return 'Ends later'
  }

  return `Ends ${new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)}`
}

function resolveTemporalStatus(event: Event, locale: SupportedLocale) {
  if (isSportsEvent(event)) {
    if (event.sports_live) {
      return {
        temporalStatus: 'live' as const,
        temporalLabel: 'LIVE',
      }
    }

    return {
      temporalStatus: 'ends' as const,
      temporalLabel: formatEndDateLabel(event.end_date, locale),
    }
  }

  if (event.has_live_chart) {
    return {
      temporalStatus: 'live' as const,
      temporalLabel: 'LIVE',
    }
  }

  const recurrence = event.series_recurrence?.trim().toLowerCase()
  if (recurrence === 'daily') {
    return {
      temporalStatus: 'daily' as const,
      temporalLabel: 'Daily',
    }
  }

  if (recurrence === 'monthly') {
    return {
      temporalStatus: 'monthly' as const,
      temporalLabel: 'Monthly',
    }
  }

  return {
    temporalStatus: 'ends' as const,
    temporalLabel: formatEndDateLabel(event.end_date, locale),
  }
}

function shouldPreferComments(event: Event, targetType: 'event' | 'series') {
  const recurrence = event.series_recurrence?.trim().toLowerCase()
  return (
    targetType === 'series' ||
    recurrence === 'daily' ||
    recurrence === 'weekly' ||
    recurrence === 'monthly' ||
    Boolean(event.has_live_chart || event.sports_live)
  )
}

function resolveEffectiveContextMode(configuredMode: HomeFeaturedContextMode, defaultMode: HomeFeaturedContextMode) {
  return configuredMode === 'auto' && defaultMode !== 'auto' ? defaultMode : configuredMode
}

function sanitizeCommentContent(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 140)
}

function containsBlacklistedCommentTerm(value: string, blacklist: string[]) {
  const normalizedValue = value.toLowerCase()
  return blacklist.some((term) => term.trim() && normalizedValue.includes(term.trim().toLowerCase()))
}

async function fetchCompactComments(
  eventSlug: string,
  blacklist: string[],
): Promise<{ hasEnoughSeriesComments: boolean; items: HomeFeaturedContextItem[] }> {
  'use cache'
  cacheLife(HOME_INITIAL_EVENTS_CACHE_LIFE)
  cacheTag(cacheTags.event(eventSlug), cacheTags.homeFeaturedEvents)

  const { communityUrl } = resolvePublicRuntimeEnv(process.env)
  if (!communityUrl) {
    return { hasEnoughSeriesComments: false, items: [] }
  }

  try {
    const url = buildCommunityApiUrl(communityUrl, '/comments')
    url.searchParams.set('event_slug', eventSlug)
    url.searchParams.set('limit', String(FEATURED_COMMENTS_LIMIT))
    url.searchParams.set('offset', '0')
    url.searchParams.set('sort', 'recent')

    const response = await fetch(url.toString(), {
      next: { revalidate: 30 },
    })
    if (!response.ok) {
      return { hasEnoughSeriesComments: false, items: [] }
    }

    const payload = await response.json()
    const comments = Array.isArray(payload) ? (payload as Comment[]) : []
    const visibleComments = comments.filter((comment) => !containsBlacklistedCommentTerm(comment.content, blacklist))
    const now = new Date()
    const expiresAt = new Date(now.getTime() + CONTEXT_ITEM_TTL_MS)

    const items = visibleComments
      .filter((comment) => sanitizeCommentContent(comment.content).length > 0)
      .slice(0, FEATURED_CONTEXT_ITEMS_PER_EVENT)
      .map((comment) => ({
        id: `comment:${comment.id}`,
        type: 'comment' as const,
        source: comment.username || 'Community',
        title: sanitizeCommentContent(comment.content),
        avatarUrl: comment.user_avatar || null,
        avatarSeed: comment.user_proxy_wallet_address || comment.user_address || comment.username || 'user',
        faviconUrl: null,
        url: null,
        publishedAt: comment.created_at ?? null,
        selectedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        relevanceScore:
          typeof comment.likes_count === 'number' ? Math.min(1, Math.max(0, comment.likes_count / 20)) : null,
        isManual: false,
      }))

    return {
      hasEnoughSeriesComments: visibleComments.length >= MIN_COMMENTS_FOR_SERIES,
      items,
    }
  } catch {
    return { hasEnoughSeriesComments: false, items: [] }
  }
}

async function resolveContextItems(input: {
  event: Event
  targetType: 'event' | 'series'
  mode: HomeFeaturedContextMode
  featuredId: string
  settings: HomeFeaturedSettings
  locale: SupportedLocale
  refreshNews?: boolean
}) {
  const { event, targetType, mode, featuredId, settings, locale } = input
  if (mode === 'hidden') {
    return []
  }

  const comments =
    mode === 'news'
      ? { items: [], hasEnoughSeriesComments: false }
      : await fetchCompactComments(event.slug, settings.commentBlacklist)
  if (
    mode === 'comments' ||
    (mode === 'auto' && shouldPreferComments(event, targetType) && comments.hasEnoughSeriesComments)
  ) {
    return comments.items
  }

  const newsItems = await loadHomeFeaturedNews(
    featuredId,
    { id: event.id, title: event.title, slug: event.slug, end_date: event.end_date },
    locale,
    settings.newsSources,
    input.refreshNews,
  )
  if (newsItems.length > 0) {
    return newsItems
  }

  return comments.items
}

export async function listHomeFeaturedEvents(
  locale: SupportedLocale = DEFAULT_LOCALE,
): Promise<HomeFeaturedEventCard[]> {
  const { data: allSettings, error: settingsError } = await loadHomeFeaturedSettings()
  if (settingsError) {
    console.error('Failed to load home featured settings', settingsError)
    return []
  }

  const settings = getHomeFeaturedSettingsFromSettings(allSettings ?? undefined)

  if (!settings.enabled) {
    return []
  }

  const { data: resolvedTargets, error } = await HomeFeaturedEventsRepository.resolvePublicTargets(settings.maxCards)
  if (error) {
    console.error('Failed to resolve home featured targets', error)
    return []
  }

  const targets = resolvedTargets ?? []
  if (targets.length === 0) {
    console.warn('Home featured markets are enabled, but no public targets were resolved.')
    return []
  }

  const featuredEvents = await loadHomeFeaturedEvents(
    targets.map((target) => target.eventSlug),
    locale,
  )
  const eventsBySlug = new Map(featuredEvents.map(({ requestedSlug, event }) => [requestedSlug, event]))
  const resolvedEvents = targets
    .map((target) => {
      const event = eventsBySlug.get(target.eventSlug)
      return event ? { target, event } : null
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
  if (resolvedEvents.length === 0) {
    console.warn(
      'Home featured targets were resolved, but their event payloads could not be loaded.',
      targets.map((target) => ({
        eventId: target.eventId,
        eventSlug: target.eventSlug,
        targetType: target.targetType,
      })),
    )
    return []
  }
  const liveSeriesEntries: Array<readonly [string, HomeFeaturedLiveSeriesData]> = await Promise.all(
    resolvedEvents.map(async ({ event, target }) => {
      if (target.targetType !== 'series' || !event.series_slug) {
        return [event.id, { config: null, seriesEvents: [], nextEvent: null }] as const
      }

      const [configResult, seriesEventsResult] = await Promise.all([
        loadHomeFeaturedLiveChartConfig(event.series_slug),
        loadHomeFeaturedSeriesEvents(event.series_slug),
      ])
      if (configResult.error) {
        console.warn('Failed to load featured event live chart config:', configResult.error)
      }
      if (seriesEventsResult.error) {
        console.warn('Failed to load featured event series:', seriesEventsResult.error)
      }

      const seriesEvents = seriesEventsResult.data ?? []
      const nextSeriesEntry = findNextHomeFeaturedSeriesEvent(seriesEvents, event)
      const nextEvent = nextSeriesEntry ? await loadHomeFeaturedEvent(nextSeriesEntry.slug, locale) : null

      return [
        event.id,
        {
          config: configResult.data ?? null,
          seriesEvents,
          nextEvent: nextEvent
            ? buildHomeFeaturedRolloverEvent(
                nextEvent,
                locale,
                await resolveContextItems({
                  event: nextEvent,
                  targetType: target.targetType,
                  mode: resolveEffectiveContextMode(target.contextMode, settings.defaultContextMode),
                  featuredId: target.featuredId,
                  settings,
                  locale,
                }),
              )
            : null,
        },
      ] as const
    }),
  )
  const liveSeriesByEventId = new Map(liveSeriesEntries)

  return Promise.all(
    resolvedEvents.map(async (entry, index, all): Promise<HomeFeaturedEventCard> => {
      const { target, event } = entry
      const kind = resolveCardKind(event)
      const mode = resolveEffectiveContextMode(target.contextMode, settings.defaultContextMode)
      const temporal = resolveTemporalStatus(event, locale)
      const liveSeries = liveSeriesByEventId.get(event.id)

      return {
        featuredId: target.featuredId,
        targetType: target.targetType,
        source: target.source,
        rank: target.rank,
        contextMode: mode,
        kind,
        event,
        primaryMarkets: buildPrimaryMarkets(event, kind),
        topOutcomes: buildTopOutcomes(event, kind),
        contextItems: await resolveContextItems({
          event,
          targetType: target.targetType,
          mode,
          featuredId: target.featuredId,
          settings,
          locale,
        }),
        previousTitle: all[index - 1]?.event.title ?? all.at(-1)?.event.title ?? null,
        nextTitle: all[index + 1]?.event.title ?? all[0]?.event.title ?? null,
        resolvedEventId: target.eventId,
        resolvedSeriesSlug: target.seriesSlug,
        temporalStatus: temporal.temporalStatus,
        temporalLabel: temporal.temporalLabel,
        sportsMarketGroups: kind === 'sports' ? buildSportsMarketGroups(event) : [],
        liveChartConfig: liveSeries?.config ?? null,
        seriesEvents: liveSeries?.seriesEvents ?? [],
        nextSeriesEvent: liveSeries?.nextEvent ?? null,
      }
    }),
  )
}
