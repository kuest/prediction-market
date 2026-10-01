import { and, asc, eq, gt, or, sql } from 'drizzle-orm'
import { cacheLife, cacheTag, unstable_cache } from 'next/cache'

import type { SportsMenuActiveCountRow } from '@/lib/sports-menu-counts'
import type { SportsMenuEntry } from '@/lib/sports-menu-types'
import type { SportsSlugMappingEntry } from '@/lib/sports-slug-mapping'
import type { SportsVertical } from '@/lib/sports-vertical'
import type { QueryResult } from '@/types'

import { cacheTags } from '@/lib/cache-tags'
import { hasDatabaseEnv } from '@/lib/db/env'
import { event_sports, events, sports_menu_items } from '@/lib/db/schema/events/tables'
import { runQuery } from '@/lib/db/utils/run-query'
import { db } from '@/lib/drizzle'
import { normalizeComparableValue, slugifyText } from '@/lib/slug'
import { SPORTS_AUXILIARY_SLUG_SQL_REGEX } from '@/lib/sports-event-slugs'
import { buildSportsMenuCountsBySlug } from '@/lib/sports-menu-counts'
import { buildSportsSidebarEntries } from '@/lib/sports-sidebar-entries'
import { buildSportsSlugResolver, resolveCanonicalSportsSlugAlias } from '@/lib/sports-slug-mapping'

interface SportsMenuItemRow {
  id: string
  item_type: string
  label: string | null
  href: string | null
  icon_url: string | null
  parent_id: string | null
  menu_slug: string | null
  h1_title: string | null
  mapped_tags: unknown
  url_aliases: unknown
  games_enabled: boolean
  props_enabled: boolean
  sort_order: number
  sidebar_category: boolean
  sidebar_enabled: boolean
  sidebar_featured: boolean
  sidebar_sort_order: number
}

export interface SportsMenuLayoutData {
  menuEntries: SportsMenuEntry[]
  countsBySlug: Record<string, number>
  canonicalSlugByAliasKey: Record<string, string>
  h1TitleBySlug: Record<string, string>
  sectionsBySlug: Record<string, { gamesEnabled: boolean; propsEnabled: boolean }>
}

function toOptionalStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[]
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function requireText(value: string | null | undefined, rowId: string, field: string) {
  if (typeof value !== 'string') {
    throw new TypeError(`sports_menu_items.${field} is required for row ${rowId}`)
  }

  const normalized = value.trim()
  if (!normalized) {
    throw new TypeError(`sports_menu_items.${field} cannot be empty for row ${rowId}`)
  }

  return normalized
}

function buildChildrenByParent(rows: SportsMenuItemRow[]) {
  const childrenByParent = new Map<string, SportsMenuItemRow[]>()

  for (const row of rows) {
    if (!row.parent_id) {
      continue
    }

    const childRows = childrenByParent.get(row.parent_id) ?? []
    childRows.push(row)
    childrenByParent.set(row.parent_id, childRows)
  }

  for (const childRows of childrenByParent.values()) {
    childRows.sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
  }

  return childrenByParent
}

function resolveGroupMenuSlug(row: SportsMenuItemRow) {
  const configuredSlug = normalizeComparableValue(row.menu_slug)
  if (configuredSlug) {
    return configuredSlug
  }

  const label = row.label?.trim()
  if (!label) {
    return null
  }

  return slugifyText(label) || null
}

function resolveGroupSectionConfig(childRows: SportsMenuItemRow[]) {
  const hrefs = childRows.map((child) => child.href?.trim().toLowerCase() ?? '').filter(Boolean)

  return {
    gamesEnabled:
      childRows.some((child) => child.item_type === 'link' && Boolean(child.games_enabled)) ||
      hrefs.some((href) => href.endsWith('/games')),
    propsEnabled:
      childRows.some((child) => child.item_type === 'link' && Boolean(child.props_enabled)) ||
      hrefs.some((href) => href.endsWith('/props')),
  }
}

function buildGroupQueryCandidates(childRows: SportsMenuItemRow[]) {
  const queryCandidates = new Set<string>()

  for (const child of childRows) {
    if (child.item_type !== 'link') {
      continue
    }

    const menuSlug = normalizeComparableValue(child.menu_slug)
    if (menuSlug) {
      queryCandidates.add(menuSlug)
    }

    if (child.label?.trim()) {
      queryCandidates.add(child.label)
    }

    for (const alias of toOptionalStringArray(child.url_aliases)) {
      queryCandidates.add(alias)
    }

    for (const mappedTag of toOptionalStringArray(child.mapped_tags)) {
      queryCandidates.add(mappedTag)
    }
  }

  return Array.from(queryCandidates)
}

class EmptySportsMenuRowsError extends Error {
  constructor() {
    super('sports_menu_items returned no enabled rows.')
    this.name = 'EmptySportsMenuRowsError'
  }
}

function isEmptySportsMenuRowsError(error: unknown) {
  return error instanceof EmptySportsMenuRowsError
}

async function fetchSportsMenuRows(): Promise<SportsMenuItemRow[]> {
  return db
    .select({
      id: sports_menu_items.id,
      item_type: sports_menu_items.item_type,
      label: sports_menu_items.label,
      href: sports_menu_items.href,
      icon_url: sports_menu_items.icon_url,
      parent_id: sports_menu_items.parent_id,
      menu_slug: sports_menu_items.menu_slug,
      h1_title: sports_menu_items.h1_title,
      mapped_tags: sports_menu_items.mapped_tags,
      url_aliases: sports_menu_items.url_aliases,
      games_enabled: sports_menu_items.games_enabled,
      props_enabled: sports_menu_items.props_enabled,
      sort_order: sports_menu_items.sort_order,
      sidebar_category: sports_menu_items.sidebar_category,
      sidebar_enabled: sports_menu_items.sidebar_enabled,
      sidebar_featured: sports_menu_items.sidebar_featured,
      sidebar_sort_order: sports_menu_items.sidebar_sort_order,
    })
    .from(sports_menu_items)
    .where(eq(sports_menu_items.enabled, true))
    .orderBy(asc(sports_menu_items.sort_order), asc(sports_menu_items.id))
}

const getCachedSportsMenuRows = unstable_cache(
  async (): Promise<SportsMenuItemRow[]> => {
    return fetchSportsMenuRows()
  },
  ['sports-menu-items-v2'],
  {
    revalidate: 31_536_000,
    tags: [cacheTags.sportsMenuStructure],
  },
)

async function getSportsMenuRowsWithFreshEmptyFallback() {
  const cachedRows = await getCachedSportsMenuRows()
  if (cachedRows.length > 0) {
    return cachedRows
  }

  return fetchSportsMenuRows()
}

async function getRequiredSportsMenuRows() {
  const rows = await getSportsMenuRowsWithFreshEmptyFallback()
  if (rows.length === 0) {
    throw new EmptySportsMenuRowsError()
  }

  return rows
}

const getCachedActiveSportsCountRows = unstable_cache(
  async (): Promise<SportsMenuActiveCountRow[]> => {
    const rows = await db
      .select({
        slug: event_sports.sports_sport_slug,
        series_slug: event_sports.sports_series_slug,
        event_slug: events.slug,
        sports_event_id: event_sports.sports_event_id,
        sports_event_slug: event_sports.sports_event_slug,
        parent_event_id: event_sports.sports_parent_event_id,
        tags: event_sports.sports_tags,
        is_hidden: events.is_hidden,
        sports_live: event_sports.sports_live,
        sports_ended: event_sports.sports_ended,
        sports_start_time: event_sports.sports_start_time,
        start_date: events.start_date,
        end_date: events.end_date,
      })
      .from(event_sports)
      .innerJoin(events, eq(event_sports.event_id, events.id))
      .where(
        and(
          eq(events.status, 'active'),
          eq(events.is_hidden, false),
          gt(events.active_markets_count, 0),
          sql`LOWER(TRIM(COALESCE(${events.slug}, ''))) !~ ${SPORTS_AUXILIARY_SLUG_SQL_REGEX}`,
          or(
            sql`TRIM(COALESCE(${event_sports.sports_sport_slug}, '')) <> ''`,
            sql`TRIM(COALESCE(${event_sports.sports_series_slug}, '')) <> ''`,
            sql`jsonb_array_length(COALESCE(${event_sports.sports_tags}, '[]'::jsonb)) > 0`,
          ),
        ),
      )

    return rows
  },
  ['sports-menu-active-count-rows-v4'],
  {
    revalidate: 900,
    tags: [cacheTags.eventsList],
  },
)

function toMappingEntries(rows: SportsMenuItemRow[]) {
  const childrenByParent = buildChildrenByParent(rows)
  const mappings: SportsSlugMappingEntry[] = []

  for (const row of rows) {
    if (row.item_type === 'link') {
      const menuSlug = normalizeComparableValue(row.menu_slug)
      if (!menuSlug) {
        continue
      }

      const h1Title = row.h1_title?.trim()
      if (!h1Title) {
        throw new Error(`sports_menu_items.h1_title is required for menu slug ${menuSlug}`)
      }

      mappings.push({
        menuSlug,
        h1Title,
        label: row.label,
        aliases: toOptionalStringArray(row.url_aliases),
        mappedTags: toOptionalStringArray(row.mapped_tags),
        sections: {
          gamesEnabled: Boolean(row.games_enabled),
          propsEnabled: Boolean(row.props_enabled),
        },
      })
      continue
    }

    if (row.item_type !== 'group') {
      continue
    }

    const menuSlug = resolveGroupMenuSlug(row)
    if (!menuSlug) {
      continue
    }

    const childRows = childrenByParent.get(row.id) ?? []
    const sectionConfig = resolveGroupSectionConfig(childRows)
    if (!sectionConfig.gamesEnabled && !sectionConfig.propsEnabled) {
      continue
    }

    mappings.push({
      menuSlug,
      h1Title: row.h1_title?.trim() || requireText(row.label, row.id, 'label'),
      label: row.label,
      aliases: toOptionalStringArray(row.url_aliases),
      mappedTags: toOptionalStringArray(row.mapped_tags),
      queryCandidates: buildGroupQueryCandidates(childRows),
      sections: sectionConfig,
      useForEventClassification: false,
    })
  }

  return mappings
}

function findDefaultLandingHref(menuEntries: SportsMenuEntry[]) {
  for (const entry of menuEntries) {
    if (entry.type === 'link' || entry.type === 'group') {
      return entry.href
    }
  }

  return null
}

function findDefaultFuturesHref(menuEntries: SportsMenuEntry[]) {
  for (const entry of menuEntries) {
    if (entry.type === 'link' && entry.href.startsWith('/sports/futures/')) {
      return entry.href
    }

    if (entry.type === 'group') {
      const futuresLink = entry.links.find((link) => link.href.startsWith('/sports/futures/'))
      if (futuresLink) {
        return futuresLink.href
      }
    }
  }

  return null
}

function buildEmptySportsMenuLayoutData(): SportsMenuLayoutData {
  return {
    menuEntries: [],
    countsBySlug: {},
    canonicalSlugByAliasKey: {},
    h1TitleBySlug: {},
    sectionsBySlug: {},
  }
}

function buildQueryResult<T>(data: T): QueryResult<T> {
  return {
    data,
    error: null,
  }
}

async function getCachedSportsSlugResolverFromDb() {
  const rows = await getSportsMenuRowsWithFreshEmptyFallback()
  const mappingEntries = toMappingEntries(rows)
  return buildSportsSlugResolver(mappingEntries)
}

export async function getSportsSlugResolverFromDb() {
  if (!hasDatabaseEnv()) {
    return buildSportsSlugResolver([])
  }

  return getCachedSportsSlugResolverFromDb()
}

async function getCachedMenuEntries(vertical: SportsVertical): Promise<QueryResult<SportsMenuEntry[]>> {
  'use cache'
  cacheLife('max')
  cacheTag(cacheTags.sportsMenuStructure)

  const rows = await getRequiredSportsMenuRows()

  return runQuery(async () => {
    return buildQueryResult(buildSportsSidebarEntries(rows, vertical))
  })
}

async function getCachedLayoutData(vertical: SportsVertical): Promise<QueryResult<SportsMenuLayoutData>> {
  const [rows, activeCountRows] = await Promise.all([getRequiredSportsMenuRows(), getCachedActiveSportsCountRows()])

  return runQuery(async () => {
    const resolver = buildSportsSlugResolver(toMappingEntries(rows))
    const menuEntries = buildSportsSidebarEntries(rows, vertical)
    const countsBySlug = buildSportsMenuCountsBySlug(resolver, activeCountRows, menuEntries)

    return buildQueryResult({
      menuEntries,
      countsBySlug,
      canonicalSlugByAliasKey: Object.fromEntries(resolver.canonicalByAliasKey),
      h1TitleBySlug: Object.fromEntries(resolver.h1TitleBySlug),
      sectionsBySlug: Object.fromEntries(resolver.sectionsBySlug),
    })
  })
}

async function getCachedCanonicalSlugByAlias(alias: string): Promise<QueryResult<string | null>> {
  'use cache'
  cacheLife('max')
  cacheTag(cacheTags.sportsMenuStructure)

  const rows = await getRequiredSportsMenuRows()

  return runQuery(async () => {
    const resolver = buildSportsSlugResolver(toMappingEntries(rows))

    return buildQueryResult(resolveCanonicalSportsSlugAlias(resolver, alias))
  })
}

async function getCachedLandingHref(vertical: SportsVertical): Promise<QueryResult<string | null>> {
  'use cache'
  cacheLife('max')
  cacheTag(cacheTags.sportsMenuStructure)

  const rows = await getRequiredSportsMenuRows()

  return runQuery(async () => {
    const menuEntries = buildSportsSidebarEntries(rows, vertical)

    return buildQueryResult(findDefaultLandingHref(menuEntries))
  })
}

async function getCachedFuturesHref(vertical: SportsVertical): Promise<QueryResult<string | null>> {
  'use cache'
  cacheLife('max')
  cacheTag(cacheTags.sportsMenuStructure)

  const rows = await getRequiredSportsMenuRows()

  return runQuery(async () => {
    const menuEntries = buildSportsSidebarEntries(rows, vertical)

    return buildQueryResult(findDefaultFuturesHref(menuEntries))
  })
}

async function getFreshMenuEntries(vertical: SportsVertical): Promise<QueryResult<SportsMenuEntry[]>> {
  return runQuery(async () => {
    const rows = await fetchSportsMenuRows()

    return buildQueryResult(buildSportsSidebarEntries(rows, vertical))
  })
}

async function getFreshLayoutData(vertical: SportsVertical): Promise<QueryResult<SportsMenuLayoutData>> {
  return runQuery(async () => {
    const [rows, activeCountRows] = await Promise.all([fetchSportsMenuRows(), getCachedActiveSportsCountRows()])
    const resolver = buildSportsSlugResolver(toMappingEntries(rows))
    const menuEntries = buildSportsSidebarEntries(rows, vertical)
    const countsBySlug = buildSportsMenuCountsBySlug(resolver, activeCountRows, menuEntries)

    return buildQueryResult({
      menuEntries,
      countsBySlug,
      canonicalSlugByAliasKey: Object.fromEntries(resolver.canonicalByAliasKey),
      h1TitleBySlug: Object.fromEntries(resolver.h1TitleBySlug),
      sectionsBySlug: Object.fromEntries(resolver.sectionsBySlug),
    })
  })
}

async function getFreshCanonicalSlugByAlias(alias: string): Promise<QueryResult<string | null>> {
  return runQuery(async () => {
    const rows = await fetchSportsMenuRows()
    const resolver = buildSportsSlugResolver(toMappingEntries(rows))

    return buildQueryResult(resolveCanonicalSportsSlugAlias(resolver, alias))
  })
}

async function getFreshLandingHref(vertical: SportsVertical): Promise<QueryResult<string | null>> {
  return runQuery(async () => {
    const rows = await fetchSportsMenuRows()
    const menuEntries = buildSportsSidebarEntries(rows, vertical)

    return buildQueryResult(findDefaultLandingHref(menuEntries))
  })
}

async function getFreshFuturesHref(vertical: SportsVertical): Promise<QueryResult<string | null>> {
  return runQuery(async () => {
    const rows = await fetchSportsMenuRows()
    const menuEntries = buildSportsSidebarEntries(rows, vertical)

    return buildQueryResult(findDefaultFuturesHref(menuEntries))
  })
}

async function withFreshSportsMenuRowsFallback<T>(
  cachedQuery: () => Promise<QueryResult<T>>,
  freshQuery: () => Promise<QueryResult<T>>,
) {
  try {
    return await cachedQuery()
  } catch (error) {
    if (isEmptySportsMenuRowsError(error)) {
      return freshQuery()
    }

    throw error
  }
}

export const SportsMenuRepository = {
  async getMenuEntries(vertical: SportsVertical = 'sports'): Promise<QueryResult<SportsMenuEntry[]>> {
    if (!hasDatabaseEnv()) {
      return buildQueryResult([])
    }

    return withFreshSportsMenuRowsFallback(
      () => getCachedMenuEntries(vertical),
      () => getFreshMenuEntries(vertical),
    )
  },

  async getLayoutData(vertical: SportsVertical = 'sports'): Promise<QueryResult<SportsMenuLayoutData>> {
    if (!hasDatabaseEnv()) {
      return buildQueryResult(buildEmptySportsMenuLayoutData())
    }

    return withFreshSportsMenuRowsFallback(
      () => getCachedLayoutData(vertical),
      () => getFreshLayoutData(vertical),
    )
  },

  async resolveCanonicalSlugByAlias(alias: string): Promise<QueryResult<string | null>> {
    if (!hasDatabaseEnv()) {
      return buildQueryResult(null)
    }

    return withFreshSportsMenuRowsFallback(
      () => getCachedCanonicalSlugByAlias(alias),
      () => getFreshCanonicalSlugByAlias(alias),
    )
  },

  async getLandingHref(vertical: SportsVertical = 'sports'): Promise<QueryResult<string | null>> {
    if (!hasDatabaseEnv()) {
      return buildQueryResult(null)
    }

    return withFreshSportsMenuRowsFallback(
      () => getCachedLandingHref(vertical),
      () => getFreshLandingHref(vertical),
    )
  },

  async getFuturesHref(vertical: SportsVertical = 'sports'): Promise<QueryResult<string | null>> {
    if (!hasDatabaseEnv()) {
      return buildQueryResult(null)
    }

    return withFreshSportsMenuRowsFallback(
      () => getCachedFuturesHref(vertical),
      () => getFreshFuturesHref(vertical),
    )
  },
}
