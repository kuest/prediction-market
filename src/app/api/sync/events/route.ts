import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'

import type { SportsSourceCandidate } from '@/lib/sports-source'
import type { SportsSourceProviderSettings } from '@/lib/sports-source/settings'

import { SUPPORTED_LOCALES } from '@/i18n/locales'
import {
  loadAllowedMarketCreatorWallets,
  refreshAllowedMarketCreatorSiteSources,
} from '@/lib/allowed-market-creators-server'
import { cacheTags } from '@/lib/cache-tags'
import {
  conditions as conditionsTable,
  event_sports as eventSportsTable,
  events as eventsTable,
  event_tags as eventTagsTable,
  market_sports as marketSportsTable,
  markets as marketsTable,
  outcomes as outcomesTable,
  subgraph_syncs,
  tags as tagsTable,
} from '@/lib/db/schema'
import { db } from '@/lib/drizzle'
import { loadAutoDeployNewEventsEnabled } from '@/lib/event-sync-settings'
import { setEventHiddenFromNew } from '@/lib/event-visibility'
import { resolvePublicRuntimeEnv } from '@/lib/public-runtime-config.shared'
import { syncMissingOnChainResolvedPayouts } from '@/lib/resolution-payout-sync'
import { slugifyText } from '@/lib/slug'
import { findSportsEvents } from '@/lib/sports-source'
import { normalizeSingleSportsSourceProvider } from '@/lib/sports-source/providers'
import { loadSportsSourceProviderSettings } from '@/lib/sports-source/settings'
import { getPublicAssetUrl } from '@/lib/storage'
import { uploadPublicAsset } from '@/lib/storage-upload'
import {
  buildCronErrorResponse,
  buildSyncAlreadyRunningResponse,
  handleCronRoute,
  tryAcquireSyncLock,
  updateSyncStatus,
} from '@/lib/sync/cron-route'
import { triggerTranslationEnqueue } from '@/lib/translations/trigger-enqueue'

export const maxDuration = 300

const IRYS_GATEWAY = process.env.IRYS_GATEWAY || 'https://gateway.irys.xyz'
const SYNC_TIME_LIMIT_MS = 250_000
const PNL_PAGE_SIZE = 200
const INITIAL_MARKET_LOOKBACK_DAYS = 14
const INITIAL_MARKET_LOOKBACK_SECONDS = INITIAL_MARKET_LOOKBACK_DAYS * 24 * 60 * 60
const INITIAL_MARKET_CURSOR_PREFIX = 'initial-market-sync:'
const EXPIRED_MARKET_GRACE_MS = 24 * 60 * 60 * 1000
const SYNC_HARD_DEADLINE_MS = 285_000
const SYNC_FINALIZATION_RESERVE_MS = 10_000
const TRANSLATION_TRIGGER_RESERVE_MS = 30_000
const MISSING_IMAGE_REPAIR_MAX_ITEMS = 6
const MISSING_IMAGE_REPAIR_MARKET_MAX_ITEMS = 3
const MISSING_IMAGE_REPAIR_SCAN_LIMIT = 30
const MISSING_IMAGE_REPAIR_ITEM_TIMEOUT_MS = 2_500
const MARKET_SYNC_STATE = {
  serviceName: 'market_sync',
  subgraphName: 'pnl',
} as const
const AUTO_SPORTS_SOURCE_CONFIDENCE_THRESHOLD = 0.72
const SPORTS_LOGO_STORAGE_PREFIX = 'sports/team-logos'
const sportsLogoStorageCache = new Map<string, string>()
const MAIN_CATEGORY_TAGS = [
  { name: 'Politics', slug: 'politics', displayOrder: 1 },
  { name: 'Sports', slug: 'sports', displayOrder: 2 },
  { name: 'Crypto', slug: 'crypto', displayOrder: 3 },
  { name: 'Esports', slug: 'esports', displayOrder: 4 },
  { name: 'Finance', slug: 'finance', displayOrder: 5 },
  { name: 'Geopolitics', slug: 'geopolitics', displayOrder: 6 },
  { name: 'Tech', slug: 'tech', displayOrder: 7 },
  { name: 'Culture', slug: 'culture', displayOrder: 8 },
  { name: 'World', slug: 'world', displayOrder: 9 },
  { name: 'Economy', slug: 'economy', displayOrder: 10 },
  { name: 'Weather', slug: 'weather', displayOrder: 11 },
  { name: 'Elections', slug: 'elections', displayOrder: 12 },
  { name: 'Mentions', slug: 'mentions', displayOrder: 13 },
] as const
const MAIN_CATEGORY_TAG_BY_SLUG = new Map<string, (typeof MAIN_CATEGORY_TAGS)[number]>(
  MAIN_CATEGORY_TAGS.map((tag) => [tag.slug, tag]),
)

function getPnlSubgraphUrl() {
  return new URL('/pnl-subgraph', resolvePublicRuntimeEnv(process.env).subgraphsUrl).toString()
}

interface SyncCursor {
  conditionId: string
  updatedAt: number
}

interface PnLCursorState {
  cursor: SyncCursor
  initialCreationTimestamp: number | null
}

interface SubgraphCondition {
  id: string
  oracle: string | null
  questionId: string | null
  resolved: boolean
  metadataHash: string | null
  creator: string | null
  creationTimestamp: string
  updatedAt: string
}

interface MarketTimestamps {
  createdAtIso: string
  updatedAtIso: string
}

interface EventSportsMetadataInput {
  sports_event_id: string | null
  sports_event_slug: string | null
  sports_parent_event_id: number | null
  sports_game_id: number | null
  sports_event_date: string | null
  sports_start_time: Date | null
  sports_series_slug: string | null
  sports_series_id: string | null
  sports_series_recurrence: string | null
  sports_series_color: string | null
  sports_sport_slug: string | null
  sports_league_label: string | null
  sports_league_slug: string | null
  sports_event_week: number | null
  sports_score: string | null
  sports_period: string | null
  sports_elapsed: string | null
  sports_live: boolean | null
  sports_ended: boolean | null
  sports_tags: string[] | null
  sports_teams: Record<string, unknown>[] | null
  sports_team_logo_urls: string[] | null
  sports_source_provider: string | null
  sports_source_event_id: string | null
  sports_source_game_id: string | null
  sports_source_league_id: string | null
  sports_source_league_label: string | null
  sports_source_match_confidence: string | null
  sports_source_payload: Record<string, unknown> | null
  sports_source_selected_at: Date | null
}

interface MarketSportsMetadataInput {
  event_id: string | null
  sports_market_type: string | null
  sports_line: string | null
  sports_group_item_title: string | null
  sports_group_item_threshold: string | null
  sports_game_start_time: Date | null
  sports_event_id: number | null
  sports_parent_event_id: number | null
  sports_game_id: number | null
  sports_event_date: string | null
  sports_start_time: Date | null
  sports_series_color: string | null
  sports_event_slug: string | null
  sports_teams: Record<string, unknown>[] | null
  sports_team_logo_urls: string[] | null
  sports_source_provider: string | null
  sports_source_event_id: string | null
  sports_source_game_id: string | null
  sports_source_league_id: string | null
  sports_source_league_label: string | null
  sports_source_market_id: string | null
  sports_source_match_confidence: string | null
  sports_source_payload: Record<string, unknown> | null
}

interface SyncStats {
  fetchedCount: number
  processedCount: number
  skippedCreatorCount: number
  skippedExpiredCount: number
  errors: { conditionId: string; error: string }[]
  timeLimitReached: boolean
}

interface SyncOptions {
  autoDeployNewEvents: boolean
}

interface SyncRuntimeState {
  eventTagSlugsByEventId: Map<string, Set<string>>
  sportsSourceSettingsPromise?: Promise<SportsSourceProviderSettings>
}

interface NormalizedEventTag {
  name: string
  isMainCategory: boolean
  displayOrder: number | null
}

interface ProcessMarketResult {
  eventIdForStatusUpdate: string | null
  eventIdsForCacheInvalidation: string[]
  seriesSlugsForCacheInvalidation: string[]
  changed: boolean
  translationSourceChanged: boolean
  listAffectingChange: boolean
  urlSetChanged: boolean
  skippedExpired: boolean
}

interface ProcessEventResult {
  eventId: string
  eventChanged: boolean
  translationSourceChanged: boolean
  seriesSlugsForCacheInvalidation: string[]
  listAffectingChange: boolean
  urlSetChanged: boolean
  sportsSourceCandidate: SportsSourceCandidate | null
}

interface ProcessMarketDataResult {
  eventIdForStatusUpdate: string
  eventIdsForHiddenSync: string[]
  marketChanged: boolean
  urlSetChanged: boolean
}

type MarketMappingDatabase = Pick<typeof db, 'insert' | 'select' | 'update'>

class RetryableMarketSyncError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause })
    this.name = 'RetryableMarketSyncError'
  }
}

export function resolveAdditionalContextUpdatedAtIso(params: {
  hasAdditionalContextField: boolean
  hasAdditionalContextTimeField: boolean
  additionalContext: string | null
  additionalContextUpdatedAtIso: string | null
  existingAdditionalContextUpdatedAtIso?: string | null
}): string | null {
  const {
    hasAdditionalContextField,
    hasAdditionalContextTimeField,
    additionalContext,
    additionalContextUpdatedAtIso,
    existingAdditionalContextUpdatedAtIso = null,
  } = params

  if (hasAdditionalContextTimeField) {
    return additionalContextUpdatedAtIso
  }

  if (hasAdditionalContextField) {
    return additionalContext ? existingAdditionalContextUpdatedAtIso : null
  }

  return existingAdditionalContextUpdatedAtIso
}

const PNL_CONDITIONS_PAGE_QUERY = `
  query PnlConditionsPage($creators: [String!]!, $pageSize: Int!, $minCreationTimestamp: BigInt!) {
    conditions(
      first: $pageSize
      orderBy: updatedAt
      orderDirection: asc
      where: {
        and: [
          { creator_in: $creators }
          { creationTimestamp_gte: $minCreationTimestamp }
        ]
      }
    ) {
      id
      oracle
      questionId
      resolved
      metadataHash
      creator
      creationTimestamp
      updatedAt
    }
  }
`

const PNL_CONDITIONS_PAGE_SINCE_QUERY = `
  query PnlConditionsPage(
    $creators: [String!]!
    $pageSize: Int!
    $lastUpdatedAt: BigInt!
    $lastConditionId: String!
  ) {
    conditions(
      first: $pageSize
      orderBy: updatedAt
      orderDirection: asc
      where: {
        and: [
          { creator_in: $creators }
          {
            or: [
              { updatedAt_gt: $lastUpdatedAt }
              {
                and: [
                  { updatedAt: $lastUpdatedAt }
                  { id_gt: $lastConditionId }
                ]
              }
            ]
          }
        ]
      }
    ) {
      id
      oracle
      questionId
      resolved
      metadataHash
      creator
      creationTimestamp
      updatedAt
    }
  }
`

const PNL_CONDITIONS_PAGE_SINCE_WITH_CUTOFF_QUERY = `
  query PnlConditionsPage(
    $creators: [String!]!
    $pageSize: Int!
    $lastUpdatedAt: BigInt!
    $lastConditionId: String!
    $minCreationTimestamp: BigInt!
  ) {
    conditions(
      first: $pageSize
      orderBy: updatedAt
      orderDirection: asc
      where: {
        and: [
          { creator_in: $creators }
          { creationTimestamp_gte: $minCreationTimestamp }
          {
            or: [
              { updatedAt_gt: $lastUpdatedAt }
              {
                and: [
                  { updatedAt: $lastUpdatedAt }
                  { id_gt: $lastConditionId }
                ]
              }
            ]
          }
        ]
      }
    ) {
      id
      oracle
      questionId
      resolved
      metadataHash
      creator
      creationTimestamp
      updatedAt
    }
  }
`

async function getAllowedCreators(): Promise<string[]> {
  const { data, error } = await loadAllowedMarketCreatorWallets()
  if (error || !data) {
    throw new Error(error ?? 'Failed to load allowed market creators.')
  }

  return data
}

function shouldForceCreatorSourceRefresh(request: Request) {
  const searchParams = new URL(request.url).searchParams
  const rawValue = searchParams.get('refreshCreatorSources')
  return rawValue === '1' || rawValue === 'true'
}

async function refreshCreatorSourcesBeforeSync(force: boolean) {
  try {
    const result = await refreshAllowedMarketCreatorSiteSources({ force })
    if (result.checked > 0 || result.errors.length > 0) {
      console.log('🔄 Allowed market creator source refresh:', result)
    }
    return result
  } catch (error) {
    console.error('Failed to refresh allowed market creator sources:', error)
    return null
  }
}

/**
 * 🔄 Market Synchronization Script for Vercel Functions
 *
 * This function syncs prediction markets from the Goldsky PnL subgraph:
 * - Fetches new markets from blockchain via subgraph (INCREMENTAL)
 * - Downloads metadata and images from Irys
 * - Stores everything in the database and configured object storage
 */
export async function GET(request: Request) {
  const requestStartedAt = Date.now()

  return handleCronRoute({
    request,
    jobName: 'market-sync',
    handler: async () => {
      const lockAcquired = await tryAcquireSyncLock(MARKET_SYNC_STATE)
      if (!lockAcquired) {
        console.log('🚫 Sync already running, skipping...')
        return buildSyncAlreadyRunningResponse()
      }

      console.log('🚀 Starting incremental market synchronization...')

      const forceCreatorSourceRefresh = shouldForceCreatorSourceRefresh(request)
      const creatorSourceRefreshPromise = refreshCreatorSourcesBeforeSync(forceCreatorSourceRefresh)
      const autoDeployNewEventsPromise = loadAutoDeployNewEventsEnabled()
      const cursorState = await getPnLCursorState()
      const lastCursor = cursorState?.cursor ?? null
      const initialCreationTimestamp =
        cursorState?.initialCreationTimestamp ?? (lastCursor ? null : resolveMinCreationTimestamp())

      if (lastCursor) {
        console.log(
          `📊 Last PnL cursor: ${lastCursor.conditionId} @ ${new Date(lastCursor.updatedAt * 1000).toISOString()}`,
        )
        if (initialCreationTimestamp != null) {
          console.log(
            `📅 Resuming initial PnL sync with creation cutoff ${new Date(initialCreationTimestamp * 1000).toISOString()}`,
          )
        }
      } else {
        console.log('📊 Last PnL cursor: none (initial sync)')
        if (initialCreationTimestamp != null) {
          console.log(
            `📅 Initial PnL creation cutoff: ${new Date(initialCreationTimestamp * 1000).toISOString()} (${INITIAL_MARKET_LOOKBACK_DAYS}-day lookback)`,
          )
        }
      }

      await creatorSourceRefreshPromise
      const [allowedCreators, autoDeployNewEvents] = await Promise.all([
        getAllowedCreators(),
        autoDeployNewEventsPromise,
      ])
      const syncResult = await syncMarkets(
        new Set(allowedCreators),
        { autoDeployNewEvents },
        lastCursor,
        initialCreationTimestamp,
        requestStartedAt,
      )

      await updateSyncStatus({
        ...MARKET_SYNC_STATE,
        status: 'completed',
        errorMessage: null,
        totalProcessed: syncResult.processedCount,
      })

      if (syncResult.fetchedCount === 0) {
        console.log('📭 No markets fetched from PnL subgraph')
        return {
          success: true,
          message: 'No new markets to process',
          processed: 0,
          fetched: 0,
        }
      }

      const responsePayload = {
        success: true,
        processed: syncResult.processedCount,
        fetched: syncResult.fetchedCount,
        skippedCreators: syncResult.skippedCreatorCount,
        skippedExpired: syncResult.skippedExpiredCount,
        errors: syncResult.errors.length,
        errorDetails: syncResult.errors,
        timeLimitReached: syncResult.timeLimitReached,
      }

      console.log('🎉 Incremental synchronization completed:', responsePayload)
      return responsePayload
    },
    onError: async (error) => {
      console.error('💥 Sync failed:', error)
      await updateSyncStatus({
        ...MARKET_SYNC_STATE,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      })

      return buildCronErrorResponse(error)
    },
  })
}

async function syncMarkets(
  allowedCreators: Set<string>,
  options: SyncOptions,
  initialCursor: SyncCursor | null,
  initialCreationTimestamp: number | null,
  requestStartedAt: number,
): Promise<SyncStats> {
  const trackedCreators = Array.from(allowedCreators)
    .map((creator) => creator.trim().toLowerCase())
    .filter(Boolean)

  if (trackedCreators.length === 0) {
    return {
      fetchedCount: 0,
      processedCount: 0,
      skippedCreatorCount: 0,
      skippedExpiredCount: 0,
      errors: [],
      timeLimitReached: false,
    }
  }

  let cursor = initialCursor

  if (cursor) {
    const cursorIso = new Date(cursor.updatedAt * 1000).toISOString()
    console.log(`⏱️ Resuming sync after condition ${cursor.conditionId} (updated at ${cursorIso})`)
  } else {
    console.log(`📥 No existing cursor found, starting ${INITIAL_MARKET_LOOKBACK_DAYS}-day initial sync`)
  }

  let fetchedCount = 0
  let processedCount = 0
  let skippedCreatorCount = 0
  let skippedExpiredCount = 0
  let translationSourceChanged = false
  let initialScanExhausted = false
  const errors: { conditionId: string; error: string }[] = []
  let timeLimitReached = false
  const eventIdsNeedingStatusUpdate = new Set<string>()
  const eventIdsNeedingCacheInvalidation = new Set<string>()
  const seriesSlugsNeedingCacheInvalidation = new Set<string>()
  let shouldInvalidateListCache = false
  let shouldInvalidateSitemap = false
  const runtimeState: SyncRuntimeState = {
    eventTagSlugsByEventId: new Map(),
  }

  while (Date.now() - requestStartedAt < SYNC_TIME_LIMIT_MS) {
    const page = await fetchPnLConditionsPage(trackedCreators, cursor, initialCreationTimestamp)

    if (page.conditions.length === 0) {
      console.log('📦 PnL subgraph returned no additional conditions')
      initialScanExhausted = true
      if (initialCreationTimestamp != null && !cursor) {
        cursor = {
          updatedAt: initialCreationTimestamp,
          conditionId: `0x${'0'.repeat(64)}`,
        }
      }
      break
    }

    fetchedCount += page.conditions.length
    console.log(`📑 Processing ${page.conditions.length} conditions (running total fetched: ${fetchedCount})`)

    let lastPersistableCursor: SyncCursor | null = null

    for (const condition of page.conditions) {
      const updatedAt = Number(condition.updatedAt)
      if (Number.isNaN(updatedAt)) {
        console.error(`⚠️ Skipping condition ${condition.id} - invalid updatedAt: ${condition.updatedAt}`)
        continue
      }

      const conditionCursor: SyncCursor = {
        conditionId: condition.id,
        updatedAt,
      }

      if (!condition.creator) {
        console.error(`⚠️ Skipping condition ${condition.id} - missing creator field`)
        lastPersistableCursor = conditionCursor
        continue
      }

      const creatorAddress = condition.creator.toLowerCase()
      if (!allowedCreators.has(creatorAddress)) {
        skippedCreatorCount++
        console.log(`🚫 Skipping market ${condition.id} - creator ${condition.creator} not in allowed list`)
        lastPersistableCursor = conditionCursor
        continue
      }

      if (Date.now() - requestStartedAt >= SYNC_TIME_LIMIT_MS) {
        console.warn('⏹️ Time limit reached during market processing, aborting sync loop')
        timeLimitReached = true
        break
      }

      try {
        const processResult = await processMarket(condition, options, runtimeState)
        if (processResult.skippedExpired) {
          skippedExpiredCount++
          lastPersistableCursor = conditionCursor
          console.log(`⌛ Skipped expired market: ${condition.id}`)
          continue
        }
        translationSourceChanged ||= processResult.translationSourceChanged
        if (processResult.eventIdForStatusUpdate && processResult.changed) {
          eventIdsNeedingStatusUpdate.add(processResult.eventIdForStatusUpdate)
        }
        if (processResult.changed) {
          for (const eventId of processResult.eventIdsForCacheInvalidation) {
            eventIdsNeedingCacheInvalidation.add(eventId)
          }
          for (const seriesSlug of processResult.seriesSlugsForCacheInvalidation) {
            seriesSlugsNeedingCacheInvalidation.add(seriesSlug)
          }
        }
        if (processResult.listAffectingChange) {
          shouldInvalidateListCache = true
        }
        if (processResult.urlSetChanged) {
          shouldInvalidateSitemap = true
        }
        processedCount++
        lastPersistableCursor = conditionCursor
        console.log(`✅ Processed market: ${condition.id}`)
      } catch (error: any) {
        console.error(`❌ Error processing market ${condition.id}:`, error)
        if (error instanceof RetryableMarketSyncError) {
          throw error
        }
        errors.push({
          conditionId: condition.id,
          error: error.message ?? String(error),
        })
        // Prevent a single malformed condition from blocking future pages forever.
        lastPersistableCursor = conditionCursor
      }
    }

    if (lastPersistableCursor) {
      await updatePnLCursor(lastPersistableCursor, initialCreationTimestamp)
      cursor = lastPersistableCursor
    } else if (!timeLimitReached) {
      // Avoid stalling forever if an entire page cannot be processed.
      const lastConditionInPage = page.conditions.at(-1)
      const pageEndTimestamp = Number(lastConditionInPage?.updatedAt)
      if (!lastConditionInPage || Number.isNaN(pageEndTimestamp)) {
        break
      }
      const pageEndCursor = {
        updatedAt: pageEndTimestamp,
        conditionId: lastConditionInPage.id,
      }
      await updatePnLCursor(pageEndCursor, initialCreationTimestamp)
      cursor = pageEndCursor
    }

    if (eventIdsNeedingStatusUpdate.size > 0) {
      const eventIdsToRefresh = Array.from(eventIdsNeedingStatusUpdate)
      const changedEventIds = await updateEventStatusesFromMarketsBatch(eventIdsToRefresh)
      for (const changedEventId of changedEventIds) {
        eventIdsNeedingCacheInvalidation.add(changedEventId)
      }
      if (changedEventIds.length > 0) {
        shouldInvalidateListCache = true
        shouldInvalidateSitemap = true
      }
      eventIdsNeedingStatusUpdate.clear()
    }

    if (timeLimitReached) {
      break
    }

    if (page.conditions.length < PNL_PAGE_SIZE) {
      console.log('📭 Last fetched page was smaller than the configured page size; stopping pagination')
      initialScanExhausted = true
      break
    }
  }

  if (eventIdsNeedingStatusUpdate.size > 0) {
    const eventIdsToRefresh = Array.from(eventIdsNeedingStatusUpdate)
    const changedEventIds = await updateEventStatusesFromMarketsBatch(eventIdsToRefresh)
    for (const changedEventId of changedEventIds) {
      eventIdsNeedingCacheInvalidation.add(changedEventId)
    }
    if (changedEventIds.length > 0) {
      shouldInvalidateListCache = true
      shouldInvalidateSitemap = true
    }
    eventIdsNeedingStatusUpdate.clear()
  }

  const missingImageRepair = await repairMissingImageAssets(requestStartedAt + SYNC_HARD_DEADLINE_MS)
  for (const eventId of missingImageRepair.eventIds) {
    eventIdsNeedingCacheInvalidation.add(eventId)
  }
  if (missingImageRepair.repairedCount > 0) {
    shouldInvalidateListCache = true
  }

  if (
    eventIdsNeedingCacheInvalidation.size > 0 ||
    seriesSlugsNeedingCacheInvalidation.size > 0 ||
    shouldInvalidateListCache ||
    shouldInvalidateSitemap
  ) {
    const invalidationSummary = await invalidateEventCaches(Array.from(eventIdsNeedingCacheInvalidation), {
      includeList: shouldInvalidateListCache,
      includeSitemap: shouldInvalidateSitemap,
      seriesSlugs: Array.from(seriesSlugsNeedingCacheInvalidation),
    })
    console.log('🧹 Event cache invalidation summary:', invalidationSummary)
  }

  if (initialCreationTimestamp != null && initialScanExhausted && cursor) {
    await updatePnLCursor(cursor, null)
    console.log('✅ Initial PnL sync completed; future runs will use the incremental cursor')
  }

  // Keep room for this sync request to finish; the discovery cron covers skipped triggers.
  if (
    translationSourceChanged &&
    Date.now() - requestStartedAt < SYNC_HARD_DEADLINE_MS - TRANSLATION_TRIGGER_RESERVE_MS
  ) {
    await triggerTranslationEnqueue()
  }

  return {
    fetchedCount,
    processedCount,
    skippedCreatorCount,
    skippedExpiredCount,
    errors,
    timeLimitReached,
  }
}

function resolveMinCreationTimestamp(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000) - INITIAL_MARKET_LOOKBACK_SECONDS
}

function parsePnLCursorId(
  cursorId: string,
): Pick<PnLCursorState, 'initialCreationTimestamp'> & { conditionId: string } {
  if (!cursorId.startsWith(INITIAL_MARKET_CURSOR_PREFIX)) {
    return { conditionId: cursorId, initialCreationTimestamp: null }
  }

  const encodedState = cursorId.slice(INITIAL_MARKET_CURSOR_PREFIX.length)
  const separatorIndex = encodedState.indexOf(':')
  const initialCreationTimestamp = Number(encodedState.slice(0, separatorIndex))
  const conditionId = encodedState.slice(separatorIndex + 1)
  if (separatorIndex <= 0 || !Number.isSafeInteger(initialCreationTimestamp) || !conditionId) {
    throw new Error('Invalid persisted initial market sync cursor')
  }

  return { conditionId, initialCreationTimestamp }
}

function serializePnLCursorId(conditionId: string, initialCreationTimestamp: number | null) {
  return initialCreationTimestamp == null
    ? conditionId
    : `${INITIAL_MARKET_CURSOR_PREFIX}${initialCreationTimestamp}:${conditionId}`
}

async function getPnLCursorState(): Promise<PnLCursorState | null> {
  const rows = await db
    .select({
      cursor_updated_at: subgraph_syncs.cursor_updated_at,
      cursor_id: subgraph_syncs.cursor_id,
    })
    .from(subgraph_syncs)
    .where(and(eq(subgraph_syncs.service_name, 'market_sync'), eq(subgraph_syncs.subgraph_name, 'pnl')))
    .limit(1)
  const data = rows[0]

  if (!data?.cursor_updated_at || !data?.cursor_id) {
    return null
  }

  const updatedAt = Number(data.cursor_updated_at)
  if (Number.isNaN(updatedAt)) {
    return null
  }

  const parsedCursor = parsePnLCursorId(data.cursor_id)
  return {
    cursor: {
      conditionId: parsedCursor.conditionId,
      updatedAt,
    },
    initialCreationTimestamp: parsedCursor.initialCreationTimestamp,
  }
}

async function updatePnLCursor(cursor: SyncCursor, initialCreationTimestamp: number | null) {
  try {
    const cursorPayload = {
      cursor_updated_at: BigInt(cursor.updatedAt),
      cursor_id: serializePnLCursorId(cursor.conditionId, initialCreationTimestamp),
    }

    const updatedRows = await db
      .update(subgraph_syncs)
      .set(cursorPayload)
      .where(and(eq(subgraph_syncs.service_name, 'market_sync'), eq(subgraph_syncs.subgraph_name, 'pnl')))
      .returning({ id: subgraph_syncs.id })

    if (updatedRows.length === 0) {
      console.error('Failed to update market sync cursor: missing sync state row for market_sync/pnl')
    }
  } catch (error) {
    console.error('Failed to update market sync cursor:', error)
  }
}

async function fetchPnLConditionsPage(
  creators: string[],
  afterCursor: SyncCursor | null,
  initialCreationTimestamp: number | null,
): Promise<{ conditions: SubgraphCondition[] }> {
  if (creators.length === 0) {
    return { conditions: [] }
  }

  let query: string
  let variables: Record<string, string | number | string[]>

  if (!afterCursor) {
    if (initialCreationTimestamp == null) {
      throw new Error('Initial market sync requires a creation timestamp cutoff')
    }

    query = PNL_CONDITIONS_PAGE_QUERY
    variables = {
      creators,
      pageSize: PNL_PAGE_SIZE,
      minCreationTimestamp: initialCreationTimestamp.toString(),
    }
  } else {
    const cursorVariables = {
      creators,
      pageSize: PNL_PAGE_SIZE,
      lastUpdatedAt: afterCursor.updatedAt.toString(),
      lastConditionId: afterCursor.conditionId,
    }

    if (initialCreationTimestamp == null) {
      query = PNL_CONDITIONS_PAGE_SINCE_QUERY
      variables = cursorVariables
    } else {
      query = PNL_CONDITIONS_PAGE_SINCE_WITH_CUTOFF_QUERY
      variables = {
        ...cursorVariables,
        minCreationTimestamp: initialCreationTimestamp.toString(),
      }
    }
  }

  const response = await fetch(getPnlSubgraphUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    throw new Error(`PnL subgraph request failed: ${response.statusText}`)
  }

  const result = await response.json()

  if (result.errors) {
    throw new Error(`PnL subgraph query error: ${result.errors[0].message}`)
  }

  const rawConditions: SubgraphCondition[] = result.data.conditions || []

  const normalizedConditions: SubgraphCondition[] = rawConditions.map((condition) => ({
    ...condition,
    creator: condition.creator ? condition.creator.toLowerCase() : condition.creator,
  }))

  return { conditions: normalizedConditions }
}

async function processMarket(
  market: SubgraphCondition,
  options: SyncOptions,
  runtimeState: SyncRuntimeState,
): Promise<ProcessMarketResult> {
  const timestamps = getMarketTimestamps(market)
  if (!market.metadataHash) {
    throw new Error(`Market ${market.id} missing required metadataHash field`)
  }
  const metadata = await fetchMetadata(market.metadataHash)
  if (isMarketMetadataExpired(metadata) && !(await hasStoredMarket(market.id))) {
    return {
      eventIdForStatusUpdate: null,
      eventIdsForCacheInvalidation: [],
      seriesSlugsForCacheInvalidation: [],
      changed: false,
      translationSourceChanged: false,
      listAffectingChange: false,
      urlSetChanged: false,
      skippedExpired: true,
    }
  }

  const conditionChanged = await processCondition(market, timestamps)
  const eventResult = await processEvent(
    metadata.event,
    metadata.sports?.event,
    metadata.sports?.market,
    metadata,
    market.creator!,
    timestamps.createdAtIso,
    options.autoDeployNewEvents,
    runtimeState,
  )
  const marketResult = await processMarketData(
    market,
    metadata,
    eventResult.eventId,
    timestamps,
    eventResult.sportsSourceCandidate,
  )
  const hiddenSyncResults = await Promise.all(
    marketResult.eventIdsForHiddenSync.map(async (eventId) => ({
      eventId,
      changed: await syncEventHiddenFromArchivedMarkets(eventId),
    })),
  )
  const hiddenChangedEventIds = hiddenSyncResults.filter((result) => result.changed).map((result) => result.eventId)
  const hiddenChanged = hiddenChangedEventIds.length > 0
  const changed = conditionChanged || eventResult.eventChanged || marketResult.marketChanged || hiddenChanged
  const eventIdsForCacheInvalidation = new Set<string>()

  if (conditionChanged || eventResult.eventChanged || marketResult.marketChanged) {
    eventIdsForCacheInvalidation.add(eventResult.eventId)
  }
  for (const eventId of hiddenChangedEventIds) {
    eventIdsForCacheInvalidation.add(eventId)
  }

  return {
    eventIdForStatusUpdate: changed ? marketResult.eventIdForStatusUpdate : null,
    eventIdsForCacheInvalidation: changed ? Array.from(eventIdsForCacheInvalidation) : [],
    seriesSlugsForCacheInvalidation: changed ? eventResult.seriesSlugsForCacheInvalidation : [],
    changed,
    translationSourceChanged: eventResult.translationSourceChanged,
    listAffectingChange: eventResult.listAffectingChange || hiddenChanged,
    urlSetChanged: eventResult.urlSetChanged || marketResult.urlSetChanged,
    skippedExpired: false,
  }
}

export function isMarketMetadataExpired(metadata: any, nowMs = Date.now()) {
  const endTimeIso = normalizeTimestamp(metadata?.end_time) ?? normalizeTimestamp(metadata?.event?.end_time)
  if (!endTimeIso) {
    return false
  }

  return Date.parse(endTimeIso) < nowMs - EXPIRED_MARKET_GRACE_MS
}

async function hasStoredMarket(conditionId: string) {
  const rows = await db
    .select({ condition_id: marketsTable.condition_id })
    .from(marketsTable)
    .where(eq(marketsTable.condition_id, conditionId))
    .limit(1)

  return rows.length > 0
}

async function fetchMetadata(metadataHash: string) {
  const url = `${IRYS_GATEWAY}/${metadataHash}`

  const response = await fetch(url, {
    keepalive: true,
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch metadata from ${url}: ${response.statusText}`)
  }

  const metadata = await response.json()

  if (!metadata.name || !metadata.slug || !metadata.event) {
    throw new Error(`Invalid metadata: missing required fields. Got: ${JSON.stringify(Object.keys(metadata))}`)
  }

  return metadata
}

async function syncEventHiddenFromArchivedMarkets(eventId: string): Promise<boolean> {
  const [marketRows, eventRows] = await Promise.all([
    db.select({ metadata: marketsTable.metadata }).from(marketsTable).where(eq(marketsTable.event_id, eventId)),
    db.select({ is_hidden: eventsTable.is_hidden }).from(eventsTable).where(eq(eventsTable.id, eventId)).limit(1),
  ])

  const shouldHide = marketRows.some((row) => resolveStoredMetadataStatusFlag(row.metadata, ['archived'], false))
  const currentHidden = Boolean(eventRows[0]?.is_hidden)

  if (currentHidden === shouldHide) {
    return false
  }

  await db.update(eventsTable).set({ is_hidden: shouldHide, updated_at: new Date() }).where(eq(eventsTable.id, eventId))

  return true
}

async function processCondition(market: SubgraphCondition, timestamps: MarketTimestamps): Promise<boolean> {
  if (!market.oracle) {
    throw new Error(`Market ${market.id} missing required oracle field`)
  }

  if (!market.questionId) {
    throw new Error(`Market ${market.id} missing required questionId field`)
  }

  if (!market.creator) {
    throw new Error(`Market ${market.id} missing required creator field`)
  }

  if (!market.metadataHash) {
    throw new Error(`Market ${market.id} missing required metadataHash field`)
  }

  const resolutionPayload = market.resolved
    ? {
        resolution_status: 'resolved' as const,
      }
    : {}

  const payload = {
    id: market.id,
    oracle: market.oracle,
    question_id: market.questionId,
    resolved: market.resolved,
    metadata_hash: market.metadataHash,
    creator: market.creator!,
    created_at: new Date(timestamps.createdAtIso),
    updated_at: new Date(timestamps.updatedAtIso),
    ...resolutionPayload,
  }

  const existingConditionRows = await db
    .select({
      oracle: conditionsTable.oracle,
      question_id: conditionsTable.question_id,
      resolved: conditionsTable.resolved,
      metadata_hash: conditionsTable.metadata_hash,
      creator: conditionsTable.creator,
      updated_at: conditionsTable.updated_at,
    })
    .from(conditionsTable)
    .where(eq(conditionsTable.id, market.id))
    .limit(1)

  const existingCondition = existingConditionRows[0]
  const incomingUpdatedAtMs = Date.parse(timestamps.updatedAtIso)
  const existingUpdatedAtMs = existingCondition?.updated_at
    ? new Date(existingCondition.updated_at).getTime()
    : Number.NaN

  const hasConditionChange =
    !existingCondition ||
    !Number.isFinite(existingUpdatedAtMs) ||
    incomingUpdatedAtMs > existingUpdatedAtMs ||
    existingCondition.oracle !== market.oracle ||
    existingCondition.question_id !== market.questionId ||
    existingCondition.resolved !== market.resolved ||
    existingCondition.metadata_hash !== market.metadataHash ||
    existingCondition.creator !== market.creator

  if (!hasConditionChange) {
    return false
  }

  await db
    .insert(conditionsTable)
    .values(payload)
    .onConflictDoUpdate({
      target: [conditionsTable.id],
      set: payload,
    })

  console.log(`Processed condition: ${market.id}`)
  return true
}

function normalizeTimestamp(rawValue: unknown): string | null {
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim()
    if (trimmed) {
      const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
        ? `${trimmed.replace(' ', 'T')}Z`
        : trimmed
      const parsed = new Date(normalized)
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString()
      }
    }
  }

  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    // Handle Unix seconds or milliseconds
    const timestamp = rawValue > 10_000_000_000 ? rawValue : rawValue * 1000
    const parsed = new Date(timestamp)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }

  return null
}

function resolveEventStartTimestamp(sportsEventData: any, sportsMarketData: any): string | null {
  return (
    normalizeTimestamp(sportsEventData?.start_time) ??
    normalizeTimestamp(sportsMarketData?.game_start_time) ??
    normalizeTimestamp(sportsMarketData?.start_time)
  )
}

async function processEvent(
  eventData: any,
  sportsEventData: any,
  sportsMarketData: any,
  metadata: any,
  creatorAddress: string,
  createdAtIso: string,
  autoDeployNewEvents: boolean,
  runtimeState: SyncRuntimeState,
): Promise<ProcessEventResult> {
  if (!eventData || !eventData.slug || !eventData.title) {
    throw new Error(`Invalid event data: ${JSON.stringify(eventData)}`)
  }

  const eventSlug = String(eventData.slug).trim()
  if (!eventSlug) {
    throw new Error(`Invalid event slug: ${eventData.slug}`)
  }

  const normalizedEventTitle = String(eventData.title).trim()
  if (!normalizedEventTitle) {
    throw new Error(`Invalid event title for slug ${eventSlug}`)
  }

  const normalizedEndDate = normalizeTimestamp(eventData.end_time)
  const enableNegRiskFlag = normalizeBooleanField(eventData.enable_neg_risk)
  const negRiskAugmentedFlag = normalizeBooleanField(eventData.neg_risk_augmented)
  const eventNegRiskFlag = normalizeBooleanField(eventData.neg_risk)
  const eventNegRiskMarketId = normalizeHexField(eventData.neg_risk_market_id)
  const eventSeriesSlug = normalizeStringField(eventData.series_slug)
  const eventSeriesId = normalizeStringField(eventData.series_id)
  const eventSeriesRecurrence =
    normalizeStringField(eventData.series_recurrence) ?? normalizeStringField(eventData.recurrence)
  const isPolymarketMirror = Boolean(
    normalizeStringField(metadata?.mirror_condition_id) &&
    (Array.isArray(metadata?.mirror_outcome_token_ids) ||
      normalizeStringField(metadata?.mirror_protocol)?.toLowerCase() === 'polyv2'),
  )
  const hasAdditionalContextField = Object.hasOwn(eventData, 'additional_context')
  const hasAdditionalContextTimeField =
    Object.hasOwn(eventData, 'additional_context_time') || Object.hasOwn(eventData, 'additional_context_updated_at')
  const additionalContext = hasAdditionalContextField ? normalizeStringField(eventData.additional_context) : null
  const additionalContextUpdatedAtIso = hasAdditionalContextTimeField
    ? normalizeTimestamp(eventData.additional_context_time ?? eventData.additional_context_updated_at)
    : null
  const nextAdditionalContextUpdatedAtIso = resolveAdditionalContextUpdatedAtIso({
    hasAdditionalContextField,
    hasAdditionalContextTimeField,
    additionalContext,
    additionalContextUpdatedAtIso,
  })
  const sportsEventId = normalizeStringField(sportsEventData?.event_id)
  const sportsEventSlug = normalizeStringField(sportsEventData?.slug)
  const sportsParentEventId = normalizeIntegerField(sportsEventData?.parent_event_id)
  const sportsGameId = normalizeIntegerField(sportsEventData?.game_id)
  const sportsEventDate = normalizeDateField(sportsEventData?.event_date)
  let sportsStartTime = resolveEventStartTimestamp(sportsEventData, sportsMarketData)
  const sportsSeriesSlug = normalizeStringField(sportsEventData?.series_slug)
  const sportsSeriesId = normalizeStringField(sportsEventData?.series_id)
  const sportsSeriesRecurrence = normalizeStringField(sportsEventData?.series_recurrence)
  const sportsSeriesColor = normalizeStringField(sportsEventData?.series_color)
  let sportsSportSlug = normalizeStringField(sportsEventData?.sport_slug)
  let sportsLeagueLabel =
    normalizeStringField(eventData.league) ??
    normalizeStringField(sportsEventData?.league) ??
    normalizeStringField(sportsEventData?.league_label) ??
    normalizeStringField(sportsEventData?.source_league_label)
  let sportsLeagueSlug =
    normalizeStringField(sportsEventData?.league_slug) ??
    (sportsLeagueLabel ? slugifyText(sportsLeagueLabel) || null : null)
  const sportsEventWeek = normalizeIntegerField(sportsEventData?.event_week)
  const sportsScore = normalizeStringField(sportsEventData?.score)
  const sportsPeriod = normalizeStringField(sportsEventData?.period)
  const sportsElapsed = normalizeStringField(sportsEventData?.elapsed)
  const sportsLive = normalizeOptionalBooleanField(sportsEventData?.live)
  const sportsEnded = normalizeOptionalBooleanField(sportsEventData?.ended)
  const sportsTags = normalizeStringArrayField(sportsEventData?.tags)
  let sportsSourceProvider = normalizeSingleSportsSourceProvider(normalizeStringField(sportsEventData?.source_provider))
  let sportsSourceEventId = normalizeStringIdField(sportsEventData?.source_event_id)
  let sportsSourceGameId = normalizeStringIdField(sportsEventData?.source_game_id)
  let sportsSourceLeagueId = normalizeStringIdField(sportsEventData?.source_league_id)
  let sportsSourceLeagueLabel = normalizeStringField(sportsEventData?.source_league_label)
  let sportsSourceMatchConfidence = normalizeConfidenceField(sportsEventData?.source_match_confidence)
  let sportsSourcePayload = normalizeObjectField(sportsEventData?.source_payload)
  let incomingLivestreamUrl = normalizeLivestreamUrl(
    eventData.livestream_url ??
      eventData.livestream ??
      sportsEventData?.livestream_url ??
      sportsEventData?.livestreamUrl ??
      sportsEventData?.stream_url ??
      sportsEventData?.streamUrl,
  )
  const normalizedEventTags = normalizeIncomingTags([
    ...(Array.isArray(eventData.tags) ? eventData.tags : []),
    ...(sportsEventData || sportsMarketData ? ['Sports'] : []),
    ...(sportsTags ?? []),
  ])
  let normalizedSportsTeams = normalizeSportsTeamsField(sportsEventData?.teams)
  const existingEventRows = await db
    .select({
      id: eventsTable.id,
      title: eventsTable.title,
      start_date: eventsTable.start_date,
      end_date: eventsTable.end_date,
      created_at: eventsTable.created_at,
      icon_url: eventsTable.icon_url,
      additional_context: eventsTable.additional_context,
      additional_context_updated_at: eventsTable.additional_context_updated_at,
      enable_neg_risk: eventsTable.enable_neg_risk,
      neg_risk_augmented: eventsTable.neg_risk_augmented,
      neg_risk: eventsTable.neg_risk,
      neg_risk_market_id: eventsTable.neg_risk_market_id,
      series_slug: eventsTable.series_slug,
      series_id: eventsTable.series_id,
      series_recurrence: eventsTable.series_recurrence,
      livestream_url: eventsTable.livestream_url,
      is_polymarket_mirror: eventsTable.is_polymarket_mirror,
    })
    .from(eventsTable)
    .where(eq(eventsTable.slug, eventSlug))
    .limit(1)
  const existingEvent = existingEventRows[0]
  const existingEventSportsRows = existingEvent
    ? await db
        .select({
          sports_source_provider: eventSportsTable.sports_source_provider,
          sports_source_event_id: eventSportsTable.sports_source_event_id,
          sports_source_game_id: eventSportsTable.sports_source_game_id,
          sports_source_league_id: eventSportsTable.sports_source_league_id,
          sports_source_league_label: eventSportsTable.sports_source_league_label,
          sports_source_match_confidence: eventSportsTable.sports_source_match_confidence,
          sports_source_payload: eventSportsTable.sports_source_payload,
          sports_source_selected_at: eventSportsTable.sports_source_selected_at,
        })
        .from(eventSportsTable)
        .where(eq(eventSportsTable.event_id, existingEvent.id))
        .limit(1)
    : []
  const existingEventSports = existingEventSportsRows[0]
  const existingSportsSourceProvider = normalizeSingleSportsSourceProvider(
    existingEventSports?.sports_source_provider ?? null,
  )
  const hasStoredSportsSourceIdentity = Boolean(
    existingSportsSourceProvider &&
    (existingEventSports.sports_source_event_id || existingEventSports.sports_source_game_id),
  )
  const sportsSourceCandidate = await maybeInferSportsSourceCandidate({
    metadata,
    eventData,
    sportsEventData,
    sportsMarketData,
    normalizedEventTags,
    teams: normalizedSportsTeams,
    hasSourceIdentity: Boolean(sportsSourceEventId || sportsSourceGameId || hasStoredSportsSourceIdentity),
    eventTitle: normalizedEventTitle,
    eventSlug,
    eventDate: normalizedEventTags.has('esports')
      ? (sportsStartTime ?? sportsEventDate ?? normalizedEndDate)
      : (sportsEventDate ?? sportsStartTime ?? normalizedEndDate),
    runtimeState,
  })
  if (sportsSourceCandidate) {
    sportsSourceProvider = sportsSourceProvider ?? sportsSourceCandidate.provider
    sportsSourceEventId = sportsSourceEventId ?? sportsSourceCandidate.eventId
    sportsSourceGameId = sportsSourceGameId ?? sportsSourceCandidate.gameId
    sportsSourceLeagueId = sportsSourceLeagueId ?? sportsSourceCandidate.leagueId
    sportsSourceLeagueLabel = sportsSourceLeagueLabel ?? sportsSourceCandidate.leagueName
    sportsSourceMatchConfidence =
      sportsSourceMatchConfidence ?? formatSportsSourceConfidence(sportsSourceCandidate.confidence)
    sportsSourcePayload = sportsSourcePayload ?? buildSportsSourcePayload(sportsSourceCandidate, 'automatic')
    sportsStartTime = sportsStartTime ?? sportsSourceCandidate.startTime
    sportsSportSlug = sportsSportSlug ?? sportsSourceCandidate.sportSlug
    sportsLeagueLabel = sportsLeagueLabel ?? sportsSourceCandidate.leagueName
    sportsLeagueSlug =
      sportsLeagueSlug ??
      sportsSourceCandidate.leagueSlug ??
      (sportsSourceCandidate.leagueName ? slugifyText(sportsSourceCandidate.leagueName) || null : null)
    incomingLivestreamUrl = incomingLivestreamUrl ?? sportsSourceCandidate.livestreamUrl
    normalizedSportsTeams = normalizedSportsTeams ?? buildSportsSourceTeamRecords(sportsSourceCandidate)
  }
  if (existingEventSports) {
    const mergedSportsSource = mergeSportsSourceFieldsWithExisting({
      current: {
        provider: sportsSourceProvider,
        eventId: sportsSourceEventId,
        gameId: sportsSourceGameId,
        leagueId: sportsSourceLeagueId,
        leagueLabel: sportsSourceLeagueLabel,
        matchConfidence: sportsSourceMatchConfidence,
        payload: sportsSourcePayload,
      },
      existing: existingEventSports,
    })
    sportsSourceProvider = mergedSportsSource.provider
    sportsSourceEventId = mergedSportsSource.eventId
    sportsSourceGameId = mergedSportsSource.gameId
    sportsSourceLeagueId = mergedSportsSource.leagueId
    sportsSourceLeagueLabel = mergedSportsSource.leagueLabel
    sportsSourceMatchConfidence = mergedSportsSource.matchConfidence
    sportsSourcePayload = mergedSportsSource.payload
  }
  const sportsSourceSelectedAt =
    sportsSourceProvider || sportsSourceEventId || sportsSourceGameId
      ? (existingEventSports?.sports_source_selected_at ?? new Date())
      : null
  const sportsAssets = await normalizeSportsTeamAssets(normalizedSportsTeams)
  const sportsTeams = sportsAssets.teams
  const sportsTeamLogoUrls = sportsAssets.logo_urls

  if (existingEvent) {
    const updatePayload: Record<string, any> = {}
    let eventChanged = false
    let translationSourceChanged = false
    let listAffectingChange = false

    const incomingEventIconReference = normalizeAssetReference(eventData.icon)
    const incomingEventStableIconReference = resolveStableAssetReference(eventData.icon)
    const incomingEventIconPath = incomingEventIconReference
      ? buildCanonicalIconStoragePath(
          incomingEventIconReference,
          `events/icons/${normalizeStorageSlug(eventSlug, `${normalizedEventTitle}:${creatorAddress}`)}`,
        )
      : null
    if (
      incomingEventIconReference &&
      incomingEventStableIconReference &&
      incomingEventIconPath &&
      existingEvent.icon_url !== incomingEventIconPath
    ) {
      const storedIconPath = await downloadAndSaveImage(incomingEventIconReference, incomingEventIconPath)
      if (storedIconPath && storedIconPath !== existingEvent.icon_url) {
        updatePayload.icon_url = storedIconPath
        eventChanged = true
        listAffectingChange = true
      }
    }
    const previousSeriesSlug = existingEvent.series_slug
    const seriesSlugChanged = (existingEvent.series_slug ?? null) !== (eventSeriesSlug ?? null)

    if (existingEvent.enable_neg_risk !== enableNegRiskFlag) {
      updatePayload.enable_neg_risk = enableNegRiskFlag
      eventChanged = true
    }
    if (existingEvent.neg_risk_augmented !== negRiskAugmentedFlag) {
      updatePayload.neg_risk_augmented = negRiskAugmentedFlag
      eventChanged = true
    }
    if (existingEvent.neg_risk !== eventNegRiskFlag) {
      updatePayload.neg_risk = eventNegRiskFlag
      eventChanged = true
    }
    if ((existingEvent.neg_risk_market_id ?? null) !== (eventNegRiskMarketId ?? null)) {
      updatePayload.neg_risk_market_id = eventNegRiskMarketId ?? null
      eventChanged = true
    }
    if (seriesSlugChanged) {
      updatePayload.series_slug = eventSeriesSlug ?? null
      eventChanged = true
    }
    if ((existingEvent.series_id ?? null) !== (eventSeriesId ?? null)) {
      updatePayload.series_id = eventSeriesId ?? null
      eventChanged = true
    }
    if ((existingEvent.series_recurrence ?? null) !== (eventSeriesRecurrence ?? null)) {
      updatePayload.series_recurrence = eventSeriesRecurrence ?? null
      eventChanged = true
    }
    if (hasAdditionalContextField && (existingEvent.additional_context ?? null) !== (additionalContext ?? null)) {
      updatePayload.additional_context = additionalContext ?? null
      eventChanged = true
    }
    if (hasAdditionalContextField || hasAdditionalContextTimeField) {
      const existingAdditionalContextUpdatedAtIso = existingEvent.additional_context_updated_at?.toISOString() ?? null
      const mergedAdditionalContextUpdatedAtIso = resolveAdditionalContextUpdatedAtIso({
        hasAdditionalContextField,
        hasAdditionalContextTimeField,
        additionalContext,
        additionalContextUpdatedAtIso,
        existingAdditionalContextUpdatedAtIso,
      })
      if (existingAdditionalContextUpdatedAtIso !== mergedAdditionalContextUpdatedAtIso) {
        updatePayload.additional_context_updated_at = mergedAdditionalContextUpdatedAtIso
          ? new Date(mergedAdditionalContextUpdatedAtIso)
          : null
        eventChanged = true
      }
    }

    if (existingEvent.title !== normalizedEventTitle) {
      updatePayload.title = normalizedEventTitle
      eventChanged = true
      translationSourceChanged = true
      listAffectingChange = true
    }

    const existingCreatedAtMs = existingEvent.created_at ? new Date(existingEvent.created_at).getTime() : Number.NaN
    const incomingCreatedAtMs = Date.parse(createdAtIso)
    if (
      !Number.isNaN(incomingCreatedAtMs) &&
      (Number.isNaN(existingCreatedAtMs) || incomingCreatedAtMs < existingCreatedAtMs)
    ) {
      updatePayload.created_at = new Date(createdAtIso)
      eventChanged = true
      listAffectingChange = true
    }

    const existingEndDateIso = existingEvent.end_date?.toISOString() ?? null
    if (normalizedEndDate && normalizedEndDate !== existingEndDateIso) {
      updatePayload.end_date = new Date(normalizedEndDate)
      eventChanged = true
      listAffectingChange = true
    }

    const existingStartDateIso = existingEvent.start_date?.toISOString() ?? null
    if (sportsStartTime && sportsStartTime !== existingStartDateIso) {
      updatePayload.start_date = new Date(sportsStartTime)
      eventChanged = true
      listAffectingChange = true
    }
    if (incomingLivestreamUrl && !(existingEvent.livestream_url ?? '').trim()) {
      updatePayload.livestream_url = incomingLivestreamUrl
      eventChanged = true
    }

    if (Object.keys(updatePayload).length > 0) {
      try {
        await db.update(eventsTable).set(updatePayload).where(eq(eventsTable.id, existingEvent.id))
      } catch (updateError) {
        console.error(`Failed to update event ${existingEvent.id}:`, updateError)
      }
    }

    if (normalizedEventTags.size > 0) {
      const existingEventTagSlugs = await loadEventTagSlugs(existingEvent.id, runtimeState)
      const normalizedTagsChanged = await processNormalizedTags(existingEvent.id, normalizedEventTags)
      if (normalizedTagsChanged) {
        eventChanged = true
        translationSourceChanged = true
        listAffectingChange = true

        for (const slug of normalizedEventTags.keys()) {
          existingEventTagSlugs.add(slug)
        }
      }
    }

    await upsertEventSportsMetadata(existingEvent.id, {
      sports_event_id: sportsEventId,
      sports_event_slug: sportsEventSlug,
      sports_parent_event_id: sportsParentEventId,
      sports_game_id: sportsGameId,
      sports_event_date: sportsEventDate,
      sports_start_time: sportsStartTime ? new Date(sportsStartTime) : null,
      sports_series_slug: sportsSeriesSlug,
      sports_series_id: sportsSeriesId,
      sports_series_recurrence: sportsSeriesRecurrence,
      sports_series_color: sportsSeriesColor,
      sports_sport_slug: sportsSportSlug,
      sports_league_label: sportsLeagueLabel,
      sports_league_slug: sportsLeagueSlug,
      sports_event_week: sportsEventWeek,
      sports_score: sportsScore,
      sports_period: sportsPeriod,
      sports_elapsed: sportsElapsed,
      sports_live: sportsLive,
      sports_ended: sportsEnded,
      sports_tags: sportsTags,
      sports_teams: sportsTeams,
      sports_team_logo_urls: sportsTeamLogoUrls,
      sports_source_provider: sportsSourceProvider,
      sports_source_event_id: sportsSourceEventId,
      sports_source_game_id: sportsSourceGameId,
      sports_source_league_id: sportsSourceLeagueId,
      sports_source_league_label: sportsSourceLeagueLabel,
      sports_source_match_confidence: sportsSourceMatchConfidence,
      sports_source_payload: sportsSourcePayload,
      sports_source_selected_at: sportsSourceSelectedAt,
    })

    console.log(`Event ${eventSlug} already exists, using existing ID: ${existingEvent.id}`)
    return {
      eventId: existingEvent.id,
      eventChanged,
      translationSourceChanged,
      seriesSlugsForCacheInvalidation: seriesSlugChanged
        ? getSeriesSlugsForCacheInvalidation(previousSeriesSlug, eventSeriesSlug)
        : [],
      listAffectingChange,
      urlSetChanged: false,
      sportsSourceCandidate,
    }
  }

  let iconUrl: string | null = null
  if (eventData.icon) {
    const eventIconSlug = normalizeStorageSlug(eventSlug, `${eventData.title ?? 'event'}:${creatorAddress}`)
    iconUrl = await downloadAndSaveImage(
      eventData.icon,
      buildCanonicalIconStoragePath(eventData.icon, `events/icons/${eventIconSlug}`),
    )
  }

  console.log(`Creating new event: ${eventSlug} by creator: ${creatorAddress}`)

  const newEventPayload: typeof eventsTable.$inferInsert = {
    slug: eventSlug,
    title: normalizedEventTitle,
    creator: creatorAddress,
    icon_url: iconUrl,
    show_market_icons: eventData.show_market_icons !== false,
    is_polymarket_mirror: isPolymarketMirror,
    enable_neg_risk: enableNegRiskFlag,
    neg_risk_augmented: negRiskAugmentedFlag,
    neg_risk: eventNegRiskFlag,
    neg_risk_market_id: eventNegRiskMarketId ?? null,
    series_slug: eventSeriesSlug ?? null,
    series_id: eventSeriesId ?? null,
    series_recurrence: eventSeriesRecurrence ?? null,
    additional_context: additionalContext ?? null,
    additional_context_updated_at: nextAdditionalContextUpdatedAtIso
      ? new Date(nextAdditionalContextUpdatedAtIso)
      : null,
    livestream_url: incomingLivestreamUrl,
    rules: eventData.rules || null,
    start_date: sportsStartTime ? new Date(sportsStartTime) : null,
    end_date: normalizedEndDate ? new Date(normalizedEndDate) : null,
    created_at: new Date(createdAtIso),
  }

  const newEventRows = await db.insert(eventsTable).values(newEventPayload).returning({ id: eventsTable.id })
  const newEvent = newEventRows[0]

  if (!newEvent?.id) {
    throw new Error(`Event creation failed: no ID returned`)
  }

  console.log(`Created event ${eventSlug} with ID: ${newEvent.id}`)

  if (normalizedEventTags.size > 0) {
    await processNormalizedTags(newEvent.id, normalizedEventTags)
    runtimeState.eventTagSlugsByEventId.set(newEvent.id, new Set(normalizedEventTags.keys()))
  }

  if (!autoDeployNewEvents) {
    await setEventHiddenFromNew(newEvent.id, true)
  }

  await upsertEventSportsMetadata(newEvent.id, {
    sports_event_id: sportsEventId,
    sports_event_slug: sportsEventSlug,
    sports_parent_event_id: sportsParentEventId,
    sports_game_id: sportsGameId,
    sports_event_date: sportsEventDate,
    sports_start_time: sportsStartTime ? new Date(sportsStartTime) : null,
    sports_series_slug: sportsSeriesSlug,
    sports_series_id: sportsSeriesId,
    sports_series_recurrence: sportsSeriesRecurrence,
    sports_series_color: sportsSeriesColor,
    sports_sport_slug: sportsSportSlug,
    sports_league_label: sportsLeagueLabel,
    sports_league_slug: sportsLeagueSlug,
    sports_event_week: sportsEventWeek,
    sports_score: sportsScore,
    sports_period: sportsPeriod,
    sports_elapsed: sportsElapsed,
    sports_live: sportsLive,
    sports_ended: sportsEnded,
    sports_tags: sportsTags,
    sports_teams: sportsTeams,
    sports_team_logo_urls: sportsTeamLogoUrls,
    sports_source_provider: sportsSourceProvider,
    sports_source_event_id: sportsSourceEventId,
    sports_source_game_id: sportsSourceGameId,
    sports_source_league_id: sportsSourceLeagueId,
    sports_source_league_label: sportsSourceLeagueLabel,
    sports_source_match_confidence: sportsSourceMatchConfidence,
    sports_source_payload: sportsSourcePayload,
    sports_source_selected_at: sportsSourceSelectedAt,
  })

  return {
    eventId: newEvent.id,
    eventChanged: true,
    translationSourceChanged: true,
    seriesSlugsForCacheInvalidation: getSeriesSlugsForCacheInvalidation(null, eventSeriesSlug),
    listAffectingChange: true,
    urlSetChanged: true,
    sportsSourceCandidate,
  }
}

async function processMarketData(
  market: SubgraphCondition,
  metadata: any,
  eventId: string,
  timestamps: MarketTimestamps,
  sportsSourceCandidate: SportsSourceCandidate | null,
): Promise<ProcessMarketDataResult> {
  if (!eventId) {
    throw new Error(`Invalid eventId: ${eventId}. Event must be created first.`)
  }

  const hasPolymarketConditionIdField = Object.hasOwn(metadata, 'mirror_condition_id')
  const polymarketAssetIds = resolvePolymarketOutcomeAssetIds(metadata)
  const hasPolymarketTokenIdsField = polymarketAssetIds.hasMapping
  const polymarketConditionId = normalizeHexField(metadata.mirror_condition_id)
  const polymarketTokenIds = polymarketAssetIds.ids
  const shouldSyncPolymarketTokenIds =
    hasPolymarketTokenIdsField || (hasPolymarketConditionIdField && polymarketConditionId == null)

  const existingMarketRows = await db
    .select({
      condition_id: marketsTable.condition_id,
      event_id: marketsTable.event_id,
      is_resolved: marketsTable.is_resolved,
      polymarket_condition_id: marketsTable.polymarket_condition_id,
      metadata: marketsTable.metadata,
      updated_at: marketsTable.updated_at,
      slug: marketsTable.slug,
      icon_url: marketsTable.icon_url,
    })
    .from(marketsTable)
    .where(eq(marketsTable.condition_id, market.id))
    .limit(1)
  const existingMarket = existingMarketRows[0]
  const existingOutcomeRows =
    existingMarket && shouldSyncPolymarketTokenIds
      ? await db
          .select({
            outcomeIndex: outcomesTable.outcome_index,
            polymarketTokenId: outcomesTable.polymarket_token_id,
            tokenId: outcomesTable.token_id,
          })
          .from(outcomesTable)
          .where(eq(outcomesTable.condition_id, market.id))
      : []
  const polymarketTokenIdsChanged =
    shouldSyncPolymarketTokenIds && hasPolymarketOutcomeTokenMappingChanged(polymarketTokenIds, existingOutcomeRows)
  const acceptingOrdersFlag = resolveMetadataStatusFlag(metadata, ['acceptingOrders', 'accepting_orders'], true)
  const archivedFlag = resolveMetadataStatusFlag(metadata, ['archived'], false)
  const existingAcceptingOrdersFlag = existingMarket
    ? resolveStoredMetadataStatusFlag(existingMarket.metadata, ['acceptingOrders', 'accepting_orders'], true)
    : true
  const existingArchivedFlag = existingMarket
    ? resolveStoredMetadataStatusFlag(existingMarket.metadata, ['archived'], false)
    : false

  const marketAlreadyExists = Boolean(existingMarket)
  const eventIdForStatusUpdate = existingMarket?.event_id ?? eventId
  const incomingUpdatedAtMs = Date.parse(timestamps.updatedAtIso)
  const existingUpdatedAtMs = existingMarket?.updated_at ? new Date(existingMarket.updated_at).getTime() : Number.NaN
  const marketIconReference = normalizeAssetReference(metadata.icon)
  const marketIconPath = marketIconReference
    ? buildCanonicalIconStoragePath(
        marketIconReference,
        `markets/icons/${normalizeStorageSlug(metadata.slug, market.id)}`,
      )
    : null
  const shouldUseCanonicalMarketIcon = Boolean(
    marketIconReference &&
    marketIconPath &&
    resolveStableAssetReference(marketIconReference) &&
    existingMarket?.icon_url !== marketIconPath,
  )
  const shouldSyncMarketIcon = Boolean(
    marketIconReference &&
    marketIconPath &&
    (shouldDownloadMarketIcon(existingMarket, marketIconReference) || shouldUseCanonicalMarketIcon),
  )
  const marketNeedsUpdate =
    !existingMarket ||
    !Number.isFinite(existingUpdatedAtMs) ||
    incomingUpdatedAtMs > existingUpdatedAtMs ||
    existingMarket.event_id !== eventId ||
    existingMarket.is_resolved !== market.resolved ||
    (hasPolymarketConditionIdField &&
      (existingMarket.polymarket_condition_id ?? null) !== (polymarketConditionId ?? null)) ||
    polymarketTokenIdsChanged ||
    existingAcceptingOrdersFlag !== acceptingOrdersFlag ||
    existingArchivedFlag !== archivedFlag ||
    shouldSyncMarketIcon

  const eventIdsForHiddenSync = new Set<string>()
  if (existingMarket) {
    const archivedStateChanged = existingArchivedFlag !== archivedFlag
    const eventChanged = existingMarket.event_id !== eventId
    if (archivedStateChanged || (eventChanged && (existingArchivedFlag || archivedFlag))) {
      eventIdsForHiddenSync.add(existingMarket.event_id)
      eventIdsForHiddenSync.add(eventId)
    }
  } else if (archivedFlag) {
    eventIdsForHiddenSync.add(eventId)
  }

  if (marketAlreadyExists) {
    console.log(`Market ${market.id} already exists, updating cached data...`)
  }

  if (!marketNeedsUpdate) {
    const payoutsChanged = market.resolved ? await syncMissingOnChainResolvedPayouts(market.id) : false
    let mirrorStatusChanged: boolean
    try {
      mirrorStatusChanged = await db.transaction((transaction) => syncEventPolymarketMirrorStatus(eventId, transaction))
    } catch (error) {
      throw new RetryableMarketSyncError(`Failed to synchronize Polymarket mirror status for event ${eventId}.`, error)
    }

    return {
      eventIdForStatusUpdate,
      eventIdsForHiddenSync: [],
      marketChanged: payoutsChanged || mirrorStatusChanged,
      urlSetChanged: false,
    }
  }

  let iconUrl: string | null = null
  if (shouldSyncMarketIcon && marketIconReference && marketIconPath) {
    iconUrl = await downloadAndSaveImage(marketIconReference, marketIconPath)
  }

  console.log(`${marketAlreadyExists ? 'Updating' : 'Creating'} market ${market.id} with eventId: ${eventId}`)

  if (!market.oracle) {
    throw new Error(`Market ${market.id} missing required oracle field`)
  }

  const question = normalizeStringField(metadata.question)
  const marketRules = normalizeStringField(metadata.market_rules)
  const resolutionSource = normalizeStringField(metadata.resolution_source)
  const resolutionSourceUrl = normalizeStringField(metadata.resolution_source_url)
  const resolutionAdapterAddress = normalizeAddressField(metadata.resolution_adapter_address)
  const resolverAddress = normalizeAddressField(metadata.resolver) ?? resolutionAdapterAddress
  const negRiskFlag = normalizeBooleanField(metadata.neg_risk)
  const negRiskOtherFlag = normalizeBooleanField(metadata.neg_risk_other)
  const negRiskMarketId = normalizeHexField(metadata.neg_risk_market_id)
  const negRiskRequestId = normalizeHexField(metadata.neg_risk_request_id)
  const umaRequestTxHash = normalizeHexField(metadata.uma_request_tx_hash)
  const umaRequestLogIndex = normalizeIntegerField(metadata.uma_request_log_index)
  const umaOracleAddress = normalizeAddressField(metadata.uma_oracle_address)
  const mirrorUmaRequestTxHash = normalizeHexField(metadata.mirror_uma_request_tx_hash)
  const mirrorUmaRequestLogIndex = normalizeIntegerField(metadata.mirror_uma_request_log_index)
  const mirrorUmaOracleAddress = normalizeAddressField(metadata.mirror_uma_oracle_address)
  const metadataVersion = normalizeStringField(metadata.version)
  const metadataSchema = normalizeStringField(metadata.schema)
  const sportsMarketData = metadata?.sports?.market
  const sportsMarketType = normalizeStringField(sportsMarketData?.sports_market_type)
  const sportsLine = normalizeDecimalField(sportsMarketData?.line)
  const sportsGroupItemTitle = normalizeStringField(sportsMarketData?.group_item_title)
  const sportsGroupItemThreshold = normalizeStringField(sportsMarketData?.group_item_threshold)
  const sportsGameStartTime = normalizeTimestamp(sportsMarketData?.game_start_time)
  const sportsEventId = normalizeIntegerField(sportsMarketData?.event_id)
  const sportsParentEventId = normalizeIntegerField(sportsMarketData?.parent_event_id)
  const sportsGameId = normalizeIntegerField(sportsMarketData?.game_id)
  const sportsEventDate = normalizeDateField(sportsMarketData?.event_date)
  const sportsStartTime = normalizeTimestamp(sportsMarketData?.start_time)
  const sportsSeriesColor = normalizeStringField(sportsMarketData?.series_color)
  const sportsEventSlug = normalizeStringField(sportsMarketData?.event_slug)
  const sportsSourceProvider =
    normalizeSingleSportsSourceProvider(normalizeStringField(sportsMarketData?.source_provider)) ??
    sportsSourceCandidate?.provider ??
    null
  const sportsSourceEventId =
    normalizeStringIdField(sportsMarketData?.source_event_id) ?? sportsSourceCandidate?.eventId ?? null
  const sportsSourceGameId =
    normalizeStringIdField(sportsMarketData?.source_game_id) ?? sportsSourceCandidate?.gameId ?? null
  const sportsSourceLeagueId =
    normalizeStringIdField(sportsMarketData?.source_league_id) ?? sportsSourceCandidate?.leagueId ?? null
  const sportsSourceLeagueLabel =
    normalizeStringField(sportsMarketData?.source_league_label) ?? sportsSourceCandidate?.leagueName ?? null
  const sportsSourceMarketId = normalizeStringIdField(sportsMarketData?.source_market_id)
  const sportsSourceMatchConfidence =
    normalizeConfidenceField(sportsMarketData?.source_match_confidence) ??
    (sportsSourceCandidate ? formatSportsSourceConfidence(sportsSourceCandidate.confidence) : null)
  const sportsSourcePayload =
    normalizeObjectField(sportsMarketData?.source_payload) ??
    (sportsSourceCandidate ? buildSportsSourcePayload(sportsSourceCandidate, 'automatic') : null)
  const normalizedSportsTeams = normalizeSportsTeamsField(sportsMarketData?.teams)
  const sportsAssets = await normalizeSportsTeamAssets(normalizedSportsTeams)
  const sportsTeams = sportsAssets.teams
  const sportsTeamLogoUrls = sportsAssets.logo_urls
  const normalizedMarketEndTime = normalizeTimestamp(metadata.end_time)
  const storedMetadata = { ...metadata }
  delete storedMetadata.mirror_condition_id
  delete storedMetadata.mirror_outcome_token_ids

  const conditionUpdate: Record<string, any> = {}
  if (umaRequestTxHash) {
    conditionUpdate.uma_request_tx_hash = umaRequestTxHash
  }
  if (umaRequestLogIndex != null) {
    conditionUpdate.uma_request_log_index = umaRequestLogIndex
  }
  if (umaOracleAddress) {
    conditionUpdate.uma_oracle_address = umaOracleAddress
  }
  if (mirrorUmaRequestTxHash) {
    conditionUpdate.mirror_uma_request_tx_hash = mirrorUmaRequestTxHash
  }
  if (mirrorUmaRequestLogIndex != null) {
    conditionUpdate.mirror_uma_request_log_index = mirrorUmaRequestLogIndex
  }
  if (mirrorUmaOracleAddress) {
    conditionUpdate.mirror_uma_oracle_address = mirrorUmaOracleAddress
  }
  if (Object.keys(conditionUpdate).length > 0) {
    await db.update(conditionsTable).set(conditionUpdate).where(eq(conditionsTable.id, market.id))
  }

  const marketData: typeof marketsTable.$inferInsert = {
    condition_id: market.id,
    polymarket_condition_id: hasPolymarketConditionIdField
      ? (polymarketConditionId ?? null)
      : (existingMarket?.polymarket_condition_id ?? null),
    event_id: eventId,
    is_resolved: market.resolved,
    is_active: !market.resolved && !archivedFlag,
    title: String(metadata.name),
    slug: String(metadata.slug),
    short_title: normalizeStringField(metadata.short_title),
    icon_url: iconUrl ?? (existingMarket?.icon_url || null),
    metadata: JSON.stringify(storedMetadata),
    question: question ?? null,
    market_rules: marketRules ?? null,
    resolution_source: resolutionSource ?? null,
    resolution_source_url: resolutionSourceUrl ?? null,
    resolver: resolverAddress ?? null,
    neg_risk: negRiskFlag,
    neg_risk_other: negRiskOtherFlag,
    neg_risk_market_id: negRiskMarketId ?? null,
    neg_risk_request_id: negRiskRequestId ?? null,
    metadata_version: metadataVersion ?? null,
    metadata_schema: metadataSchema ?? null,
    created_at: new Date(timestamps.createdAtIso),
    updated_at: new Date(timestamps.updatedAtIso),
  }

  if (normalizedMarketEndTime) {
    marketData.end_time = new Date(normalizedMarketEndTime)
  }

  try {
    await db.transaction(async (transaction) => {
      await transaction
        .insert(marketsTable)
        .values(marketData)
        .onConflictDoUpdate({
          target: [marketsTable.condition_id],
          set: marketData,
        })

      if (metadata.outcomes?.length > 0) {
        await processOutcomes(
          market.id,
          metadata.outcomes,
          polymarketTokenIds,
          shouldSyncPolymarketTokenIds,
          transaction,
        )
        if (shouldSyncPolymarketTokenIds) {
          for (const row of existingOutcomeRows) {
            if (row.outcomeIndex >= metadata.outcomes.length && row.polymarketTokenId != null) {
              await transaction
                .update(outcomesTable)
                .set({ polymarket_token_id: null, updated_at: new Date() })
                .where(eq(outcomesTable.token_id, row.tokenId))
            }
          }
        }
      } else if (shouldSyncPolymarketTokenIds) {
        for (const row of existingOutcomeRows) {
          await transaction
            .update(outcomesTable)
            .set({
              polymarket_token_id: polymarketTokenIds[row.outcomeIndex] ?? null,
              updated_at: new Date(),
            })
            .where(eq(outcomesTable.token_id, row.tokenId))
        }
      }

      for (const mirrorEventId of Array.from(
        new Set([eventId, existingMarket?.event_id].filter((value): value is string => Boolean(value))),
      )) {
        await syncEventPolymarketMirrorStatus(mirrorEventId, transaction)
      }
    })
  } catch (error) {
    throw new RetryableMarketSyncError(
      `Failed to atomically synchronize Polymarket mappings for market ${market.id}.`,
      error,
    )
  }

  await upsertMarketSportsMetadata(market.id, {
    event_id: eventId,
    sports_market_type: sportsMarketType,
    sports_line: sportsLine,
    sports_group_item_title: sportsGroupItemTitle,
    sports_group_item_threshold: sportsGroupItemThreshold,
    sports_game_start_time: sportsGameStartTime ? new Date(sportsGameStartTime) : null,
    sports_event_id: sportsEventId,
    sports_parent_event_id: sportsParentEventId,
    sports_game_id: sportsGameId,
    sports_event_date: sportsEventDate,
    sports_start_time: sportsStartTime ? new Date(sportsStartTime) : null,
    sports_series_color: sportsSeriesColor,
    sports_event_slug: sportsEventSlug,
    sports_teams: sportsTeams,
    sports_team_logo_urls: sportsTeamLogoUrls,
    sports_source_provider: sportsSourceProvider,
    sports_source_event_id: sportsSourceEventId,
    sports_source_game_id: sportsSourceGameId,
    sports_source_league_id: sportsSourceLeagueId,
    sports_source_league_label: sportsSourceLeagueLabel,
    sports_source_market_id: sportsSourceMarketId,
    sports_source_match_confidence: sportsSourceMatchConfidence,
    sports_source_payload: sportsSourcePayload,
  })

  if (market.resolved) {
    await syncMissingOnChainResolvedPayouts(market.id)
  }

  const incomingSlug = String(metadata.slug ?? '').trim()
  const previousSlug = (existingMarket?.slug ?? '').trim()
  const urlSetChanged =
    (!marketAlreadyExists && incomingSlug.length > 0) || (marketAlreadyExists && incomingSlug !== previousSlug)

  return {
    eventIdForStatusUpdate,
    eventIdsForHiddenSync: Array.from(eventIdsForHiddenSync),
    marketChanged: true,
    urlSetChanged,
  }
}

async function updateEventStatusesFromMarketsBatch(eventIds: string[]) {
  const uniqueEventIds = Array.from(new Set(eventIds.filter(Boolean)))
  if (uniqueEventIds.length === 0) {
    return [] as string[]
  }
  const changedEventIds: string[] = []

  const [currentEvents, marketRows] = await Promise.all([
    db
      .select({
        id: eventsTable.id,
        slug: eventsTable.slug,
        status: eventsTable.status,
        resolved_at: eventsTable.resolved_at,
      })
      .from(eventsTable)
      .where(inArray(eventsTable.id, uniqueEventIds)),
    db
      .select({
        event_id: marketsTable.event_id,
        is_active: marketsTable.is_active,
        is_resolved: marketsTable.is_resolved,
      })
      .from(marketsTable)
      .where(inArray(marketsTable.event_id, uniqueEventIds)),
  ])

  const currentEventById = new Map((currentEvents ?? []).map((event) => [event.id, event]))
  const countsByEventId = new Map<string, { total: number; active: number; unresolved: number }>()

  for (const eventId of uniqueEventIds) {
    countsByEventId.set(eventId, { total: 0, active: 0, unresolved: 0 })
  }

  for (const market of marketRows) {
    const eventId = market.event_id
    if (!eventId || !countsByEventId.has(eventId)) {
      continue
    }

    const bucket = countsByEventId.get(eventId)!
    bucket.total += 1

    const isActiveMarket = market.is_active || (market.is_active == null && !market.is_resolved)
    if (isActiveMarket) {
      bucket.active += 1
    }

    const isUnresolvedMarket = !market.is_resolved
    if (isUnresolvedMarket) {
      bucket.unresolved += 1
    }
  }

  for (const eventId of uniqueEventIds) {
    const currentEvent = currentEventById.get(eventId)
    if (!currentEvent) {
      continue
    }

    const counts = countsByEventId.get(eventId) ?? { total: 0, active: 0, unresolved: 0 }
    const hasMarkets = counts.total > 0
    const hasActiveMarket = counts.active > 0
    const hasUnresolvedMarket = counts.unresolved > 0

    const nextStatus: 'draft' | 'active' | 'resolved' | 'archived' = !hasMarkets
      ? 'draft'
      : !hasUnresolvedMarket
        ? 'resolved'
        : hasActiveMarket
          ? 'active'
          : 'archived'

    const shouldSetResolvedAt = nextStatus === 'resolved' && currentEvent.resolved_at == null
    const resolvedAtUpdate = shouldSetResolvedAt
      ? new Date()
      : nextStatus === 'resolved'
        ? (currentEvent.resolved_at ?? null)
        : null

    const currentResolvedAtIso = currentEvent.resolved_at?.toISOString() ?? null
    const nextResolvedAtIso = resolvedAtUpdate?.toISOString() ?? null
    if (currentEvent.status === nextStatus && currentResolvedAtIso === nextResolvedAtIso) {
      continue
    }

    await db
      .update(eventsTable)
      .set({ status: nextStatus, resolved_at: resolvedAtUpdate })
      .where(eq(eventsTable.id, eventId))
    changedEventIds.push(eventId)
  }

  return changedEventIds
}

async function repairMissingImageAssets(deadlineMs: number): Promise<{ repairedCount: number; eventIds: string[] }> {
  const repairedEventIds = new Set<string>()
  let repairedCount = 0
  let attemptedCount = 0

  function hasRepairTime() {
    return Date.now() + SYNC_FINALIZATION_RESERVE_MS < deadlineMs
  }

  function getRepairTimeoutMs() {
    return Math.min(MISSING_IMAGE_REPAIR_ITEM_TIMEOUT_MS, deadlineMs - Date.now() - SYNC_FINALIZATION_RESERVE_MS)
  }

  if (!hasRepairTime()) {
    return { repairedCount: 0, eventIds: [] }
  }

  try {
    const missingMarketRows = await db
      .select({
        condition_id: marketsTable.condition_id,
        event_id: marketsTable.event_id,
        slug: marketsTable.slug,
        metadata: marketsTable.metadata,
      })
      .from(marketsTable)
      .where(or(isNull(marketsTable.icon_url), eq(marketsTable.icon_url, '')))
      .orderBy(sql`RANDOM()`)
      .limit(MISSING_IMAGE_REPAIR_SCAN_LIMIT)

    for (const row of missingMarketRows) {
      if (!hasRepairTime() || attemptedCount >= MISSING_IMAGE_REPAIR_MARKET_MAX_ITEMS) {
        break
      }

      const reference = normalizeStringField(parseStoredMarketMetadata(row.metadata)?.icon)
      if (!reference) {
        continue
      }

      const timeoutMs = getRepairTimeoutMs()
      if (timeoutMs <= 0) {
        break
      }
      attemptedCount += 1

      try {
        const storagePath = `markets/icons/${normalizeStorageSlug(row.slug, row.condition_id)}`
        const storedPath = await downloadAndSaveImage(reference, storagePath, { timeoutMs })
        if (!storedPath) {
          continue
        }

        const updatedRows = await db
          .update(marketsTable)
          .set({ icon_url: storedPath })
          .where(
            and(
              eq(marketsTable.condition_id, row.condition_id),
              or(isNull(marketsTable.icon_url), eq(marketsTable.icon_url, '')),
            ),
          )
          .returning({ condition_id: marketsTable.condition_id })
        if (updatedRows.length > 0) {
          repairedCount += 1
          repairedEventIds.add(row.event_id)
        }
      } catch (error) {
        console.error(`Failed to repair market icon ${row.condition_id}:`, error)
      }
    }

    if (hasRepairTime() && attemptedCount < MISSING_IMAGE_REPAIR_MAX_ITEMS) {
      const missingEventRows = await db
        .select({
          id: eventsTable.id,
          slug: eventsTable.slug,
          title: eventsTable.title,
          creator: eventsTable.creator,
        })
        .from(eventsTable)
        .where(or(isNull(eventsTable.icon_url), eq(eventsTable.icon_url, '')))
        .orderBy(sql`RANDOM()`)
        .limit(MISSING_IMAGE_REPAIR_SCAN_LIMIT)

      const eventIds = missingEventRows.map((row) => row.id)
      const eventMarketRows =
        eventIds.length > 0
          ? await db
              .select({
                event_id: marketsTable.event_id,
                condition_id: marketsTable.condition_id,
                metadata: marketsTable.metadata,
                updated_at: marketsTable.updated_at,
              })
              .from(marketsTable)
              .where(and(inArray(marketsTable.event_id, eventIds), isNotNull(marketsTable.metadata)))
          : []
      const latestEventIconById = new Map<string, { reference: string; updatedAtMs: number; conditionId: string }>()
      for (const row of eventMarketRows) {
        const reference = resolveStoredEventIconReference(row.metadata)
        if (!reference) {
          continue
        }

        const updatedAtMs = row.updated_at?.getTime() ?? Number.NEGATIVE_INFINITY
        const current = latestEventIconById.get(row.event_id)
        if (
          !current ||
          updatedAtMs > current.updatedAtMs ||
          (updatedAtMs === current.updatedAtMs && row.condition_id > current.conditionId)
        ) {
          latestEventIconById.set(row.event_id, { reference, updatedAtMs, conditionId: row.condition_id })
        }
      }

      for (const row of missingEventRows) {
        if (!hasRepairTime() || attemptedCount >= MISSING_IMAGE_REPAIR_MAX_ITEMS) {
          break
        }

        const reference = latestEventIconById.get(row.id)?.reference
        if (!reference) {
          continue
        }

        const timeoutMs = getRepairTimeoutMs()
        if (timeoutMs <= 0) {
          break
        }
        attemptedCount += 1

        try {
          const storagePath = `events/icons/${normalizeStorageSlug(row.slug, `${row.title}:${row.creator ?? ''}`)}`
          const storedPath = await downloadAndSaveImage(reference, storagePath, { timeoutMs })
          if (!storedPath) {
            continue
          }

          const updatedRows = await db
            .update(eventsTable)
            .set({ icon_url: storedPath })
            .where(and(eq(eventsTable.id, row.id), or(isNull(eventsTable.icon_url), eq(eventsTable.icon_url, ''))))
            .returning({ id: eventsTable.id })
          if (updatedRows.length > 0) {
            repairedCount += 1
            repairedEventIds.add(row.id)
          }
        } catch (error) {
          console.error(`Failed to repair event icon ${row.id}:`, error)
        }
      }
    }
  } catch (error) {
    console.error('Failed to load missing image assets for repair:', error)
  }

  if (attemptedCount > 0 || repairedCount > 0) {
    console.log(
      JSON.stringify({
        message: 'repaired missing event and market icons',
        attemptedCount,
        repairedCount,
        eventCount: repairedEventIds.size,
      }),
    )
  }

  return { repairedCount, eventIds: Array.from(repairedEventIds) }
}

function resolveStoredEventIconReference(value: unknown) {
  const metadata = parseStoredMarketMetadata(value)
  const eventMetadata = normalizeObjectField(metadata?.event)
  return normalizeStringField(eventMetadata?.icon)
}

async function invalidateEventCaches(
  eventIds: string[],
  options: { includeList?: boolean; includeSitemap?: boolean; seriesSlugs?: string[] } = {},
) {
  const uniqueEventIds = Array.from(new Set(eventIds.filter(Boolean)))
  const listTagInvalidated = options.includeList === true
  const sitemapTagInvalidated = options.includeSitemap === true
  const homeFeaturedTagInvalidated = listTagInvalidated
  const seriesSlugsToInvalidate = new Set(normalizeSeriesSlugsForCacheInvalidation(options.seriesSlugs ?? []))
  if (listTagInvalidated) {
    revalidateTag(cacheTags.eventsList, { expire: 0 })
    revalidateTag(cacheTags.homeFeaturedEvents, { expire: 0 })
    for (const locale of SUPPORTED_LOCALES) {
      revalidateTag(cacheTags.mainTags(locale), { expire: 0 })
    }
  }
  if (sitemapTagInvalidated) {
    revalidateTag(cacheTags.sitemap, { expire: 0 })
  }

  if (uniqueEventIds.length === 0) {
    for (const seriesSlug of seriesSlugsToInvalidate) {
      revalidateTag(cacheTags.seriesEvents(seriesSlug), { expire: 0 })
    }

    return {
      listTagInvalidated,
      sitemapTagInvalidated,
      homeFeaturedTagInvalidated,
      mainTagsInvalidations: listTagInvalidated ? SUPPORTED_LOCALES.length : 0,
      eventTagInvalidations: 0,
      seriesEventsTagInvalidations: seriesSlugsToInvalidate.size,
      uniqueEventIdsCount: 0,
    }
  }

  const rows = await db
    .select({
      slug: eventsTable.slug,
      series_slug: eventsTable.series_slug,
    })
    .from(eventsTable)
    .where(inArray(eventsTable.id, uniqueEventIds))

  let eventTagInvalidations = 0
  for (const row of rows) {
    if (row.slug) {
      revalidateTag(cacheTags.event(row.slug), { expire: 0 })
      eventTagInvalidations += 1
    }
    const seriesSlug = normalizeStringField(row.series_slug)
    if (seriesSlug) {
      seriesSlugsToInvalidate.add(seriesSlug)
    }
  }
  for (const seriesSlug of seriesSlugsToInvalidate) {
    revalidateTag(cacheTags.seriesEvents(seriesSlug), { expire: 0 })
  }

  return {
    listTagInvalidated,
    sitemapTagInvalidated,
    homeFeaturedTagInvalidated,
    mainTagsInvalidations: listTagInvalidated ? SUPPORTED_LOCALES.length : 0,
    eventTagInvalidations,
    seriesEventsTagInvalidations: seriesSlugsToInvalidate.size,
    uniqueEventIdsCount: uniqueEventIds.length,
  }
}

function requireSubgraphTimestampIso(
  rawValue: string | null | undefined,
  fieldName: 'creationTimestamp' | 'updatedAt',
  marketId: string,
) {
  if (!rawValue) {
    throw new Error(`Market ${marketId} missing required ${fieldName} field`)
  }

  const timestamp = Number(rawValue)
  if (Number.isNaN(timestamp)) {
    throw new TypeError(`Market ${marketId} has invalid ${fieldName}: ${rawValue}`)
  }

  return new Date(timestamp * 1000).toISOString()
}

function getMarketTimestamps(market: SubgraphCondition): MarketTimestamps {
  return {
    createdAtIso: requireSubgraphTimestampIso(market.creationTimestamp, 'creationTimestamp', market.id),
    updatedAtIso: requireSubgraphTimestampIso(market.updatedAt, 'updatedAt', market.id),
  }
}

async function loadRuntimeSportsSourceSettings(runtimeState: SyncRuntimeState) {
  runtimeState.sportsSourceSettingsPromise ??= loadSportsSourceProviderSettings().catch((error) => {
    console.error('Failed to load sports source provider settings:', error)
    return { configured: false } satisfies SportsSourceProviderSettings
  })
  return runtimeState.sportsSourceSettingsPromise
}

function hasSportsOrEsportsTag(normalizedEventTags: Map<string, NormalizedEventTag>) {
  return normalizedEventTags.has('sports') || normalizedEventTags.has('esports')
}

function readOutcomeTexts(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[]
  }

  const out: string[] = []
  for (const item of value) {
    const normalized =
      typeof item === 'string'
        ? normalizeStringField(item)
        : item && typeof item === 'object' && !Array.isArray(item)
          ? (normalizeStringField((item as Record<string, unknown>).outcome) ??
            normalizeStringField((item as Record<string, unknown>).name) ??
            normalizeStringField((item as Record<string, unknown>).title) ??
            normalizeStringField((item as Record<string, unknown>).label))
          : null
    if (normalized) {
      out.push(normalized)
    }
  }
  return out
}

export function mergeSportsSourceFieldsWithExisting(input: {
  current: {
    provider: string | null
    eventId: string | null
    gameId: string | null
    leagueId: string | null
    leagueLabel: string | null
    matchConfidence: string | null
    payload: Record<string, unknown> | null
  }
  existing: {
    sports_source_provider: string | null
    sports_source_event_id: string | null
    sports_source_game_id: string | null
    sports_source_league_id: string | null
    sports_source_league_label: string | null
    sports_source_match_confidence: string | null
    sports_source_payload: unknown
  }
}) {
  const currentProvider = normalizeSingleSportsSourceProvider(input.current.provider)
  const existingProvider = normalizeSingleSportsSourceProvider(input.existing.sports_source_provider)
  const existingSourceIdentityKey = buildSportsSourceIdentityKey({
    provider: existingProvider,
    eventId: input.existing.sports_source_event_id ?? null,
    gameId: input.existing.sports_source_game_id ?? null,
    leagueId: input.existing.sports_source_league_id ?? null,
  })
  const hasCurrentSourceIdentity = Boolean(
    currentProvider || input.current.eventId || input.current.gameId || input.current.leagueId,
  )
  const canReuseExistingSourceIdentity = Boolean(
    existingProvider && (!currentProvider || currentProvider === existingProvider),
  )
  const mergedProvider = currentProvider ?? existingProvider
  const provisionalEventId =
    input.current.eventId ?? (canReuseExistingSourceIdentity ? (input.existing.sports_source_event_id ?? null) : null)
  const provisionalGameId =
    input.current.gameId ?? (canReuseExistingSourceIdentity ? (input.existing.sports_source_game_id ?? null) : null)
  const provisionalLeagueId =
    input.current.leagueId ?? (canReuseExistingSourceIdentity ? (input.existing.sports_source_league_id ?? null) : null)
  const mergedSourceIdentityKey = buildSportsSourceIdentityKey({
    provider: mergedProvider,
    eventId: provisionalEventId,
    gameId: provisionalGameId,
    leagueId: provisionalLeagueId,
  })
  const sourceIdentityChanged = hasCurrentSourceIdentity && mergedSourceIdentityKey !== existingSourceIdentityKey
  const mayReuseExistingSourceDetails = !sourceIdentityChanged && canReuseExistingSourceIdentity
  const mergedEventId =
    input.current.eventId ?? (mayReuseExistingSourceDetails ? (input.existing.sports_source_event_id ?? null) : null)
  const mergedGameId =
    input.current.gameId ?? (mayReuseExistingSourceDetails ? (input.existing.sports_source_game_id ?? null) : null)
  const mergedLeagueId =
    input.current.leagueId ?? (mayReuseExistingSourceDetails ? (input.existing.sports_source_league_id ?? null) : null)

  return {
    provider: mergedProvider,
    eventId: mergedEventId,
    gameId: mergedGameId,
    leagueId: mergedLeagueId,
    leagueLabel:
      input.current.leagueLabel ??
      (mayReuseExistingSourceDetails ? (input.existing.sports_source_league_label ?? null) : null),
    matchConfidence:
      input.current.matchConfidence ??
      (mayReuseExistingSourceDetails ? (input.existing.sports_source_match_confidence ?? null) : null),
    payload:
      input.current.payload ??
      (mayReuseExistingSourceDetails ? normalizeObjectField(input.existing.sports_source_payload) : null),
  }
}

function formatSportsSourceConfidence(value: number) {
  return Math.min(1, Math.max(0, value)).toFixed(4)
}

function buildSportsSourcePayload(candidate: SportsSourceCandidate, selection: 'automatic' | 'manual') {
  return {
    selection,
    provider: candidate.provider,
    eventId: candidate.eventId,
    eventName: candidate.eventName ?? null,
    gameId: candidate.gameId,
    leagueId: candidate.leagueId,
    leagueName: candidate.leagueName,
    startTime: candidate.startTime,
    confidence: candidate.confidence,
    matchReason: candidate.matchReason,
    livestreamUrl: candidate.livestreamUrl,
    livestreamEmbedUrl: candidate.livestreamEmbedUrl,
    livestreamProvider: candidate.livestreamProvider,
    livestreamOfficial: candidate.livestreamOfficial,
    raw: candidate.raw,
  }
}

function buildSportsSourceIdentityKey(input: {
  provider: string | null
  eventId: string | null
  gameId: string | null
  leagueId: string | null
}) {
  return [
    input.provider?.trim().toLowerCase() ?? '',
    input.eventId?.trim() ?? '',
    input.gameId?.trim() ?? '',
    input.leagueId?.trim() ?? '',
  ].join('\u0000')
}

export function buildEventSportsSourceUpsertPayload(
  input: Pick<
    EventSportsMetadataInput,
    | 'sports_source_provider'
    | 'sports_source_event_id'
    | 'sports_source_game_id'
    | 'sports_source_league_id'
    | 'sports_source_league_label'
    | 'sports_source_match_confidence'
    | 'sports_source_payload'
    | 'sports_source_selected_at'
  >,
) {
  const hasSportsSourceData = [
    input.sports_source_provider,
    input.sports_source_event_id,
    input.sports_source_game_id,
    input.sports_source_league_id,
    input.sports_source_league_label,
    input.sports_source_match_confidence,
    input.sports_source_payload,
    input.sports_source_selected_at,
  ].some((value) => value !== null)

  if (!hasSportsSourceData) {
    return null
  }

  return {
    sports_source_provider: input.sports_source_provider,
    sports_source_event_id: input.sports_source_event_id,
    sports_source_game_id: input.sports_source_game_id,
    sports_source_league_id: input.sports_source_league_id,
    sports_source_league_label: input.sports_source_league_label,
    sports_source_match_confidence: input.sports_source_match_confidence,
    sports_source_payload: input.sports_source_payload,
    sports_source_selected_at: input.sports_source_selected_at,
  }
}

export function buildMarketSportsSourceUpsertPayload(
  input: Pick<
    MarketSportsMetadataInput,
    | 'sports_source_provider'
    | 'sports_source_event_id'
    | 'sports_source_game_id'
    | 'sports_source_league_id'
    | 'sports_source_league_label'
    | 'sports_source_market_id'
    | 'sports_source_match_confidence'
    | 'sports_source_payload'
  >,
) {
  const hasSportsSourceData = [
    input.sports_source_provider,
    input.sports_source_event_id,
    input.sports_source_game_id,
    input.sports_source_league_id,
    input.sports_source_league_label,
    input.sports_source_market_id,
    input.sports_source_match_confidence,
    input.sports_source_payload,
  ].some((value) => value !== null)

  if (!hasSportsSourceData) {
    return null
  }

  return {
    sports_source_provider: input.sports_source_provider,
    sports_source_event_id: input.sports_source_event_id,
    sports_source_game_id: input.sports_source_game_id,
    sports_source_league_id: input.sports_source_league_id,
    sports_source_league_label: input.sports_source_league_label,
    sports_source_market_id: input.sports_source_market_id,
    sports_source_match_confidence: input.sports_source_match_confidence,
    sports_source_payload: input.sports_source_payload,
  }
}

function buildSportsSourceTeamRecords(candidate: SportsSourceCandidate): Record<string, unknown>[] | null {
  const teams: Record<string, unknown>[] = []
  for (const team of [candidate.homeTeam, candidate.awayTeam]) {
    if (!team?.name) {
      continue
    }
    const record: Record<string, unknown> = { name: team.name }
    if (team.abbreviation) {
      record.abbreviation = team.abbreviation
    }
    if (team.slug) {
      record.slug = team.slug
    }
    if (team.logo) {
      record.logo = team.logo
    }
    if (team.hostStatus) {
      record.hostStatus = team.hostStatus
    }
    teams.push(record)
  }
  return teams.length > 0 ? teams : null
}

async function maybeInferSportsSourceCandidate(args: {
  metadata: any
  eventData: any
  sportsEventData: any
  sportsMarketData: any
  normalizedEventTags: Map<string, NormalizedEventTag>
  teams: Array<{ name?: string | null; abbreviation?: string | null }> | null
  hasSourceIdentity: boolean
  eventTitle: string
  eventSlug: string
  eventDate: string | null
  runtimeState: SyncRuntimeState
}) {
  if (args.hasSourceIdentity || !hasSportsOrEsportsTag(args.normalizedEventTags)) {
    return null
  }

  const settings = await loadRuntimeSportsSourceSettings(args.runtimeState)
  if (!settings.configured) {
    return null
  }

  const tags = Array.from(args.normalizedEventTags.values()).map((tag) => tag.name)
  const description = [
    normalizeStringField(args.metadata?.description),
    normalizeStringField(args.metadata?.market_rules),
    normalizeStringField(args.metadata?.resolution_source),
    normalizeStringField(args.eventData?.rules),
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const candidates = await findSportsEvents({
      title: args.eventTitle,
      question: normalizeStringField(args.metadata?.question),
      outcomes: readOutcomeTexts(args.metadata?.outcomes),
      teams: args.teams,
      description,
      slug: normalizeStringField(args.metadata?.slug) ?? args.eventSlug,
      tags,
      date: args.eventDate,
      sport:
        normalizeStringField(args.sportsEventData?.sport_slug) ??
        normalizeStringField(args.sportsMarketData?.sport_slug),
      league:
        normalizeStringField(args.sportsEventData?.league_slug) ??
        normalizeStringField(args.sportsEventData?.league) ??
        normalizeStringField(args.sportsMarketData?.league_slug) ??
        normalizeStringField(args.sportsMarketData?.league) ??
        normalizeStringField(args.eventData?.league),
      series: normalizeStringField(args.eventData?.series_slug),
      limit: 5,
      auth: settings,
    })
    const best = candidates[0]
    if (!best || best.confidence < AUTO_SPORTS_SOURCE_CONFIDENCE_THRESHOLD) {
      return null
    }
    return best
  } catch (error) {
    console.error('Failed to infer sports source candidate:', error)
    return null
  }
}

async function syncEventPolymarketMirrorStatus(eventId: string, database: MarketMappingDatabase = db) {
  const mirrorMarketRows = await database
    .select({ conditionId: marketsTable.condition_id })
    .from(marketsTable)
    .where(and(eq(marketsTable.event_id, eventId), isNotNull(marketsTable.polymarket_condition_id)))
    .limit(1)
  const eventRows = await database
    .select({ isPolymarketMirror: eventsTable.is_polymarket_mirror })
    .from(eventsTable)
    .where(eq(eventsTable.id, eventId))
    .limit(1)
  const shouldBePolymarketMirror = mirrorMarketRows.length > 0
  const currentValue = eventRows[0]?.isPolymarketMirror
  if (currentValue == null || currentValue === shouldBePolymarketMirror) {
    return false
  }

  await database
    .update(eventsTable)
    .set({ is_polymarket_mirror: shouldBePolymarketMirror, updated_at: new Date() })
    .where(eq(eventsTable.id, eventId))

  return true
}

async function processOutcomes(
  conditionId: string,
  outcomes: any[],
  polymarketTokenIds: unknown,
  syncPolymarketTokenIds: boolean,
  database: MarketMappingDatabase = db,
) {
  const outcomeData = outcomes.map((outcome, index) => ({
    condition_id: conditionId,
    outcome_text: outcome.outcome,
    outcome_index: index,
    token_id: outcome.token_id || `${conditionId}${index}`,
    polymarket_token_id: normalizeStringIdField(Array.isArray(polymarketTokenIds) ? polymarketTokenIds[index] : null),
  }))

  const updatePayload: Record<string, any> = {
    outcome_text: sql`EXCLUDED.outcome_text`,
    outcome_index: sql`EXCLUDED.outcome_index`,
    updated_at: new Date(),
  }
  if (syncPolymarketTokenIds) {
    updatePayload.polymarket_token_id = sql`EXCLUDED.polymarket_token_id`
  }

  await database.insert(outcomesTable).values(outcomeData).onConflictDoUpdate({
    target: outcomesTable.token_id,
    set: updatePayload,
  })
}

export function normalizePolymarketOutcomeTokenIds(value: unknown) {
  return Array.isArray(value) ? value.map(normalizeStringIdField) : []
}

export function resolvePolymarketOutcomeAssetIds(metadata: Record<string, any>) {
  if (normalizeStringField(metadata.mirror_protocol)?.toLowerCase() !== 'polyv2') {
    return {
      hasMapping: Object.hasOwn(metadata, 'mirror_outcome_token_ids'),
      ids: normalizePolymarketOutcomeTokenIds(metadata.mirror_outcome_token_ids),
    }
  }

  const arrayIds = normalizePolyV2PositionIds(metadata.mirror_position_ids)
  const outcomes = Array.isArray(metadata.outcomes) ? metadata.outcomes : []
  const outcomeIds = normalizePolyV2PositionIds(outcomes.map((outcome: any) => outcome?.mirror_position_id))
  const idsAreDistinct = arrayIds[0] === null || arrayIds[1] === null || arrayIds[0] !== arrayIds[1]
  const idsAreConsistent =
    arrayIds.length === 2 &&
    outcomeIds.length === 2 &&
    arrayIds.every((id, index) => id === outcomeIds[index]) &&
    idsAreDistinct

  return {
    // The protocol marker is explicit. If position metadata is incomplete, clear any stale
    // legacy token IDs instead of accidentally treating CTF IDs as PolyV2 position IDs.
    hasMapping: true,
    ids: idsAreConsistent ? arrayIds : [null, null],
  }
}

function normalizePolyV2PositionIds(value: unknown): Array<string | null> {
  if (!Array.isArray(value) || value.length !== 2) {
    return []
  }

  return value.map((positionId) => {
    if (typeof positionId !== 'string' || !/^(0|[1-9]\d*)$/.test(positionId)) {
      return null
    }
    try {
      const parsed = BigInt(positionId)
      return parsed <= (1n << 256n) - 1n ? parsed.toString() : null
    } catch {
      return null
    }
  })
}

export function hasPolymarketOutcomeTokenMappingChanged(
  incomingTokenIds: Array<string | null>,
  existingOutcomes: Array<{ outcomeIndex: number; polymarketTokenId: string | null }>,
) {
  const existingByIndex = new Map(existingOutcomes.map((outcome) => [outcome.outcomeIndex, outcome.polymarketTokenId]))
  const indexes = new Set([...incomingTokenIds.keys(), ...existingByIndex.keys()])

  return Array.from(indexes).some((index) => (incomingTokenIds[index] ?? null) !== (existingByIndex.get(index) ?? null))
}

export function shouldDownloadMarketIcon(
  existingMarket: { icon_url: string | null; metadata: unknown } | undefined,
  incomingIconReference: unknown,
): boolean {
  const normalizedIncomingReference = normalizeAssetReference(incomingIconReference)
  if (!normalizedIncomingReference) {
    return false
  }

  if (!existingMarket) {
    return true
  }

  if (!normalizeStringField(existingMarket.icon_url)) {
    return false
  }

  const storedIconReference = normalizeAssetReference(parseStoredMarketMetadata(existingMarket.metadata)?.icon)
  return storedIconReference !== normalizedIncomingReference
}

function normalizeIncomingTags(tagNames: any[] | null | undefined) {
  const normalizedTagBySlug = new Map<string, NormalizedEventTag>()

  for (const tagName of tagNames ?? []) {
    if (typeof tagName !== 'string') {
      console.warn(`Skipping invalid tag:`, tagName)
      continue
    }

    const truncatedName = tagName.trim().substring(0, 100)
    if (!truncatedName) {
      continue
    }

    const slug = truncatedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .substring(0, 100)
    if (!slug) {
      continue
    }

    const mainCategory = MAIN_CATEGORY_TAG_BY_SLUG.get(slug)
    const existing = normalizedTagBySlug.get(slug)
    normalizedTagBySlug.set(slug, {
      name: mainCategory?.name ?? existing?.name ?? truncatedName,
      isMainCategory: Boolean(existing?.isMainCategory || mainCategory),
      displayOrder: mainCategory?.displayOrder ?? existing?.displayOrder ?? null,
    })
  }

  return normalizedTagBySlug
}

async function loadEventTagSlugs(eventId: string, runtimeState: SyncRuntimeState) {
  const cachedTagSlugs = runtimeState.eventTagSlugsByEventId.get(eventId)
  if (cachedTagSlugs) {
    return cachedTagSlugs
  }

  let existingEventTagRows: Array<{ slug: string | null }> = []
  try {
    existingEventTagRows = await db
      .select({
        slug: tagsTable.slug,
      })
      .from(eventTagsTable)
      .innerJoin(tagsTable, eq(eventTagsTable.tag_id, tagsTable.id))
      .where(eq(eventTagsTable.event_id, eventId))
  } catch (existingEventTagsError) {
    console.error(`Failed to load existing event tags for event ${eventId}:`, existingEventTagsError)
    return new Set<string>()
  }

  const eventTagSlugs = new Set(existingEventTagRows.map((tag) => tag.slug?.trim().toLowerCase() ?? '').filter(Boolean))
  runtimeState.eventTagSlugsByEventId.set(eventId, eventTagSlugs)
  return eventTagSlugs
}

async function processNormalizedTags(eventId: string, normalizedTagBySlug: Map<string, NormalizedEventTag>) {
  if (normalizedTagBySlug.size === 0) {
    return false
  }

  const slugs = Array.from(normalizedTagBySlug.keys())
  const tagIdBySlug = new Map<string, number>()

  let existingTags: Array<{ id: number; slug: string; is_main_category: boolean | null }> = []
  try {
    existingTags = await db
      .select({
        id: tagsTable.id,
        slug: tagsTable.slug,
        is_main_category: tagsTable.is_main_category,
      })
      .from(tagsTable)
      .where(inArray(tagsTable.slug, slugs))
  } catch (existingTagsError) {
    console.error(`Failed to load existing tags for event ${eventId}:`, existingTagsError)
    return false
  }

  for (const tag of existingTags) {
    if (typeof tag.slug === 'string' && typeof tag.id === 'number') {
      tagIdBySlug.set(tag.slug, tag.id)
    }
  }

  let changed = false
  for (const tag of existingTags) {
    const normalizedTag = normalizedTagBySlug.get(tag.slug)
    if (!normalizedTag?.isMainCategory || tag.is_main_category === true) {
      continue
    }

    try {
      await db
        .update(tagsTable)
        .set({
          name: normalizedTag.name,
          is_main_category: true,
          is_hidden: false,
          hide_events: false,
          display_order: normalizedTag.displayOrder ?? 0,
        })
        .where(eq(tagsTable.slug, tag.slug))
      changed = true
    } catch (updateTagError) {
      console.error(`Failed to promote main tag ${tag.slug} for event ${eventId}:`, updateTagError)
    }
  }

  const rowsToInsert = slugs
    .filter((slug) => !tagIdBySlug.has(slug))
    .map((slug) => ({
      name: normalizedTagBySlug.get(slug)!.name,
      slug,
      is_main_category: normalizedTagBySlug.get(slug)!.isMainCategory,
      is_hidden: false,
      hide_events: false,
      display_order: normalizedTagBySlug.get(slug)!.displayOrder ?? 0,
    }))

  if (rowsToInsert.length > 0) {
    let insertedTags: Array<{ id: number; slug: string }> = []
    try {
      insertedTags = await db
        .insert(tagsTable)
        .values(rowsToInsert)
        .onConflictDoNothing({
          target: [tagsTable.slug],
        })
        .returning({
          id: tagsTable.id,
          slug: tagsTable.slug,
        })
    } catch (upsertTagsError) {
      console.error(`Failed to create tags for event ${eventId}:`, upsertTagsError)
      return changed
    }
    changed = insertedTags.length > 0 || changed

    for (const tag of insertedTags) {
      if (typeof tag.slug === 'string' && typeof tag.id === 'number') {
        tagIdBySlug.set(tag.slug, tag.id)
      }
    }

    if (tagIdBySlug.size < slugs.length) {
      try {
        const refreshedTags = await db
          .select({
            id: tagsTable.id,
            slug: tagsTable.slug,
          })
          .from(tagsTable)
          .where(inArray(tagsTable.slug, slugs))

        for (const tag of refreshedTags) {
          if (typeof tag.slug === 'string' && typeof tag.id === 'number') {
            tagIdBySlug.set(tag.slug, tag.id)
          }
        }
      } catch (refreshedTagsError) {
        console.error(`Failed to refresh tags for event ${eventId}:`, refreshedTagsError)
        return changed
      }
    }
  }

  const eventTagRows = slugs
    .map((slug) => tagIdBySlug.get(slug))
    .filter((tagId): tagId is number => Number.isInteger(tagId))
    .map((tagId) => ({
      event_id: eventId,
      tag_id: tagId,
    }))

  if (eventTagRows.length === 0) {
    return changed
  }

  try {
    const insertedEventTagRows = await db
      .insert(eventTagsTable)
      .values(eventTagRows)
      .onConflictDoNothing({
        target: [eventTagsTable.event_id, eventTagsTable.tag_id],
      })
      .returning({
        event_id: eventTagsTable.event_id,
      })

    return changed || insertedEventTagRows.length > 0
  } catch (eventTagsError) {
    console.error(`Failed to upsert event_tags for event ${eventId}:`, eventTagsError)
    return changed
  }
}
function resolveImageMeta(contentType: string | null, bytes: Uint8Array | null) {
  const normalized = (contentType ?? '').split(';')[0]?.trim().toLowerCase()

  if (normalized === 'image/png') {
    return { extension: 'png', contentType: 'image/png' }
  }
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') {
    return { extension: 'jpg', contentType: 'image/jpeg' }
  }
  if (normalized === 'image/webp') {
    return { extension: 'webp', contentType: 'image/webp' }
  }

  if (bytes) {
    if (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return { extension: 'png', contentType: 'image/png' }
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      return { extension: 'jpg', contentType: 'image/jpeg' }
    }
    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return { extension: 'webp', contentType: 'image/webp' }
    }
  }

  return { extension: 'jpg', contentType: 'image/jpeg' }
}

function resolveImageStoragePath(storagePath: string, extension: string) {
  if (/\.(?:png|jpe?g|webp)$/i.test(storagePath)) {
    return storagePath
  }
  return `${storagePath}.${extension}`
}

async function downloadAndSaveImage(assetReference: string, storagePath: string, options: { timeoutMs?: number } = {}) {
  try {
    const normalizedReference = normalizeAssetReference(assetReference)
    if (!normalizedReference) {
      return null
    }

    const imageAttemptDeadlineMs = options.timeoutMs ? Date.now() + options.timeoutMs : null
    function remainingTimeoutMs() {
      return imageAttemptDeadlineMs == null ? undefined : Math.max(0, imageAttemptDeadlineMs - Date.now())
    }

    if (storagePath.endsWith('.png')) {
      const publicUrl = getPublicAssetUrl(storagePath)
      if (publicUrl) {
        const remainingTimeout = remainingTimeoutMs()
        if (remainingTimeout !== undefined && remainingTimeout <= 0) {
          return null
        }
        const cachedResponse = await fetch(publicUrl, {
          method: 'HEAD',
          keepalive: true,
          signal: remainingTimeout === undefined ? undefined : AbortSignal.timeout(Math.max(1, remainingTimeout)),
        }).catch(() => null)
        if (cachedResponse?.ok) {
          return storagePath
        }
      }
    }

    const imageUrl = /^https?:\/\//i.test(normalizedReference)
      ? normalizedReference
      : `${IRYS_GATEWAY}/${normalizedReference}`
    const remainingTimeout = remainingTimeoutMs()
    if (remainingTimeout !== undefined && remainingTimeout <= 0) {
      return null
    }
    const response = await fetch(imageUrl, {
      keepalive: true,
      signal: remainingTimeout === undefined ? undefined : AbortSignal.timeout(Math.max(1, remainingTimeout)),
    })

    if (!response.ok) {
      console.error(`Failed to download image: ${response.statusText}`)
      return null
    }

    const imageBuffer = await response.arrayBuffer()
    const imageBytes = new Uint8Array(imageBuffer)
    const resolvedMeta = resolveImageMeta(response.headers.get('content-type'), imageBytes)
    const resolvedPath = resolveImageStoragePath(storagePath, resolvedMeta.extension)
    const uploadTimeoutMs = remainingTimeoutMs()
    if (uploadTimeoutMs != null && uploadTimeoutMs <= 0) {
      return null
    }

    const { error } = await uploadPublicAsset(resolvedPath, imageBuffer, {
      contentType: resolvedMeta.contentType,
      cacheControl: '31536000',
      upsert: true,
      timeoutMs: uploadTimeoutMs,
    })

    if (error) {
      console.error(`Failed to upload image: ${error}`)
      return null
    }

    return resolvedPath
  } catch (error) {
    console.error(`Failed to process image ${assetReference}:`, error)
    return null
  }
}

async function upsertEventSportsMetadata(eventId: string, input: EventSportsMetadataInput) {
  const payload: typeof eventSportsTable.$inferInsert = {
    event_id: eventId,
  }
  let hasSportsData = false

  if (input.sports_event_id !== null) {
    payload.sports_event_id = input.sports_event_id
    hasSportsData = true
  }
  if (input.sports_event_slug !== null) {
    payload.sports_event_slug = input.sports_event_slug
    hasSportsData = true
  }
  if (input.sports_parent_event_id !== null) {
    payload.sports_parent_event_id = input.sports_parent_event_id
    hasSportsData = true
  }
  if (input.sports_game_id !== null) {
    payload.sports_game_id = input.sports_game_id
    hasSportsData = true
  }
  if (input.sports_event_date !== null) {
    payload.sports_event_date = input.sports_event_date
    hasSportsData = true
  }
  if (input.sports_start_time !== null) {
    payload.sports_start_time = input.sports_start_time
    hasSportsData = true
  }
  if (input.sports_series_slug !== null) {
    payload.sports_series_slug = input.sports_series_slug
    hasSportsData = true
  }
  if (input.sports_series_id !== null) {
    payload.sports_series_id = input.sports_series_id
    hasSportsData = true
  }
  if (input.sports_series_recurrence !== null) {
    payload.sports_series_recurrence = input.sports_series_recurrence
    hasSportsData = true
  }
  if (input.sports_series_color !== null) {
    payload.sports_series_color = input.sports_series_color
    hasSportsData = true
  }
  if (input.sports_sport_slug !== null) {
    payload.sports_sport_slug = input.sports_sport_slug
    hasSportsData = true
  }
  if (input.sports_league_label !== null) {
    payload.sports_league_label = input.sports_league_label
    hasSportsData = true
  }
  if (input.sports_league_slug !== null) {
    payload.sports_league_slug = input.sports_league_slug
    hasSportsData = true
  }
  if (input.sports_event_week !== null) {
    payload.sports_event_week = input.sports_event_week
    hasSportsData = true
  }
  if (input.sports_score !== null) {
    payload.sports_score = input.sports_score
    hasSportsData = true
  }
  if (input.sports_period !== null) {
    payload.sports_period = input.sports_period
    hasSportsData = true
  }
  if (input.sports_elapsed !== null) {
    payload.sports_elapsed = input.sports_elapsed
    hasSportsData = true
  }
  if (input.sports_live !== null) {
    payload.sports_live = input.sports_live
    hasSportsData = true
  }
  if (input.sports_ended !== null) {
    payload.sports_ended = input.sports_ended
    hasSportsData = true
  }
  if (input.sports_tags !== null) {
    payload.sports_tags = input.sports_tags
    hasSportsData = true
  }
  if (input.sports_teams !== null) {
    payload.sports_teams = input.sports_teams
    hasSportsData = true
  }
  if (input.sports_team_logo_urls !== null) {
    payload.sports_team_logo_urls = input.sports_team_logo_urls
    hasSportsData = true
  }
  const sportsSourcePayload = buildEventSportsSourceUpsertPayload(input)
  if (sportsSourcePayload) {
    Object.assign(payload, sportsSourcePayload)
    hasSportsData = true
  }

  if (!hasSportsData) {
    return
  }

  payload.updated_at = new Date()
  await db
    .insert(eventSportsTable)
    .values(payload)
    .onConflictDoUpdate({
      target: [eventSportsTable.event_id],
      set: payload,
    })
}

async function upsertMarketSportsMetadata(conditionId: string, input: MarketSportsMetadataInput) {
  const payload: typeof marketSportsTable.$inferInsert = {
    condition_id: conditionId,
  }
  let hasSportsData = false

  if (input.event_id !== null) {
    payload.event_id = input.event_id
  }
  if (input.sports_market_type !== null) {
    payload.sports_market_type = input.sports_market_type
    hasSportsData = true
  }
  if (input.sports_line !== null) {
    payload.sports_line = input.sports_line
    hasSportsData = true
  }
  if (input.sports_group_item_title !== null) {
    payload.sports_group_item_title = input.sports_group_item_title
    hasSportsData = true
  }
  if (input.sports_group_item_threshold !== null) {
    payload.sports_group_item_threshold = input.sports_group_item_threshold
    hasSportsData = true
  }
  if (input.sports_game_start_time !== null) {
    payload.sports_game_start_time = input.sports_game_start_time
    hasSportsData = true
  }
  if (input.sports_event_id !== null) {
    payload.sports_event_id = input.sports_event_id
    hasSportsData = true
  }
  if (input.sports_parent_event_id !== null) {
    payload.sports_parent_event_id = input.sports_parent_event_id
    hasSportsData = true
  }
  if (input.sports_game_id !== null) {
    payload.sports_game_id = input.sports_game_id
    hasSportsData = true
  }
  if (input.sports_event_date !== null) {
    payload.sports_event_date = input.sports_event_date
    hasSportsData = true
  }
  if (input.sports_start_time !== null) {
    payload.sports_start_time = input.sports_start_time
    hasSportsData = true
  }
  if (input.sports_series_color !== null) {
    payload.sports_series_color = input.sports_series_color
    hasSportsData = true
  }
  if (input.sports_event_slug !== null) {
    payload.sports_event_slug = input.sports_event_slug
    hasSportsData = true
  }
  if (input.sports_teams !== null) {
    payload.sports_teams = input.sports_teams
    hasSportsData = true
  }
  if (input.sports_team_logo_urls !== null) {
    payload.sports_team_logo_urls = input.sports_team_logo_urls
    hasSportsData = true
  }
  const sportsSourcePayload = buildMarketSportsSourceUpsertPayload(input)
  if (sportsSourcePayload) {
    Object.assign(payload, sportsSourcePayload)
    hasSportsData = true
  }

  if (!hasSportsData) {
    return
  }

  payload.updated_at = new Date()
  await db
    .insert(marketSportsTable)
    .values(payload)
    .onConflictDoUpdate({
      target: [marketSportsTable.condition_id],
      set: payload,
    })
}

function normalizeStringField(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function getSeriesSlugsForCacheInvalidation(previousSeriesSlug: unknown, currentSeriesSlug: unknown) {
  return normalizeSeriesSlugsForCacheInvalidation([previousSeriesSlug, currentSeriesSlug])
}

export function normalizeSeriesSlugsForCacheInvalidation(seriesSlugs: unknown[]) {
  return Array.from(
    new Set(
      seriesSlugs
        .map((seriesSlug) => normalizeStringField(seriesSlug))
        .filter((seriesSlug): seriesSlug is string => Boolean(seriesSlug)),
    ),
  )
}

function normalizeStringIdField(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value))
  }
  return normalizeStringField(value)
}

function normalizeConfidenceField(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numericValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN

  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 1) {
    return null
  }

  return numericValue.toFixed(4)
}

function normalizeObjectField(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function normalizeLivestreamUrl(value: unknown): string | null {
  const normalized = normalizeStringField(value)
  if (!normalized) {
    return null
  }

  try {
    const url = new URL(normalized)
    if (url.protocol !== 'https:') {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

function normalizeSportsTeamsField(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const teams: Record<string, unknown>[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }

    const normalized: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(item as Record<string, unknown>)) {
      if (key === 'logo_url') {
        continue
      }
      if (raw === null || raw === undefined) {
        continue
      }
      if (typeof raw === 'string') {
        const trimmed = raw.trim()
        if (!trimmed) {
          continue
        }
        normalized[key] = trimmed
        continue
      }
      if (typeof raw === 'number' || typeof raw === 'boolean') {
        normalized[key] = raw
      }
    }

    if (Object.keys(normalized).length > 0) {
      teams.push(normalized)
    }
  }

  return teams.length > 0 ? teams : null
}

function normalizeStringArrayField(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const out: string[] = []
  for (const item of value) {
    const normalized = normalizeStringField(item)
    if (!normalized) {
      continue
    }
    if (!out.includes(normalized)) {
      out.push(normalized)
    }
  }

  return out.length > 0 ? out : null
}

async function normalizeSportsTeamAssets(
  teams: Record<string, unknown>[] | null,
): Promise<{ teams: Record<string, unknown>[] | null; logo_urls: string[] | null }> {
  const normalizedTeams = teams ? teams.map((team) => ({ ...team })) : null
  const logoUrls: string[] = []

  async function resolveAndPushLogo(reference: unknown): Promise<string | null> {
    const normalized = normalizeAssetReference(reference)
    if (!normalized) {
      return null
    }
    const stored = await persistSportsLogo(normalized)
    if (stored && !logoUrls.includes(stored)) {
      logoUrls.push(stored)
    }
    return stored
  }

  if (normalizedTeams && normalizedTeams.length > 0) {
    for (const team of normalizedTeams) {
      const logoRef = team.logo
      const resolved = await resolveAndPushLogo(logoRef)
      if (resolved) {
        team.logo_url = resolved
      }
    }
  }

  return {
    teams: normalizedTeams && normalizedTeams.length > 0 ? normalizedTeams : null,
    logo_urls: logoUrls.length > 0 ? logoUrls : null,
  }
}

function normalizeAssetReference(value: unknown): string | null {
  const normalized = normalizeStringField(value)
  if (!normalized) {
    return null
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized
  }

  const withoutScheme = normalized.replace(/^irys:\/\//i, '').trim()
  if (!withoutScheme) {
    return null
  }

  const withoutQuery = withoutScheme.split('?')[0]?.trim()
  if (!withoutQuery) {
    return null
  }

  const parts = withoutQuery.split('/').filter(Boolean)
  return parts.length > 0 ? (parts.at(-1) ?? withoutQuery) : withoutQuery
}

function buildSportsLogoStoragePath(reference: string): string {
  return buildCanonicalIconStoragePath(reference, `${SPORTS_LOGO_STORAGE_PREFIX}/logo-${hashStringToHex(reference)}`)
}

function isStableAssetReference(reference: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(reference)
}

function resolveStableAssetReference(assetReference: unknown): string | null {
  const normalizedReference = normalizeAssetReference(assetReference)
  if (!normalizedReference) {
    return null
  }
  if (isStableAssetReference(normalizedReference)) {
    return normalizedReference
  }
  if (!/^https?:\/\//i.test(normalizedReference)) {
    return null
  }

  try {
    const referenceUrl = new URL(normalizedReference)
    const gatewayUrl = new URL(IRYS_GATEWAY)
    if (referenceUrl.hostname !== gatewayUrl.hostname) {
      return null
    }

    const candidate = referenceUrl.pathname.split('/').filter(Boolean).at(-1) ?? ''
    return isStableAssetReference(candidate) ? candidate : null
  } catch {
    return null
  }
}

export function buildCanonicalIconStoragePath(assetReference: unknown, fallbackStoragePath: string): string {
  const stableReference = resolveStableAssetReference(assetReference)
  if (!stableReference) {
    return fallbackStoragePath
  }

  return `icons/source/${encodeURIComponent(stableReference)}.png`
}

async function persistSportsLogo(reference: string): Promise<string | null> {
  const cached = sportsLogoStorageCache.get(reference)
  if (cached) {
    return cached
  }

  const storagePath = buildSportsLogoStoragePath(reference)
  const stored = await downloadAndSaveImage(reference, storagePath)
  if (stored) {
    sportsLogoStorageCache.set(reference, stored)
  }
  return stored
}

function normalizeDateField(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed
    }
    const parsed = new Date(trimmed)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10)
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = value > 10_000_000_000 ? value : value * 1000
    const parsed = new Date(timestamp)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10)
    }
  }

  return null
}

function normalizeDecimalField(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString()
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) {
      return trimmed
    }
  }
  return null
}

function normalizeOptionalBooleanField(value: unknown): boolean | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') {
      return true
    }
    if (normalized === 'false' || normalized === '0') {
      return false
    }
    return null
  }
  if (typeof value === 'number') {
    if (value === 1) {
      return true
    }
    if (value === 0) {
      return false
    }
    return null
  }
  return null
}

function resolveMetadataStatusFlag(metadata: any, keys: string[], defaultValue: boolean): boolean {
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

function parseStoredMarketMetadata(value: unknown): Record<string, any> | null {
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

function resolveStoredMetadataStatusFlag(value: unknown, keys: string[], defaultValue: boolean): boolean {
  return resolveMetadataStatusFlag(parseStoredMarketMetadata(value), keys, defaultValue)
}

function hashStringToHex(value: string) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function normalizeStorageSlug(value: unknown, fallbackSeed: string) {
  const rawValue =
    typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
  const sanitized = rawValue
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  if (sanitized) {
    return sanitized
  }

  return `icon-${hashStringToHex(fallbackSeed || rawValue || 'fallback')}`
}

function normalizeIntegerField(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed)
    }
  }

  return null
}

function normalizeAddressField(value: unknown): string | null {
  const normalized = normalizeStringField(value)
  if (!normalized) {
    return null
  }
  return /^0x[a-fA-F0-9]{40}$/.test(normalized) ? normalized.toLowerCase() : normalized
}

function normalizeHexField(value: unknown): string | null {
  const normalized = normalizeStringField(value)
  if (!normalized) {
    return null
  }
  return normalized.startsWith('0x') ? normalized.toLowerCase() : normalized
}

function normalizeBooleanField(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') {
      return true
    }
    if (normalized === 'false') {
      return false
    }
  }
  if (typeof value === 'number') {
    return value !== 0
  }
  return Boolean(value)
}
