import { and, asc, desc, eq, exists, gt, inArray, isNotNull, isNull, lte, ne, not, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { cacheTag, revalidateTag } from 'next/cache'

import type { TermsOfServiceTranslationsPatch } from '@/lib/terms-of-service'
import type {
  HomeFeaturedContextItem,
  HomeFeaturedContextMode,
  HomeFeaturedEventAdminItem,
  HomeFeaturedSource,
  HomeFeaturedTargetType,
  QueryResult,
} from '@/types'

import { DEFAULT_LOCALE } from '@/i18n/locales'
import { cacheTags } from '@/lib/cache-tags'
import { upsertTermsOfServiceTranslationsInTransaction } from '@/lib/db/queries/terms-of-service'
import {
  event_sports,
  events,
  home_featured_event_context_items,
  home_featured_events,
  market_sports,
  markets,
} from '@/lib/db/schema'
import { settings } from '@/lib/db/schema/settings/tables'
import { runQuery } from '@/lib/db/utils/run-query'
import { db } from '@/lib/drizzle'
import { buildPublicEventListVisibilityCondition } from '@/lib/event-visibility'
import { HOME_FEATURED_NEWS_LIMIT, HOME_FEATURED_NEWS_TTL_MS } from '@/lib/home-featured-settings'
import { getPublicAssetUrl } from '@/lib/storage'

export interface HomeFeaturedResolvedTarget {
  featuredId: string
  targetType: HomeFeaturedTargetType
  source: HomeFeaturedSource
  rank: number
  contextMode: HomeFeaturedContextMode
  eventId: string
  eventSlug: string
  eventTitle: string
  seriesSlug: string | null
}

export interface UpsertHomeFeaturedContextItemInput {
  featuredEventId: string
  eventId: string
  locale: string
  itemType: 'news' | 'comment'
  source: string
  title: string
  url?: string | null
  faviconUrl?: string | null
  publishedAt?: Date | null
  relevanceScore?: number | null
  expiresAt: Date
  isManual?: boolean
}

export interface ReplaceHomeFeaturedContextItemInput {
  locale: string
  itemType: 'news' | 'comment'
  source: string
  title: string
  url?: string | null
  faviconUrl?: string | null
  publishedAt?: Date | null
  relevanceScore?: number | null
  expiresAt?: Date | null
  isManual?: boolean
}

export interface ReplaceHomeFeaturedEventsInput {
  targetType: HomeFeaturedTargetType
  eventId: string | null
  seriesSlug: string | null
  enabled: boolean
  rank: number
  source: HomeFeaturedSource
  startsAt: Date | null
  endsAt: Date | null
  contextMode: HomeFeaturedContextMode
  autoRolloverEnabled: boolean
  contextLocale?: string | null
  contextEventId?: string | null
  contextItems?: ReplaceHomeFeaturedContextItemInput[]
}

export interface HomeFeaturedSettingsUpdateRow {
  group: string
  key: string
  value: string
}

const VALID_CONTEXT_MODES: HomeFeaturedContextMode[] = ['auto', 'news', 'comments', 'hidden']
const VALID_TARGET_TYPES: HomeFeaturedTargetType[] = ['event', 'series']
const VALID_SOURCES: HomeFeaturedSource[] = ['manual', 'ai']
const MANUAL_CONTEXT_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000
type HomeFeaturedTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
interface AdminFeaturedEventRow {
  id: string
  target_type: string
  event_id: string | null
  series_slug: string | null
}
type SeriesTargetMap = Map<string, ResolvedSeriesTarget>

function normalizeContextMode(value: string | null | undefined): HomeFeaturedContextMode {
  return VALID_CONTEXT_MODES.includes(value as HomeFeaturedContextMode) ? (value as HomeFeaturedContextMode) : 'auto'
}

function normalizeTargetType(value: string | null | undefined): HomeFeaturedTargetType {
  return VALID_TARGET_TYPES.includes(value as HomeFeaturedTargetType) ? (value as HomeFeaturedTargetType) : 'event'
}

function normalizeSource(value: string | null | undefined): HomeFeaturedSource {
  return VALID_SOURCES.includes(value as HomeFeaturedSource) ? (value as HomeFeaturedSource) : 'manual'
}

function toIsoString(value: Date | null | undefined) {
  return value instanceof Date ? value.toISOString() : null
}

function toOptionalNumber(value: unknown) {
  if (value == null) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeContextDate(value: Date | null | undefined) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : null
}

function parseNewsRefreshExpirations(value: string | undefined): Record<string, number> {
  try {
    return Object.fromEntries(
      Object.entries(JSON.parse(value ?? '{}') ?? {}).filter(
        ([, expiry]) => typeof expiry === 'number' && Number.isFinite(expiry),
      ),
    ) as Record<string, number>
  } catch {
    return {}
  }
}

function normalizeReplaceContextItems(items: ReplaceHomeFeaturedContextItemInput[] | null | undefined) {
  if (!Array.isArray(items)) {
    return null
  }

  const fallbackExpiresAt = new Date(Date.now() + MANUAL_CONTEXT_EXPIRY_MS)

  return items
    .filter((item) => item.source.trim() && item.title.trim())
    .slice(0, HOME_FEATURED_NEWS_LIMIT)
    .map((item) => ({
      locale: item.locale.trim() || 'en',
      item_type: item.itemType,
      source: item.source.trim().slice(0, 120),
      title: item.title.trim().slice(0, 240),
      url: item.url?.trim() || null,
      favicon_url: item.faviconUrl?.trim() || null,
      published_at: normalizeContextDate(item.publishedAt),
      relevance_score: item.relevanceScore == null ? null : String(Math.max(0, Math.min(1, item.relevanceScore))),
      expires_at: normalizeContextDate(item.expiresAt) ?? fallbackExpiresAt,
      is_manual: Boolean(item.isManual),
    }))
}

function normalizeReplaceItem(item: ReplaceHomeFeaturedEventsInput, index: number) {
  const requestedTargetType = normalizeTargetType(item.targetType)
  const eventId = item.eventId?.trim() || null
  const seriesSlug = item.seriesSlug?.trim() || null
  const targetType: HomeFeaturedTargetType | null =
    requestedTargetType === 'series'
      ? seriesSlug
        ? 'series'
        : eventId
          ? 'event'
          : null
      : eventId
        ? 'event'
        : seriesSlug
          ? 'series'
          : null

  if (!targetType) {
    return null
  }

  return {
    target_type: targetType,
    event_id: targetType === 'event' ? eventId : null,
    series_slug: targetType === 'series' ? seriesSlug : null,
    enabled: item.enabled,
    rank: Number.isInteger(item.rank) ? item.rank : index,
    source: normalizeSource(item.source),
    starts_at: item.startsAt,
    ends_at: item.endsAt,
    context_mode: normalizeContextMode(item.contextMode),
    auto_rollover_enabled: targetType === 'series' ? item.autoRolloverEnabled : false,
  }
}

function createFeaturedRowKey(item: {
  target_type: string | null
  event_id: string | null
  series_slug: string | null
}) {
  return item.target_type === 'series' ? `series:${item.series_slug ?? ''}` : `event:${item.event_id ?? ''}`
}

async function replaceContextItemsInTransaction(
  tx: HomeFeaturedTransaction,
  featuredEventId: string,
  eventId: string,
  locale: string,
  items: ReturnType<typeof normalizeReplaceContextItems>,
  preserveManual = false,
) {
  if (!items) {
    return
  }

  const localesToReplace = Array.from(new Set([locale, ...items.map((item) => item.locale)].filter(Boolean)))

  await tx
    .delete(home_featured_event_context_items)
    .where(
      and(
        eq(home_featured_event_context_items.featured_event_id, featuredEventId),
        inArray(home_featured_event_context_items.locale, localesToReplace),
        or(
          eq(home_featured_event_context_items.event_id, eventId),
          lte(home_featured_event_context_items.expires_at, new Date()),
        ),
        ...(preserveManual ? [eq(home_featured_event_context_items.is_manual, false)] : []),
      ),
    )

  if (items.length === 0) {
    return
  }

  return tx
    .insert(home_featured_event_context_items)
    .values(
      items.map((item) => ({
        featured_event_id: featuredEventId,
        event_id: eventId,
        locale: item.locale,
        item_type: item.item_type,
        source: item.source,
        title: item.title,
        url: item.url,
        favicon_url: item.favicon_url,
        published_at: item.published_at,
        relevance_score: item.relevance_score,
        expires_at: item.expires_at,
        is_manual: item.is_manual,
      })),
    )
    .returning()
}

async function replaceFeaturedEventsInTransaction(
  tx: HomeFeaturedTransaction,
  items: ReplaceHomeFeaturedEventsInput[],
) {
  const normalizedItems = items
    .map((item, index) => ({
      input: item,
      row: normalizeReplaceItem(item, index),
      contextItems: normalizeReplaceContextItems(item.contextItems),
    }))
    .filter(
      (
        item,
      ): item is {
        input: ReplaceHomeFeaturedEventsInput
        row: NonNullable<ReturnType<typeof normalizeReplaceItem>>
        contextItems: ReturnType<typeof normalizeReplaceContextItems>
      } => item.row !== null,
    )

  const existingRows = await tx
    .select({
      id: home_featured_events.id,
      target_type: home_featured_events.target_type,
      event_id: home_featured_events.event_id,
      series_slug: home_featured_events.series_slug,
    })
    .from(home_featured_events)
  const existingByKey = new Map(existingRows.map((row) => [createFeaturedRowKey(row), row]))
  const retainedIds = new Set<string>()

  for (const item of normalizedItems) {
    const existing = existingByKey.get(createFeaturedRowKey(item.row))
    const contextEventId = item.input.contextEventId?.trim() || item.input.eventId?.trim() || null
    const contextLocale = item.input.contextLocale?.trim() || item.contextItems?.[0]?.locale || 'en'
    let featuredEventId: string | null = existing?.id ?? null

    if (existing) {
      await tx
        .update(home_featured_events)
        .set({
          ...item.row,
          updated_at: new Date(),
        })
        .where(eq(home_featured_events.id, existing.id))
    } else {
      const [inserted] = await tx
        .insert(home_featured_events)
        .values(item.row)
        .returning({ id: home_featured_events.id })
      featuredEventId = inserted?.id ?? null
    }

    if (featuredEventId) {
      retainedIds.add(featuredEventId)
      if (contextEventId) {
        await replaceContextItemsInTransaction(tx, featuredEventId, contextEventId, contextLocale, item.contextItems)
      }
    }
  }

  for (const row of existingRows) {
    if (retainedIds.has(row.id)) {
      continue
    }

    await tx.delete(home_featured_events).where(eq(home_featured_events.id, row.id))
  }
}

function hasSportsEventCondition() {
  return exists(
    db.select({ event_id: event_sports.event_id }).from(event_sports).where(eq(event_sports.event_id, events.id)),
  )
}

function hasTypedSportsMarketsCondition() {
  const typedSportsMarkets = alias(market_sports, 'typed_sports_markets')
  const typedMarkets = alias(markets, 'typed_markets')

  return exists(
    db
      .select({ condition_id: typedSportsMarkets.condition_id })
      .from(typedSportsMarkets)
      .innerJoin(typedMarkets, eq(typedMarkets.condition_id, typedSportsMarkets.condition_id))
      .where(
        and(
          eq(typedSportsMarkets.event_id, events.id),
          eq(typedMarkets.event_id, events.id),
          eq(typedMarkets.is_active, true),
          eq(typedMarkets.is_resolved, false),
          sql`TRIM(COALESCE(${typedSportsMarkets.sports_market_type}, '')) <> ''`,
        ),
      ),
  )
}

function isBaseMoneylineMarketCondition() {
  const normalizedType = sql<string>`LOWER(TRIM(REPLACE(COALESCE(${market_sports.sports_market_type}, ''), '_', ' ')))`
  const normalizedText = sql<string>`
    LOWER(CONCAT(
      ' ',
      COALESCE(${market_sports.sports_group_item_title}, ''),
      ' ',
      COALESCE(${markets.short_title}, ''),
      ' ',
      COALESCE(${markets.title}, ''),
      ' '
    ))
  `

  return or(
    sql`${normalizedType} IN ('moneyline', 'match winner', '1x2')`,
    and(
      or(isNull(market_sports.sports_market_type), sql`TRIM(${market_sports.sports_market_type}) = ''`),
      sql`${normalizedText} NOT LIKE '% first half %'`,
      sql`${normalizedText} NOT LIKE '% 1h %'`,
      sql`${normalizedText} NOT LIKE '% spread %'`,
      sql`${normalizedText} NOT LIKE '% handicap %'`,
      sql`${normalizedText} NOT LIKE '% total %'`,
      sql`${normalizedText} NOT LIKE '% over under %'`,
      sql`${normalizedText} NOT LIKE '% both teams to score %'`,
      sql`${normalizedText} NOT LIKE '% btts %'`,
      sql`${normalizedText} NOT LIKE '% exact score %'`,
      or(
        sql`${normalizedText} LIKE '% moneyline %'`,
        sql`${normalizedText} LIKE '% match winner %'`,
        sql`${normalizedText} LIKE '% 1x2 %'`,
      ),
    ),
  )
}

function hasActiveFeaturedMarketCondition() {
  const sportsEventCondition = hasSportsEventCondition()
  const typedSportsMarketsCondition = hasTypedSportsMarketsCondition()

  return exists(
    db
      .select({ condition_id: markets.condition_id })
      .from(markets)
      .leftJoin(market_sports, eq(market_sports.condition_id, markets.condition_id))
      .where(
        and(
          eq(markets.event_id, events.id),
          eq(markets.is_active, true),
          eq(markets.is_resolved, false),
          or(not(sportsEventCondition), isBaseMoneylineMarketCondition(), not(typedSportsMarketsCondition)),
        ),
      ),
  )
}

function hasOpenFeaturedWindowCondition(now: Date) {
  return or(
    gt(events.end_date, now),
    exists(
      db
        .select({ condition_id: markets.condition_id })
        .from(markets)
        .where(
          and(
            eq(markets.event_id, events.id),
            eq(markets.is_active, true),
            eq(markets.is_resolved, false),
            gt(markets.end_time, now),
          ),
        ),
    ),
    and(
      isNull(events.end_date),
      not(
        exists(
          db
            .select({ condition_id: markets.condition_id })
            .from(markets)
            .where(
              and(
                eq(markets.event_id, events.id),
                eq(markets.is_active, true),
                eq(markets.is_resolved, false),
                isNotNull(markets.end_time),
              ),
            ),
        ),
      ),
    ),
  )
}

async function resolveSeriesTarget(seriesSlug: string) {
  const normalizedSeriesSlug = seriesSlug.trim()
  if (!normalizedSeriesSlug) {
    return null
  }
  const now = new Date()

  const rows = await db
    .select({
      id: events.id,
      slug: events.slug,
      title: events.title,
      series_slug: events.series_slug,
      icon_url: events.icon_url,
      sports_live: event_sports.sports_live,
      end_date: events.end_date,
      created_at: events.created_at,
    })
    .from(events)
    .leftJoin(event_sports, eq(event_sports.event_id, events.id))
    .where(
      and(
        eq(events.series_slug, normalizedSeriesSlug),
        eq(events.status, 'active'),
        eq(events.is_hidden, false),
        or(isNull(events.start_date), lte(events.start_date, now)),
        buildPublicEventListVisibilityCondition(events.id),
        hasActiveFeaturedMarketCondition(),
        hasOpenFeaturedWindowCondition(now),
      ),
    )
    .orderBy(
      desc(sql<number>`CASE WHEN ${event_sports.sports_live} IS TRUE THEN 1 ELSE 0 END`),
      asc(sql<number>`CASE WHEN ${events.end_date} IS NULL THEN 1 ELSE 0 END`),
      asc(events.end_date),
      desc(events.created_at),
      desc(events.id),
    )
    .limit(1)

  return rows[0] ?? null
}

type ResolvedSeriesTarget = NonNullable<Awaited<ReturnType<typeof resolveSeriesTarget>>>

async function resolveSeriesTargetsBySlug(seriesSlugs: string[]) {
  const normalizedSeriesSlugs = Array.from(new Set(seriesSlugs.map((seriesSlug) => seriesSlug.trim()).filter(Boolean)))
  const targetBySeriesSlug = new Map<string, ResolvedSeriesTarget>()

  if (normalizedSeriesSlugs.length === 0) {
    return targetBySeriesSlug
  }
  const now = new Date()

  const rows = await db
    .select({
      id: events.id,
      slug: events.slug,
      title: events.title,
      series_slug: events.series_slug,
      icon_url: events.icon_url,
      sports_live: event_sports.sports_live,
      end_date: events.end_date,
      created_at: events.created_at,
    })
    .from(events)
    .leftJoin(event_sports, eq(event_sports.event_id, events.id))
    .where(
      and(
        inArray(events.series_slug, normalizedSeriesSlugs),
        eq(events.status, 'active'),
        eq(events.is_hidden, false),
        or(isNull(events.start_date), lte(events.start_date, now)),
        buildPublicEventListVisibilityCondition(events.id),
        hasActiveFeaturedMarketCondition(),
        hasOpenFeaturedWindowCondition(now),
      ),
    )
    .orderBy(
      asc(events.series_slug),
      desc(sql<number>`CASE WHEN ${event_sports.sports_live} IS TRUE THEN 1 ELSE 0 END`),
      asc(sql<number>`CASE WHEN ${events.end_date} IS NULL THEN 1 ELSE 0 END`),
      asc(events.end_date),
      desc(events.created_at),
      desc(events.id),
    )

  for (const row of rows) {
    const seriesSlug = row.series_slug?.trim()
    if (!seriesSlug || targetBySeriesSlug.has(seriesSlug)) {
      continue
    }

    targetBySeriesSlug.set(seriesSlug, row)
  }

  return targetBySeriesSlug
}

async function resolveEventTarget(eventId: string | null) {
  if (!eventId?.trim()) {
    return null
  }

  const rows = await db
    .select({
      id: events.id,
      slug: events.slug,
      title: events.title,
      series_slug: events.series_slug,
    })
    .from(events)
    .where(
      and(
        eq(events.id, eventId),
        eq(events.status, 'active'),
        eq(events.is_hidden, false),
        buildPublicEventListVisibilityCondition(events.id),
        hasActiveFeaturedMarketCondition(),
      ),
    )
    .limit(1)

  return rows[0] ?? null
}

type ResolvedEventTarget = NonNullable<Awaited<ReturnType<typeof resolveEventTarget>>>

async function resolveEventTargetsById(eventIds: string[]) {
  const normalizedEventIds = Array.from(new Set(eventIds.map((eventId) => eventId.trim()).filter(Boolean)))
  const targetByEventId = new Map<string, ResolvedEventTarget>()

  if (normalizedEventIds.length === 0) {
    return targetByEventId
  }

  const rows = await db
    .select({
      id: events.id,
      slug: events.slug,
      title: events.title,
      series_slug: events.series_slug,
    })
    .from(events)
    .where(
      and(
        inArray(events.id, normalizedEventIds),
        eq(events.status, 'active'),
        eq(events.is_hidden, false),
        buildPublicEventListVisibilityCondition(events.id),
        hasActiveFeaturedMarketCondition(),
      ),
    )

  for (const row of rows) {
    targetByEventId.set(row.id, row)
  }

  return targetByEventId
}

function mapContextRow(row: typeof home_featured_event_context_items.$inferSelect): HomeFeaturedContextItem {
  return {
    id: row.id,
    type: row.item_type === 'comment' ? 'comment' : 'news',
    source: row.source,
    title: row.title,
    avatarUrl: null,
    faviconUrl: row.favicon_url ?? null,
    url: row.url ?? null,
    publishedAt: toIsoString(row.published_at),
    selectedAt: row.selected_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    relevanceScore: toOptionalNumber(row.relevance_score),
    isManual: Boolean(row.is_manual),
  }
}

function resolveAdminFeaturedEventTarget(row: AdminFeaturedEventRow, seriesTargetBySlug: SeriesTargetMap) {
  const targetType = normalizeTargetType(row.target_type)
  const resolvedSeriesEvent =
    targetType === 'series' ? (seriesTargetBySlug.get(row.series_slug?.trim() ?? '') ?? null) : null
  const eventId = targetType === 'series' ? (resolvedSeriesEvent?.id ?? row.event_id ?? null) : (row.event_id ?? null)

  return {
    targetType,
    resolvedSeriesEvent,
    eventId,
  }
}

export const HomeFeaturedEventsRepository = {
  async findNextSeriesRolloverEvent(
    seriesSlug: string,
    currentEventId: string,
    after: Date,
  ): Promise<QueryResult<{ id: string; slug: string } | null>> {
    return runQuery(async () => {
      const rows = await db
        .select({ id: events.id, slug: events.slug })
        .from(events)
        .where(
          and(
            eq(events.series_slug, seriesSlug),
            ne(events.id, currentEventId),
            eq(events.status, 'active'),
            eq(events.is_hidden, false),
            gt(events.end_date, after),
            buildPublicEventListVisibilityCondition(events.id),
            hasActiveFeaturedMarketCondition(),
          ),
        )
        .orderBy(asc(events.end_date), desc(events.created_at), desc(events.id))
        .limit(1)

      return { data: rows[0] ?? null, error: null }
    })
  },

  async resolveLiveSeriesDestination(
    seriesSlug: string,
    selectedMarketSlug: string | null,
    selectedConditionId: string | null,
  ): Promise<QueryResult<{ eventSlug: string; marketSlug: string | null; conditionId: string | null } | null>> {
    return runQuery(async () => {
      const event = await resolveSeriesTarget(seriesSlug)
      if (!event) {
        return { data: null, error: null }
      }

      if (!selectedMarketSlug && !selectedConditionId) {
        return { data: { eventSlug: event.slug, marketSlug: null, conditionId: null }, error: null }
      }

      const currentMarkets = await db
        .select({
          condition_id: markets.condition_id,
          slug: markets.slug,
          title: markets.title,
          short_title: markets.short_title,
        })
        .from(markets)
        .where(and(eq(markets.event_id, event.id), eq(markets.is_active, true), eq(markets.is_resolved, false)))
      const oldMarket = selectedConditionId
        ? (
            await db
              .select({ title: markets.title, short_title: markets.short_title })
              .from(markets)
              .where(eq(markets.condition_id, selectedConditionId))
              .limit(1)
          )[0]
        : null
      const exactMatches = currentMarkets.filter(
        (market) => market.slug === selectedMarketSlug || market.condition_id === selectedConditionId,
      )
      const oldTitle = oldMarket?.short_title?.trim().toLowerCase() || oldMarket?.title.trim().toLowerCase()
      const titleMatches = oldTitle
        ? currentMarkets.filter(
            (market) => (market.short_title?.trim().toLowerCase() || market.title.trim().toLowerCase()) === oldTitle,
          )
        : []
      const selectedMarket =
        exactMatches.length === 1
          ? exactMatches[0]
          : titleMatches.length === 1
            ? titleMatches[0]
            : currentMarkets.length === 1
              ? currentMarkets[0]
              : null

      return {
        data: {
          eventSlug: event.slug,
          marketSlug: selectedMarket?.slug ?? null,
          conditionId: selectedMarket?.condition_id ?? null,
        },
        error: null,
      }
    })
  },

  async listAdminFeaturedEvents(locale?: string): Promise<QueryResult<HomeFeaturedEventAdminItem[]>> {
    return runQuery(async () => {
      const rows = await db
        .select({
          id: home_featured_events.id,
          target_type: home_featured_events.target_type,
          event_id: home_featured_events.event_id,
          series_slug: home_featured_events.series_slug,
          enabled: home_featured_events.enabled,
          rank: home_featured_events.rank,
          source: home_featured_events.source,
          starts_at: home_featured_events.starts_at,
          ends_at: home_featured_events.ends_at,
          context_mode: home_featured_events.context_mode,
          auto_rollover_enabled: home_featured_events.auto_rollover_enabled,
          event_title: events.title,
          event_slug: events.slug,
          event_icon_url: events.icon_url,
        })
        .from(home_featured_events)
        .leftJoin(events, eq(events.id, home_featured_events.event_id))
        .orderBy(asc(home_featured_events.rank), asc(home_featured_events.created_at))

      const seriesTargetBySlug = await resolveSeriesTargetsBySlug(
        rows.flatMap((row) => {
          const targetType = normalizeTargetType(row.target_type)
          const seriesSlug = row.series_slug?.trim()

          return targetType === 'series' && seriesSlug ? [seriesSlug] : []
        }),
      )
      const eventIdsByFeaturedId = new Map<string, string>()
      for (const row of rows) {
        const { eventId } = resolveAdminFeaturedEventTarget(row, seriesTargetBySlug)

        if (eventId) {
          eventIdsByFeaturedId.set(row.id, eventId)
        }
      }

      const contextResult = locale
        ? await HomeFeaturedEventsRepository.listContextItems(
            rows.map((row) => row.id),
            locale,
            { eventIdsByFeaturedId },
          )
        : { data: new Map<string, HomeFeaturedContextItem[]>(), error: null }
      if (contextResult.error) {
        return { data: null, error: contextResult.error }
      }

      const contextItemsByFeaturedId = contextResult.data ?? new Map<string, HomeFeaturedContextItem[]>()

      const items: HomeFeaturedEventAdminItem[] = rows.map((row) => {
        const { eventId, resolvedSeriesEvent, targetType } = resolveAdminFeaturedEventTarget(row, seriesTargetBySlug)

        return {
          id: row.id,
          targetType,
          eventId,
          seriesSlug: row.series_slug ?? null,
          title: resolvedSeriesEvent?.title ?? row.event_title ?? row.series_slug ?? 'Featured market',
          slug: resolvedSeriesEvent?.slug ?? row.event_slug ?? null,
          iconUrl: getPublicAssetUrl(resolvedSeriesEvent?.icon_url ?? row.event_icon_url) ?? null,
          enabled: Boolean(row.enabled),
          rank: Number(row.rank ?? 0),
          source: normalizeSource(row.source),
          startsAt: toIsoString(row.starts_at),
          endsAt: toIsoString(row.ends_at),
          contextMode: normalizeContextMode(row.context_mode),
          autoRolloverEnabled: Boolean(row.auto_rollover_enabled),
          contextItems: contextItemsByFeaturedId.get(row.id) ?? [],
        }
      })

      return { data: items, error: null }
    })
  },

  async replaceFeaturedEvents(items: ReplaceHomeFeaturedEventsInput[]): Promise<QueryResult<null>> {
    return runQuery(async () => {
      await db.transaction(async (tx) => {
        await replaceFeaturedEventsInTransaction(tx, items)
      })

      revalidateTag(cacheTags.homeFeaturedEvents, { expire: 0 })

      return { data: null, error: null }
    })
  },

  async replaceFeaturedEventsWithSettings(
    items: ReplaceHomeFeaturedEventsInput[],
    settingsRows: HomeFeaturedSettingsUpdateRow[],
    termsOfServiceTranslations?: TermsOfServiceTranslationsPatch,
  ): Promise<QueryResult<null>> {
    return runQuery(async () => {
      await db.transaction(async (tx) => {
        if (settingsRows.length > 0) {
          await tx
            .insert(settings)
            .values(settingsRows)
            .onConflictDoUpdate({
              target: [settings.group, settings.key],
              set: {
                value: sql`EXCLUDED.value`,
              },
            })
        }

        await replaceFeaturedEventsInTransaction(tx, items)

        if (termsOfServiceTranslations) {
          await upsertTermsOfServiceTranslationsInTransaction(tx, termsOfServiceTranslations)
        }
      })

      revalidateTag(cacheTags.homeFeaturedEvents, { expire: 0 })
      revalidateTag(cacheTags.settings, { expire: 0 })
      if (termsOfServiceTranslations) {
        revalidateTag(cacheTags.termsOfService, { expire: 0 })
      }

      return { data: null, error: null }
    })
  },

  async resolvePublicTargets(limit = 6): Promise<QueryResult<HomeFeaturedResolvedTarget[]>> {
    'use cache'
    cacheTag(cacheTags.homeFeaturedEvents)
    cacheTag(cacheTags.eventsList)

    return runQuery(async () => {
      const now = new Date()
      const safeLimit = Math.min(Math.max(limit, 1), 8)
      const rows = await db
        .select()
        .from(home_featured_events)
        .where(
          and(
            eq(home_featured_events.enabled, true),
            or(isNull(home_featured_events.starts_at), lte(home_featured_events.starts_at, now)),
            or(isNull(home_featured_events.ends_at), gt(home_featured_events.ends_at, now)),
          ),
        )
        .orderBy(asc(home_featured_events.rank), asc(home_featured_events.created_at), asc(home_featured_events.id))
        .limit(safeLimit * 2)

      const eligibleRows = rows.filter((row) => {
        const targetType = normalizeTargetType(row.target_type)
        return targetType !== 'series' || row.auto_rollover_enabled
      })
      const [seriesTargetBySlug, eventTargetById] = await Promise.all([
        resolveSeriesTargetsBySlug(
          eligibleRows
            .filter((row) => normalizeTargetType(row.target_type) === 'series')
            .map((row) => row.series_slug ?? ''),
        ),
        resolveEventTargetsById(
          eligibleRows
            .filter((row) => normalizeTargetType(row.target_type) !== 'series')
            .map((row) => row.event_id ?? ''),
        ),
      ])
      const resolvedTargets: HomeFeaturedResolvedTarget[] = []
      const seenEventIds = new Set<string>()

      for (const row of eligibleRows) {
        if (resolvedTargets.length >= safeLimit) {
          break
        }

        const targetType = normalizeTargetType(row.target_type)
        const resolvedEvent =
          targetType === 'series'
            ? seriesTargetBySlug.get(row.series_slug?.trim() ?? '')
            : eventTargetById.get(row.event_id?.trim() ?? '')

        if (!resolvedEvent || seenEventIds.has(resolvedEvent.id)) {
          continue
        }

        seenEventIds.add(resolvedEvent.id)
        resolvedTargets.push({
          featuredId: row.id,
          targetType,
          source: normalizeSource(row.source),
          rank: Number(row.rank ?? 0),
          contextMode: normalizeContextMode(row.context_mode),
          eventId: resolvedEvent.id,
          eventSlug: resolvedEvent.slug,
          eventTitle: resolvedEvent.title,
          seriesSlug: resolvedEvent.series_slug ?? row.series_slug ?? null,
        })
      }

      return { data: resolvedTargets, error: null }
    })
  },

  async listContextItems(
    featuredEventIds: string[],
    locale: string,
    options: {
      includeDefaultFallback?: boolean
      eventIdsByFeaturedId?: Map<string, string | null | undefined>
      itemType?: 'news' | 'comment'
      transaction?: HomeFeaturedTransaction
    } = {},
  ): Promise<QueryResult<Map<string, HomeFeaturedContextItem[]>>> {
    if (featuredEventIds.length === 0) {
      return { data: new Map(), error: null }
    }

    return runQuery(async () => {
      const now = new Date()
      const contextLocales =
        options.includeDefaultFallback && locale !== DEFAULT_LOCALE ? [locale, DEFAULT_LOCALE] : [locale]
      const eventIdsByFeaturedId = options.eventIdsByFeaturedId
      const allowedEventIds = Array.from(
        new Set(
          Array.from(eventIdsByFeaturedId?.values() ?? [])
            .map((eventId) => eventId?.trim())
            .filter((eventId): eventId is string => Boolean(eventId)),
        ),
      )
      const rows = await (options.transaction ?? db)
        .select()
        .from(home_featured_event_context_items)
        .where(
          and(
            inArray(home_featured_event_context_items.featured_event_id, featuredEventIds),
            inArray(home_featured_event_context_items.locale, contextLocales),
            ...(allowedEventIds.length > 0
              ? [inArray(home_featured_event_context_items.event_id, allowedEventIds)]
              : []),
            ...(options.itemType ? [eq(home_featured_event_context_items.item_type, options.itemType)] : []),
            gt(home_featured_event_context_items.expires_at, now),
          ),
        )
        .orderBy(
          asc(home_featured_event_context_items.featured_event_id),
          desc(sql<number>`CASE WHEN ${home_featured_event_context_items.locale} = ${locale} THEN 1 ELSE 0 END`),
          desc(home_featured_event_context_items.is_manual),
          desc(home_featured_event_context_items.relevance_score),
          desc(home_featured_event_context_items.published_at),
          desc(home_featured_event_context_items.selected_at),
        )

      const itemsByFeaturedId = new Map<string, HomeFeaturedContextItem[]>()
      for (const row of rows) {
        const expectedEventId = eventIdsByFeaturedId?.get(row.featured_event_id)?.trim()
        if (expectedEventId && row.event_id !== expectedEventId) {
          continue
        }

        const items = itemsByFeaturedId.get(row.featured_event_id) ?? []
        if (items.length < HOME_FEATURED_NEWS_LIMIT) {
          items.push(mapContextRow(row))
          itemsByFeaturedId.set(row.featured_event_id, items)
        }
      }

      return { data: itemsByFeaturedId, error: null }
    })
  },

  async getOrCreateContextItems(
    featuredEventId: string,
    eventId: string,
    locale: string,
    generate: () => Promise<ReplaceHomeFeaturedContextItemInput[]>,
  ): Promise<QueryResult<HomeFeaturedContextItem[]>> {
    return runQuery(async () => {
      let refreshed = false
      const data = await db.transaction(async (tx) => {
        // Share the refresh lock across server instances without holding a settings row lock.
        const key = `home-featured-news:${featuredEventId}:${eventId}:${locale}`
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`)

        const existing = await HomeFeaturedEventsRepository.listContextItems([featuredEventId], locale, {
          eventIdsByFeaturedId: new Map([[featuredEventId, eventId]]),
          itemType: 'news',
          transaction: tx,
        })
        if (existing.error) {
          throw new Error(existing.error)
        }
        const items = existing.data?.get(featuredEventId) ?? []
        if (items.length > 0) {
          return items
        }

        const refreshKey = `${featuredEventId}:${eventId}:${locale}`
        const markerFilter = and(eq(settings.group, 'cache'), eq(settings.key, 'home_featured_news_refreshes'))
        async function readMarker() {
          const [row] = await tx.select({ value: settings.value }).from(settings).where(markerFilter).limit(1)
          return row
        }
        const marker = await readMarker()
        if ((parseNewsRefreshExpirations(marker?.value)[refreshKey] ?? 0) > Date.now()) {
          return []
        }

        const generated = normalizeReplaceContextItems(await generate())
        const rows = await replaceContextItemsInTransaction(tx, featuredEventId, eventId, locale, generated, true)
        if (!rows?.length) {
          // Different event locks share one persisted map; serialize only its update.
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('home-featured-news-refreshes', 0))`)
          const currentMarker = await readMarker()
          const now = Date.now()
          const expirations = Object.fromEntries(
            Object.entries(parseNewsRefreshExpirations(currentMarker?.value)).filter(([, expiry]) => expiry > now),
          )
          expirations[refreshKey] = now + HOME_FEATURED_NEWS_TTL_MS
          const value = JSON.stringify(expirations)
          if (currentMarker) {
            await tx.update(settings).set({ value }).where(markerFilter)
          } else {
            await tx.insert(settings).values({ group: 'cache', key: 'home_featured_news_refreshes', value })
          }
        }

        refreshed = true
        return (rows ?? []).map(mapContextRow)
      })
      if (refreshed) {
        revalidateTag(cacheTags.homeFeaturedEvents, { expire: 0 })
      }
      return { data, error: null }
    })
  },

  async replaceContextItems(
    featuredEventId: string,
    eventId: string,
    locale: string,
    items: UpsertHomeFeaturedContextItemInput[],
    options: { preserveManual?: boolean } = {},
  ): Promise<QueryResult<null>> {
    return runQuery(async () => {
      await db.transaction(async (tx) => {
        await replaceContextItemsInTransaction(
          tx,
          featuredEventId,
          eventId,
          locale,
          normalizeReplaceContextItems(items.map((item) => ({ ...item, locale }))),
          options.preserveManual,
        )
      })

      revalidateTag(cacheTags.homeFeaturedEvents, { expire: 0 })

      return { data: null, error: null }
    })
  },
}
