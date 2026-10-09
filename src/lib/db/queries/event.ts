import {
  Column,
  SQL,
  aliasedTableColumn,
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  getColumnTable,
  getOriginalColumnFromAlias,
  getTableName,
  ilike,
  inArray,
  is,
  not,
  or,
  sql,
} from 'drizzle-orm'
import { cacheLife, cacheTag } from 'next/cache'
import { createHash } from 'node:crypto'

import type { NonDefaultLocale, SupportedLocale } from '@/i18n/locales'
import type { AdminEventAttentionFilter } from '@/lib/admin-event-attention'
import type { OutcomePrices } from '@/lib/clob-event-prices'
import type { EventListSortBy, EventListStatusFilter } from '@/lib/event-list-filters'
import type { SportsSlugResolver } from '@/lib/sports-slug-mapping'
import type { SportsVertical } from '@/lib/sports-vertical'
import type {
  ConditionChangeLogEntry,
  Event,
  EventLiveChartConfig,
  EventSeriesEntry,
  QueryResult,
  SportsSegmentScore,
} from '@/types'

import { DEFAULT_LOCALE, NON_DEFAULT_LOCALES } from '@/i18n/locales'
import { cacheTags } from '@/lib/cache-tags'
import { resolveClobUrl } from '@/lib/clob'
import { EVENT_PRICES_TIMEOUT_MS, fetchOutcomePrices } from '@/lib/clob-event-prices'
import { OUTCOME_INDEX } from '@/lib/constants'
import {
  CRYPTO_CADENCE_ROUTES,
  isCryptoEvent,
  resolveCryptoCadenceEventTitle,
  resolveCryptoCadenceRoute,
  resolveCryptoCadenceRouteSlug,
  resolveCryptoEventAsset,
} from '@/lib/crypto-cadence-event'
import {
  buildMissingSportsSourceCondition,
  buildPastDueUnresolvedEventCondition,
} from '@/lib/db/queries/admin-event-attention'
import { getSportsSlugResolverFromDb } from '@/lib/db/queries/sports-menu'
import { bookmarks } from '@/lib/db/schema/bookmarks/tables'
import {
  conditions,
  conditions_audit,
  event_live_chart_configs,
  event_sports,
  event_tags,
  event_translations,
  events,
  market_sports,
  markets,
  outcomes,
  tag_translations,
  tags,
  v_main_tag_subcategories,
} from '@/lib/db/schema/events/tables'
import { runQuery } from '@/lib/db/utils/run-query'
import { db } from '@/lib/drizzle'
import {
  buildRelatedEventPrimaryOutcomes,
  selectCryptoRelatedEventCandidates,
  selectRelatedEventCandidates,
} from '@/lib/event-related'
import { buildPublicEventListVisibilityCondition, HIDE_FROM_NEW_TAG_SLUG } from '@/lib/event-visibility'
import { resolveSportsSection } from '@/lib/events-routing'
import { resolveDisplayPrice } from '@/lib/market-chance'
import { resolvePublicRuntimeEnv } from '@/lib/public-runtime-config.shared'
import {
  isSportsAuxiliaryEventSlug,
  SPORTS_AUXILIARY_SLUG_SQL_REGEX,
  stripSportsAuxiliaryEventSuffix,
} from '@/lib/sports-event-slugs'
import { normalizeSportsSegmentScores, resolveSportsSourceSegmentCount } from '@/lib/sports-segment-score'
import { resolveCanonicalSportsSportSlug, resolveSportsSportSlugQueryCandidates } from '@/lib/sports-slug-mapping'
import { getPublicAssetUrl } from '@/lib/storage'

const DEFAULT_EVENT_LIST_LIMIT = 32
const DEFAULT_SPORTS_FEED_EVENT_LIMIT = 128
const MAX_SPORTS_FEED_EVENT_LIMIT = 256
const SPORTS_FEED_EVENT_QUERY_CACHE_VERSION = 2
const RELATED_EVENT_CANDIDATE_LIMIT = 64
const RELATED_EVENT_RESULT_LIMIT = 3

interface LastTradePriceEntry {
  token_id: string
  price: string
  side: 'BUY' | 'SELL'
}

function resolveSeriesEventDirection(outcomeText: string | null | undefined): 'up' | 'down' | null {
  if (!outcomeText) {
    return null
  }

  const normalized = outcomeText.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  if (normalized.includes('up')) {
    return 'up'
  }

  if (normalized.includes('down')) {
    return 'down'
  }

  return null
}

function normalizeSportsMetadataText(value: string | null | undefined) {
  return (
    value
      ?.normalize('NFKD')
      .replace(/[\u0300-\u036F]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim() ?? ''
  )
}

function parseMarketMetadata(value: unknown): Record<string, any> | null {
  if (!value) {
    return null
  }

  if (typeof value === 'object') {
    return value as Record<string, any>
  }

  if (typeof value !== 'string') {
    return null
  }

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null
  } catch {
    return null
  }
}

function normalizeOptionalBooleanField(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value !== 0
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
      return true
    }
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
      return false
    }
  }

  return null
}

function resolveMetadataStatusFlag(
  metadata: Record<string, any> | null,
  keys: string[],
  defaultValue: boolean,
): boolean {
  const roots = [metadata, metadata?.sports?.market, metadata?.event, metadata?.sports?.event]

  for (const root of roots) {
    if (!root || typeof root !== 'object') {
      continue
    }

    for (const key of keys) {
      const value = normalizeOptionalBooleanField((root as Record<string, unknown>)[key])
      if (value !== null) {
        return value
      }
    }
  }

  return defaultValue
}

function isMoneylineMarketForAdminList(input: {
  sports_market_type: string | null
  short_title: string | null
  title: string | null
}) {
  const normalizedType = normalizeSportsMetadataText(input.sports_market_type)
  if (normalizedType.includes('moneyline') || normalizedType.includes('match winner') || normalizedType === '1x2') {
    return true
  }

  if (
    normalizedType.includes('spread') ||
    normalizedType.includes('handicap') ||
    normalizedType.includes('total') ||
    normalizedType.includes('over under') ||
    normalizedType.includes('both teams to score') ||
    normalizedType.includes('btts')
  ) {
    return false
  }

  const marketText = ` ${normalizeSportsMetadataText(`${input.short_title ?? ''} ${input.title ?? ''}`)} `
  return marketText.includes(' draw ') || marketText.includes(' moneyline ') || marketText.includes(' match winner ')
}

function isPrerenderAbortError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const record = error as { digest?: string; name?: string; code?: string; message?: string }

  if (record.digest === 'HANGING_PROMISE_REJECTION') {
    return true
  }

  if (record.name === 'AbortError' || record.code === 'UND_ERR_ABORTED') {
    return true
  }

  if (typeof record.message === 'string' && record.message.includes('fetch() rejects when the prerender is complete')) {
    return true
  }

  return false
}

function normalizeTradePrice(value: string | undefined) {
  if (!value) {
    return null
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return null
  }
  if (parsed < 0) {
    return 0
  }
  if (parsed > 1) {
    return 1
  }
  return parsed
}

function invertPrice(value: number | null) {
  if (value == null) {
    return null
  }

  if (value <= 0) {
    return 1
  }

  if (value >= 1) {
    return 0
  }

  return 1 - value
}

function resolveOutcomeDisplayPrice(
  outcome: { buy_price?: number; last_trade_price?: number; sell_price?: number } | null | undefined,
) {
  return resolveDisplayPrice({
    bid: outcome?.sell_price ?? null,
    ask: outcome?.buy_price ?? null,
    lastTrade: outcome?.last_trade_price ?? null,
  })
}

function resolveMarketDisplayPrice(
  outcomes: Array<{ outcome_index: number; buy_price?: number; last_trade_price?: number; sell_price?: number }>,
) {
  const yesOutcome = outcomes.find((outcome) => outcome.outcome_index === OUTCOME_INDEX.YES)
  const noOutcome = outcomes.find((outcome) => outcome.outcome_index === OUTCOME_INDEX.NO)

  const directYesDisplayPrice = resolveOutcomeDisplayPrice(yesOutcome)
  if (directYesDisplayPrice != null) {
    return directYesDisplayPrice
  }

  if (yesOutcome && noOutcome) {
    const noDisplayPrice = resolveOutcomeDisplayPrice(noOutcome)
    const inferredYesDisplayPrice = invertPrice(noDisplayPrice)
    if (inferredYesDisplayPrice != null) {
      return inferredYesDisplayPrice
    }
  }

  const primaryOutcome = yesOutcome ?? outcomes[0]
  return resolveOutcomeDisplayPrice(primaryOutcome) ?? 0.5
}

async function fetchLastTradePrices(tokenIds: string[]): Promise<Map<string, number>> {
  const uniqueTokenIds = Array.from(new Set(tokenIds.filter(Boolean)))

  if (!uniqueTokenIds.length) {
    return new Map()
  }

  const endpoint = `${resolveClobUrl(resolvePublicRuntimeEnv(process.env).clobUrl)}/last-trades-prices`
  const lastTradeMap = new Map<string, number>()

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(uniqueTokenIds.map((tokenId) => ({ token_id: tokenId }))),
      signal: AbortSignal.timeout(EVENT_PRICES_TIMEOUT_MS),
    })

    if (!response.ok) {
      return lastTradeMap
    }

    const payload = (await response.json()) as LastTradePriceEntry[]
    payload.forEach((entry) => {
      const normalized = normalizeTradePrice(entry?.price)
      if (normalized != null && entry?.token_id) {
        lastTradeMap.set(entry.token_id, normalized)
      }
    })
  } catch (error) {
    if (!isPrerenderAbortError(error) && !(error instanceof Error && error.name === 'TimeoutError')) {
      console.error('Failed to fetch last trades prices', error)
    }
    return lastTradeMap
  }

  return lastTradeMap
}

interface ListEventsProps {
  tag: string
  mainTag?: string
  search?: string
  sortBy?: EventListSortBy
  userId?: string | undefined
  bookmarked?: boolean
  frequency?: 'all' | 'daily' | 'weekly' | 'monthly'
  hideCrypto?: boolean
  hideEarnings?: boolean
  hideSports?: boolean
  excludeSportsAuxiliary?: boolean
  preferResolvedDateOrder?: boolean
  skipLivePricing?: boolean
  status?: EventListStatusFilter
  offset?: number
  limit?: number
  locale?: SupportedLocale
  sportsSportSlug?: string
  sportsSection?: 'games' | 'props' | ''
  sportsVertical?: SportsVertical | ''
}

type SportsFeedMode = 'liveAndSoon' | 'soon'

interface ListSportsFeedEventsProps {
  cacheVersion?: number
  locale?: SupportedLocale
  limit?: number
  mode: SportsFeedMode
  sportsVertical: SportsVertical
}

interface RelatedEventOptions {
  cadenceSlug?: string
  currentTimestamp: number
  tagSlug?: string
  locale?: SupportedLocale
}

interface ListEventMarketSlugsProps {
  tag: string
  mainTag?: string
  locale?: SupportedLocale
  limit?: number
  sportsSection?: 'games' | 'props' | ''
  sportsSportSlug?: string
  status?: EventListStatusFilter
  sportsVertical?: SportsVertical | ''
}

interface ListAdminEventsParams {
  limit?: number
  offset?: number
  search?: string
  sortBy?: 'title' | 'status' | 'volume' | 'volume_24h' | 'created_at' | 'updated_at' | 'end_date'
  sortOrder?: 'asc' | 'desc'
  mainCategorySlug?: string
  creator?: string
  seriesSlug?: string
  hideCrypto?: boolean
  activeOnly?: boolean
  attention?: AdminEventAttentionFilter
  resolutionReportCountsByCondition?: ReadonlyMap<string, number>
}

export type EventTranslationsMap = Partial<Record<NonDefaultLocale, string>>
export type EventAdditionalContextTranslationsMap = Partial<Record<NonDefaultLocale, string>>
export type EventRulesTranslationsMap = Partial<Record<NonDefaultLocale, string>>

interface AdminEventRow {
  id: string
  slug: string
  title: string
  status: Event['status']
  icon_url: string
  livestream_url: string | null
  series_slug: string | null
  series_recurrence: string | null
  start_date: string | null
  volume: number
  volume_24h: number
  is_hidden: boolean
  translations: EventTranslationsMap
  rules_translations: EventRulesTranslationsMap
  sports_score: string | null
  sports_live: boolean | null
  sports_ended: boolean | null
  sports_event_date: string | null
  sports_start_time: string | null
  sports_teams: Array<{ name?: string | null; abbreviation?: string | null; logo_url?: string | null }> | null
  sports_team_logo_urls: string[] | null
  sports_sport_slug: string | null
  sports_league_slug: string | null
  sports_series_slug: string | null
  sports_source_provider: string | null
  sports_source_event_id: string | null
  sports_source_game_id: string | null
  sports_source_league_id: string | null
  sports_source_league_label: string | null
  sports_source_match_confidence: string | null
  sports_vertical: 'sports' | 'esports' | null
  is_sports_games_moneyline: boolean
  resolution_report_count: number
  end_date: string | null
  created_at: string
  updated_at: string
}

type EventWithTags = typeof events.$inferSelect & {
  eventTags: (typeof event_tags.$inferSelect & {
    tag: typeof tags.$inferSelect
  })[]
}

type DrizzleEventResult = typeof events.$inferSelect & {
  markets: (typeof markets.$inferSelect & {
    sports?: typeof market_sports.$inferSelect | null
    condition: typeof conditions.$inferSelect & {
      outcomes: (typeof outcomes.$inferSelect)[]
    }
  })[]
  sports?: typeof event_sports.$inferSelect | null
  eventTags: (typeof event_tags.$inferSelect & {
    tag: typeof tags.$inferSelect
  })[]
  bookmarks?: (typeof bookmarks.$inferSelect)[]
}

interface RelatedEvent {
  has_live_chart: boolean
  id: string
  slug: string
  title: string
  icon_url: string
  outcome_label: string
  sports_event_slug?: string | null
  sports_sport_slug?: string | null
  sports_league_slug?: string | null
  sports_section?: 'games' | 'props' | null
  common_tags_count: number
  chance: number | null
}

async function getLocalizedTagNamesById(tagIds: number[], locale: SupportedLocale): Promise<Map<number, string>> {
  if (!tagIds.length || locale === DEFAULT_LOCALE) {
    return new Map()
  }

  const rows = await db
    .select({
      tag_id: tag_translations.tag_id,
      name: tag_translations.name,
    })
    .from(tag_translations)
    .where(and(inArray(tag_translations.tag_id, tagIds), eq(tag_translations.locale, locale)))

  return new Map(rows.map((row) => [row.tag_id, row.name]))
}

async function getLocalizedEventTitlesById(eventIds: string[], locale: SupportedLocale): Promise<Map<string, string>> {
  if (!eventIds.length || locale === DEFAULT_LOCALE) {
    return new Map()
  }

  const rows = await db
    .select({
      event_id: event_translations.event_id,
      title: event_translations.title,
      source_hash: event_translations.source_hash,
    })
    .from(event_translations)
    .where(
      and(
        inArray(event_translations.event_id, eventIds),
        eq(event_translations.locale, locale),
        sql`NULLIF(TRIM(COALESCE(${event_translations.source_hash}, '')), '') IS NOT NULL`,
      ),
    )

  return new Map(
    rows
      .filter((row): row is typeof row & { title: string } => typeof row.title === 'string' && Boolean(row.source_hash))
      .map((row) => [row.event_id, row.title]),
  )
}

async function getLocalizedEventAdditionalContextsById(
  eventIds: string[],
  locale: SupportedLocale,
): Promise<Map<string, { value: string; sourceHash: string | null }>> {
  if (!eventIds.length || locale === DEFAULT_LOCALE) {
    return new Map()
  }

  const rows = await db
    .select({
      event_id: event_translations.event_id,
      additional_context: event_translations.additional_context,
      source_hash: event_translations.additional_context_source_hash,
    })
    .from(event_translations)
    .where(
      and(
        inArray(event_translations.event_id, eventIds),
        eq(event_translations.locale, locale),
        sql`NULLIF(TRIM(COALESCE(${event_translations.additional_context}, '')), '') IS NOT NULL`,
      ),
    )

  return new Map(
    rows
      .filter((row): row is typeof row & { additional_context: string } => typeof row.additional_context === 'string')
      .map((row) => [
        row.event_id,
        {
          value: row.additional_context.trim(),
          sourceHash: typeof row.source_hash === 'string' ? row.source_hash : null,
        },
      ]),
  )
}

async function getLocalizedEventRulesById(
  eventIds: string[],
  locale: SupportedLocale,
): Promise<Map<string, { value: string; sourceHash: string | null }>> {
  if (!eventIds.length || locale === DEFAULT_LOCALE) {
    return new Map()
  }

  const rows = await db
    .select({
      event_id: event_translations.event_id,
      rules: event_translations.rules,
      source_hash: event_translations.rules_source_hash,
    })
    .from(event_translations)
    .where(
      and(
        inArray(event_translations.event_id, eventIds),
        eq(event_translations.locale, locale),
        sql`NULLIF(TRIM(COALESCE(${event_translations.rules}, '')), '') IS NOT NULL`,
      ),
    )

  return new Map(
    rows
      .filter((row): row is typeof row & { rules: string } => typeof row.rules === 'string')
      .map((row) => [
        row.event_id,
        {
          value: row.rules.trim(),
          sourceHash: typeof row.source_hash === 'string' ? row.source_hash : null,
        },
      ]),
  )
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }

  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : null
}

function buildSportsVolumeGroupKeySql() {
  return sql<string>`
    COALESCE(
      NULLIF(TRIM(COALESCE(${event_sports.sports_parent_event_id}::text, '')), ''),
      NULLIF(TRIM(COALESCE(${event_sports.sports_event_id}, '')), ''),
      NULLIF(LOWER(TRIM(COALESCE(${event_sports.sports_event_slug}, ''))), '')
    )
  `
}

function buildExcludeSportsAuxiliaryCondition() {
  return sql`
    ${events.slug} !~* ${SPORTS_AUXILIARY_SLUG_SQL_REGEX}
    AND NOT EXISTS (
      SELECT 1
      FROM ${event_sports} sports_aux
      WHERE sports_aux.event_id = ${events.id}
        AND sports_aux.sports_parent_event_id > 0
    )
  `
}

async function hydrateSportsAuxiliaryEventContext(eventResult: DrizzleEventResult): Promise<DrizzleEventResult> {
  const currentSports = eventResult.sports
  if (!currentSports || !isSportsAuxiliaryEventSlug(eventResult.slug)) {
    return eventResult
  }

  const baseSlug = stripSportsAuxiliaryEventSuffix(eventResult.slug)
  if (!baseSlug || baseSlug === eventResult.slug) {
    return eventResult
  }

  const shouldLoadBaseSports =
    currentSports.sports_score == null ||
    currentSports.sports_segment_scores == null ||
    currentSports.sports_source_payload == null ||
    currentSports.sports_period == null ||
    currentSports.sports_elapsed == null ||
    currentSports.sports_live == null ||
    currentSports.sports_ended == null ||
    currentSports.sports_tags == null ||
    currentSports.sports_teams == null ||
    currentSports.sports_team_logo_urls == null ||
    currentSports.sports_league_slug == null
  if (!shouldLoadBaseSports) {
    return eventResult
  }

  const baseSportsRows = await db
    .select({
      sports_score: event_sports.sports_score,
      sports_segment_scores: event_sports.sports_segment_scores,
      sports_source_payload: event_sports.sports_source_payload,
      sports_period: event_sports.sports_period,
      sports_elapsed: event_sports.sports_elapsed,
      sports_live: event_sports.sports_live,
      sports_ended: event_sports.sports_ended,
      sports_tags: event_sports.sports_tags,
      sports_teams: event_sports.sports_teams,
      sports_team_logo_urls: event_sports.sports_team_logo_urls,
      sports_start_time: event_sports.sports_start_time,
      sports_event_week: event_sports.sports_event_week,
      sports_sport_slug: event_sports.sports_sport_slug,
      sports_league_slug: event_sports.sports_league_slug,
      sports_series_slug: event_sports.sports_series_slug,
    })
    .from(events)
    .innerJoin(event_sports, eq(event_sports.event_id, events.id))
    .where(eq(events.slug, baseSlug))
    .limit(1)

  const baseSports = baseSportsRows[0]
  if (!baseSports) {
    return eventResult
  }

  return {
    ...eventResult,
    sports: {
      ...currentSports,
      sports_score: currentSports.sports_score ?? baseSports.sports_score,
      sports_segment_scores: currentSports.sports_segment_scores ?? baseSports.sports_segment_scores,
      sports_source_payload: currentSports.sports_source_payload ?? baseSports.sports_source_payload,
      sports_period: currentSports.sports_period ?? baseSports.sports_period,
      sports_elapsed: currentSports.sports_elapsed ?? baseSports.sports_elapsed,
      sports_live: currentSports.sports_live ?? baseSports.sports_live,
      sports_ended: currentSports.sports_ended ?? baseSports.sports_ended,
      sports_tags: currentSports.sports_tags ?? baseSports.sports_tags,
      sports_teams: currentSports.sports_teams ?? baseSports.sports_teams,
      sports_team_logo_urls: currentSports.sports_team_logo_urls ?? baseSports.sports_team_logo_urls,
      sports_start_time: currentSports.sports_start_time ?? baseSports.sports_start_time,
      sports_event_week: currentSports.sports_event_week ?? baseSports.sports_event_week,
      sports_sport_slug: currentSports.sports_sport_slug ?? baseSports.sports_sport_slug,
      sports_league_slug: currentSports.sports_league_slug ?? baseSports.sports_league_slug,
      sports_series_slug: currentSports.sports_series_slug ?? baseSports.sports_series_slug,
    },
  }
}

function hydrateGroupedSportsAuxiliaryEventContexts(groupedEvents: DrizzleEventResult[]): DrizzleEventResult[] {
  const eventsBySlug = new Map(groupedEvents.map((event) => [event.slug, event] as const))

  return groupedEvents.map((event) => {
    const currentSports = event.sports
    if (!currentSports || !isSportsAuxiliaryEventSlug(event.slug)) {
      return event
    }

    const baseSlug = stripSportsAuxiliaryEventSuffix(event.slug)
    if (!baseSlug || baseSlug === event.slug) {
      return event
    }

    const baseEvent = eventsBySlug.get(baseSlug)
    const baseSports = baseEvent?.sports
    if (!baseSports) {
      return event
    }

    return {
      ...event,
      sports: {
        ...currentSports,
        sports_score: currentSports.sports_score ?? baseSports.sports_score,
        sports_segment_scores: currentSports.sports_segment_scores ?? baseSports.sports_segment_scores,
        sports_source_payload: currentSports.sports_source_payload ?? baseSports.sports_source_payload,
        sports_period: currentSports.sports_period ?? baseSports.sports_period,
        sports_elapsed: currentSports.sports_elapsed ?? baseSports.sports_elapsed,
        sports_live: currentSports.sports_live ?? baseSports.sports_live,
        sports_ended: currentSports.sports_ended ?? baseSports.sports_ended,
        sports_tags: currentSports.sports_tags ?? baseSports.sports_tags,
        sports_teams: currentSports.sports_teams ?? baseSports.sports_teams,
        sports_team_logo_urls: currentSports.sports_team_logo_urls ?? baseSports.sports_team_logo_urls,
        sports_start_time: currentSports.sports_start_time ?? baseSports.sports_start_time,
        sports_event_week: currentSports.sports_event_week ?? baseSports.sports_event_week,
        sports_sport_slug: currentSports.sports_sport_slug ?? baseSports.sports_sport_slug,
        sports_league_slug: currentSports.sports_league_slug ?? baseSports.sports_league_slug,
        sports_series_slug: currentSports.sports_series_slug ?? baseSports.sports_series_slug,
      },
    }
  })
}

async function getSportsVolumeGroupKeysByEventId(eventIds: string[]) {
  if (eventIds.length === 0) {
    return new Map<string, string>()
  }

  const sportsVolumeGroupKeySql = buildSportsVolumeGroupKeySql()

  const rows = await db
    .select({
      event_id: event_sports.event_id,
      group_key: sportsVolumeGroupKeySql,
    })
    .from(event_sports)
    .where(and(inArray(event_sports.event_id, eventIds), sql`${sportsVolumeGroupKeySql} IS NOT NULL`))

  return new Map(rows.map((row) => [row.event_id, row.group_key]))
}

async function getSportsAggregatedVolumesByGroupKey(groupKeys: string[]): Promise<Map<string, number>> {
  if (groupKeys.length === 0) {
    return new Map()
  }

  const sportsVolumeGroupKeySql = buildSportsVolumeGroupKeySql()

  const rows = await db
    .select({
      group_key: sportsVolumeGroupKeySql,
      total_volume: sql<string>`COALESCE(SUM(${markets.volume}), 0)`,
    })
    .from(event_sports)
    .innerJoin(markets, eq(markets.event_id, event_sports.event_id))
    .where(and(sql`${sportsVolumeGroupKeySql} IS NOT NULL`, inArray(sportsVolumeGroupKeySql, groupKeys)))
    .groupBy(sportsVolumeGroupKeySql)

  return new Map(rows.map((row) => [row.group_key, toOptionalNumber(row.total_volume) ?? 0]))
}

function toOptionalStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const strings = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)

  return strings.length > 0 ? strings : null
}

function toOptionalSportsTeams(value: unknown) {
  if (!Array.isArray(value)) {
    return null
  }

  const teams = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return []
    }

    const record = entry as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const abbreviation = typeof record.abbreviation === 'string' ? record.abbreviation.trim() : ''
    const recordLabel = typeof record.record === 'string' ? record.record.trim() : ''
    const color = typeof record.color === 'string' ? record.color.trim() : ''
    const hostStatus = typeof record.host_status === 'string' ? record.host_status.trim() : ''
    const logoPath = typeof record.logo_url === 'string' ? record.logo_url.trim() : ''

    return [
      {
        name: name || null,
        abbreviation: abbreviation || null,
        record: recordLabel || null,
        color: color || null,
        host_status: hostStatus || null,
        logo_url: getPublicAssetUrl(logoPath || null) || null,
      },
    ]
  })

  return teams.length > 0 ? teams : null
}

function buildSportsTagsMatchCondition(sportsSportSlugCandidates: string[]) {
  if (sportsSportSlugCandidates.length === 0) {
    return null
  }

  const normalizedCandidates = sportsSportSlugCandidates
    .map((candidate) => candidate.trim().toLowerCase())
    .filter(Boolean)

  if (normalizedCandidates.length === 0) {
    return null
  }

  const candidatesSql = sql.join(
    normalizedCandidates.map((candidate) => sql`${candidate}`),
    sql`, `,
  )

  return sql<boolean>`
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(COALESCE(${event_sports.sports_tags}, '[]'::jsonb)) AS sports_tag(value)
      WHERE LOWER(TRIM(sports_tag.value)) IN (${candidatesSql})
    )
  `
}

function buildSportsSlugMatchCondition(sportsSportSlugCandidates: string[]) {
  if (sportsSportSlugCandidates.length === 0) {
    return null
  }

  const normalizedSportsSportSlugColumn = sql<string>`
    LOWER(TRIM(COALESCE(${event_sports.sports_sport_slug}, '')))
  `
  const normalizedSportsSeriesSlugColumn = sql<string>`
    LOWER(TRIM(COALESCE(${event_sports.sports_series_slug}, '')))
  `
  const sportsSportSlugCondition =
    sportsSportSlugCandidates.length === 1
      ? eq(normalizedSportsSportSlugColumn, sportsSportSlugCandidates[0]!)
      : inArray(normalizedSportsSportSlugColumn, sportsSportSlugCandidates)
  const sportsSeriesSlugCondition =
    sportsSportSlugCandidates.length === 1
      ? eq(normalizedSportsSeriesSlugColumn, sportsSportSlugCandidates[0]!)
      : inArray(normalizedSportsSeriesSlugColumn, sportsSportSlugCandidates)
  const sportsDirectSlugCondition = or(sportsSportSlugCondition, sportsSeriesSlugCondition)
  const sportsTagsMatchCondition = buildSportsTagsMatchCondition(sportsSportSlugCandidates)

  return sportsTagsMatchCondition ? or(sportsDirectSlugCondition, sportsTagsMatchCondition) : sportsDirectSlugCondition
}

function buildSportsVerticalTagCondition(sportsVertical: SportsVertical | '' | undefined) {
  if (sportsVertical !== 'sports' && sportsVertical !== 'esports') {
    return null
  }

  const hasEsportsTag = exists(
    db
      .select()
      .from(event_tags)
      .innerJoin(tags, eq(event_tags.tag_id, tags.id))
      .where(and(eq(event_tags.event_id, events.id), eq(tags.slug, 'esports'))),
  )

  return sportsVertical === 'esports' ? hasEsportsTag : sql`NOT ${hasEsportsTag}`
}

function buildSportsSectionCondition(sportsSection: string) {
  const normalizedSportsSection = sportsSection.trim().toLowerCase()
  if (normalizedSportsSection !== 'games' && normalizedSportsSection !== 'props') {
    return null
  }

  const sectionTagSlugs = normalizedSportsSection === 'games' ? ['games', 'game'] : ['props', 'prop']
  const sportsTagsMatchCondition = buildSportsTagsMatchCondition(sectionTagSlugs)
  const sportsMetadataSectionCondition = sportsTagsMatchCondition
    ? exists(
        db
          .select()
          .from(event_sports)
          .where(and(eq(event_sports.event_id, events.id), sportsTagsMatchCondition)),
      )
    : null
  const genericTagSectionCondition = exists(
    db
      .select()
      .from(event_tags)
      .innerJoin(tags, eq(event_tags.tag_id, tags.id))
      .where(and(eq(event_tags.event_id, events.id), inArray(tags.slug, sectionTagSlugs))),
  )

  return sportsMetadataSectionCondition
    ? or(sportsMetadataSectionCondition, genericTagSectionCondition)
    : genericTagSectionCondition
}

function toOptionalIsoString(value: unknown): string | null {
  if (!value) {
    return null
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'string') {
    const parsedTimestamp = Date.parse(value)
    return Number.isFinite(parsedTimestamp) ? new Date(parsedTimestamp).toISOString() : null
  }

  return null
}

async function getEnabledLiveChartSeriesSlugs() {
  const liveChartRows = await db
    .select({
      series_slug: event_live_chart_configs.series_slug,
    })
    .from(event_live_chart_configs)
    .where(eq(event_live_chart_configs.enabled, true))

  return new Set(
    liveChartRows.map((row) => row.series_slug?.trim().toLowerCase()).filter((slug): slug is string => Boolean(slug)),
  )
}

function eventResource(
  event: DrizzleEventResult,
  userId: string,
  sportsSlugResolver: SportsSlugResolver,
  priceMap: Map<string, OutcomePrices>,
  lastTradeMap: Map<string, number> = new Map(),
  localizedTagNamesById: Map<number, string> = new Map(),
  localizedEventTitlesById: Map<string, string> = new Map(),
  localizedEventAdditionalContextsById: Map<string, { value: string; sourceHash: string | null }> = new Map(),
  localizedEventRulesById: Map<string, { value: string; sourceHash: string | null }> = new Map(),
  liveChartSeriesSlugs: Set<string> = new Set(),
): Event {
  const sourceRules = typeof event.rules === 'string' ? event.rules.trim() : ''
  const localizedRules = localizedEventRulesById.get(event.id)
  const localizedRulesValue =
    localizedRules &&
    sourceRules &&
    localizedRules.sourceHash === createHash('sha256').update(sourceRules).digest('hex')
      ? localizedRules.value
      : null

  const tagRecords = (event.eventTags ?? [])
    .map((et) => et.tag)
    .filter((tag) => Boolean(tag?.slug))
    .map((tag) => ({
      ...tag,
      name: localizedTagNamesById.get(tag.id) ?? tag.name,
    }))

  const marketsWithDerivedValues = event.markets.map((market: any) => {
    const rawOutcomes = (market.condition?.outcomes || []) as Array<typeof outcomes.$inferSelect>
    const normalizedOutcomes = rawOutcomes.map((outcome) => {
      const outcomePrice = outcome.token_id ? priceMap.get(outcome.token_id) : undefined

      return {
        ...outcome,
        outcome_index: Number(outcome.outcome_index || 0),
        payout_value: outcome.payout_value != null ? Number(outcome.payout_value) : undefined,
        buy_price: outcomePrice?.buy,
        last_trade_price: outcome.token_id ? lastTradeMap.get(outcome.token_id) : undefined,
        sell_price: outcomePrice?.sell,
      }
    })

    const marketDisplayPrice = resolveMarketDisplayPrice(normalizedOutcomes)
    const probability = marketDisplayPrice * 100
    const normalizedCurrentVolume24h = Number(market.volume_24h || 0)
    const normalizedTotalVolume = Number(market.volume || 0)
    const marketMetadata = parseMarketMetadata(market.metadata)

    return {
      ...market,
      ...(localizedRulesValue && typeof market.market_rules === 'string' && market.market_rules.trim() === sourceRules
        ? { market_rules: localizedRulesValue }
        : {}),
      neg_risk: Boolean(market.neg_risk),
      neg_risk_other: Boolean(market.neg_risk_other),
      accepting_orders: resolveMetadataStatusFlag(marketMetadata, ['acceptingOrders', 'accepting_orders'], true),
      archived: resolveMetadataStatusFlag(marketMetadata, ['archived'], false),
      sports_market_type: market.sports?.sports_market_type ?? null,
      sports_game_start_time: market.sports?.sports_game_start_time?.toISOString?.() ?? null,
      sports_start_time: market.sports?.sports_start_time?.toISOString?.() ?? null,
      sports_line: market.sports?.sports_line ?? null,
      sports_group_item_title: market.sports?.sports_group_item_title ?? null,
      sports_group_item_threshold: market.sports?.sports_group_item_threshold ?? null,
      end_time: market.end_time?.toISOString?.() ?? null,
      question_id: market.condition?.question_id || '',
      title: market.short_title || market.title,
      probability,
      price: marketDisplayPrice,
      volume: normalizedTotalVolume,
      volume_24h: normalizedCurrentVolume24h,
      outcomes: normalizedOutcomes,
      icon_url: getPublicAssetUrl(market.icon_url),
      condition: market.condition
        ? {
            ...market.condition,
            outcome_slot_count: Number(market.condition.outcome_slot_count || 0),
            payout_denominator: market.condition.payout_denominator
              ? Number(market.condition.payout_denominator)
              : undefined,
            resolution_status: market.condition.resolution_status?.toLowerCase?.() ?? null,
            resolution_flagged:
              market.condition.resolution_flagged == null ? null : Boolean(market.condition.resolution_flagged),
            resolution_paused:
              market.condition.resolution_paused == null ? null : Boolean(market.condition.resolution_paused),
            resolution_last_update: toOptionalIsoString(market.condition.resolution_last_update),
            resolution_price: toOptionalNumber(market.condition.resolution_price),
            resolution_was_disputed:
              market.condition.resolution_was_disputed == null
                ? null
                : Boolean(market.condition.resolution_was_disputed),
            resolution_approved:
              market.condition.resolution_approved == null ? null : Boolean(market.condition.resolution_approved),
            resolution_liveness_seconds: toOptionalNumber(market.condition.resolution_liveness_seconds),
            resolution_deadline_at: toOptionalIsoString(market.condition.resolution_deadline_at),
            volume: Number(market.condition.volume || 0),
            open_interest: Number(market.condition.open_interest || 0),
            active_positions_count: Number(market.condition.active_positions_count || 0),
          }
        : null,
    }
  })

  const totalRecentVolume = marketsWithDerivedValues.reduce(
    (sum: number, market: any) => sum + (typeof market.volume_24h === 'number' ? market.volume_24h : 0),
    0,
  )
  const normalizedSeriesSlug = event.series_slug?.trim().toLowerCase() ?? null
  const hasLiveChart = Boolean(
    normalizedSeriesSlug && liveChartSeriesSlugs.has(normalizedSeriesSlug) && marketsWithDerivedValues.length === 1,
  )
  const isRecentlyUpdated =
    event.updated_at instanceof Date ? Date.now() - event.updated_at.getTime() < 1000 * 60 * 60 * 24 * 3 : false
  const isTrending = totalRecentVolume > 0 || isRecentlyUpdated
  const normalizedSportsTags = toOptionalStringArray(event.sports?.sports_tags)
  const normalizedSportsTeams = toOptionalSportsTeams(event.sports?.sports_teams)
  const normalizedSportsTeamLogoUrls =
    toOptionalStringArray(event.sports?.sports_team_logo_urls)?.map(
      (logoPath) => getPublicAssetUrl(logoPath) || logoPath,
    ) ?? null
  const sportsLeagueSlug = event.sports?.sports_league_slug ?? null
  const sportsSegmentCount = resolveSportsSourceSegmentCount(event.sports?.sports_source_payload)

  return {
    id: event.id || '',
    slug: event.slug || '',
    title: (localizedEventTitlesById.get(event.id) ?? event.title) || '',
    creator: event.creator || '',
    icon_url: getPublicAssetUrl(event.icon_url),
    livestream_url: event.livestream_url ?? null,
    additional_context: (() => {
      const sourceContext = typeof event.additional_context === 'string' ? event.additional_context.trim() : ''
      const localizedContext = localizedEventAdditionalContextsById.get(event.id)
      if (
        localizedContext &&
        sourceContext &&
        localizedContext.sourceHash === createHash('sha256').update(sourceContext).digest('hex')
      ) {
        return localizedContext.value
      }
      return event.additional_context ?? null
    })(),
    additional_context_updated_at: event.additional_context_updated_at?.toISOString?.() ?? null,
    show_market_icons: event.show_market_icons ?? true,
    is_polymarket_mirror: Boolean(event.is_polymarket_mirror),
    enable_neg_risk: Boolean(event.enable_neg_risk),
    neg_risk_augmented: Boolean(event.neg_risk_augmented),
    neg_risk: Boolean(event.neg_risk),
    neg_risk_market_id: event.neg_risk_market_id || undefined,
    status: (event.status ?? 'draft') as Event['status'],
    rules: (() => {
      if (localizedRulesValue) {
        return localizedRulesValue
      }
      return event.rules || undefined
    })(),
    series_slug: event.series_slug ?? null,
    series_recurrence: event.series_recurrence ?? null,
    sports_event_id: event.sports?.sports_event_id ?? null,
    sports_parent_event_id: toOptionalNumber(event.sports?.sports_parent_event_id),
    sports_event_slug: event.sports?.sports_event_slug ?? null,
    sports_sport_slug: resolveCanonicalSportsSportSlug(sportsSlugResolver, {
      sportsSportSlug: event.sports?.sports_sport_slug ?? null,
      sportsSeriesSlug: event.sports?.sports_series_slug ?? null,
      sportsTags: normalizedSportsTags,
    }),
    sports_league_slug: sportsLeagueSlug,
    sports_series_slug: event.sports?.sports_series_slug ?? null,
    sports_section: resolveSportsSection({ tags: tagRecords }),
    sports_start_time: event.sports?.sports_start_time?.toISOString() ?? null,
    sports_event_week: toOptionalNumber(event.sports?.sports_event_week),
    sports_score: event.sports?.sports_score ?? null,
    sports_segment_scores: normalizeSportsSegmentScores(event.sports?.sports_segment_scores),
    sports_segment_count: sportsSegmentCount,
    sports_period: event.sports?.sports_period ?? null,
    sports_elapsed: event.sports?.sports_elapsed ?? null,
    sports_live: event.sports?.sports_live ?? null,
    sports_ended: event.sports?.sports_ended ?? null,
    sports_tags: normalizedSportsTags,
    sports_teams: normalizedSportsTeams,
    sports_team_logo_urls: normalizedSportsTeamLogoUrls,
    sports_source_provider: event.sports?.sports_source_provider ?? null,
    sports_source_event_id: event.sports?.sports_source_event_id ?? null,
    sports_source_game_id: event.sports?.sports_source_game_id ?? null,
    sports_source_league_id: event.sports?.sports_source_league_id ?? null,
    sports_source_league_label: event.sports?.sports_source_league_label ?? null,
    sports_source_match_confidence: event.sports?.sports_source_match_confidence ?? null,
    has_live_chart: hasLiveChart,
    active_markets_count: Number(event.active_markets_count || 0),
    total_markets_count: Number(event.total_markets_count || 0),
    created_at: event.created_at?.toISOString() || new Date().toISOString(),
    updated_at: event.updated_at?.toISOString() || new Date().toISOString(),
    start_date: event.start_date?.toISOString() ?? null,
    end_date: event.end_date?.toISOString() ?? null,
    resolved_at: event.resolved_at?.toISOString() ?? null,
    volume: marketsWithDerivedValues.reduce((sum: number, market: { volume: number }) => sum + (market.volume ?? 0), 0),
    markets: marketsWithDerivedValues,
    tags: tagRecords.map((tag) => ({
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
      isMainCategory: Boolean(tag.is_main_category),
      event_page_note: typeof tag.event_page_note === 'string' ? tag.event_page_note : null,
    })),
    main_tag: getEventMainTag(tagRecords),
    is_bookmarked: event.bookmarks?.some((bookmark) => bookmark.user_id === userId) || false,
    is_trending: isTrending,
  }
}

async function buildEventResource(
  eventResult: DrizzleEventResult,
  userId: string,
  sportsSlugResolver: SportsSlugResolver,
  locale: SupportedLocale = DEFAULT_LOCALE,
): Promise<Event> {
  const outcomeTokenIds = (eventResult.markets ?? []).flatMap((market: any) =>
    (market.condition?.outcomes ?? []).map((outcome: any) => outcome.token_id).filter(Boolean),
  )

  const tagIds = Array.from(
    new Set(
      (eventResult.eventTags ?? [])
        .map((eventTag) => eventTag.tag?.id)
        .filter((tagId): tagId is number => typeof tagId === 'number'),
    ),
  )
  const [
    priceMap,
    lastTradeMap,
    localizedTagNamesById,
    localizedEventTitlesById,
    localizedEventAdditionalContextsById,
    localizedEventRulesById,
    liveChartSeriesSlugs,
  ] = await Promise.all([
    fetchOutcomePrices(outcomeTokenIds),
    fetchLastTradePrices(outcomeTokenIds),
    getLocalizedTagNamesById(tagIds, locale),
    getLocalizedEventTitlesById([eventResult.id], locale),
    getLocalizedEventAdditionalContextsById([eventResult.id], locale),
    getLocalizedEventRulesById([eventResult.id], locale),
    getEnabledLiveChartSeriesSlugs(),
  ])
  return eventResource(
    eventResult,
    userId,
    sportsSlugResolver,
    priceMap,
    lastTradeMap,
    localizedTagNamesById,
    localizedEventTitlesById,
    localizedEventAdditionalContextsById,
    localizedEventRulesById,
    liveChartSeriesSlugs,
  )
}

interface EventListQueryContext {
  baseWhere: SQL<unknown> | undefined
  empty: boolean
  sportsSlugResolver: SportsSlugResolver
}

interface RelationSelectQueryChunk {
  config: {
    where?: SQL
    having?: SQL
    joins?: Array<{ on?: SQL }>
  }
}

function isRelationSelectQueryChunk(chunk: unknown): chunk is RelationSelectQueryChunk {
  if (typeof chunk !== 'object' || chunk === null || !('config' in chunk)) {
    return false
  }

  const config = (chunk as { config?: unknown }).config
  return typeof config === 'object' && config !== null && ('where' in config || 'having' in config || 'joins' in config)
}

function mapEventColumnsToRelationAlias(query: SQL, table: typeof events): SQL {
  const alias = getTableName(table)

  return sql.join(
    query.queryChunks.map((chunk) => {
      if (isRelationSelectQueryChunk(chunk)) {
        if (is(chunk.config.where, SQL)) {
          chunk.config.where = mapEventColumnsToRelationAlias(chunk.config.where, table)
        }

        if (is(chunk.config.having, SQL)) {
          chunk.config.having = mapEventColumnsToRelationAlias(chunk.config.having, table)
        }

        for (const join of chunk.config.joins ?? []) {
          if (is(join.on, SQL)) {
            join.on = mapEventColumnsToRelationAlias(join.on, table)
          }
        }

        return chunk
      }

      if (is(chunk, Column)) {
        const originalColumn = getOriginalColumnFromAlias(chunk)
        return getColumnTable(originalColumn) === events ? aliasedTableColumn(originalColumn, alias) : chunk
      }

      if (is(chunk, SQL)) {
        return mapEventColumnsToRelationAlias(chunk, table)
      }

      if (is(chunk, SQL.Aliased)) {
        return new SQL.Aliased(mapEventColumnsToRelationAlias(chunk.sql, table), chunk.fieldAlias)
      }

      return chunk
    }),
  )
}

function normalizeEventListLimit(value: number | undefined) {
  const normalized = Number.isFinite(value) ? Math.floor(value as number) : DEFAULT_EVENT_LIST_LIMIT
  return Math.min(Math.max(normalized, 1), 128)
}

function normalizeSportsFeedEventLimit(value: number | undefined) {
  const normalized = Number.isFinite(value) ? Math.floor(value as number) : DEFAULT_SPORTS_FEED_EVENT_LIMIT
  return Math.min(Math.max(normalized, 1), MAX_SPORTS_FEED_EVENT_LIMIT)
}

function normalizeEventListOffset(value: number | undefined) {
  return Number.isNaN(value) || (value ?? 0) < 0 ? 0 : Math.max(0, Math.floor(value ?? 0))
}

function buildTagContainsCondition(slugFragment: string) {
  return exists(
    db
      .select()
      .from(event_tags)
      .innerJoin(tags, eq(event_tags.tag_id, tags.id))
      .where(and(eq(event_tags.event_id, events.id), ilike(tags.slug, `%${slugFragment}%`))),
  )
}

function buildTrendingVolumeOrder() {
  return sql<number>`COALESCE(
    NULLIF((
      SELECT SUM(${markets.volume_24h})
      FROM ${markets}
      WHERE ${markets.event_id} = ${events.id}
    ), 0),
    (
      SELECT SUM(${markets.volume})
      FROM ${markets}
      WHERE ${markets.event_id} = ${events.id}
    ),
    0
  )`
}

function buildTotalVolumeOrder() {
  return sql<number>`COALESCE((
    SELECT SUM(${markets.volume})
    FROM ${markets}
    WHERE ${markets.event_id} = ${events.id}
  ), 0)::double precision`
}

function buildVolume24hOrder() {
  return sql<number>`COALESCE((
    SELECT SUM(${markets.volume_24h})
    FROM ${markets}
    WHERE ${markets.event_id} = ${events.id}
  ), 0)::double precision`
}

export function buildEndingSoonOrderBy() {
  const futureEndDate = sql<Date | null>`CASE
    WHEN ${events.end_date} >= CURRENT_TIMESTAMP THEN ${events.end_date}
  END`
  const pastEndDate = sql<Date | null>`CASE
    WHEN ${events.end_date} < CURRENT_TIMESTAMP THEN ${events.end_date}
  END`
  const endDateRank = sql<number>`CASE
    WHEN ${events.end_date} >= CURRENT_TIMESTAMP THEN 0
    WHEN ${events.end_date} IS NOT NULL THEN 1
    ELSE 2
  END`

  return [asc(endDateRank), asc(futureEndDate), desc(pastEndDate), desc(events.created_at), desc(events.id)]
}

export function buildRelatedEventOrderBy(sameCryptoAssetRank: SQL<number> | null, commonTagsCount: SQL<number>) {
  return [...(sameCryptoAssetRank ? [desc(sameCryptoAssetRank)] : []), desc(commonTagsCount), desc(events.created_at)]
}

export function buildResolvedLikeCondition(input: { hasAnyMarkets: SQL<unknown>; hasUnresolvedMarkets: SQL<unknown> }) {
  return or(eq(events.status, 'resolved'), and(input.hasAnyMarkets, not(input.hasUnresolvedMarkets)))!
}

function buildHasAnyMarketsCondition() {
  return exists(db.select({ condition_id: markets.condition_id }).from(markets).where(eq(markets.event_id, events.id)))
}

function buildHasUnresolvedMarketsCondition() {
  return exists(
    db
      .select({ condition_id: markets.condition_id })
      .from(markets)
      .leftJoin(conditions, eq(conditions.id, markets.condition_id))
      .where(
        and(
          eq(markets.event_id, events.id),
          eq(markets.is_resolved, false),
          sql`COALESCE(${conditions.resolved}, false) = false`,
        ),
      ),
  )
}

function buildEventStatusFilterCondition(
  status: EventListStatusFilter,
  input: {
    hasAnyMarkets: SQL<unknown>
    hasUnresolvedMarkets: SQL<unknown>
  },
) {
  const resolvedLike = buildResolvedLikeCondition(input)
  const resolvedFilterCondition = sql<boolean>`${resolvedLike}`

  if (status === 'resolved') {
    return resolvedFilterCondition
  }

  if (status === 'all') {
    return or(eq(events.status, 'active'), resolvedFilterCondition)
  }

  return eq(events.status, status)
}

export function resolveEventTagCadenceRoute(tag: string, mainTag: string) {
  if (mainTag.trim().toLowerCase() !== 'crypto') {
    return null
  }

  return resolveCryptoCadenceRoute(tag)
}

export function resolveEventMarketSlugsMainTag(tag: string, mainTag: string) {
  const normalizedMainTag = mainTag.trim().toLowerCase()
  if (normalizedMainTag) {
    return normalizedMainTag
  }

  const cadenceRoute = resolveCryptoCadenceRoute(tag)
  return cadenceRoute && cadenceRoute.cadence !== 'daily' ? 'crypto' : ''
}

function buildEventTagFilterCondition(tag: string, mainTag: string) {
  const tagCondition = exists(
    db
      .select()
      .from(event_tags)
      .innerJoin(tags, eq(event_tags.tag_id, tags.id))
      .where(and(eq(event_tags.event_id, events.id), eq(tags.slug, tag))),
  )

  const cadenceRoute = resolveEventTagCadenceRoute(tag, mainTag)
  if (cadenceRoute) {
    const normalizedSeriesSlug = sql<string>`LOWER(TRIM(COALESCE(${events.series_slug}, '')))`
    const normalizedSeriesRecurrence = sql<string>`LOWER(TRIM(COALESCE(${events.series_recurrence}, '')))`
    const seriesPattern = `(^|-)(${cadenceRoute.seriesTokens.join('|')})(-|$)`
    const knownSeriesPattern = `(^|-)(${CRYPTO_CADENCE_ROUTES.flatMap((route) => route.seriesTokens).join('|')})(-|$)`
    const seriesCondition = sql<boolean>`${normalizedSeriesSlug} ~ ${seriesPattern}`
    const knownSeriesCondition = sql<boolean>`${normalizedSeriesSlug} ~ ${knownSeriesPattern}`
    const recurrenceCondition = or(
      ...cadenceRoute.recurrenceValues.map((value) => eq(normalizedSeriesRecurrence, value)),
    )

    return or(seriesCondition, and(not(knownSeriesCondition), or(tagCondition, recurrenceCondition)))
  }

  return tagCondition
}

function buildSearchEventOrderBy(
  status: EventListStatusFilter,
  input: {
    hasAnyMarkets: SQL<unknown>
    hasUnresolvedMarkets: SQL<unknown>
  },
) {
  const resolvedLike = buildResolvedLikeCondition(input)
  const resolvedLikeRank = sql<number>`CASE WHEN ${resolvedLike} THEN 1 ELSE 0 END`
  const activeResolutionDate = sql<Date | null>`CASE WHEN NOT (${resolvedLike}) THEN ${events.end_date} END`
  const resolvedResolutionDate = sql<Date | null>`CASE WHEN ${resolvedLike} THEN COALESCE(${events.resolved_at}, ${events.end_date}) END`
  const activeResolutionNullRank = sql<number>`CASE WHEN ${activeResolutionDate} IS NULL THEN 1 ELSE 0 END`
  const resolvedResolutionNullRank = sql<number>`CASE WHEN ${resolvedResolutionDate} IS NULL THEN 1 ELSE 0 END`

  if (status === 'resolved') {
    return [
      asc(resolvedResolutionNullRank),
      desc(resolvedResolutionDate),
      desc(events.created_at),
      desc(events.updated_at),
      desc(events.id),
    ]
  }

  if (status === 'all') {
    return [
      asc(resolvedLikeRank),
      asc(activeResolutionNullRank),
      asc(activeResolutionDate),
      asc(resolvedResolutionNullRank),
      desc(resolvedResolutionDate),
      desc(events.created_at),
      desc(events.updated_at),
      desc(events.id),
    ]
  }

  return [
    asc(activeResolutionNullRank),
    asc(activeResolutionDate),
    desc(events.created_at),
    desc(events.updated_at),
    desc(events.id),
  ]
}

async function buildEventListQueryContext({
  tag,
  mainTag = '',
  search = '',
  userId = '',
  bookmarked = false,
  frequency = 'all',
  status = 'active',
  sportsSportSlug = '',
  sportsSection = '',
  sportsVertical = '',
  hideSports = false,
  hideCrypto = false,
  hideEarnings = false,
  excludeSportsAuxiliary = false,
}: ListEventsProps & {
  excludeSportsAuxiliary?: boolean
  hideCrypto?: boolean
  hideEarnings?: boolean
  hideSports?: boolean
  locale?: SupportedLocale
}): Promise<EventListQueryContext> {
  const sportsSlugResolver = await getSportsSlugResolverFromDb()
  const normalizedRequestedSportsSportSlug = sportsSportSlug.trim().toLowerCase()
  const whereConditions: SQL<unknown>[] = []

  const hasAnyMarkets = buildHasAnyMarketsCondition()
  const hasUnresolvedMarkets = buildHasUnresolvedMarketsCondition()
  const statusFilterCondition = buildEventStatusFilterCondition(status, {
    hasAnyMarkets,
    hasUnresolvedMarkets,
  })

  if (statusFilterCondition) {
    whereConditions.push(statusFilterCondition)
  }
  whereConditions.push(buildPublicEventListVisibilityCondition(events.id))
  whereConditions.push(eq(events.is_hidden, false))

  if (excludeSportsAuxiliary) {
    whereConditions.push(buildExcludeSportsAuxiliaryCondition())
  }

  if (search) {
    const normalizedSearch = search.trim().toLowerCase()
    const searchTerms = normalizedSearch.split(/\s+/).filter(Boolean)

    if (searchTerms.length > 0) {
      const loweredTitle = sql<string>`LOWER(${events.title})`
      const searchCondition = and(...searchTerms.map((term) => ilike(loweredTitle, `%${term}%`)))
      if (searchCondition) {
        whereConditions.push(searchCondition)
      }
    }
  }

  if (frequency !== 'all') {
    const normalizedSeriesRecurrence = sql<string>`LOWER(TRIM(COALESCE(${events.series_recurrence}, '')))`
    whereConditions.push(eq(normalizedSeriesRecurrence, frequency))
  }

  const sportsSportSlugCandidates = resolveSportsSportSlugQueryCandidates(sportsSlugResolver, sportsSportSlug)
  if (normalizedRequestedSportsSportSlug && sportsSportSlugCandidates.length === 0) {
    return {
      baseWhere: undefined,
      empty: true,
      sportsSlugResolver,
    }
  }
  if (sportsSportSlugCandidates.length > 0) {
    const sportsSlugOrTagCondition = buildSportsSlugMatchCondition(sportsSportSlugCandidates)
    if (!sportsSlugOrTagCondition) {
      return {
        baseWhere: undefined,
        empty: true,
        sportsSlugResolver,
      }
    }
    whereConditions.push(
      exists(
        db
          .select({ event_id: event_sports.event_id })
          .from(event_sports)
          .where(and(eq(event_sports.event_id, events.id), sportsSlugOrTagCondition)),
      ),
    )
  }

  const sportsSectionCondition = buildSportsSectionCondition(sportsSection)
  if (sportsSectionCondition) {
    whereConditions.push(sportsSectionCondition)
  }

  const sportsVerticalCondition = buildSportsVerticalTagCondition(sportsVertical)
  if (sportsVerticalCondition) {
    whereConditions.push(sportsVerticalCondition)
  }

  if (tag && tag !== 'trending' && tag !== 'new') {
    const tagFilterCondition = buildEventTagFilterCondition(tag, mainTag)
    if (tagFilterCondition) {
      whereConditions.push(tagFilterCondition)
    }
  }

  if (
    mainTag &&
    mainTag !== 'trending' &&
    mainTag !== 'new' &&
    tag &&
    tag !== 'trending' &&
    tag !== 'new' &&
    tag !== mainTag
  ) {
    whereConditions.push(
      exists(
        db
          .select()
          .from(event_tags)
          .innerJoin(tags, eq(event_tags.tag_id, tags.id))
          .where(and(eq(event_tags.event_id, events.id), eq(tags.slug, mainTag))),
      ),
    )
  }

  if (tag === 'new') {
    whereConditions.push(
      sql`NOT ${exists(
        db
          .select()
          .from(event_tags)
          .innerJoin(tags, eq(event_tags.tag_id, tags.id))
          .where(and(eq(event_tags.event_id, events.id), eq(tags.slug, HIDE_FROM_NEW_TAG_SLUG))),
      )}`,
    )
  }

  if (bookmarked && userId) {
    whereConditions.push(
      exists(
        db
          .select()
          .from(bookmarks)
          .where(and(eq(bookmarks.event_id, events.id), eq(bookmarks.user_id, userId))),
      ),
    )
  }

  if (hideSports) {
    whereConditions.push(not(buildTagContainsCondition('sport')))
  }
  if (hideCrypto) {
    whereConditions.push(not(buildTagContainsCondition('crypto')))
  }
  if (hideEarnings) {
    whereConditions.push(not(buildTagContainsCondition('earning')))
  }

  return {
    baseWhere: and(...whereConditions),
    empty: false,
    sportsSlugResolver,
  }
}

async function selectOrderedEventIds({
  baseWhere,
  tag,
  limit = DEFAULT_EVENT_LIST_LIMIT,
  offset = 0,
}: {
  baseWhere: SQL<unknown> | undefined
  tag: string
  limit?: number
  offset?: number
}) {
  if (!baseWhere) {
    return []
  }

  const safeLimit = normalizeEventListLimit(limit)
  const safeOffset = normalizeEventListOffset(offset)

  if (tag === 'trending') {
    const trendingVolumeOrder = buildTrendingVolumeOrder()
    const rows = await db
      .select({ id: events.id })
      .from(events)
      .where(baseWhere)
      .orderBy(desc(trendingVolumeOrder), desc(events.created_at))
      .limit(safeLimit)
      .offset(safeOffset)

    return rows.map((row) => row.id)
  }

  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(baseWhere)
    .orderBy(tag === 'new' ? desc(events.created_at) : desc(events.id), desc(events.id))
    .limit(safeLimit)
    .offset(safeOffset)

  return rows.map((row) => row.id)
}

async function selectSportsFeedEventIds({
  baseWhere,
  limit = DEFAULT_SPORTS_FEED_EVENT_LIMIT,
  mode,
  now = new Date(),
}: {
  baseWhere: SQL<unknown> | undefined
  limit?: number
  mode: SportsFeedMode
  now?: Date
}) {
  if (!baseWhere) {
    return []
  }

  const cappedLimit = normalizeSportsFeedEventLimit(limit)
  const sportsStartTime = sql<Date | null>`COALESCE(${event_sports.sports_start_time}, ${events.start_date})`
  const sportsReferenceEndTime = sql<Date | null>`
    CASE
      WHEN ${events.end_date} IS NOT NULL AND ${events.end_date} > ${sportsStartTime}
        THEN ${events.end_date}
      ELSE ${sportsStartTime}
    END
  `
  const sportsLiveWindowCondition = sql`
    ${event_sports.sports_live} IS TRUE
    OR (
      ${sportsStartTime} IS NOT NULL
      AND ${sportsStartTime} <= ${now}
      AND ${now} <= ${sportsReferenceEndTime} + INTERVAL '2 hours'
    )
  `
  const sportsFutureCondition = sql`
    ${sportsStartTime} IS NOT NULL
    AND ${sportsStartTime} > ${now}
  `
  const sportsFeedCondition =
    mode === 'soon' ? sportsFutureCondition : or(sportsLiveWindowCondition, sportsFutureCondition)
  const sportsLiveSortRank = sql<number>`
    CASE
      WHEN ${sportsLiveWindowCondition} THEN 0
      ELSE 1
    END
  `

  const rows = await db
    .select({ id: events.id })
    .from(events)
    .innerJoin(event_sports, eq(event_sports.event_id, events.id))
    .where(and(baseWhere, sql`${event_sports.sports_ended} IS NOT TRUE`, sportsFeedCondition))
    .orderBy(...(mode === 'liveAndSoon' ? [asc(sportsLiveSortRank)] : []), asc(sportsStartTime), desc(events.id))
    .limit(cappedLimit)

  return rows.map((row) => row.id)
}

function getEventMainTag(tags: any[] | undefined): string {
  if (!tags?.length) {
    return 'World'
  }

  const mainTag = tags.find((tag) => tag.is_main_category)
  return mainTag?.name || tags[0].name
}

async function hydrateEventListResults({
  eventsData,
  locale,
  skipLivePricing = false,
  sportsSlugResolver,
  userId = '',
}: {
  eventsData: DrizzleEventResult[]
  locale: SupportedLocale
  skipLivePricing?: boolean
  sportsSlugResolver: SportsSlugResolver
  userId?: string
}) {
  const tokensForPricing = skipLivePricing
    ? []
    : eventsData.flatMap((event) =>
        (event.markets ?? []).flatMap((market) =>
          (market.condition?.outcomes ?? []).map((outcome) => outcome.token_id).filter(Boolean),
        ),
      )
  const tagIds = Array.from(
    new Set(
      eventsData.flatMap((event) =>
        (event.eventTags ?? [])
          .map((eventTag) => eventTag.tag?.id)
          .filter((tagId): tagId is number => typeof tagId === 'number'),
      ),
    ),
  )
  const eventIds = eventsData.map((event) => event.id)
  const sportsVolumeGroupKeyByEventId = await getSportsVolumeGroupKeysByEventId(eventIds)
  const sportsVolumeGroupKeysForAggregation = Array.from(new Set(sportsVolumeGroupKeyByEventId.values()))
  const [
    priceMap,
    lastTradeMap,
    localizedTagNamesById,
    localizedEventTitlesById,
    localizedEventAdditionalContextsById,
    localizedEventRulesById,
    groupedSportsVolumesByGroupKey,
  ] = await Promise.all([
    skipLivePricing ? Promise.resolve(new Map<string, OutcomePrices>()) : fetchOutcomePrices(tokensForPricing),
    skipLivePricing ? Promise.resolve(new Map<string, number>()) : fetchLastTradePrices(tokensForPricing),
    getLocalizedTagNamesById(tagIds, locale),
    getLocalizedEventTitlesById(eventIds, locale),
    getLocalizedEventAdditionalContextsById(eventIds, locale),
    getLocalizedEventRulesById(eventIds, locale),
    getSportsAggregatedVolumesByGroupKey(sportsVolumeGroupKeysForAggregation),
  ])
  const liveChartSeriesSlugs = await getEnabledLiveChartSeriesSlugs()

  return eventsData
    .filter((event) => event.markets?.length > 0)
    .map((event) =>
      eventResource(
        event as DrizzleEventResult,
        userId,
        sportsSlugResolver,
        priceMap,
        lastTradeMap,
        localizedTagNamesById,
        localizedEventTitlesById,
        localizedEventAdditionalContextsById,
        localizedEventRulesById,
        liveChartSeriesSlugs,
      ),
    )
    .map((event) => {
      const groupKey = sportsVolumeGroupKeyByEventId.get(event.id)
      if (!groupKey) {
        return event
      }

      const groupedVolume = groupedSportsVolumesByGroupKey.get(groupKey)
      if (groupedVolume == null) {
        return event
      }

      return {
        ...event,
        volume: groupedVolume,
      }
    })
}

export const EventRepository = {
  async listAdminSeriesSlugs(creatorWalletAddresses: string[]): Promise<QueryResult<string[]>> {
    const creators = Array.from(
      new Set(
        creatorWalletAddresses
          .map((address) => address.trim().toLowerCase())
          .filter((address) => /^0x[0-9a-f]{40}$/.test(address)),
      ),
    )

    if (creators.length === 0) {
      return { data: [], error: null }
    }

    const creatorSeriesConditions = creators.map((creator) => {
      const walletTail = creator.slice(-12)
      return and(
        eq(sql<string>`LOWER(COALESCE(${events.creator}, ''))`, creator),
        sql`LOWER(TRIM(COALESCE(${events.series_slug}, ''))) ~ ${`-[0-9]{10,}${walletTail}$`}`,
      )
    })

    return runQuery(async () => {
      const rows = await db
        .select({ series_slug: events.series_slug })
        .from(events)
        .where(or(...creatorSeriesConditions))
        .groupBy(events.series_slug)
        .orderBy(asc(events.series_slug))

      return {
        data: rows.map((row) => row.series_slug?.trim() ?? '').filter(Boolean),
        error: null,
      }
    })
  },

  async listEvents({
    tag,
    mainTag = '',
    search = '',
    sortBy,
    userId = '',
    bookmarked = false,
    frequency = 'all',
    hideCrypto = false,
    hideEarnings = false,
    hideSports = false,
    excludeSportsAuxiliary = false,
    preferResolvedDateOrder = false,
    skipLivePricing = false,
    status = 'active',
    offset = 0,
    limit = DEFAULT_EVENT_LIST_LIMIT,
    locale = DEFAULT_LOCALE,
    sportsSportSlug = '',
    sportsSection = '',
    sportsVertical = '',
  }: ListEventsProps): Promise<QueryResult<Event[]>> {
    'use cache'
    cacheTag(cacheTags.events(userId || 'guest'))
    cacheTag(cacheTags.eventsList)

    return await runQuery(async () => {
      const safeLimit = normalizeEventListLimit(limit)
      const validOffset = normalizeEventListOffset(offset)
      const sportsSlugResolver = await getSportsSlugResolverFromDb()
      const normalizedRequestedSportsSportSlug = sportsSportSlug.trim().toLowerCase()

      const whereConditions: SQL<unknown>[] = []
      const normalizedSearch = search.trim().toLowerCase()
      const isSearchOrderedQuery = normalizedSearch.length > 0 && !sortBy
      const hasAnyMarkets = buildHasAnyMarketsCondition()
      const hasUnresolvedMarkets = buildHasUnresolvedMarketsCondition()
      const statusFilterCondition = buildEventStatusFilterCondition(status, {
        hasAnyMarkets,
        hasUnresolvedMarkets,
      })

      if (statusFilterCondition) {
        whereConditions.push(statusFilterCondition)
      }
      whereConditions.push(buildPublicEventListVisibilityCondition(events.id))
      whereConditions.push(eq(events.is_hidden, false))

      if (excludeSportsAuxiliary) {
        whereConditions.push(buildExcludeSportsAuxiliaryCondition())
      }

      if (search) {
        const searchTerms = normalizedSearch.split(/\s+/).filter(Boolean)

        if (searchTerms.length > 0) {
          const loweredTitle = sql<string>`LOWER(${events.title})`
          const searchCondition = and(...searchTerms.map((term) => ilike(loweredTitle, `%${term}%`)))
          if (searchCondition) {
            whereConditions.push(searchCondition)
          }
        }
      }

      if (frequency !== 'all') {
        const normalizedSeriesRecurrence = sql<string>`LOWER(TRIM(COALESCE(${events.series_recurrence}, '')))`
        whereConditions.push(eq(normalizedSeriesRecurrence, frequency))
      }

      const sportsSportSlugCandidates = resolveSportsSportSlugQueryCandidates(sportsSlugResolver, sportsSportSlug)
      if (normalizedRequestedSportsSportSlug && sportsSportSlugCandidates.length === 0) {
        return { data: [], error: null }
      }
      if (sportsSportSlugCandidates.length > 0) {
        const sportsSlugOrTagCondition = buildSportsSlugMatchCondition(sportsSportSlugCandidates)
        if (!sportsSlugOrTagCondition) {
          return { data: [], error: null }
        }
        whereConditions.push(
          exists(
            db
              .select({ event_id: event_sports.event_id })
              .from(event_sports)
              .where(and(eq(event_sports.event_id, events.id), sportsSlugOrTagCondition)),
          ),
        )
      }

      const sportsSectionCondition = buildSportsSectionCondition(sportsSection)
      if (sportsSectionCondition) {
        whereConditions.push(sportsSectionCondition)
      }

      const sportsVerticalCondition = buildSportsVerticalTagCondition(sportsVertical)
      if (sportsVerticalCondition) {
        whereConditions.push(sportsVerticalCondition)
      }

      if (tag && tag !== 'trending' && tag !== 'new') {
        const tagFilterCondition = buildEventTagFilterCondition(tag, mainTag)
        if (tagFilterCondition) {
          whereConditions.push(tagFilterCondition)
        }
      }

      if (
        mainTag &&
        mainTag !== 'trending' &&
        mainTag !== 'new' &&
        tag &&
        tag !== 'trending' &&
        tag !== 'new' &&
        tag !== mainTag
      ) {
        whereConditions.push(
          exists(
            db
              .select()
              .from(event_tags)
              .innerJoin(tags, eq(event_tags.tag_id, tags.id))
              .where(and(eq(event_tags.event_id, events.id), eq(tags.slug, mainTag))),
          ),
        )
      }

      if (tag === 'new') {
        whereConditions.push(
          sql`NOT ${exists(
            db
              .select()
              .from(event_tags)
              .innerJoin(tags, eq(event_tags.tag_id, tags.id))
              .where(and(eq(event_tags.event_id, events.id), eq(tags.slug, HIDE_FROM_NEW_TAG_SLUG))),
          )}`,
        )
      }

      if (bookmarked && userId) {
        whereConditions.push(
          exists(
            db
              .select()
              .from(bookmarks)
              .where(and(eq(bookmarks.event_id, events.id), eq(bookmarks.user_id, userId))),
          ),
        )
      }

      if (hideSports) {
        whereConditions.push(not(buildTagContainsCondition('sport')))
      }
      if (hideCrypto) {
        whereConditions.push(not(buildTagContainsCondition('crypto')))
      }
      if (hideEarnings) {
        whereConditions.push(not(buildTagContainsCondition('earning')))
      }

      const baseWhere = and(...whereConditions)

      let eventsData: DrizzleEventResult[] = []

      if (isSearchOrderedQuery) {
        const orderedSearchEventIds = await db
          .select({ id: events.id })
          .from(events)
          .where(baseWhere)
          .orderBy(
            ...buildSearchEventOrderBy(status, {
              hasAnyMarkets,
              hasUnresolvedMarkets,
            }),
          )
          .limit(safeLimit)
          .offset(validOffset)

        if (orderedSearchEventIds.length === 0) {
          return { data: [], error: null }
        }

        const orderedIds = orderedSearchEventIds.map((event) => event.id)
        const orderIndex = new Map(orderedIds.map((id, index) => [id, index]))

        const orderedSearchData = (await db.query.events.findMany({
          where: {
            RAW: (table) => mapEventColumnsToRelationAlias(and(baseWhere, inArray(table.id, orderedIds))!, table),
          },
          with: {
            markets: {
              with: {
                sports: true,
                condition: {
                  with: { outcomes: true },
                },
              },
            },

            eventTags: {
              with: { tag: true },
            },
            sports: true,

            ...(userId && {
              bookmarks: {
                where: { RAW: (table) => eq(table.user_id, userId) },
              },
            }),
          },
        })) as DrizzleEventResult[]

        eventsData = orderedSearchData.sort((left, right) => {
          const leftIndex = orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER
          const rightIndex = orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER
          return leftIndex - rightIndex
        })
      } else if (status === 'resolved' && preferResolvedDateOrder && !sortBy) {
        const resolvedDateOrder = sql<Date | null>`COALESCE(${events.resolved_at}, ${events.end_date})`
        const resolvedDateNullRank = sql<number>`CASE WHEN ${resolvedDateOrder} IS NULL THEN 1 ELSE 0 END`
        const resolvedEventIds = await db
          .select({ id: events.id })
          .from(events)
          .where(baseWhere)
          .orderBy(
            asc(resolvedDateNullRank),
            desc(resolvedDateOrder),
            desc(events.created_at),
            desc(events.updated_at),
            desc(events.id),
          )
          .limit(safeLimit)
          .offset(validOffset)

        if (resolvedEventIds.length === 0) {
          return { data: [], error: null }
        }

        const orderedIds = resolvedEventIds.map((event) => event.id)
        const orderIndex = new Map(orderedIds.map((id, index) => [id, index]))

        const resolvedData = (await db.query.events.findMany({
          where: {
            RAW: (table) => mapEventColumnsToRelationAlias(and(baseWhere, inArray(table.id, orderedIds))!, table),
          },
          with: {
            markets: {
              with: {
                sports: true,
                condition: {
                  with: { outcomes: true },
                },
              },
            },

            eventTags: {
              with: { tag: true },
            },
            sports: true,

            ...(userId && {
              bookmarks: {
                where: { RAW: (table) => eq(table.user_id, userId) },
              },
            }),
          },
        })) as DrizzleEventResult[]

        eventsData = resolvedData.sort((left, right) => {
          const leftIndex = orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER
          const rightIndex = orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER
          return leftIndex - rightIndex
        })
      } else if ((tag === 'trending' && !sortBy) || sortBy === 'trending') {
        const trendingVolumeOrder = buildTrendingVolumeOrder()

        const trendingEventIds = await db
          .select({ id: events.id })
          .from(events)
          .where(baseWhere)
          .orderBy(desc(trendingVolumeOrder), desc(events.created_at))
          .limit(safeLimit)
          .offset(validOffset)

        if (trendingEventIds.length === 0) {
          return { data: [], error: null }
        }

        const orderedIds = trendingEventIds.map((event) => event.id)
        const orderIndex = new Map(orderedIds.map((id, index) => [id, index]))

        const trendingData = (await db.query.events.findMany({
          where: {
            RAW: (table) => mapEventColumnsToRelationAlias(and(baseWhere, inArray(table.id, orderedIds))!, table),
          },
          with: {
            markets: {
              with: {
                sports: true,
                condition: {
                  with: { outcomes: true },
                },
              },
            },

            eventTags: {
              with: { tag: true },
            },
            sports: true,

            ...(userId && {
              bookmarks: {
                where: { RAW: (table) => eq(table.user_id, userId) },
              },
            }),
          },
        })) as DrizzleEventResult[]

        eventsData = trendingData.sort((left, right) => {
          const leftIndex = orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER
          const rightIndex = orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER
          return leftIndex - rightIndex
        })
      } else {
        const totalVolumeOrder = buildTotalVolumeOrder()
        const volume24hOrder = buildVolume24hOrder()
        const orderByClause = (() => {
          switch (sortBy) {
            case 'volume_24h':
              return [desc(volume24hOrder), desc(events.created_at)]
            case 'volume':
              return [desc(totalVolumeOrder), desc(events.created_at)]
            case 'created_at':
              return [desc(events.created_at)]
            case 'end_date':
              return buildEndingSoonOrderBy()
            default:
              return tag === 'new' ? [desc(events.created_at)] : [desc(events.id)]
          }
        })()

        const sortedEventIds = await db
          .select({ id: events.id })
          .from(events)
          .where(baseWhere)
          .orderBy(...orderByClause)
          .limit(safeLimit)
          .offset(validOffset)

        if (sortedEventIds.length === 0) {
          return { data: [], error: null }
        }

        const orderedIds = sortedEventIds.map((event) => event.id)
        const orderIndex = new Map(orderedIds.map((id, index) => [id, index]))

        const sortedData = (await db.query.events.findMany({
          where: {
            RAW: (table) => mapEventColumnsToRelationAlias(and(baseWhere, inArray(table.id, orderedIds))!, table),
          },
          with: {
            markets: {
              with: {
                sports: true,
                condition: {
                  with: { outcomes: true },
                },
              },
            },

            eventTags: {
              with: { tag: true },
            },
            sports: true,

            ...(userId && {
              bookmarks: {
                where: { RAW: (table) => eq(table.user_id, userId) },
              },
            }),
          },
        })) as DrizzleEventResult[]

        eventsData = sortedData.sort((left, right) => {
          const leftIndex = orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER
          const rightIndex = orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER
          return leftIndex - rightIndex
        })
      }

      const eventsWithMarkets = await hydrateEventListResults({
        eventsData,
        locale,
        skipLivePricing,
        sportsSlugResolver,
        userId,
      })

      return { data: eventsWithMarkets, error: null }
    })
  },

  async listSportsFeedEvents({
    cacheVersion = SPORTS_FEED_EVENT_QUERY_CACHE_VERSION,
    locale = DEFAULT_LOCALE,
    limit = DEFAULT_SPORTS_FEED_EVENT_LIMIT,
    mode,
    sportsVertical,
  }: ListSportsFeedEventsProps): Promise<QueryResult<Event[]>> {
    'use cache'
    cacheTag(cacheTags.events('guest'))
    cacheTag(cacheTags.eventsList)
    void cacheVersion

    return await runQuery(async () => {
      const { baseWhere, empty, sportsSlugResolver } = await buildEventListQueryContext({
        tag: '',
        sportsVertical,
        search: '',
        userId: '',
        bookmarked: false,
        status: 'active',
        locale,
        sportsSection: 'games',
        excludeSportsAuxiliary: true,
      })

      if (empty) {
        return { data: [], error: null }
      }

      const orderedIds = await selectSportsFeedEventIds({
        baseWhere,
        limit,
        mode,
      })

      if (orderedIds.length === 0) {
        return { data: [], error: null }
      }

      const orderIndex = new Map(orderedIds.map((id, index) => [id, index]))
      const sportsFeedData = (await db.query.events.findMany({
        where: {
          RAW: (table) => mapEventColumnsToRelationAlias(and(baseWhere, inArray(table.id, orderedIds))!, table),
        },
        with: {
          markets: {
            with: {
              sports: true,
              condition: {
                with: { outcomes: true },
              },
            },
          },

          eventTags: {
            with: { tag: true },
          },
          sports: true,
        },
      })) as DrizzleEventResult[]

      const eventsData = sportsFeedData.sort((left, right) => {
        const leftIndex = orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER
        const rightIndex = orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER
        return leftIndex - rightIndex
      })
      const eventsWithMarkets = await hydrateEventListResults({
        eventsData,
        locale,
        sportsSlugResolver,
      })

      return { data: eventsWithMarkets, error: null }
    })
  },

  async listEventMarketSlugs({
    tag,
    mainTag = '',
    locale = DEFAULT_LOCALE,
    limit = 80,
    sportsSection = '',
    sportsSportSlug = '',
    status = 'active',
    sportsVertical = '',
  }: ListEventMarketSlugsProps): Promise<QueryResult<string[]>> {
    'use cache'
    cacheTag(cacheTags.eventsList)

    return await runQuery(async () => {
      const { baseWhere, empty } = await buildEventListQueryContext({
        tag,
        mainTag: resolveEventMarketSlugsMainTag(tag, mainTag),
        status,
        locale,
        sportsSportSlug,
        sportsSection,
        sportsVertical,
      })

      if (empty) {
        return { data: [], error: null }
      }

      const orderedEventIds = await selectOrderedEventIds({
        baseWhere,
        tag,
        limit: DEFAULT_EVENT_LIST_LIMIT,
        offset: 0,
      })

      if (orderedEventIds.length === 0) {
        return { data: [], error: null }
      }

      const rows = await db
        .select({
          event_id: markets.event_id,
          slug: markets.slug,
          created_at: markets.created_at,
        })
        .from(markets)
        .where(and(inArray(markets.event_id, orderedEventIds), sql`TRIM(COALESCE(${markets.slug}, '')) <> ''`))

      const rowsByEventId = new Map<string, typeof rows>()
      orderedEventIds.forEach((eventId) => {
        rowsByEventId.set(eventId, [])
      })

      rows.forEach((row) => {
        const bucket = rowsByEventId.get(row.event_id)
        if (bucket) {
          bucket.push(row)
        }
      })

      const seen = new Set<string>()
      const slugs: string[] = []
      const safeLimit = Math.min(Math.max(limit, 1), 200)

      for (const eventId of orderedEventIds) {
        const eventRows = rowsByEventId.get(eventId) ?? []
        eventRows
          .sort((left, right) => {
            const leftTime = left.created_at?.getTime?.() ?? 0
            const rightTime = right.created_at?.getTime?.() ?? 0
            return rightTime - leftTime
          })
          .forEach((row) => {
            const normalizedSlug = row.slug?.trim()
            if (!normalizedSlug || seen.has(normalizedSlug)) {
              return
            }

            seen.add(normalizedSlug)
            slugs.push(normalizedSlug)
          })

        if (slugs.length >= safeLimit) {
          break
        }
      }

      return { data: slugs.slice(0, safeLimit), error: null }
    })
  },

  async listAdminEvents({
    limit = 50,
    offset = 0,
    search,
    sortBy = 'created_at',
    sortOrder = 'desc',
    mainCategorySlug,
    creator,
    seriesSlug,
    hideCrypto = false,
    activeOnly = false,
    attention,
    resolutionReportCountsByCondition = new Map(),
  }: ListAdminEventsParams = {}): Promise<{
    data: AdminEventRow[]
    error: string | null
    totalCount: number
    creatorOptions: string[]
    seriesOptions: string[]
  }> {
    const cappedLimit = Math.min(Math.max(limit, 1), 100)
    const safeOffset = Math.max(offset, 0)
    const normalizedSearch = search?.trim().toLowerCase()
    const trimmedMainCategorySlug = mainCategorySlug?.trim()
    const trimmedCreator = creator?.trim()
    const trimmedSeriesSlug = seriesSlug?.trim()
    const resolutionReportConditionIds = [...resolutionReportCountsByCondition.keys()]

    const searchCondition = normalizedSearch
      ? or(
          ilike(sql<string>`LOWER(${events.title})`, `%${normalizedSearch}%`),
          ilike(sql<string>`LOWER(${events.slug})`, `%${normalizedSearch}%`),
        )
      : undefined
    const activeStatusCondition = activeOnly ? eq(events.status, 'active') : undefined
    const hideCryptoCondition = hideCrypto ? not(buildTagContainsCondition('crypto')) : undefined
    const attentionCondition =
      attention === 'missing-sports-id'
        ? buildMissingSportsSourceCondition()
        : attention === 'past-due-unresolved'
          ? buildPastDueUnresolvedEventCondition()
          : attention === 'resolution-reports'
            ? resolutionReportConditionIds.length > 0
              ? and(
                  eq(events.status, 'active'),
                  exists(
                    db
                      .select({ id: markets.condition_id })
                      .from(markets)
                      .innerJoin(conditions, eq(conditions.id, markets.condition_id))
                      .where(
                        and(
                          eq(markets.event_id, events.id),
                          inArray(sql<string>`LOWER(${markets.condition_id})`, resolutionReportConditionIds),
                          eq(markets.is_resolved, false),
                          sql`COALESCE(${conditions.resolved}, false) = false`,
                        ),
                      ),
                  ),
                )
              : sql`false`
            : undefined

    let categorySlugs: string[] | null = null
    if (trimmedMainCategorySlug) {
      const subTagRows = await db
        .select({
          slug: v_main_tag_subcategories.sub_tag_slug,
        })
        .from(v_main_tag_subcategories)
        .where(
          and(
            eq(v_main_tag_subcategories.main_tag_slug, trimmedMainCategorySlug),
            sql`TRIM(COALESCE(${v_main_tag_subcategories.sub_tag_slug}, '')) <> ''`,
          ),
        )

      const slugs = new Set<string>([trimmedMainCategorySlug])
      for (const row of subTagRows) {
        const slug = row.slug?.trim()
        if (slug) {
          slugs.add(slug)
        }
      }

      categorySlugs = Array.from(slugs)
    }

    const mainCategoryCondition =
      categorySlugs && categorySlugs.length > 0
        ? exists(
            db
              .select({ event_id: event_tags.event_id })
              .from(event_tags)
              .innerJoin(tags, eq(event_tags.tag_id, tags.id))
              .where(and(eq(event_tags.event_id, events.id), inArray(tags.slug, categorySlugs))),
          )
        : undefined

    const baseWhereCondition = and(
      searchCondition,
      mainCategoryCondition,
      activeStatusCondition,
      hideCryptoCondition,
      attentionCondition,
    )
    const creatorCondition = trimmedCreator ? eq(events.creator, trimmedCreator) : undefined
    const seriesCondition = trimmedSeriesSlug ? eq(events.series_slug, trimmedSeriesSlug) : undefined
    const whereCondition = and(baseWhereCondition, creatorCondition, seriesCondition)

    const validSortFields: Array<
      'title' | 'status' | 'volume' | 'volume_24h' | 'created_at' | 'updated_at' | 'end_date'
    > = ['title', 'status', 'volume', 'volume_24h', 'created_at', 'updated_at', 'end_date']
    const resolvedSortBy = validSortFields.includes(
      sortBy as 'title' | 'status' | 'volume' | 'volume_24h' | 'created_at' | 'updated_at' | 'end_date',
    )
      ? (sortBy as 'title' | 'status' | 'volume' | 'volume_24h' | 'created_at' | 'updated_at' | 'end_date')
      : 'created_at'
    const ascending = (sortOrder ?? 'desc') === 'asc'
    const totalVolumeOrder = sql<number>`COALESCE((
      SELECT SUM(${markets.volume})
      FROM ${markets}
      WHERE ${markets.event_id} = ${events.id}
    ), 0)::double precision`
    const volume24hOrder = sql<number>`COALESCE((
      SELECT SUM(${markets.volume_24h})
      FROM ${markets}
      WHERE ${markets.event_id} = ${events.id}
    ), 0)::double precision`

    let orderByClause
    switch (resolvedSortBy) {
      case 'title':
        orderByClause = ascending ? asc(events.title) : desc(events.title)
        break
      case 'status':
        orderByClause = ascending ? asc(events.status) : desc(events.status)
        break
      case 'volume':
        orderByClause = ascending ? asc(totalVolumeOrder) : desc(totalVolumeOrder)
        break
      case 'volume_24h':
        orderByClause = ascending ? asc(volume24hOrder) : desc(volume24hOrder)
        break
      case 'updated_at':
        orderByClause = ascending ? asc(events.updated_at) : desc(events.updated_at)
        break
      case 'end_date':
        orderByClause = ascending ? asc(events.end_date) : desc(events.end_date)
        break
      case 'created_at':
      default:
        orderByClause = ascending ? asc(events.created_at) : desc(events.created_at)
        break
    }

    const baseQuery = db
      .select({
        id: events.id,
        slug: events.slug,
        title: events.title,
        status: events.status,
        icon_url: events.icon_url,
        is_hidden: events.is_hidden,
        livestream_url: events.livestream_url,
        additional_context: events.additional_context,
        additional_context_updated_at: events.additional_context_updated_at,
        rules: events.rules,
        series_slug: events.series_slug,
        series_recurrence: events.series_recurrence,
        start_date: events.start_date,
        end_date: events.end_date,
        created_at: events.created_at,
        updated_at: events.updated_at,
      })
      .from(events)

    const finalQuery = whereCondition
      ? baseQuery.where(whereCondition).orderBy(orderByClause, desc(events.id)).limit(cappedLimit).offset(safeOffset)
      : baseQuery.orderBy(orderByClause, desc(events.id)).limit(cappedLimit).offset(safeOffset)

    const baseCountQuery = db.select({ count: count() }).from(events)
    const countQuery = whereCondition ? baseCountQuery.where(whereCondition) : baseCountQuery

    const { data, error } = await runQuery(async () => {
      const result = await finalQuery
      return { data: result, error: null }
    })

    const { data: countResult, error: countError } = await runQuery(async () => {
      const result = await countQuery
      return { data: result, error: null }
    })

    if (error || countError) {
      return {
        data: [],
        error: error ?? countError,
        totalCount: 0,
        creatorOptions: [],
        seriesOptions: [],
      }
    }

    const { data: creatorRows, error: creatorError } = await runQuery(async () => {
      const creatorFilterCondition = and(
        baseWhereCondition,
        seriesCondition,
        sql`TRIM(COALESCE(${events.creator}, '')) <> ''`,
      )

      const result = creatorFilterCondition
        ? await db
            .select({
              creator: events.creator,
            })
            .from(events)
            .where(creatorFilterCondition)
            .groupBy(events.creator)
            .orderBy(asc(events.creator))
        : await db
            .select({
              creator: events.creator,
            })
            .from(events)
            .where(sql`TRIM(COALESCE(${events.creator}, '')) <> ''`)
            .groupBy(events.creator)
            .orderBy(asc(events.creator))

      return { data: result, error: null }
    })

    if (creatorError) {
      return {
        data: [],
        error: creatorError,
        totalCount: 0,
        creatorOptions: [],
        seriesOptions: [],
      }
    }

    const { data: seriesRows, error: seriesError } = await runQuery(async () => {
      const seriesFilterCondition = and(
        baseWhereCondition,
        creatorCondition,
        sql`TRIM(COALESCE(${events.series_slug}, '')) <> ''`,
      )

      const result = seriesFilterCondition
        ? await db
            .select({
              series_slug: events.series_slug,
            })
            .from(events)
            .where(seriesFilterCondition)
            .groupBy(events.series_slug)
            .orderBy(asc(events.series_slug))
        : await db
            .select({
              series_slug: events.series_slug,
            })
            .from(events)
            .where(sql`TRIM(COALESCE(${events.series_slug}, '')) <> ''`)
            .groupBy(events.series_slug)
            .orderBy(asc(events.series_slug))

      return { data: result, error: null }
    })

    if (seriesError) {
      return {
        data: [],
        error: seriesError,
        totalCount: 0,
        creatorOptions: [],
        seriesOptions: [],
      }
    }

    const rows = data ?? []
    const eventIds = rows.map((row) => row.id)
    const volumeByEventId = new Map<string, { volume: number; volume_24h: number }>()
    const sportsByEventId = new Map<
      string,
      {
        sports_score: string | null
        sports_segment_scores: SportsSegmentScore[] | null
        sports_segment_count: number | null
        sports_live: boolean | null
        sports_ended: boolean | null
        sports_event_date: string | null
        sports_start_time: string | null
        sports_teams: Array<{ name?: string | null; abbreviation?: string | null; logo_url?: string | null }> | null
        sports_team_logo_urls: string[] | null
        sports_sport_slug: string | null
        sports_league_slug: string | null
        sports_series_slug: string | null
        sports_source_provider: string | null
        sports_source_event_id: string | null
        sports_source_game_id: string | null
        sports_source_league_id: string | null
        sports_source_league_label: string | null
        sports_source_match_confidence: string | null
      }
    >()
    const sportsTagStateByEventId = new Map<
      string,
      { hasSportsTag: boolean; hasEsportsTag: boolean; hasGamesTag: boolean }
    >()
    const moneylineEventIds = new Set<string>()
    const resolutionReportCountByEventId = new Map<string, number>()
    const translationsByEventId = new Map<string, EventTranslationsMap>()
    const rulesTranslationsByEventId = new Map<string, EventRulesTranslationsMap>()

    if (eventIds.length > 0) {
      const translationRows = await db
        .select({
          event_id: event_translations.event_id,
          locale: event_translations.locale,
          title: event_translations.title,
          source_hash: event_translations.source_hash,
          rules: event_translations.rules,
        })
        .from(event_translations)
        .where(inArray(event_translations.event_id, eventIds))

      for (const row of translationRows) {
        if (!NON_DEFAULT_LOCALES.includes(row.locale as NonDefaultLocale)) {
          continue
        }

        const locale = row.locale as NonDefaultLocale
        if (row.source_hash) {
          const translations = translationsByEventId.get(row.event_id) ?? {}
          translations[locale] = row.title
          translationsByEventId.set(row.event_id, translations)
        }

        if (typeof row.rules === 'string' && row.rules.trim()) {
          const rulesTranslations = rulesTranslationsByEventId.get(row.event_id) ?? {}
          rulesTranslations[locale] = row.rules
          rulesTranslationsByEventId.set(row.event_id, rulesTranslations)
        }
      }

      const volumeRows = await db
        .select({
          event_id: markets.event_id,
          volume: sql<number>`COALESCE(SUM(${markets.volume}), 0)::double precision`,
          volume_24h: sql<number>`COALESCE(SUM(${markets.volume_24h}), 0)::double precision`,
        })
        .from(markets)
        .where(inArray(markets.event_id, eventIds))
        .groupBy(markets.event_id)

      for (const row of volumeRows) {
        volumeByEventId.set(row.event_id, {
          volume: Number(row.volume ?? 0),
          volume_24h: Number(row.volume_24h ?? 0),
        })
      }

      const resolutionReportRows = resolutionReportConditionIds.length
        ? await db
            .select({
              event_id: markets.event_id,
              condition_id: markets.condition_id,
            })
            .from(markets)
            .innerJoin(conditions, eq(conditions.id, markets.condition_id))
            .innerJoin(events, eq(events.id, markets.event_id))
            .where(
              and(
                inArray(markets.event_id, eventIds),
                inArray(sql<string>`LOWER(${markets.condition_id})`, resolutionReportConditionIds),
                eq(events.status, 'active'),
                eq(markets.is_resolved, false),
                sql`COALESCE(${conditions.resolved}, false) = false`,
              ),
            )
        : []

      for (const row of resolutionReportRows) {
        const countForCondition = resolutionReportCountsByCondition.get(row.condition_id.toLowerCase()) ?? 0
        resolutionReportCountByEventId.set(
          row.event_id,
          (resolutionReportCountByEventId.get(row.event_id) ?? 0) + countForCondition,
        )
      }

      const sportsRows = await db
        .select({
          event_id: event_sports.event_id,
          sports_score: event_sports.sports_score,
          sports_segment_scores: event_sports.sports_segment_scores,
          sports_source_payload: event_sports.sports_source_payload,
          sports_live: event_sports.sports_live,
          sports_ended: event_sports.sports_ended,
          sports_event_date: event_sports.sports_event_date,
          sports_start_time: event_sports.sports_start_time,
          sports_teams: event_sports.sports_teams,
          sports_team_logo_urls: event_sports.sports_team_logo_urls,
          sports_sport_slug: event_sports.sports_sport_slug,
          sports_league_slug: event_sports.sports_league_slug,
          sports_series_slug: event_sports.sports_series_slug,
          sports_source_provider: event_sports.sports_source_provider,
          sports_source_event_id: event_sports.sports_source_event_id,
          sports_source_game_id: event_sports.sports_source_game_id,
          sports_source_league_id: event_sports.sports_source_league_id,
          sports_source_league_label: event_sports.sports_source_league_label,
          sports_source_match_confidence: event_sports.sports_source_match_confidence,
        })
        .from(event_sports)
        .where(inArray(event_sports.event_id, eventIds))

      for (const row of sportsRows) {
        sportsByEventId.set(row.event_id, {
          sports_score: row.sports_score ?? null,
          sports_segment_scores: normalizeSportsSegmentScores(row.sports_segment_scores),
          sports_segment_count: resolveSportsSourceSegmentCount(row.sports_source_payload),
          sports_live: row.sports_live ?? null,
          sports_ended: row.sports_ended ?? null,
          sports_event_date: row.sports_event_date ?? null,
          sports_start_time: row.sports_start_time?.toISOString?.() ?? null,
          sports_teams: toOptionalSportsTeams(row.sports_teams),
          sports_team_logo_urls:
            toOptionalStringArray(row.sports_team_logo_urls)?.map(
              (logoPath) => getPublicAssetUrl(logoPath) || logoPath,
            ) ?? null,
          sports_sport_slug: row.sports_sport_slug ?? null,
          sports_league_slug: row.sports_league_slug ?? null,
          sports_series_slug: row.sports_series_slug ?? null,
          sports_source_provider: row.sports_source_provider ?? null,
          sports_source_event_id: row.sports_source_event_id ?? null,
          sports_source_game_id: row.sports_source_game_id ?? null,
          sports_source_league_id: row.sports_source_league_id ?? null,
          sports_source_league_label: row.sports_source_league_label ?? null,
          sports_source_match_confidence: row.sports_source_match_confidence ?? null,
        })
      }

      const sportsTagRows = await db
        .select({
          event_id: event_tags.event_id,
          slug: tags.slug,
        })
        .from(event_tags)
        .innerJoin(tags, eq(event_tags.tag_id, tags.id))
        .where(and(inArray(event_tags.event_id, eventIds), inArray(tags.slug, ['sports', 'esports', 'games', 'game'])))

      for (const row of sportsTagRows) {
        const currentState = sportsTagStateByEventId.get(row.event_id) ?? {
          hasSportsTag: false,
          hasEsportsTag: false,
          hasGamesTag: false,
        }

        if (row.slug === 'sports') {
          currentState.hasSportsTag = true
        }
        if (row.slug === 'esports') {
          currentState.hasEsportsTag = true
        }
        if (row.slug === 'games' || row.slug === 'game') {
          currentState.hasGamesTag = true
        }

        sportsTagStateByEventId.set(row.event_id, currentState)
      }

      const sportsMarketRows = await db
        .select({
          event_id: markets.event_id,
          sports_market_type: market_sports.sports_market_type,
          sports_teams: market_sports.sports_teams,
          sports_team_logo_urls: market_sports.sports_team_logo_urls,
          short_title: markets.short_title,
          title: markets.title,
        })
        .from(markets)
        .leftJoin(market_sports, eq(market_sports.condition_id, markets.condition_id))
        .where(inArray(markets.event_id, eventIds))

      for (const row of sportsMarketRows) {
        const currentSports = sportsByEventId.get(row.event_id)
        if (currentSports && (!currentSports.sports_teams || !currentSports.sports_team_logo_urls)) {
          sportsByEventId.set(row.event_id, {
            ...currentSports,
            sports_teams: currentSports.sports_teams ?? toOptionalSportsTeams(row.sports_teams),
            sports_team_logo_urls:
              currentSports.sports_team_logo_urls ??
              (toOptionalStringArray(row.sports_team_logo_urls)?.map(
                (logoPath) => getPublicAssetUrl(logoPath) || logoPath,
              ) ||
                null),
          })
        }

        if (isMoneylineMarketForAdminList(row)) {
          moneylineEventIds.add(row.event_id)
        }
      }
    }

    const formattedRows: AdminEventRow[] = rows.map((row) => {
      const createdAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at)
      const updatedAt = row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at)
      const startDate = row.start_date
        ? row.start_date instanceof Date
          ? row.start_date
          : new Date(row.start_date)
        : null
      const endDate = row.end_date ? (row.end_date instanceof Date ? row.end_date : new Date(row.end_date)) : null
      const volumeData = volumeByEventId.get(row.id)
      const sportsData = sportsByEventId.get(row.id)
      const sportsTagState = sportsTagStateByEventId.get(row.id)

      return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        status: (row.status ?? 'draft') as Event['status'],
        icon_url: getPublicAssetUrl(row.icon_url ?? null),
        livestream_url: row.livestream_url ?? null,
        additional_context: row.additional_context ?? null,
        additional_context_updated_at: row.additional_context_updated_at?.toISOString?.() ?? null,
        rules: row.rules ?? null,
        series_slug: row.series_slug ?? null,
        series_recurrence: row.series_recurrence ?? null,
        start_date: startDate && !Number.isNaN(startDate.getTime()) ? startDate.toISOString() : null,
        volume: volumeData?.volume ?? 0,
        volume_24h: volumeData?.volume_24h ?? 0,
        is_hidden: Boolean(row.is_hidden),
        translations: translationsByEventId.get(row.id) ?? {},
        rules_translations: rulesTranslationsByEventId.get(row.id) ?? {},
        sports_score: sportsData?.sports_score ?? null,
        sports_segment_scores: sportsData?.sports_segment_scores ?? null,
        sports_segment_count: sportsData?.sports_segment_count ?? null,
        sports_live: sportsData?.sports_live ?? null,
        sports_ended: sportsData?.sports_ended ?? null,
        sports_event_date: sportsData?.sports_event_date ?? null,
        sports_start_time: sportsData?.sports_start_time ?? null,
        sports_teams: sportsData?.sports_teams ?? null,
        sports_team_logo_urls: sportsData?.sports_team_logo_urls ?? null,
        sports_sport_slug: sportsData?.sports_sport_slug ?? null,
        sports_league_slug: sportsData?.sports_league_slug ?? null,
        sports_series_slug: sportsData?.sports_series_slug ?? null,
        sports_source_provider: sportsData?.sports_source_provider ?? null,
        sports_source_event_id: sportsData?.sports_source_event_id ?? null,
        sports_source_game_id: sportsData?.sports_source_game_id ?? null,
        sports_source_league_id: sportsData?.sports_source_league_id ?? null,
        sports_source_league_label: sportsData?.sports_source_league_label ?? null,
        sports_source_match_confidence: sportsData?.sports_source_match_confidence ?? null,
        sports_vertical: sportsTagState?.hasEsportsTag ? 'esports' : sportsTagState?.hasSportsTag ? 'sports' : null,
        is_sports_games_moneyline: Boolean(
          (sportsTagState?.hasSportsTag || sportsTagState?.hasEsportsTag) &&
          sportsTagState?.hasGamesTag &&
          moneylineEventIds.has(row.id),
        ),
        resolution_report_count: resolutionReportCountByEventId.get(row.id) ?? 0,
        end_date: endDate && !Number.isNaN(endDate.getTime()) ? endDate.toISOString() : null,
        created_at: Number.isNaN(createdAt.getTime()) ? new Date().toISOString() : createdAt.toISOString(),
        updated_at: Number.isNaN(updatedAt.getTime()) ? new Date().toISOString() : updatedAt.toISOString(),
      }
    })

    return {
      data: formattedRows,
      error: null,
      totalCount: countResult?.[0]?.count ?? 0,
      creatorOptions: (creatorRows ?? []).map((row) => row.creator?.trim() ?? '').filter((value) => value.length > 0),
      seriesOptions: (seriesRows ?? []).map((row) => row.series_slug?.trim() ?? '').filter((value) => value.length > 0),
    }
  },

  async setEventHiddenState(
    eventId: string,
    isHidden: boolean,
  ): Promise<
    QueryResult<{
      id: string
      slug: string
      is_hidden: boolean
    }>
  > {
    return runQuery(async () => {
      const updatedRows = await db
        .update(events)
        .set({
          is_hidden: isHidden,
          updated_at: new Date(),
        })
        .where(eq(events.id, eventId))
        .returning({
          id: events.id,
          slug: events.slug,
          is_hidden: events.is_hidden,
        })

      const updatedRow = updatedRows[0]
      if (!updatedRow) {
        return { data: null, error: 'Event not found.' }
      }

      return {
        data: updatedRow,
        error: null,
      }
    })
  },

  async updateEventTranslationsById(
    eventId: string,
    translations: EventTranslationsMap,
  ): Promise<{
    data: { slug: string; translations: EventTranslationsMap } | null
    error: string | null
  }> {
    const normalizedEntries = NON_DEFAULT_LOCALES.map((locale) => {
      const rawValue = translations[locale]
      const value = typeof rawValue === 'string' ? rawValue.trim() : ''
      return { locale, value }
    })

    const { data: eventRecord, error: eventCheckError } = await runQuery(async () => {
      const result = await db
        .select({ id: events.id, slug: events.slug, title: events.title })
        .from(events)
        .where(eq(events.id, eventId))
        .limit(1)

      return { data: result[0] ?? null, error: null }
    })

    if (eventCheckError || !eventRecord) {
      return { data: null, error: eventCheckError ?? 'Event not found.' }
    }

    const sourceHash = createHash('sha256').update(eventRecord.title).digest('hex')
    const localesToDelete = normalizedEntries.filter((entry) => entry.value.length === 0).map((entry) => entry.locale)
    const rowsToUpsert = normalizedEntries
      .filter((entry) => entry.value.length > 0)
      .map((entry) => ({
        event_id: eventId,
        locale: entry.locale,
        title: entry.value,
        source_hash: sourceHash,
        is_manual: true,
        updated_at: new Date(),
      }))

    const { error } = await runQuery(async () => {
      await db.transaction(async (tx) => {
        if (localesToDelete.length > 0) {
          await tx
            .update(event_translations)
            .set({
              title: eventRecord.title,
              source_hash: '',
              is_manual: false,
              updated_at: new Date(),
            })
            .where(and(eq(event_translations.event_id, eventId), inArray(event_translations.locale, localesToDelete)))

          await tx
            .delete(event_translations)
            .where(
              and(
                eq(event_translations.event_id, eventId),
                inArray(event_translations.locale, localesToDelete),
                sql`NULLIF(TRIM(COALESCE(${event_translations.additional_context}, '')), '') IS NULL`,
                sql`NULLIF(TRIM(COALESCE(${event_translations.rules}, '')), '') IS NULL`,
              ),
            )
        }

        if (rowsToUpsert.length > 0) {
          await tx
            .insert(event_translations)
            .values(rowsToUpsert)
            .onConflictDoUpdate({
              target: [event_translations.event_id, event_translations.locale],
              set: {
                title: sql`EXCLUDED.title`,
                source_hash: sql`EXCLUDED.source_hash`,
                is_manual: true,
                updated_at: sql`EXCLUDED.updated_at`,
              },
            })
        }
      })

      return { data: true, error: null }
    })

    if (error) {
      return { data: null, error }
    }

    const { data: translationRows, error: translationError } = await runQuery(async () => {
      const result = await db
        .select({
          locale: event_translations.locale,
          title: event_translations.title,
          source_hash: event_translations.source_hash,
        })
        .from(event_translations)
        .where(eq(event_translations.event_id, eventId))

      return { data: result, error: null }
    })

    if (translationError || !translationRows) {
      return { data: null, error: translationError ?? 'Failed to load event translations.' }
    }

    const nextTranslations: EventTranslationsMap = {}
    for (const row of translationRows) {
      if (NON_DEFAULT_LOCALES.includes(row.locale as NonDefaultLocale) && row.source_hash) {
        nextTranslations[row.locale as NonDefaultLocale] = row.title
      }
    }

    return {
      data: {
        slug: eventRecord.slug,
        translations: nextTranslations,
      },
      error: null,
    }
  },

  async updateEventRulesTranslationsById(
    eventId: string,
    translations: EventRulesTranslationsMap,
  ): Promise<{
    data: { slug: string; rulesTranslations: EventRulesTranslationsMap } | null
    error: string | null
  }> {
    const normalizedEntries = NON_DEFAULT_LOCALES.map((locale) => ({
      locale,
      value: typeof translations[locale] === 'string' ? translations[locale]!.trim() : '',
    }))

    const result = await runQuery(async () => {
      await db.transaction(async (tx) => {
        const eventRows = await tx
          .select({ id: events.id, slug: events.slug, title: events.title, rules: events.rules })
          .from(events)
          .where(eq(events.id, eventId))
          .limit(1)
        const event = eventRows[0]
        if (!event) {
          throw new Error('Event not found.')
        }

        const now = new Date()
        const sourceHash = createHash('sha256')
          .update(event.rules?.trim() ?? '')
          .digest('hex')

        for (const entry of normalizedEntries) {
          if (!entry.value) {
            await tx
              .update(event_translations)
              .set({
                rules: null,
                rules_source_hash: null,
                rules_is_manual: false,
                updated_at: now,
              })
              .where(and(eq(event_translations.event_id, eventId), eq(event_translations.locale, entry.locale)))
            continue
          }

          await tx
            .insert(event_translations)
            .values({
              event_id: eventId,
              locale: entry.locale,
              title: event.title,
              source_hash: '',
              is_manual: false,
              rules: entry.value,
              rules_source_hash: sourceHash,
              rules_is_manual: true,
              updated_at: now,
            })
            .onConflictDoUpdate({
              target: [event_translations.event_id, event_translations.locale],
              set: {
                rules: sql`EXCLUDED.rules`,
                rules_source_hash: sql`EXCLUDED.rules_source_hash`,
                rules_is_manual: true,
                updated_at: sql`EXCLUDED.updated_at`,
              },
            })
        }
      })

      return { data: true, error: null }
    })

    if (result.error) {
      return { data: null, error: result.error }
    }

    const { data: eventRow, error: eventError } = await runQuery(async () => {
      const rows = await db.select({ slug: events.slug }).from(events).where(eq(events.id, eventId)).limit(1)
      return { data: rows[0] ?? null, error: null }
    })
    if (eventError || !eventRow) {
      return { data: null, error: eventError ?? 'Event not found.' }
    }

    const { data: rows, error: rowsError } = await runQuery(async () => {
      const values = await db
        .select({ locale: event_translations.locale, rules: event_translations.rules })
        .from(event_translations)
        .where(eq(event_translations.event_id, eventId))
      return { data: values, error: null }
    })
    if (rowsError || !rows) {
      return { data: null, error: rowsError ?? 'Failed to load event Rules translations.' }
    }

    const rulesTranslations: EventRulesTranslationsMap = {}
    for (const row of rows) {
      if (NON_DEFAULT_LOCALES.includes(row.locale as NonDefaultLocale) && typeof row.rules === 'string') {
        rulesTranslations[row.locale as NonDefaultLocale] = row.rules
      }
    }

    return { data: { slug: eventRow.slug, rulesTranslations }, error: null }
  },

  async setEventLivestreamUrl(
    eventId: string,
    livestreamUrl: string | null,
  ): Promise<
    QueryResult<{
      id: string
      slug: string
      livestream_url: string | null
    }>
  > {
    return runQuery(async () => {
      const updatedRows = await db
        .update(events)
        .set({
          livestream_url: livestreamUrl,
          updated_at: new Date(),
        })
        .where(eq(events.id, eventId))
        .returning({
          id: events.id,
          slug: events.slug,
          livestream_url: events.livestream_url,
        })

      const updatedRow = updatedRows[0]
      if (!updatedRow) {
        return { data: null, error: 'Event not found.' }
      }

      return {
        data: {
          id: updatedRow.id,
          slug: updatedRow.slug,
          livestream_url: updatedRow.livestream_url ?? null,
        },
        error: null,
      }
    })
  },

  async setEventAdditionalContext(
    eventId: string,
    additionalContext: string | null,
    additionalContextUpdatedAt: Date | null,
  ): Promise<
    QueryResult<{
      id: string
      slug: string
      additional_context: string | null
      additional_context_updated_at: string | null
    }>
  > {
    return runQuery(async () => {
      const updatedRows = await db
        .update(events)
        .set({
          additional_context: additionalContext,
          additional_context_updated_at: additionalContextUpdatedAt,
          updated_at: new Date(),
        })
        .where(eq(events.id, eventId))
        .returning({
          id: events.id,
          slug: events.slug,
          additional_context: events.additional_context,
          additional_context_updated_at: events.additional_context_updated_at,
        })

      const updatedRow = updatedRows[0]
      if (!updatedRow) {
        return { data: null, error: 'Event not found.' }
      }

      return {
        data: {
          id: updatedRow.id,
          slug: updatedRow.slug,
          additional_context: updatedRow.additional_context ?? null,
          additional_context_updated_at: updatedRow.additional_context_updated_at?.toISOString?.() ?? null,
        },
        error: null,
      }
    })
  },

  async updateEventAdditionalContextTranslationsById(
    eventId: string,
    sourceContext: string | null,
    translations: EventAdditionalContextTranslationsMap,
  ): Promise<{ data: { updated: number } | null; error: string | null }> {
    const normalizedContext = sourceContext?.trim() || null
    const normalizedEntries = NON_DEFAULT_LOCALES.map((locale) => ({
      locale,
      value: typeof translations[locale] === 'string' ? translations[locale]!.trim() : '',
    })).filter((entry) => entry.value.length > 0)

    return runQuery(async () => {
      await db.transaction(async (tx) => {
        const eventRecord = await tx
          .select({ id: events.id, title: events.title })
          .from(events)
          .where(eq(events.id, eventId))
          .limit(1)

        const event = eventRecord[0]
        if (!event) {
          throw new Error('Event not found.')
        }

        const now = new Date()
        const localesToReplace = normalizedContext
          ? normalizedEntries.map((entry) => entry.locale)
          : NON_DEFAULT_LOCALES

        if (localesToReplace.length > 0) {
          await tx
            .update(event_translations)
            .set({
              additional_context: null,
              additional_context_source_hash: null,
              additional_context_is_manual: false,
              updated_at: now,
            })
            .where(
              and(
                eq(event_translations.event_id, eventId),
                inArray(event_translations.locale, localesToReplace),
                eq(event_translations.additional_context_is_manual, false),
              ),
            )
        }

        if (!normalizedContext || normalizedEntries.length === 0) {
          return
        }

        const sourceHash = createHash('sha256').update(normalizedContext).digest('hex')
        for (const entry of normalizedEntries) {
          await tx
            .insert(event_translations)
            .values({
              event_id: eventId,
              locale: entry.locale,
              title: event.title,
              source_hash: '',
              is_manual: false,
              additional_context: entry.value,
              additional_context_source_hash: sourceHash,
              additional_context_is_manual: false,
              updated_at: now,
            })
            .onConflictDoUpdate({
              target: [event_translations.event_id, event_translations.locale],
              set: {
                additional_context: sql`EXCLUDED.additional_context`,
                additional_context_source_hash: sql`EXCLUDED.additional_context_source_hash`,
                additional_context_is_manual: false,
                updated_at: sql`EXCLUDED.updated_at`,
              },
              setWhere: eq(event_translations.additional_context_is_manual, false),
            })
        }
      })

      return { data: { updated: normalizedEntries.length }, error: null }
    })
  },

  async setEventSportsFinalState(
    eventId: string,
    {
      sportsEnded,
      sportsScore,
      sportsSegmentScores,
      sportsSource,
      livestreamUrl,
    }: {
      sportsEnded: boolean
      sportsScore: string | null
      sportsSegmentScores?: SportsSegmentScore[] | null
      sportsSource?: {
        provider: string | null
        eventId: string | null
        gameId: string | null
        leagueId: string | null
        leagueLabel: string | null
        matchConfidence: string | null
        payload?: Record<string, unknown> | null
      }
      livestreamUrl?: string | null
    },
  ): Promise<
    QueryResult<{
      id: string
      slug: string
      livestream_url: string | null
      sports_score: string | null
      sports_live: boolean | null
      sports_ended: boolean | null
      sports_source_provider: string | null
      sports_source_event_id: string | null
      sports_source_game_id: string | null
      sports_source_league_id: string | null
      sports_source_league_label: string | null
      sports_source_match_confidence: string | null
    }>
  > {
    return runQuery(async () => {
      return db.transaction(async (tx) => {
        const row = await tx
          .select({
            id: events.id,
            slug: events.slug,
            livestream_url: events.livestream_url,
          })
          .from(events)
          .where(eq(events.id, eventId))
          .limit(1)

        const eventRow = row[0]
        if (!eventRow) {
          return { data: null, error: 'Event not found.' }
        }

        const now = new Date()
        const sportsPayload: Partial<typeof event_sports.$inferInsert> & {
          sports_ended: boolean
          sports_score: string | null
          updated_at: Date
        } = {
          sports_ended: sportsEnded,
          sports_score: sportsScore,
          updated_at: now,
        }

        if (sportsSegmentScores !== undefined) {
          sportsPayload.sports_segment_scores = sportsSegmentScores
        }

        if (sportsEnded) {
          sportsPayload.sports_live = false
        }

        if (sportsSource) {
          const hasSourceIdentity = Boolean(sportsSource.provider && (sportsSource.eventId || sportsSource.gameId))
          sportsPayload.sports_source_provider = sportsSource.provider
          sportsPayload.sports_source_event_id = sportsSource.eventId
          sportsPayload.sports_source_game_id = sportsSource.gameId
          sportsPayload.sports_source_league_id = sportsSource.leagueId
          sportsPayload.sports_source_league_label = sportsSource.leagueLabel
          sportsPayload.sports_source_match_confidence = sportsSource.matchConfidence
          sportsPayload.sports_source_selected_at = hasSourceIdentity ? now : null
          if ('payload' in sportsSource) {
            sportsPayload.sports_source_payload = sportsSource.payload ?? null
          }
        }

        if (livestreamUrl !== undefined) {
          await tx
            .update(events)
            .set({
              livestream_url: livestreamUrl,
              updated_at: now,
            })
            .where(eq(events.id, eventId))
        }

        await tx
          .insert(event_sports)
          .values({
            event_id: eventId,
            ...sportsPayload,
          })
          .onConflictDoUpdate({
            target: event_sports.event_id,
            set: sportsPayload,
          })

        const sportsRows = await tx
          .select({
            sports_score: event_sports.sports_score,
            sports_live: event_sports.sports_live,
            sports_ended: event_sports.sports_ended,
            sports_source_provider: event_sports.sports_source_provider,
            sports_source_event_id: event_sports.sports_source_event_id,
            sports_source_game_id: event_sports.sports_source_game_id,
            sports_source_league_id: event_sports.sports_source_league_id,
            sports_source_league_label: event_sports.sports_source_league_label,
            sports_source_match_confidence: event_sports.sports_source_match_confidence,
          })
          .from(event_sports)
          .where(eq(event_sports.event_id, eventId))
          .limit(1)

        const sportsRow = sportsRows[0]

        return {
          data: {
            id: eventRow.id,
            slug: eventRow.slug,
            livestream_url: livestreamUrl !== undefined ? livestreamUrl : (eventRow.livestream_url ?? null),
            sports_score: sportsRow?.sports_score ?? null,
            sports_live: sportsRow?.sports_live ?? null,
            sports_ended: sportsRow?.sports_ended ?? null,
            sports_source_provider: sportsRow?.sports_source_provider ?? null,
            sports_source_event_id: sportsRow?.sports_source_event_id ?? null,
            sports_source_game_id: sportsRow?.sports_source_game_id ?? null,
            sports_source_league_id: sportsRow?.sports_source_league_id ?? null,
            sports_source_league_label: sportsRow?.sports_source_league_label ?? null,
            sports_source_match_confidence: sportsRow?.sports_source_match_confidence ?? null,
          },
          error: null,
        }
      })
    })
  },

  async getCanonicalEventSlugBySportsPath(
    sportsSportSlug: string,
    sportsEventSlug: string,
    sportsLeagueSlug?: string | null,
  ): Promise<QueryResult<{ slug: string }>> {
    return runQuery(async () => {
      const sportsSlugResolver = await getSportsSlugResolverFromDb()
      const requestedCanonicalSportsSlug = resolveCanonicalSportsSportSlug(sportsSlugResolver, {
        sportsSportSlug,
        sportsTags: null,
      })
      const sportsSportSlugCandidates = resolveSportsSportSlugQueryCandidates(sportsSlugResolver, sportsSportSlug)
      const normalizedSportsEventSlug = sportsEventSlug.trim().toLowerCase()
      const normalizedSportsLeagueSlug = sportsLeagueSlug?.trim().toLowerCase() ?? ''

      if (!requestedCanonicalSportsSlug || !normalizedSportsEventSlug || sportsSportSlugCandidates.length === 0) {
        throw new Error('Event not found')
      }

      const sportsSlugMatchCondition = buildSportsSlugMatchCondition(sportsSportSlugCandidates)
      if (!sportsSlugMatchCondition) {
        throw new Error('Event not found')
      }

      const normalizedSportsEventSlugColumn = sql<string>`
        LOWER(TRIM(COALESCE(${event_sports.sports_event_slug}, '')))
      `

      const result = await db
        .select({
          slug: events.slug,
          created_at: events.created_at,
        })
        .from(event_sports)
        .innerJoin(events, eq(event_sports.event_id, events.id))
        .where(
          and(
            eq(normalizedSportsEventSlugColumn, normalizedSportsEventSlug),
            eq(events.is_hidden, false),
            buildPublicEventListVisibilityCondition(events.id),
            sportsSlugMatchCondition,
            normalizedSportsLeagueSlug ? eq(event_sports.sports_league_slug, normalizedSportsLeagueSlug) : undefined,
          ),
        )
        .orderBy(desc(events.created_at))

      const matchingRow = result.sort((left, right) => {
        const leftIsAuxiliary = isSportsAuxiliaryEventSlug(left.slug)
        const rightIsAuxiliary = isSportsAuxiliaryEventSlug(right.slug)
        if (leftIsAuxiliary !== rightIsAuxiliary) {
          return Number(leftIsAuxiliary) - Number(rightIsAuxiliary)
        }

        return right.created_at.getTime() - left.created_at.getTime()
      })[0]

      if (matchingRow) {
        return { data: { slug: matchingRow.slug }, error: null }
      }

      throw new Error('Event not found')
    })
  },

  async existsBySlug(slug: string): Promise<QueryResult<boolean>> {
    return runQuery(async () => {
      const result = await db.select({ id: events.id }).from(events).where(eq(events.slug, slug)).limit(1)

      return {
        data: result.length > 0,
        error: null,
      }
    })
  },

  async getEventTitleBySlug(
    slug: string,
    locale: SupportedLocale = DEFAULT_LOCALE,
  ): Promise<QueryResult<{ title: string }>> {
    'use cache'
    cacheTag(cacheTags.event(slug))

    return runQuery(async () => {
      const result = await db
        .select({ id: events.id, title: events.title })
        .from(events)
        .where(and(eq(events.slug, slug), eq(events.is_hidden, false)))
        .limit(1)

      if (result.length === 0) {
        throw new Error('Event not found')
      }

      const eventRow = result[0]
      if (!eventRow) {
        throw new Error('Event not found')
      }

      if (locale === DEFAULT_LOCALE) {
        return { data: { title: eventRow.title }, error: null }
      }

      const localizedTitles = await getLocalizedEventTitlesById([eventRow.id], locale)

      return {
        data: {
          title: localizedTitles.get(eventRow.id) ?? eventRow.title,
        },
        error: null,
      }
    })
  },

  async getEventRouteBySlug(slug: string): Promise<
    QueryResult<{
      slug: string
      sports_sport_slug: string | null
      sports_league_slug: string | null
      sports_event_slug: string | null
      sports_section: 'games' | 'props' | null
      tags: Array<{ slug: string }>
    }>
  > {
    'use cache'
    cacheTag(cacheTags.event(slug))

    return runQuery(async () => {
      interface EventRouteRow {
        id: string
        slug: string
        sports_sport_slug: string | null
        sports_league_slug: string | null
        sports_series_slug: string | null
        sports_event_slug: string | null
        sports_tags: unknown
      }

      const result = (await db
        .select({
          id: events.id,
          slug: events.slug,
          sports_sport_slug: event_sports.sports_sport_slug,
          sports_league_slug: event_sports.sports_league_slug,
          sports_series_slug: event_sports.sports_series_slug,
          sports_event_slug: event_sports.sports_event_slug,
          sports_tags: event_sports.sports_tags,
        })
        .from(events)
        .leftJoin(event_sports, eq(event_sports.event_id, events.id))
        .where(and(eq(events.slug, slug), eq(events.is_hidden, false)))
        .limit(1)) as EventRouteRow[]

      const eventRow = result[0]
      if (!eventRow) {
        throw new Error('Event not found')
      }

      const tagRows = await db
        .select({
          slug: tags.slug,
        })
        .from(event_tags)
        .innerJoin(tags, eq(event_tags.tag_id, tags.id))
        .where(eq(event_tags.event_id, eventRow.id))

      const sportsSlugResolver = await getSportsSlugResolverFromDb()
      const normalizedSportsTags = toOptionalStringArray(eventRow.sports_tags)

      return {
        data: {
          slug: eventRow.slug,
          sports_sport_slug: resolveCanonicalSportsSportSlug(sportsSlugResolver, {
            sportsSportSlug: eventRow.sports_sport_slug,
            sportsSeriesSlug: eventRow.sports_series_slug,
            sportsTags: normalizedSportsTags,
          }),
          sports_league_slug: eventRow.sports_league_slug ?? null,
          sports_event_slug: eventRow.sports_event_slug ?? null,
          sports_section: resolveSportsSection({ tags: tagRows }),
          tags: tagRows.map((tagRow) => ({
            slug: tagRow.slug,
          })),
        },
        error: null,
      }
    })
  },

  async getEventConditionChangeLogBySlug(slug: string): Promise<QueryResult<ConditionChangeLogEntry[]>> {
    return runQuery(async () => {
      const eventResult = await db
        .select({ id: events.id })
        .from(events)
        .where(and(eq(events.slug, slug), eq(events.is_hidden, false)))
        .limit(1)

      if (!eventResult.length) {
        throw new Error('Event not found')
      }

      const eventId = eventResult[0]!.id

      const rows = await db
        .select({
          condition_id: conditions_audit.condition_id,
          created_at: conditions_audit.created_at,
          old_values: conditions_audit.old_values,
          new_values: conditions_audit.new_values,
        })
        .from(conditions_audit)
        .innerJoin(markets, eq(markets.condition_id, conditions_audit.condition_id))
        .where(eq(markets.event_id, eventId))
        .orderBy(desc(conditions_audit.created_at))

      const data = rows.map((row) => ({
        condition_id: row.condition_id,
        created_at:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : new Date(row.created_at as unknown as string).toISOString(),
        old_values: row.old_values as Record<string, unknown>,
        new_values: row.new_values as Record<string, unknown>,
      }))

      return { data, error: null }
    })
  },

  async getEventMarketMetadata(slug: string): Promise<
    QueryResult<
      {
        condition_id: string
        title: string
        slug: string
        is_active: boolean
        is_resolved: boolean
        neg_risk: boolean
        event_enable_neg_risk: boolean
        outcomes: Array<{
          token_id: string
          outcome_text: string
          outcome_index: number
        }>
      }[]
    >
  > {
    return runQuery(async () => {
      interface MarketMetadataRow {
        condition_id: string
        title: string
        slug: string
        is_active: boolean | null
        is_resolved: boolean | null
        neg_risk: boolean | null
        condition: {
          outcomes: Array<{
            token_id: string
            outcome_text: string | null
            outcome_index: number | null
          }>
        } | null
      }
      interface EventMarketMetadataRow {
        enable_neg_risk: boolean | null
        markets?: MarketMetadataRow[]
      }

      const eventResult = (await db.query.events.findFirst({
        where: { RAW: (table) => and(eq(table.slug, slug), eq(table.is_hidden, false))! },
        columns: {
          id: true,
          enable_neg_risk: true,
        },
        with: {
          markets: {
            columns: {
              condition_id: true,
              title: true,
              slug: true,
              is_active: true,
              is_resolved: true,
              neg_risk: true,
            },
            with: {
              condition: {
                columns: { id: true },
                with: {
                  outcomes: {
                    columns: {
                      token_id: true,
                      outcome_text: true,
                      outcome_index: true,
                    },
                  },
                },
              },
            },
          },
        },
      })) as EventMarketMetadataRow | undefined

      if (!eventResult) {
        throw new Error('Event not found')
      }

      const markets = (eventResult.markets ?? []).map((market) => ({
        condition_id: market.condition_id,
        title: market.title,
        slug: market.slug,
        is_active: Boolean(market.is_active),
        is_resolved: Boolean(market.is_resolved),
        neg_risk: Boolean(market.neg_risk),
        event_enable_neg_risk: Boolean(eventResult.enable_neg_risk),
        outcomes: (market.condition?.outcomes ?? []).map((outcome) => ({
          token_id: outcome.token_id,
          outcome_text: outcome.outcome_text || '',
          outcome_index:
            typeof outcome.outcome_index === 'number' ? outcome.outcome_index : Number(outcome.outcome_index || 0),
        })),
      }))

      return { data: markets, error: null }
    })
  },

  async getEventBySlug(
    slug: string,
    userId: string = '',
    locale: SupportedLocale = DEFAULT_LOCALE,
  ): Promise<QueryResult<Event>> {
    return runQuery(async () => {
      const eventResult = (await db.query.events.findFirst({
        where: { RAW: (table) => and(eq(table.slug, slug), eq(table.is_hidden, false))! },
        with: {
          markets: {
            with: {
              sports: true,
              condition: {
                with: { outcomes: true },
              },
            },
          },
          eventTags: {
            with: { tag: true },
          },
          sports: true,
          ...(userId && {
            bookmarks: {
              where: { RAW: (table) => eq(table.user_id, userId) },
            },
          }),
        },
      })) as DrizzleEventResult

      if (!eventResult) {
        throw new Error('Event not found')
      }

      const hydratedEventResult = await hydrateSportsAuxiliaryEventContext(eventResult as DrizzleEventResult)

      const sportsSlugResolver = await getSportsSlugResolverFromDb()
      const transformedEvent = await buildEventResource(hydratedEventResult, userId, sportsSlugResolver, locale)

      return { data: transformedEvent, error: null }
    })
  },

  async getEventsBySlugs(
    slugs: string[],
    userId: string = '',
    locale: SupportedLocale = DEFAULT_LOCALE,
  ): Promise<QueryResult<Event[]>> {
    return runQuery(async () => {
      const normalizedSlugs = Array.from(new Set(slugs.map((slug) => slug.trim()).filter(Boolean)))
      if (normalizedSlugs.length === 0) {
        return { data: [], error: null }
      }

      const eventResults = (await db.query.events.findMany({
        where: {
          RAW: (table) => and(inArray(table.slug, normalizedSlugs), eq(table.is_hidden, false))!,
        },
        with: {
          markets: {
            with: {
              sports: true,
              condition: {
                with: { outcomes: true },
              },
            },
          },
          eventTags: {
            with: { tag: true },
          },
          sports: true,
          ...(userId && {
            bookmarks: {
              where: { RAW: (table) => eq(table.user_id, userId) },
            },
          }),
        },
      })) as DrizzleEventResult[]

      if (eventResults.length === 0) {
        return { data: [], error: null }
      }

      const hydratedEventResults = await Promise.all(eventResults.map(hydrateSportsAuxiliaryEventContext))
      const sportsSlugResolver = await getSportsSlugResolverFromDb()
      const eventsWithMarkets = await hydrateEventListResults({
        eventsData: hydratedEventResults,
        locale,
        sportsSlugResolver,
        userId,
      })
      const eventsBySlug = new Map(eventsWithMarkets.map((event) => [event.slug, event]))

      return {
        data: normalizedSlugs.map((slug) => eventsBySlug.get(slug)).filter((event): event is Event => Boolean(event)),
        error: null,
      }
    })
  },

  async getSportsEventGroupBySlug(
    slug: string,
    userId: string = '',
    locale: SupportedLocale = DEFAULT_LOCALE,
  ): Promise<QueryResult<Event[]>> {
    return runQuery(async () => {
      const sportsSlugResolver = await getSportsSlugResolverFromDb()
      const sportsVolumeGroupKeySql = buildSportsVolumeGroupKeySql()

      const baseGroupRows = await db
        .select({
          group_key: sportsVolumeGroupKeySql,
        })
        .from(events)
        .innerJoin(event_sports, eq(event_sports.event_id, events.id))
        .where(and(eq(events.slug, slug), eq(events.is_hidden, false), sql`${sportsVolumeGroupKeySql} IS NOT NULL`))
        .limit(1)

      const baseGroupKey = baseGroupRows[0]?.group_key?.trim()
      if (!baseGroupKey) {
        return { data: [], error: null }
      }

      const groupedEventsData = (await db.query.events.findMany({
        where: {
          RAW: (table) =>
            mapEventColumnsToRelationAlias(
              and(
                eq(table.is_hidden, false),
                exists(
                  db
                    .select({ event_id: event_sports.event_id })
                    .from(event_sports)
                    .where(and(eq(event_sports.event_id, table.id), sql`${sportsVolumeGroupKeySql} = ${baseGroupKey}`)),
                ),
              )!,
              table,
            ),
        },
        with: {
          markets: {
            with: {
              sports: true,
              condition: {
                with: { outcomes: true },
              },
            },
          },
          eventTags: {
            with: { tag: true },
          },
          sports: true,
          ...(userId && {
            bookmarks: {
              where: { RAW: (table) => eq(table.user_id, userId) },
            },
          }),
        },
        orderBy: { created_at: 'asc' },
      })) as DrizzleEventResult[]

      if (groupedEventsData.length === 0) {
        return { data: [], error: null }
      }

      const hydratedGroupedEventsData = hydrateGroupedSportsAuxiliaryEventContexts(groupedEventsData)

      const tokensForPricing = hydratedGroupedEventsData.flatMap((event) =>
        (event.markets ?? []).flatMap((market) =>
          (market.condition?.outcomes ?? []).map((outcome) => outcome.token_id).filter(Boolean),
        ),
      )
      const tagIds = Array.from(
        new Set(
          hydratedGroupedEventsData.flatMap((event) =>
            (event.eventTags ?? [])
              .map((eventTag) => eventTag.tag?.id)
              .filter((tagId): tagId is number => typeof tagId === 'number'),
          ),
        ),
      )
      const eventIds = hydratedGroupedEventsData.map((event) => event.id)
      const [
        priceMap,
        lastTradeMap,
        localizedTagNamesById,
        localizedEventTitlesById,
        localizedEventAdditionalContextsById,
        localizedEventRulesById,
        groupedVolumesByGroupKey,
      ] = await Promise.all([
        fetchOutcomePrices(tokensForPricing),
        fetchLastTradePrices(tokensForPricing),
        getLocalizedTagNamesById(tagIds, locale),
        getLocalizedEventTitlesById(eventIds, locale),
        getLocalizedEventAdditionalContextsById(eventIds, locale),
        getLocalizedEventRulesById(eventIds, locale),
        getSportsAggregatedVolumesByGroupKey([baseGroupKey]),
      ])
      const liveChartSeriesSlugs = await getEnabledLiveChartSeriesSlugs()

      const groupedVolume = groupedVolumesByGroupKey.get(baseGroupKey)
      const eventsWithMarkets = hydratedGroupedEventsData
        .filter((event) => event.markets?.length > 0)
        .map((event) =>
          eventResource(
            event as DrizzleEventResult,
            userId,
            sportsSlugResolver,
            priceMap,
            lastTradeMap,
            localizedTagNamesById,
            localizedEventTitlesById,
            localizedEventAdditionalContextsById,
            localizedEventRulesById,
            liveChartSeriesSlugs,
          ),
        )
        .map((event) => {
          if (groupedVolume == null) {
            return event
          }

          return {
            ...event,
            volume: groupedVolume,
          }
        })

      return { data: eventsWithMarkets, error: null }
    })
  },

  async getSeriesEventsBySeriesSlug(seriesSlug: string): Promise<QueryResult<EventSeriesEntry[]>> {
    return runQuery(async () => {
      const normalizedSeriesSlug = seriesSlug.trim()

      if (!normalizedSeriesSlug) {
        return { data: [], error: null }
      }

      const sportsSlugResolver = await getSportsSlugResolverFromDb()
      const rows = await db
        .select({
          id: events.id,
          slug: events.slug,
          status: events.status,
          end_date: events.end_date,
          resolved_at: events.resolved_at,
          created_at: events.created_at,
          sports_event_slug: event_sports.sports_event_slug,
          sports_sport_slug: event_sports.sports_sport_slug,
          sports_league_slug: event_sports.sports_league_slug,
          sports_series_slug: event_sports.sports_series_slug,
          sports_tags: event_sports.sports_tags,
        })
        .from(events)
        .leftJoin(event_sports, eq(event_sports.event_id, events.id))
        .where(
          and(
            eq(events.series_slug, normalizedSeriesSlug),
            eq(events.is_hidden, false),
            inArray(events.status, ['active', 'resolved', 'archived']),
            buildPublicEventListVisibilityCondition(events.id),
          ),
        )
        .orderBy(desc(events.end_date), desc(events.created_at))

      const eventIds = rows.map((row) => row.id)
      const marketRows =
        eventIds.length > 0
          ? await db
              .select({
                event_id: markets.event_id,
                is_resolved: markets.is_resolved,
              })
              .from(markets)
              .where(inArray(markets.event_id, eventIds))
          : []

      const winningOutcomeRows =
        eventIds.length > 0
          ? await db
              .select({
                event_id: markets.event_id,
                outcome_text: outcomes.outcome_text,
              })
              .from(markets)
              .innerJoin(
                outcomes,
                and(eq(outcomes.condition_id, markets.condition_id), eq(outcomes.is_winning_outcome, true)),
              )
              .where(inArray(markets.event_id, eventIds))
          : []

      const marketStateByEventId = new Map<string, { total: number; unresolved: number }>()
      for (const eventId of eventIds) {
        marketStateByEventId.set(eventId, { total: 0, unresolved: 0 })
      }

      for (const marketRow of marketRows) {
        const bucket = marketStateByEventId.get(marketRow.event_id)
        if (!bucket) {
          continue
        }

        bucket.total += 1
        if (marketRow.is_resolved !== true) {
          bucket.unresolved += 1
        }
      }

      const outcomeDirectionByEventId = new Map<string, 'up' | 'down'>()
      for (const winningOutcomeRow of winningOutcomeRows) {
        if (outcomeDirectionByEventId.has(winningOutcomeRow.event_id)) {
          continue
        }

        const direction = resolveSeriesEventDirection(winningOutcomeRow.outcome_text)
        if (!direction) {
          continue
        }

        outcomeDirectionByEventId.set(winningOutcomeRow.event_id, direction)
      }

      const data: EventSeriesEntry[] = rows.map((row) => ({
        // Series headers should treat events as resolved as soon as all markets are resolved,
        // even if events.status lags behind sync updates.
        status: (() => {
          const marketState = marketStateByEventId.get(row.id)
          if (row.status === 'resolved') {
            return 'resolved' as Event['status']
          }

          if (marketState && marketState.total > 0 && marketState.unresolved === 0) {
            return 'resolved' as Event['status']
          }

          return row.status as Event['status']
        })(),
        id: row.id,
        slug: row.slug,
        end_date: row.end_date?.toISOString() ?? null,
        resolved_at: row.resolved_at?.toISOString() ?? null,
        created_at: row.created_at.toISOString(),
        sports_event_slug: row.sports_event_slug ?? null,
        sports_sport_slug: resolveCanonicalSportsSportSlug(sportsSlugResolver, {
          sportsSportSlug: row.sports_sport_slug ?? null,
          sportsSeriesSlug: row.sports_series_slug ?? null,
          sportsTags: toOptionalStringArray(row.sports_tags),
        }),
        sports_league_slug: row.sports_league_slug ?? null,
        resolved_direction: outcomeDirectionByEventId.get(row.id) ?? null,
      }))

      return { data, error: null }
    })
  },

  async getLiveChartConfigBySeriesSlug(seriesSlug: string): Promise<QueryResult<EventLiveChartConfig | null>> {
    return runQuery(async () => {
      const normalizedSeriesSlug = seriesSlug.trim()

      if (!normalizedSeriesSlug) {
        return { data: null, error: null }
      }

      const row = await db
        .select({
          series_slug: event_live_chart_configs.series_slug,
          topic: event_live_chart_configs.topic,
          event_type: event_live_chart_configs.event_type,
          symbol: event_live_chart_configs.symbol,
          display_name: event_live_chart_configs.display_name,
          display_symbol: event_live_chart_configs.display_symbol,
          line_color: event_live_chart_configs.line_color,
          icon_path: event_live_chart_configs.icon_path,
          enabled: event_live_chart_configs.enabled,
          show_price_decimals: event_live_chart_configs.show_price_decimals,
          active_window_minutes: event_live_chart_configs.active_window_minutes,
        })
        .from(event_live_chart_configs)
        .where(eq(event_live_chart_configs.series_slug, normalizedSeriesSlug))
        .limit(1)

      return { data: row[0] ?? null, error: null }
    })
  },

  async getRelatedEventsBySlug(slug: string, options: RelatedEventOptions): Promise<QueryResult<RelatedEvent[]>> {
    'use cache'
    cacheLife({ stale: 30, revalidate: 30, expire: 120 })
    cacheTag(cacheTags.event(slug))
    cacheTag(cacheTags.eventsList)

    return runQuery(async () => {
      const cadenceRoute = resolveCryptoCadenceRoute(options.cadenceSlug)
      const tagSlug = options.tagSlug?.toLowerCase()
      const locale = options.locale ?? DEFAULT_LOCALE

      const currentEvent = (await db.query.events.findFirst({
        where: { RAW: (table) => and(eq(table.slug, slug), eq(table.is_hidden, false))! },
        with: {
          eventTags: {
            with: { tag: true },
          },
        },
      })) as EventWithTags | undefined

      if (!currentEvent) {
        return { data: [], error: null }
      }

      const currentCryptoEvent = {
        title: currentEvent.title,
        end_date: currentEvent.end_date?.toISOString() ?? null,
        series_recurrence: currentEvent.series_recurrence,
        series_slug: currentEvent.series_slug,
        tags: currentEvent.eventTags.map((eventTag) => ({
          name: eventTag.tag.name,
          slug: eventTag.tag.slug,
        })),
      }
      const currentCryptoCadenceRouteSlug = isCryptoEvent(currentCryptoEvent)
        ? resolveCryptoCadenceRouteSlug(currentCryptoEvent)
        : null
      if (options.cadenceSlug && (!cadenceRoute || !currentCryptoCadenceRouteSlug)) {
        return { data: [], error: null }
      }

      let selectedTagIds = cadenceRoute
        ? currentEvent.eventTags
            .filter((eventTag) => eventTag.tag.slug.toLowerCase() === 'crypto')
            .map((eventTag) => eventTag.tag_id)
        : currentEvent.eventTags.map((eventTag) => eventTag.tag_id)
      if (!cadenceRoute && tagSlug && tagSlug !== 'all' && tagSlug.trim() !== '') {
        const matchingTags = currentEvent.eventTags.filter((et) => et.tag.slug === tagSlug)
        selectedTagIds = matchingTags.map((et) => et.tag_id)

        if (selectedTagIds.length === 0) {
          return { data: [], error: null }
        }
      }

      if (selectedTagIds.length === 0) {
        return { data: [], error: null }
      }

      const normalizedCurrentSeriesSlug = currentEvent.series_slug?.trim().toLowerCase() ?? null
      const currentCryptoAsset = cadenceRoute ? resolveCryptoEventAsset(currentCryptoEvent) : null
      const currentCryptoAssetSeriesPattern = currentCryptoAsset
        ? `^(${currentCryptoAsset.aliases.join('|')})(-|$)`
        : null
      const normalizedRelatedSeriesSlug = sql<string>`LOWER(TRIM(COALESCE(${events.series_slug}, '')))`
      const shouldExcludeCurrentCryptoAsset = Boolean(
        cadenceRoute && currentCryptoCadenceRouteSlug === cadenceRoute.routeSlug && currentCryptoAssetSeriesPattern,
      )
      const sameCryptoAssetRank =
        currentCryptoAssetSeriesPattern && !shouldExcludeCurrentCryptoAsset
          ? sql<number>`CASE WHEN ${normalizedRelatedSeriesSlug} ~ ${currentCryptoAssetSeriesPattern} THEN 1 ELSE 0 END`
          : null
      const sportsSlugResolver = await getSportsSlugResolverFromDb()
      const commonTagsCount = sql<number>`COUNT(DISTINCT ${event_tags.tag_id})`
      const relatedCandidates = await db
        .select({
          id: events.id,
          slug: events.slug,
          title: events.title,
          icon_url: markets.icon_url,
          series_slug: events.series_slug,
          series_recurrence: events.series_recurrence,
          status: events.status,
          end_date: events.end_date,
          created_at: events.created_at,
          updated_at: events.updated_at,
          sports_event_slug: event_sports.sports_event_slug,
          sports_parent_event_id: event_sports.sports_parent_event_id,
          sports_sport_slug: event_sports.sports_sport_slug,
          sports_league_slug: event_sports.sports_league_slug,
          sports_series_slug: event_sports.sports_series_slug,
          sports_tags: event_sports.sports_tags,
          common_tags_count: commonTagsCount,
        })
        .from(events)
        .innerJoin(markets, eq(markets.event_id, events.id))
        .leftJoin(event_sports, eq(event_sports.event_id, events.id))
        .innerJoin(event_tags, eq(event_tags.event_id, events.id))
        .where(
          and(
            sql`${events.slug} != ${slug}`,
            buildPublicEventListVisibilityCondition(events.id),
            eq(events.is_hidden, false),
            eq(events.status, 'active'),
            eq(markets.is_resolved, false),
            inArray(event_tags.tag_id, selectedTagIds),
            cadenceRoute ? buildEventTagFilterCondition(cadenceRoute.routeSlug, 'crypto') : undefined,
            sql`1 = (SELECT COUNT(*) FROM markets market_count WHERE market_count.event_id = ${events.id})`,
            shouldExcludeCurrentCryptoAsset && currentCryptoAssetSeriesPattern
              ? not(sql<boolean>`${normalizedRelatedSeriesSlug} ~ ${currentCryptoAssetSeriesPattern}`)
              : !cadenceRoute && normalizedCurrentSeriesSlug
                ? sql`COALESCE(NULLIF(LOWER(TRIM(${events.series_slug})), ''), '') <> ${normalizedCurrentSeriesSlug}`
                : undefined,
          ),
        )
        .groupBy(
          events.id,
          events.slug,
          events.title,
          markets.icon_url,
          events.series_slug,
          events.series_recurrence,
          events.status,
          events.end_date,
          events.created_at,
          events.updated_at,
          event_sports.sports_event_slug,
          event_sports.sports_parent_event_id,
          event_sports.sports_sport_slug,
          event_sports.sports_league_slug,
          event_sports.sports_series_slug,
          event_sports.sports_tags,
        )
        .orderBy(...buildRelatedEventOrderBy(sameCryptoAssetRank, commonTagsCount))
        .limit(RELATED_EVENT_CANDIDATE_LIMIT)

      if (!relatedCandidates.length) {
        return { data: [], error: null }
      }

      const normalizedRelatedCandidates = relatedCandidates.map((candidate) => ({
        ...candidate,
        status: candidate.status as Event['status'],
        end_date: candidate.end_date?.toISOString() ?? null,
        created_at: candidate.created_at.toISOString(),
        updated_at: candidate.updated_at.toISOString(),
      }))
      const selectedCandidates = cadenceRoute
        ? selectCryptoRelatedEventCandidates(currentCryptoEvent, normalizedRelatedCandidates, {
            cadenceSlug: cadenceRoute.routeSlug,
            currentTimestamp: options.currentTimestamp,
            limit: RELATED_EVENT_RESULT_LIMIT,
          })
        : selectRelatedEventCandidates(normalizedRelatedCandidates, {
            currentTimestamp: options.currentTimestamp,
            limit: RELATED_EVENT_RESULT_LIMIT,
          })

      if (!selectedCandidates.length) {
        return { data: [], error: null }
      }

      const topResultIds = selectedCandidates.map((candidate) => candidate.id)
      const candidateTagRows = await db
        .select({
          event_id: event_tags.event_id,
          slug: tags.slug,
        })
        .from(event_tags)
        .innerJoin(tags, eq(event_tags.tag_id, tags.id))
        .where(inArray(event_tags.event_id, topResultIds))

      const outcomeRows = await db
        .select({
          event_id: markets.event_id,
          token_id: outcomes.token_id,
          outcome_index: outcomes.outcome_index,
          outcome_text: outcomes.outcome_text,
        })
        .from(markets)
        .innerJoin(outcomes, eq(outcomes.condition_id, markets.condition_id))
        .where(inArray(markets.event_id, topResultIds))
        .orderBy(asc(outcomes.outcome_index))

      const tagSlugsByEventId = new Map<string, Array<{ slug: string }>>()
      candidateTagRows.forEach((row) => {
        const bucket = tagSlugsByEventId.get(row.event_id) ?? []
        bucket.push({ slug: row.slug })
        tagSlugsByEventId.set(row.event_id, bucket)
      })

      const primaryOutcomeByEventId = buildRelatedEventPrimaryOutcomes(outcomeRows)

      const tokenIds = selectedCandidates
        .map((event) => primaryOutcomeByEventId.get(event.id)?.tokenId)
        .filter((tokenId): tokenId is string => Boolean(tokenId))
      const eventIds = selectedCandidates.map((event) => event.id)
      const [priceMap, localizedEventTitlesById, liveChartSeriesSlugs, lastTradesByToken] = await Promise.all([
        fetchOutcomePrices(tokenIds),
        getLocalizedEventTitlesById(eventIds, locale),
        getEnabledLiveChartSeriesSlugs(),
        fetchLastTradePrices(tokenIds),
      ])

      const transformedResults = selectedCandidates.map((row) => {
        const primaryOutcome = primaryOutcomeByEventId.get(row.id)
        const yesTokenId = primaryOutcome?.tokenId
        const price = yesTokenId ? priceMap.get(yesTokenId) : undefined
        const lastTrade = yesTokenId ? lastTradesByToken.get(yesTokenId) : null
        const displayPrice = resolveDisplayPrice({
          bid: price?.sell ?? null,
          ask: price?.buy ?? null,
          lastTrade,
        })
        const chance = displayPrice != null ? displayPrice * 100 : null
        const normalizedSeriesSlug = row.series_slug?.trim().toLowerCase() ?? null
        const localizedTitle = localizedEventTitlesById.get(row.id) ?? String(row.title)
        const compactCadenceTitle = resolveCryptoCadenceEventTitle(
          {
            title: localizedTitle,
            end_date: row.end_date,
            series_recurrence: row.series_recurrence,
            series_slug: row.series_slug,
            main_tag: cadenceRoute ? 'crypto' : null,
          },
          locale,
        )

        return {
          has_live_chart: Boolean(normalizedSeriesSlug && liveChartSeriesSlugs.has(normalizedSeriesSlug)),
          id: String(row.id),
          slug: String(row.slug),
          title: compactCadenceTitle ?? localizedTitle,
          icon_url: getPublicAssetUrl(String(row.icon_url || '')),
          outcome_label: primaryOutcome?.label ?? '',
          sports_event_slug: row.sports_event_slug ?? null,
          sports_sport_slug: resolveCanonicalSportsSportSlug(sportsSlugResolver, {
            sportsSportSlug: row.sports_sport_slug ?? null,
            sportsSeriesSlug: row.sports_series_slug ?? null,
            sportsTags: toOptionalStringArray(row.sports_tags),
          }),
          sports_league_slug: row.sports_league_slug ?? null,
          sports_section: resolveSportsSection({ tags: tagSlugsByEventId.get(row.id) ?? [] }),
          common_tags_count: Number(row.common_tags_count),
          chance,
        }
      })

      return { data: transformedResults, error: null }
    })
  },
}
