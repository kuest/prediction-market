import { and, asc, count, desc, eq, exists, ilike, inArray, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { cacheTag } from 'next/cache'
import { createHash } from 'node:crypto'

import type { NonDefaultLocale, SupportedLocale } from '@/i18n/locales'
import type { PlatformCategorySidebarItem, PlatformNavigationChild } from '@/lib/platform-navigation'

import { DEFAULT_LOCALE, NON_DEFAULT_LOCALES } from '@/i18n/locales'
import { cacheTags } from '@/lib/cache-tags'
import { getCategorySidebarConfiguredTagSlugs, resolveCategorySidebarData } from '@/lib/category-sidebar-config'
import {
  CRYPTO_CADENCE_ROUTES,
  resolveCryptoCadenceRouteSlug,
  resolveCryptoCadenceSidebarLabel,
} from '@/lib/crypto-cadence-event'
import { hasDatabaseEnv } from '@/lib/db/env'
import { event_tags, events, tag_translations, tags, v_main_tag_subcategories } from '@/lib/db/schema/events/tables'
import { runQuery } from '@/lib/db/utils/run-query'
import { db } from '@/lib/drizzle'
import {
  buildPublicEventListVisibilityCondition,
  HIDE_FROM_NEW_TAG_SLUG,
  REWARDS_AUTOMATION_TAG_SLUG,
} from '@/lib/event-visibility'
import { filterHomeEvents } from '@/lib/home-events'

const EXCLUDED_SUB_SLUGS = new Set([HIDE_FROM_NEW_TAG_SLUG, REWARDS_AUTOMATION_TAG_SLUG])

interface ListTagsParams {
  limit?: number
  offset?: number
  search?: string
  sortBy?: 'name' | 'slug' | 'display_order' | 'created_at' | 'updated_at' | 'active_events_count'
  sortOrder?: 'asc' | 'desc'
  mainOnly?: boolean
}

export type TagTranslationsMap = Partial<Record<NonDefaultLocale, string>>

interface AdminTagRow {
  id: number
  name: string
  slug: string
  is_main_category: boolean
  is_hidden: boolean
  hide_events: boolean
  event_page_note: string | null
  display_order: number
  active_markets_count: number
  active_events_count: number
  created_at: string
  updated_at: string
  translations: TagTranslationsMap
}

export interface MainCategoryOrderRow {
  id: number
  name: string
  slug: string
  display_order: number
}

interface TagWithChilds {
  id: number
  name: string
  slug: string
  is_main_category: boolean | null
  is_hidden: boolean
  display_order: number | null
  active_markets_count: number | null
  created_at: Date
  updated_at: Date
  childs: PlatformNavigationChild[]
  sidebarItems?: PlatformCategorySidebarItem[]
}

interface MainTagsResult {
  data: TagWithChilds[] | null
  error: string | null
  globalChilds: PlatformNavigationChild[]
}

interface SidebarCountEventCandidate {
  id: string
  slug: string
  status: 'draft' | 'active' | 'resolved' | 'archived'
  series_recurrence?: string | null
  series_slug?: string | null
  end_date?: string | null
  created_at: string
  updated_at: string
  main_tag?: string | null
  tags: Array<{
    slug: string
    isMainCategory: boolean
  }>
  markets: Array<{
    is_resolved: boolean
  }>
}

function createSidebarCountEventCandidate(row: {
  event_id: string
  event_slug: string
  event_status: SidebarCountEventCandidate['status']
  series_recurrence: string | null
  series_slug: string | null
  end_date: Date | null
  created_at: Date
  updated_at: Date
}): SidebarCountEventCandidate {
  return {
    id: row.event_id,
    slug: row.event_slug,
    status: row.event_status,
    series_recurrence: row.series_recurrence,
    series_slug: row.series_slug,
    end_date: row.end_date?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    main_tag: null,
    tags: [],
    markets: [],
  }
}

interface TagTranslationRecord {
  tag_id: number
  locale: string
  name: string
}

function normalizeTranslationLocale(locale: string): NonDefaultLocale | null {
  return NON_DEFAULT_LOCALES.includes(locale as NonDefaultLocale) ? (locale as NonDefaultLocale) : null
}

function buildSourceHash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeCurrentTimestampMs(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  if (value instanceof Date) {
    return value.getTime()
  }

  return null
}

async function getCurrentTimestampMs() {
  const { data } = await runQuery(async () => {
    const result = await db.execute(
      sql`SELECT FLOOR(EXTRACT(EPOCH FROM statement_timestamp()) * 1000)::double precision AS current_timestamp_ms`,
    )

    return { data: result, error: null }
  })

  return normalizeCurrentTimestampMs(
    (data as Array<{ current_timestamp_ms?: unknown }> | null)?.[0]?.current_timestamp_ms,
  )
}

function buildTagTranslationsByTagId(rows: TagTranslationRecord[]): Map<number, TagTranslationsMap> {
  const mapByTagId = new Map<number, TagTranslationsMap>()

  for (const row of rows) {
    const locale = normalizeTranslationLocale(row.locale)
    if (!locale) {
      continue
    }

    const current = mapByTagId.get(row.tag_id) ?? {}
    current[locale] = row.name
    mapByTagId.set(row.tag_id, current)
  }

  return mapByTagId
}

async function getTranslationsByTagIds(tagIds: number[]): Promise<{
  data: Map<number, TagTranslationsMap>
  error: string | null
}> {
  if (tagIds.length === 0) {
    return { data: new Map(), error: null }
  }

  const { data, error } = await runQuery(async () => {
    const result = await db
      .select({
        tag_id: tag_translations.tag_id,
        locale: tag_translations.locale,
        name: tag_translations.name,
      })
      .from(tag_translations)
      .where(inArray(tag_translations.tag_id, tagIds))

    return { data: result as TagTranslationRecord[], error: null }
  })

  if (error || !data) {
    return {
      data: new Map(),
      error: typeof error === 'string' ? error : 'Unknown error',
    }
  }

  return { data: buildTagTranslationsByTagId(data), error: null }
}

async function getLocalizedNamesByTagId(
  tagIds: number[],
  locale: SupportedLocale,
): Promise<{
  data: Map<number, string>
  error: string | null
}> {
  if (locale === DEFAULT_LOCALE || tagIds.length === 0) {
    return { data: new Map(), error: null }
  }

  const { data, error } = await runQuery(async () => {
    const result = await db
      .select({
        tag_id: tag_translations.tag_id,
        name: tag_translations.name,
      })
      .from(tag_translations)
      .where(and(inArray(tag_translations.tag_id, tagIds), eq(tag_translations.locale, locale)))

    return { data: result, error: null }
  })

  if (error || !data) {
    return {
      data: new Map(),
      error: typeof error === 'string' ? error : 'Unknown error',
    }
  }

  const localized = new Map<number, string>()
  for (const row of data) {
    localized.set(row.tag_id, row.name)
  }

  return { data: localized, error: null }
}

async function getVisibleActiveEventCountsByTagSlugs(tagSlugs: string[]): Promise<{
  data: Map<string, number>
  error: string | null
}> {
  const normalizedTagSlugs = Array.from(new Set(tagSlugs.map((tagSlug) => tagSlug.trim()).filter(Boolean)))

  if (normalizedTagSlugs.length === 0) {
    return { data: new Map(), error: null }
  }

  const { data, error } = await runQuery(async () => {
    const result = await db
      .select({
        event_id: events.id,
        event_slug: events.slug,
        event_status: events.status,
        series_recurrence: events.series_recurrence,
        series_slug: events.series_slug,
        end_date: events.end_date,
        created_at: events.created_at,
        updated_at: events.updated_at,
        tag_slug: tags.slug,
      })
      .from(events)
      .innerJoin(event_tags, eq(event_tags.event_id, events.id))
      .innerJoin(tags, eq(event_tags.tag_id, tags.id))
      .where(
        and(
          eq(events.status, 'active'),
          eq(events.is_hidden, false),
          inArray(tags.slug, normalizedTagSlugs),
          buildPublicEventListVisibilityCondition(events.id),
        ),
      )

    return { data: result, error: null }
  })

  if (error || !data) {
    return {
      data: new Map(),
      error: typeof error === 'string' ? error : 'Unknown error',
    }
  }

  const eventsByTagSlug = new Map<string, Map<string, SidebarCountEventCandidate>>()

  for (const row of data) {
    const bucket = eventsByTagSlug.get(row.tag_slug) ?? new Map<string, SidebarCountEventCandidate>()

    if (!bucket.has(row.event_id)) {
      bucket.set(
        row.event_id,
        createSidebarCountEventCandidate({
          event_id: row.event_id,
          event_slug: row.event_slug,
          event_status: row.event_status as SidebarCountEventCandidate['status'],
          series_recurrence: row.series_recurrence,
          series_slug: row.series_slug,
          end_date: row.end_date,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }),
      )
    }

    eventsByTagSlug.set(row.tag_slug, bucket)
  }

  const countsByTagSlug = new Map<string, number>()

  for (const tagSlug of normalizedTagSlugs) {
    const visibleEvents = filterHomeEvents(Array.from(eventsByTagSlug.get(tagSlug)?.values() ?? []))

    countsByTagSlug.set(tagSlug, visibleEvents.length)
  }

  return {
    data: countsByTagSlug,
    error: null,
  }
}

async function getCachedMainTags(locale: SupportedLocale): Promise<MainTagsResult> {
  'use cache'
  cacheTag(cacheTags.mainTags(locale))

  const { data: mainTagsResult, error } = await runQuery(async () => {
    const result = await db
      .select({
        id: tags.id,
        name: tags.name,
        slug: tags.slug,
        is_main_category: tags.is_main_category,
        is_hidden: tags.is_hidden,
        display_order: tags.display_order,
        active_markets_count: tags.active_markets_count,
        created_at: tags.created_at,
        updated_at: tags.updated_at,
      })
      .from(tags)
      .where(and(eq(tags.is_main_category, true), eq(tags.is_hidden, false)))
      .orderBy(asc(tags.display_order), asc(tags.name))

    return { data: result, error: null }
  })

  if (error || !mainTagsResult) {
    const errorMessage = typeof error === 'string' ? error : 'Unknown error'
    return { data: null, error: errorMessage, globalChilds: [] }
  }

  const mainVisibleTags = mainTagsResult
  const mainSlugs = mainVisibleTags.map((tag) => tag.slug)

  const { data: subcategoriesResult, error: viewError } = await runQuery(async () => {
    const result = await db
      .select({
        main_tag_id: v_main_tag_subcategories.main_tag_id,
        main_tag_slug: v_main_tag_subcategories.main_tag_slug,
        main_tag_name: v_main_tag_subcategories.main_tag_name,
        main_tag_is_hidden: v_main_tag_subcategories.main_tag_is_hidden,
        sub_tag_id: v_main_tag_subcategories.sub_tag_id,
        sub_tag_name: v_main_tag_subcategories.sub_tag_name,
        sub_tag_slug: v_main_tag_subcategories.sub_tag_slug,
        sub_tag_is_main_category: v_main_tag_subcategories.sub_tag_is_main_category,
        sub_tag_is_hidden: v_main_tag_subcategories.sub_tag_is_hidden,
        active_markets_count: v_main_tag_subcategories.active_markets_count,
        last_market_activity_at: v_main_tag_subcategories.last_market_activity_at,
      })
      .from(v_main_tag_subcategories)
      .where(inArray(v_main_tag_subcategories.main_tag_slug, mainSlugs))

    return { data: result, error: null }
  })

  if (viewError || !subcategoriesResult) {
    const tagsWithChilds = mainVisibleTags.map((tag: any) => ({ ...tag, childs: [] }))
    const errorMessage = typeof viewError === 'string' ? viewError : 'Unknown error'
    return { data: tagsWithChilds, error: errorMessage, globalChilds: [] }
  }

  const configuredSidebarTagSlugs = locale === DEFAULT_LOCALE ? [] : Array.from(getCategorySidebarConfiguredTagSlugs())
  const { data: configuredSidebarTags, error: configuredSidebarTagsError } =
    configuredSidebarTagSlugs.length === 0
      ? { data: [], error: null }
      : await runQuery(async () => {
          const result = await db
            .select({
              id: tags.id,
              slug: tags.slug,
            })
            .from(tags)
            .where(and(inArray(tags.slug, configuredSidebarTagSlugs), eq(tags.is_main_category, false)))

          return { data: result, error: null }
        })

  const configuredSidebarTagRecords = configuredSidebarTagsError ? [] : (configuredSidebarTags ?? [])

  const visibleMainEventTags = alias(event_tags, 'visible_main_event_tags')
  const visibleMainTags = alias(tags, 'visible_main_tags')

  const { data: visibleEventTagRows } = await runQuery(async () => {
    const result = await db
      .select({
        event_id: events.id,
        event_slug: events.slug,
        event_status: events.status,
        series_recurrence: events.series_recurrence,
        series_slug: events.series_slug,
        end_date: events.end_date,
        created_at: events.created_at,
        updated_at: events.updated_at,
        tag_slug: tags.slug,
        tag_is_main_category: tags.is_main_category,
      })
      .from(events)
      .innerJoin(event_tags, eq(event_tags.event_id, events.id))
      .innerJoin(tags, eq(event_tags.tag_id, tags.id))
      .where(
        and(
          eq(events.status, 'active'),
          eq(events.is_hidden, false),
          eq(tags.is_hidden, false),
          buildPublicEventListVisibilityCondition(events.id),
          exists(
            db
              .select()
              .from(visibleMainEventTags)
              .innerJoin(visibleMainTags, eq(visibleMainEventTags.tag_id, visibleMainTags.id))
              .where(
                and(
                  eq(visibleMainEventTags.event_id, events.id),
                  inArray(visibleMainTags.slug, mainSlugs),
                  eq(visibleMainTags.is_main_category, true),
                  eq(visibleMainTags.is_hidden, false),
                ),
              ),
          ),
        ),
      )

    return { data: result, error: null }
  })

  const sidebarCountEventsById = new Map<string, SidebarCountEventCandidate>()

  for (const row of visibleEventTagRows ?? []) {
    const eventId = row.event_id
    const existing: SidebarCountEventCandidate =
      sidebarCountEventsById.get(eventId) ??
      createSidebarCountEventCandidate({
        event_id: row.event_id,
        event_slug: row.event_slug,
        event_status: row.event_status as SidebarCountEventCandidate['status'],
        series_recurrence: row.series_recurrence,
        series_slug: row.series_slug,
        end_date: row.end_date,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })

    existing.tags.push({
      slug: row.tag_slug,
      isMainCategory: Boolean(row.tag_is_main_category),
    })

    sidebarCountEventsById.set(eventId, existing)
  }

  const currentTimestamp = await getCurrentTimestampMs()
  const visibleSidebarCountEvents = filterHomeEvents(Array.from(sidebarCountEventsById.values()), {
    currentTimestamp,
  })

  const subcategoryEventCounts = new Map<string, number>()
  const mainCategoryEventCounts = new Map<string, number>()

  const translationTagIds = new Set<number>()
  for (const tag of mainVisibleTags) {
    translationTagIds.add(tag.id)
  }
  for (const subtag of subcategoriesResult) {
    if (subtag.main_tag_id) {
      translationTagIds.add(subtag.main_tag_id)
    }
    if (subtag.sub_tag_id) {
      translationTagIds.add(subtag.sub_tag_id)
    }
  }
  for (const tag of configuredSidebarTagRecords) {
    translationTagIds.add(tag.id)
  }

  const { data: localizedNamesByTagId, error: translationError } = await getLocalizedNamesByTagId(
    Array.from(translationTagIds),
    locale,
  )

  if (translationError) {
    return { data: null, error: translationError, globalChilds: [] }
  }

  const localizedNamesBySlug = new Map<string, string>()
  for (const subcategory of subcategoriesResult) {
    if (!subcategory.sub_tag_slug) {
      continue
    }

    const localizedName = localizedNamesByTagId.get(subcategory.sub_tag_id ?? -1)
    if (localizedName) {
      localizedNamesBySlug.set(subcategory.sub_tag_slug, localizedName)
    }
  }
  for (const tag of configuredSidebarTagRecords) {
    const localizedName = localizedNamesByTagId.get(tag.id)
    if (localizedName) {
      localizedNamesBySlug.set(tag.slug, localizedName)
    }
  }

  const grouped = new Map<string, { name: string; slug: string; count: number }[]>()
  const globalCounts = new Map<string, { name: string; slug: string; count: number }>()

  const mainSlugSet = new Set(mainSlugs)

  for (const event of visibleSidebarCountEvents) {
    const mainTagsForEvent = new Set(
      event.tags.filter((tag) => tag.isMainCategory && mainSlugSet.has(tag.slug)).map((tag) => tag.slug),
    )
    const subTagsForEvent = new Set(
      event.tags
        .filter((tag) => !tag.isMainCategory && !mainSlugSet.has(tag.slug) && !EXCLUDED_SUB_SLUGS.has(tag.slug))
        .map((tag) => tag.slug),
    )

    for (const mainSlug of mainTagsForEvent) {
      mainCategoryEventCounts.set(mainSlug, (mainCategoryEventCounts.get(mainSlug) ?? 0) + 1)

      const resolvedSubTagsForEvent = new Set(subTagsForEvent)
      const cadenceRouteSlug = resolveCryptoCadenceRouteSlug(event)
      if (mainSlug === 'crypto' && cadenceRouteSlug) {
        resolvedSubTagsForEvent.add(cadenceRouteSlug)
      }

      for (const subSlug of resolvedSubTagsForEvent) {
        const key = `${mainSlug}::${subSlug}`
        subcategoryEventCounts.set(key, (subcategoryEventCounts.get(key) ?? 0) + 1)
      }
    }
  }

  for (const subtag of subcategoriesResult) {
    if (
      !subtag.sub_tag_slug ||
      mainSlugSet.has(subtag.sub_tag_slug) ||
      EXCLUDED_SUB_SLUGS.has(subtag.sub_tag_slug) ||
      subtag.sub_tag_is_hidden ||
      subtag.main_tag_is_hidden
    ) {
      continue
    }

    const localizedSubTagName = localizedNamesByTagId.get(subtag.sub_tag_id ?? -1) ?? subtag.sub_tag_name!
    const current = grouped.get(subtag.main_tag_slug!) ?? []
    const existingIndex = current.findIndex((item) => item.slug === subtag.sub_tag_slug)
    const nextCount = subcategoryEventCounts.get(`${subtag.main_tag_slug!}::${subtag.sub_tag_slug}`) ?? 0

    if (nextCount <= 0) {
      continue
    }

    if (existingIndex >= 0) {
      current[existingIndex] = {
        name: localizedSubTagName,
        slug: subtag.sub_tag_slug,
        count: Math.max(current[existingIndex].count, nextCount),
      }
    } else {
      current.push({
        name: localizedSubTagName,
        slug: subtag.sub_tag_slug,
        count: nextCount,
      })
    }

    grouped.set(subtag.main_tag_slug!, current)

    const globalExisting = globalCounts.get(subtag.sub_tag_slug)
    globalCounts.set(subtag.sub_tag_slug, {
      name: localizedSubTagName,
      slug: subtag.sub_tag_slug,
      count: (globalExisting?.count ?? 0) + nextCount,
    })
  }

  const enhanced = mainVisibleTags.map((tag) => {
    const localizedTagName = localizedNamesByTagId.get(tag.id) ?? tag.name
    const sortedChilds = (grouped.get(tag.slug) ?? [])
      .sort((a, b) => {
        if (b.count === a.count) {
          return a.name.localeCompare(b.name)
        }
        return b.count - a.count
      })
      .map(({ name, slug, count }) => ({ name, slug, count }))
    if (tag.slug === 'crypto') {
      for (const cadenceRoute of CRYPTO_CADENCE_ROUTES) {
        const cadenceCount = subcategoryEventCounts.get(`${tag.slug}::${cadenceRoute.routeSlug}`) ?? 0
        if (cadenceCount > 0 && !sortedChilds.some((child) => child.slug === cadenceRoute.routeSlug)) {
          sortedChilds.push({
            name: resolveCryptoCadenceSidebarLabel(cadenceRoute, locale),
            slug: cadenceRoute.routeSlug,
            count: cadenceCount,
          })
        }
      }
    }
    const { childs: resolvedChilds, sidebarItems } = resolveCategorySidebarData({
      categorySlug: tag.slug,
      categoryCount: mainCategoryEventCounts.get(tag.slug) ?? 0,
      childs: sortedChilds,
      localizedNamesBySlug,
    })

    return {
      ...tag,
      name: localizedTagName,
      childs: resolvedChilds,
      sidebarItems,
    }
  })

  const globalChilds = Array.from(globalCounts.values())
    .filter((child) => child.count > 0)
    .sort((a, b) => {
      if (b.count === a.count) {
        return a.name.localeCompare(b.name)
      }
      return b.count - a.count
    })
    .map(({ name, slug, count }) => ({ name, slug, count }))

  return { data: enhanced, error: null, globalChilds }
}

export const TagRepository = {
  async getMainTags(locale: SupportedLocale = DEFAULT_LOCALE): Promise<MainTagsResult> {
    // An env-less image build must not seed the runtime cache with an empty menu.
    if (!hasDatabaseEnv()) {
      return { data: null, error: 'Database env vars are not configured.', globalChilds: [] }
    }

    return getCachedMainTags(locale)
  },

  async listTags({
    limit = 50,
    offset = 0,
    search,
    sortBy = 'display_order',
    sortOrder = 'asc',
    mainOnly = false,
  }: ListTagsParams = {}): Promise<{
    data: AdminTagRow[]
    error: string | null
    totalCount: number
  }> {
    'use cache'
    cacheTag(cacheTags.adminCategories)

    const cappedLimit = Math.min(Math.max(limit, 1), 100)
    const safeOffset = Math.max(offset, 0)

    const validSortFields: NonNullable<ListTagsParams['sortBy']>[] = [
      'name',
      'slug',
      'display_order',
      'created_at',
      'updated_at',
      'active_events_count',
    ]
    const orderField = validSortFields.includes(sortBy) ? sortBy : 'display_order'
    const ascending = (sortOrder ?? 'asc') === 'asc'

    const searchCondition =
      search && search.trim()
        ? or(ilike(tags.name, `%${search.trim()}%`), ilike(tags.slug, `%${search.trim()}%`))
        : undefined
    const mainOnlyCondition = mainOnly ? eq(tags.is_main_category, true) : undefined
    const whereCondition = and(searchCondition, mainOnlyCondition)

    let orderByClause
    switch (orderField) {
      case 'name':
        orderByClause = ascending ? asc(tags.name) : desc(tags.name)
        break
      case 'slug':
        orderByClause = ascending ? asc(tags.slug) : desc(tags.slug)
        break
      case 'created_at':
        orderByClause = ascending ? asc(tags.created_at) : desc(tags.created_at)
        break
      case 'updated_at':
        orderByClause = ascending ? asc(tags.updated_at) : desc(tags.updated_at)
        break
      case 'display_order':
      default:
        orderByClause = ascending ? asc(tags.display_order) : desc(tags.display_order)
        break
    }

    const { data: countResult, error: countError } = await runQuery(async () => {
      const countQuery = whereCondition
        ? db.select({ count: count() }).from(tags).where(whereCondition)
        : db.select({ count: count() }).from(tags)
      const result = await countQuery
      return { data: result, error: null }
    })

    if (countError) {
      return {
        data: [],
        error: countError,
        totalCount: 0,
      }
    }

    let rawRows: Array<{
      id: number
      name: string
      slug: string
      is_main_category: boolean | null
      is_hidden: boolean
      hide_events: boolean
      event_page_note: string | null
      display_order: number | null
      active_markets_count: number | null
      created_at: Date
      updated_at: Date
    }> = []
    let visibleCountsByTagSlug = new Map<string, number>()

    if (orderField === 'active_events_count') {
      const { data, error } = await runQuery(async () => {
        const fullQuery = whereCondition
          ? db
              .select({
                id: tags.id,
                name: tags.name,
                slug: tags.slug,
                is_main_category: tags.is_main_category,
                is_hidden: tags.is_hidden,
                hide_events: tags.hide_events,
                event_page_note: tags.event_page_note,
                display_order: tags.display_order,
                active_markets_count: tags.active_markets_count,
                created_at: tags.created_at,
                updated_at: tags.updated_at,
              })
              .from(tags)
              .where(whereCondition)
          : db
              .select({
                id: tags.id,
                name: tags.name,
                slug: tags.slug,
                is_main_category: tags.is_main_category,
                is_hidden: tags.is_hidden,
                hide_events: tags.hide_events,
                event_page_note: tags.event_page_note,
                display_order: tags.display_order,
                active_markets_count: tags.active_markets_count,
                created_at: tags.created_at,
                updated_at: tags.updated_at,
              })
              .from(tags)
        const result = await fullQuery
        return { data: result, error: null }
      })

      if (error) {
        return {
          data: [],
          error,
          totalCount: 0,
        }
      }

      const allRows = data || []
      const { data: allVisibleCountsByTagSlug, error: visibleCountsError } =
        await getVisibleActiveEventCountsByTagSlugs(allRows.map((row) => row.slug))

      if (visibleCountsError) {
        return {
          data: [],
          error: visibleCountsError,
          totalCount: 0,
        }
      }

      visibleCountsByTagSlug = allVisibleCountsByTagSlug
      rawRows = allRows
        .toSorted((left, right) => {
          const leftCount = visibleCountsByTagSlug.get(left.slug) ?? 0
          const rightCount = visibleCountsByTagSlug.get(right.slug) ?? 0

          if (leftCount !== rightCount) {
            return ascending ? leftCount - rightCount : rightCount - leftCount
          }

          return left.name.localeCompare(right.name)
        })
        .slice(safeOffset, safeOffset + cappedLimit)
    } else {
      const { data, error } = await runQuery(async () => {
        const finalQuery = whereCondition
          ? db
              .select({
                id: tags.id,
                name: tags.name,
                slug: tags.slug,
                is_main_category: tags.is_main_category,
                is_hidden: tags.is_hidden,
                hide_events: tags.hide_events,
                event_page_note: tags.event_page_note,
                display_order: tags.display_order,
                active_markets_count: tags.active_markets_count,
                created_at: tags.created_at,
                updated_at: tags.updated_at,
              })
              .from(tags)
              .where(whereCondition)
              .orderBy(orderByClause)
              .limit(cappedLimit)
              .offset(safeOffset)
          : db
              .select({
                id: tags.id,
                name: tags.name,
                slug: tags.slug,
                is_main_category: tags.is_main_category,
                is_hidden: tags.is_hidden,
                hide_events: tags.hide_events,
                event_page_note: tags.event_page_note,
                display_order: tags.display_order,
                active_markets_count: tags.active_markets_count,
                created_at: tags.created_at,
                updated_at: tags.updated_at,
              })
              .from(tags)
              .orderBy(orderByClause)
              .limit(cappedLimit)
              .offset(safeOffset)
        const result = await finalQuery
        return { data: result, error: null }
      })

      if (error) {
        return {
          data: [],
          error,
          totalCount: 0,
        }
      }

      rawRows = data || []
    }

    const tagIds = rawRows.map((row: any) => row.id)
    const { data: translationsByTagId, error: translationError } = await getTranslationsByTagIds(tagIds)

    if (translationError) {
      return {
        data: [],
        error: translationError,
        totalCount: 0,
      }
    }

    if (orderField !== 'active_events_count') {
      const { data: pageVisibleCountsByTagSlug, error: visibleCountsError } =
        await getVisibleActiveEventCountsByTagSlugs(rawRows.map((row) => row.slug))

      if (visibleCountsError) {
        return {
          data: [],
          error: visibleCountsError,
          totalCount: 0,
        }
      }

      visibleCountsByTagSlug = pageVisibleCountsByTagSlug
    }

    const formattedData: AdminTagRow[] = rawRows.map((row: any) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      is_main_category: row.is_main_category,
      is_hidden: row.is_hidden,
      hide_events: row.hide_events,
      event_page_note: row.event_page_note,
      display_order: row.display_order,
      active_markets_count: row.active_markets_count ?? 0,
      active_events_count: visibleCountsByTagSlug.get(row.slug) ?? 0,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      translations: translationsByTagId.get(row.id) ?? {},
    }))

    return {
      data: formattedData,
      error: null,
      totalCount: countResult?.[0]?.count ?? 0,
    }
  },

  async updateTagById(
    id: number,
    payload: any,
  ): Promise<{
    data: AdminTagRow | null
    error: string | null
  }> {
    const updateQuery = db.update(tags).set(payload).where(eq(tags.id, id)).returning()

    const { data: updateResult, error } = await runQuery(async () => {
      const result = await updateQuery
      return { data: result, error: null }
    })

    if (error || !updateResult?.[0]) {
      return { data: null, error: error ?? 'Unknown error' }
    }

    const selectQuery = db
      .select({
        id: tags.id,
        name: tags.name,
        slug: tags.slug,
        is_main_category: tags.is_main_category,
        is_hidden: tags.is_hidden,
        hide_events: tags.hide_events,
        event_page_note: tags.event_page_note,
        display_order: tags.display_order,
        active_markets_count: tags.active_markets_count,
        created_at: tags.created_at,
        updated_at: tags.updated_at,
      })
      .from(tags)
      .where(eq(tags.id, id))

    const { data: selectResult, error: selectError } = await runQuery(async () => {
      const result = await selectQuery
      return { data: result, error: null }
    })

    if (selectError || !selectResult?.[0]) {
      return { data: null, error: selectError ?? 'Unknown error' }
    }

    const { data: translationsByTagId, error: translationError } = await getTranslationsByTagIds([id])

    if (translationError) {
      return { data: null, error: translationError }
    }

    const { data: visibleCountsByTagSlug, error: visibleCountsError } = await getVisibleActiveEventCountsByTagSlugs([
      selectResult[0].slug,
    ])

    if (visibleCountsError) {
      return { data: null, error: visibleCountsError }
    }

    const row = selectResult[0]
    const formattedData: AdminTagRow = {
      id: row.id,
      name: row.name,
      slug: row.slug,
      is_main_category: row.is_main_category ?? false,
      is_hidden: row.is_hidden,
      hide_events: row.hide_events,
      event_page_note: row.event_page_note,
      display_order: row.display_order ?? 0,
      active_markets_count: row.active_markets_count ?? 0,
      active_events_count: visibleCountsByTagSlug.get(row.slug) ?? 0,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      translations: translationsByTagId.get(row.id) ?? {},
    }

    return {
      data: formattedData,
      error: null,
    }
  },

  async listMainCategoriesForOrdering(): Promise<{
    data: MainCategoryOrderRow[]
    error: string | null
  }> {
    const selectQuery = db
      .select({
        id: tags.id,
        name: tags.name,
        slug: tags.slug,
        display_order: tags.display_order,
      })
      .from(tags)
      .where(eq(tags.is_main_category, true))
      .orderBy(asc(tags.display_order), asc(tags.name))

    const { data, error } = await runQuery(async () => {
      const result = await selectQuery
      return { data: result, error: null }
    })

    if (error) {
      return {
        data: [],
        error,
      }
    }

    return {
      data: (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        display_order: row.display_order ?? 0,
      })),
      error: null,
    }
  },

  async updateMainCategoriesDisplayOrder(categoryIds: number[]): Promise<{
    error: string | null
  }> {
    if (categoryIds.length === 0) {
      return { error: null }
    }

    const orderCases = categoryIds.map(
      (categoryId, index) => sql`
      WHEN ${tags.id} = ${categoryId} THEN ${index + 1}
    `,
    )
    const displayOrderSql = sql<number>`
      CASE
        ${sql.join(orderCases, sql` `)}
        ELSE ${tags.display_order}
      END
    `

    const { data, error } = await runQuery(async () => {
      const result = await db
        .update(tags)
        .set({
          display_order: displayOrderSql,
        })
        .where(and(eq(tags.is_main_category, true), inArray(tags.id, categoryIds)))
        .returning({ id: tags.id })

      return { data: result, error: null }
    })

    if (error) {
      return { error }
    }

    if ((data?.length ?? 0) !== categoryIds.length) {
      return {
        error: 'One or more main categories could not be updated.',
      }
    }

    return { error: null }
  },

  async updateTagTranslationsById(
    tagId: number,
    translations: TagTranslationsMap,
  ): Promise<{
    data: TagTranslationsMap | null
    error: string | null
  }> {
    const normalizedEntries = NON_DEFAULT_LOCALES.flatMap((locale) => {
      const rawValue = translations[locale]
      if (typeof rawValue !== 'string') {
        return []
      }

      const value = rawValue.trim()
      return [{ locale, value }]
    })

    const localesToDelete = normalizedEntries.filter((entry) => entry.value.length === 0).map((entry) => entry.locale)

    const { data: tagRecord, error: tagCheckError } = await runQuery(async () => {
      const result = await db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.id, tagId)).limit(1)

      return { data: result[0] ?? null, error: null }
    })

    if (tagCheckError || !tagRecord) {
      return { data: null, error: tagCheckError ?? 'Tag not found.' }
    }

    const sourceHash = buildSourceHash(tagRecord.name)
    const rowsToUpsert = normalizedEntries
      .filter((entry) => entry.value.length > 0)
      .map((entry) => ({
        tag_id: tagId,
        locale: entry.locale,
        name: entry.value,
        source_hash: sourceHash,
        is_manual: true,
      }))

    const { error } = await runQuery(async () => {
      await db.transaction(async (tx) => {
        if (localesToDelete.length > 0) {
          await tx
            .delete(tag_translations)
            .where(and(eq(tag_translations.tag_id, tagId), inArray(tag_translations.locale, localesToDelete)))
        }

        if (rowsToUpsert.length > 0) {
          await tx
            .insert(tag_translations)
            .values(rowsToUpsert)
            .onConflictDoUpdate({
              target: [tag_translations.tag_id, tag_translations.locale],
              set: {
                name: sql`EXCLUDED.name`,
                source_hash: sql`EXCLUDED.source_hash`,
                is_manual: true,
              },
            })
        }
      })

      return { data: true, error: null }
    })

    if (error) {
      return {
        data: null,
        error: typeof error === 'string' ? error : 'Unknown error',
      }
    }

    const { data: translationsByTagId, error: translationError } = await getTranslationsByTagIds([tagId])

    if (translationError) {
      return {
        data: null,
        error: translationError,
      }
    }

    return {
      data: translationsByTagId.get(tagId) ?? {},
      error: null,
    }
  },
}
