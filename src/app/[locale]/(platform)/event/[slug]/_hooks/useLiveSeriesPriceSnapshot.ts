import { useCallback, useMemo, useSyncExternalStore } from 'react'

import type { EventLiveChartConfig } from '@/types'

import type {
  LiveSeriesPriceSnapshot,
  LiveSeriesPriceSnapshotStatus,
  PersistedLivePrice,
} from '../_utils/eventLiveSeriesChartUtils'

import {
  isCanonicalEventBoundEquityCloseSnapshot,
  isCanonicalGoldDailyCloseSnapshot,
  isGoldDailySeries,
  LIVE_DATA_RETENTION_MS,
  normalizeLiveChartPrice,
  readPersistedLivePrice,
  writePersistedLivePrice,
} from '../_utils/eventLiveSeriesChartUtils'

interface UseLiveSeriesPriceSnapshotOptions {
  config: EventLiveChartConfig
  eventSlug?: string
  subscriptionSymbol: string
  explicitEndTimestamp: number | null
  startTimestamp: number | null
}

export interface LiveSeriesPriceSnapshotResult {
  referenceSnapshot: LiveSeriesPriceSnapshot | null
  referenceSnapshotStatus: LiveSeriesPriceSnapshotStatus
  persistedFallbackPrice: PersistedLivePrice | null
}

interface LiveSeriesPriceSnapshotStoreSnapshot {
  referenceSnapshot: LiveSeriesPriceSnapshot | null
  referenceSnapshotStatus: LiveSeriesPriceSnapshotStatus
  persistedFallbackPrice: PersistedLivePrice | null
}

interface LiveSeriesPriceSnapshotStoreEntry {
  snapshot: LiveSeriesPriceSnapshotStoreSnapshot
  inflightFetch: Promise<void> | null
  abortController: AbortController | null
  fetchToken: number
  listeners: Set<() => void>
}

interface LiveSeriesPriceSnapshotRequest {
  seriesSlug: string
  eventSlug?: string
  topic: string
  subscriptionSymbol: string
  activeWindowMinutes: number
  explicitEndTimestamp: number | null
  startTimestamp: number | null
}

const liveSeriesPriceSnapshotStores = new Map<string, LiveSeriesPriceSnapshotStoreEntry>()
const liveSeriesPriceStorageKeyPrefix = 'kuest-live-last-price'
const LIVE_SERIES_PRICE_SNAPSHOT_STORE_TTL_MS = 10 * 60 * 1000
const BINANCE_CLOSE_FIRST_REFRESH_DELAY_MS = 65 * 1000
const BINANCE_CLOSE_REFRESH_INTERVAL_MS = 10 * 1000
const BINANCE_CLOSE_REFRESH_WINDOW_MS = 5 * 60 * 1000
const GOLD_CLOSE_REFRESH_INTERVAL_MS = 60 * 1000
const GOLD_CLOSE_FAST_REFRESH_WINDOW_MS = 30 * 60 * 1000
const GOLD_CLOSE_SLOW_REFRESH_INTERVAL_MS = 5 * 60 * 1000
const GOLD_CLOSE_REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000
const OPENING_PRICE_FIRST_REFRESH_DELAY_MS = 5 * 1000
const OPENING_PRICE_REFRESH_INTERVAL_MS = 5 * 1000
const OPENING_PRICE_REFRESH_WINDOW_MS = 2 * 60 * 1000
const EQUITY_REFERENCE_REFRESH_INTERVAL_MS = 60 * 1000
const EMPTY_LIVE_SERIES_PRICE_SNAPSHOT: LiveSeriesPriceSnapshotStoreSnapshot = {
  referenceSnapshot: null,
  referenceSnapshotStatus: 'loading',
  persistedFallbackPrice: null,
}

function buildLiveSeriesPriceSnapshotStoreKey({
  seriesSlug,
  eventSlug,
  topic,
  subscriptionSymbol,
  activeWindowMinutes,
  explicitEndTimestamp,
  startTimestamp,
}: LiveSeriesPriceSnapshotRequest) {
  return [
    seriesSlug,
    eventSlug ?? '',
    topic.trim().toLowerCase(),
    subscriptionSymbol.trim().toLowerCase(),
    activeWindowMinutes,
    explicitEndTimestamp ?? 'live',
    startTimestamp ?? '',
  ].join(':')
}

function buildLiveSeriesPriceSnapshotQuery({
  seriesSlug,
  eventSlug,
  activeWindowMinutes,
  explicitEndTimestamp,
  startTimestamp,
}: LiveSeriesPriceSnapshotRequest) {
  const eventEndTimestamp = explicitEndTimestamp ?? Date.now()
  const query = new URLSearchParams({
    seriesSlug,
    eventEndMs: String(eventEndTimestamp),
    activeWindowMinutes: String(activeWindowMinutes),
  })

  if (eventSlug) {
    query.set('eventSlug', eventSlug)
  }

  if (startTimestamp != null && startTimestamp > 0 && startTimestamp < eventEndTimestamp) {
    query.set('eventStartMs', String(startTimestamp))
  }

  return query
}

function buildPersistedLivePriceStorageKey(topic: string, symbol: string) {
  return `${liveSeriesPriceStorageKeyPrefix}:${topic.trim().toLowerCase()}:${symbol.trim().toUpperCase()}`
}

function resolveRequestedWindowStart(request: LiveSeriesPriceSnapshotRequest) {
  if (request.startTimestamp != null && request.startTimestamp > 0) {
    return request.startTimestamp
  }

  if (request.explicitEndTimestamp == null) {
    return null
  }

  return request.explicitEndTimestamp - request.activeWindowMinutes * 60 * 1000
}

function hasRequestedOpeningPrice(snapshot: LiveSeriesPriceSnapshot | null, request: LiveSeriesPriceSnapshotRequest) {
  const requestedWindowStart = resolveRequestedWindowStart(request)
  const openingPrice = Number(snapshot?.opening_price)
  if (!snapshot || !Number.isFinite(openingPrice) || openingPrice <= 0) {
    return false
  }

  return requestedWindowStart == null || snapshot.event_window_start_ms === requestedWindowStart
}

function getLiveSeriesPriceSnapshotStoreEntry(storeKey: string) {
  const existingEntry = liveSeriesPriceSnapshotStores.get(storeKey)
  if (existingEntry) {
    return existingEntry
  }

  const nextEntry: LiveSeriesPriceSnapshotStoreEntry = {
    snapshot: EMPTY_LIVE_SERIES_PRICE_SNAPSHOT,
    inflightFetch: null,
    abortController: null,
    fetchToken: 0,
    listeners: new Set(),
  }
  liveSeriesPriceSnapshotStores.set(storeKey, nextEntry)
  return nextEntry
}

function pruneLiveSeriesPriceSnapshotStores() {
  const nowMs = Date.now()

  for (const [storeKey, entry] of liveSeriesPriceSnapshotStores.entries()) {
    if (entry.listeners.size > 0) {
      continue
    }

    if (entry.inflightFetch || entry.abortController) {
      continue
    }

    const snapshot = entry.snapshot.referenceSnapshot
    if (!snapshot) {
      liveSeriesPriceSnapshotStores.delete(storeKey)
      continue
    }

    const snapshotTimestamp = Math.max(
      snapshot.latest_source_timestamp_ms ?? 0,
      snapshot.event_window_end_ms ?? 0,
      snapshot.event_window_start_ms ?? 0,
      entry.snapshot.persistedFallbackPrice?.timestamp ?? 0,
    )

    if (snapshotTimestamp > 0 && nowMs - snapshotTimestamp > LIVE_SERIES_PRICE_SNAPSHOT_STORE_TTL_MS) {
      liveSeriesPriceSnapshotStores.delete(storeKey)
    }
  }
}

function arePersistedFallbackPricesEqual(a: PersistedLivePrice | null, b: PersistedLivePrice | null) {
  return Object.is(a?.price ?? null, b?.price ?? null) && Object.is(a?.timestamp ?? null, b?.timestamp ?? null)
}

function syncPersistedLivePriceSnapshot(storeKey: string, request: LiveSeriesPriceSnapshotRequest) {
  if (typeof window === 'undefined') {
    return false
  }

  const entry = getLiveSeriesPriceSnapshotStoreEntry(storeKey)
  const nextPersistedFallbackPrice = readPersistedLivePrice(request.topic, request.subscriptionSymbol)

  if (arePersistedFallbackPricesEqual(entry.snapshot.persistedFallbackPrice, nextPersistedFallbackPrice)) {
    return false
  }

  entry.snapshot = {
    ...entry.snapshot,
    persistedFallbackPrice: nextPersistedFallbackPrice,
  }

  return true
}

function notifyLiveSeriesPriceSnapshotStore(storeKey: string) {
  const entry = liveSeriesPriceSnapshotStores.get(storeKey)
  if (!entry) {
    return
  }

  for (const listener of entry.listeners) {
    listener()
  }

  pruneLiveSeriesPriceSnapshotStores()
}

async function fetchLiveSeriesPriceSnapshot(storeKey: string, request: LiveSeriesPriceSnapshotRequest) {
  const entry = getLiveSeriesPriceSnapshotStoreEntry(storeKey)
  if (entry.inflightFetch) {
    return entry.inflightFetch
  }

  const controller = new AbortController()
  const requestToken = entry.fetchToken + 1
  entry.fetchToken = requestToken
  entry.abortController = controller
  if (entry.snapshot.referenceSnapshot == null) {
    entry.snapshot = {
      ...entry.snapshot,
      referenceSnapshotStatus: 'loading',
    }
    notifyLiveSeriesPriceSnapshotStore(storeKey)
  }
  entry.inflightFetch = (async function runLiveSeriesPriceSnapshotFetch() {
    try {
      const response = await fetch(
        `/api/price-reference/live-series?${buildLiveSeriesPriceSnapshotQuery(request).toString()}`,
        {
          cache: 'no-store',
          signal: controller.signal,
        },
      )

      if (!response.ok) {
        entry.snapshot = {
          ...entry.snapshot,
          referenceSnapshotStatus: 'unavailable',
        }
        return
      }

      const payload = (await response.json()) as LiveSeriesPriceSnapshot
      entry.snapshot = {
        ...entry.snapshot,
        referenceSnapshot: payload,
        referenceSnapshotStatus: 'ready',
      }

      const fallbackPrice = normalizeLiveChartPrice(
        payload.latest_price ?? payload.closing_price ?? Number.NaN,
        request.topic,
      )

      if (typeof fallbackPrice === 'number') {
        const rawFallbackTimestamp = payload.latest_source_timestamp_ms ?? payload.event_window_end_ms ?? Date.now()
        const minTimestamp = Date.now() - LIVE_DATA_RETENTION_MS + 1000
        const fallbackTimestamp = Math.max(rawFallbackTimestamp, minTimestamp)
        writePersistedLivePrice(request.topic, request.subscriptionSymbol, fallbackPrice, fallbackTimestamp)
        entry.snapshot = {
          ...entry.snapshot,
          persistedFallbackPrice: {
            price: fallbackPrice,
            timestamp: fallbackTimestamp,
          },
        }
      }
    } catch {
      entry.snapshot = {
        ...entry.snapshot,
        referenceSnapshotStatus: 'unavailable',
      }
    } finally {
      if (entry.fetchToken === requestToken) {
        entry.inflightFetch = null
        entry.abortController = null
        notifyLiveSeriesPriceSnapshotStore(storeKey)
      }
    }
  })()

  return entry.inflightFetch
}

function subscribeToLiveSeriesPriceSnapshot(onStoreChange: () => void, request: LiveSeriesPriceSnapshotRequest) {
  if (typeof window === 'undefined') {
    return function unsubscribeFromLiveSeriesPriceSnapshot() {}
  }

  const storeKey = buildLiveSeriesPriceSnapshotStoreKey(request)
  const entry = getLiveSeriesPriceSnapshotStoreEntry(storeKey)
  entry.listeners.add(onStoreChange)
  let canonicalCloseRefreshTimer: ReturnType<typeof setTimeout> | null = null
  let openingPriceRefreshTimer: ReturnType<typeof setTimeout> | null = null
  let isSubscribed = true

  if (syncPersistedLivePriceSnapshot(storeKey, request)) {
    onStoreChange()
  }
  void fetchLiveSeriesPriceSnapshot(storeKey, request)

  const isGoldDaily = isGoldDailySeries(request.seriesSlug)
  const isEventBoundEquity =
    request.seriesSlug === 'hood-daily-up-or-down' || request.seriesSlug === 'coin-daily-up-or-down'
  const closeRefreshWindowMs =
    isGoldDaily || isEventBoundEquity ? GOLD_CLOSE_REFRESH_WINDOW_MS : BINANCE_CLOSE_REFRESH_WINDOW_MS
  const closeRefreshIntervalMs =
    isGoldDaily || isEventBoundEquity ? GOLD_CLOSE_REFRESH_INTERVAL_MS : BINANCE_CLOSE_REFRESH_INTERVAL_MS

  function getCloseRefreshIntervalMs(eventEndTimestamp: number) {
    return (isGoldDaily || isEventBoundEquity) && Date.now() >= eventEndTimestamp + GOLD_CLOSE_FAST_REFRESH_WINDOW_MS
      ? GOLD_CLOSE_SLOW_REFRESH_INTERVAL_MS
      : closeRefreshIntervalMs
  }

  async function refreshCanonicalCloseUntilAvailable() {
    if (!isSubscribed) {
      return
    }

    await fetchLiveSeriesPriceSnapshot(storeKey, request)
    const snapshot = entry.snapshot.referenceSnapshot
    const eventEndTimestamp = request.explicitEndTimestamp
    const hasClosingPrice = isGoldDaily
      ? isCanonicalGoldDailyCloseSnapshot({
          snapshot,
          snapshotStatus: entry.snapshot.referenceSnapshotStatus,
          eventWindowStartTimestamp: resolveRequestedWindowStart(request),
          eventWindowEndTimestamp: eventEndTimestamp,
        })
      : isEventBoundEquity
        ? isCanonicalEventBoundEquityCloseSnapshot({
            snapshot,
            snapshotStatus: entry.snapshot.referenceSnapshotStatus,
            eventWindowStartTimestamp: resolveRequestedWindowStart(request),
            eventWindowEndTimestamp: eventEndTimestamp,
            expectedInstrument: request.subscriptionSymbol.toUpperCase(),
          })
        : snapshot?.closing_price != null
    const hasExpectedSource = isGoldDaily
      ? snapshot?.source === 'pyth' && snapshot.interval === '1d' && snapshot.instrument === 'XAUUSD'
      : isEventBoundEquity
        ? snapshot?.source === 'pyth' &&
          snapshot.interval === '1d' &&
          snapshot.instrument === request.subscriptionSymbol.toUpperCase()
        : snapshot?.source === 'binance'
    if (
      !isSubscribed ||
      (snapshot != null && !hasExpectedSource) ||
      hasClosingPrice ||
      eventEndTimestamp == null ||
      Date.now() >= eventEndTimestamp + closeRefreshWindowMs
    ) {
      return
    }

    canonicalCloseRefreshTimer = setTimeout(
      refreshCanonicalCloseUntilAvailable,
      getCloseRefreshIntervalMs(eventEndTimestamp),
    )
  }

  if (request.explicitEndTimestamp != null) {
    const firstRefreshAtMs = request.explicitEndTimestamp + BINANCE_CLOSE_FIRST_REFRESH_DELAY_MS
    if (Date.now() < request.explicitEndTimestamp + closeRefreshWindowMs) {
      const firstRefreshDelayMs =
        firstRefreshAtMs > Date.now()
          ? firstRefreshAtMs - Date.now()
          : getCloseRefreshIntervalMs(request.explicitEndTimestamp)
      canonicalCloseRefreshTimer = setTimeout(refreshCanonicalCloseUntilAvailable, firstRefreshDelayMs)
    }
  }

  async function refreshOpeningPriceUntilAvailable() {
    if (!isSubscribed || hasRequestedOpeningPrice(entry.snapshot.referenceSnapshot, request)) {
      return
    }

    await fetchLiveSeriesPriceSnapshot(storeKey, request)
    const requestedWindowStart = resolveRequestedWindowStart(request)
    const openingRefreshWindowMs =
      isEventBoundEquity && request.explicitEndTimestamp != null && requestedWindowStart != null
        ? Math.max(0, request.explicitEndTimestamp - requestedWindowStart)
        : OPENING_PRICE_REFRESH_WINDOW_MS
    if (
      !isSubscribed ||
      hasRequestedOpeningPrice(entry.snapshot.referenceSnapshot, request) ||
      requestedWindowStart == null ||
      Date.now() >= requestedWindowStart + openingRefreshWindowMs
    ) {
      return
    }

    openingPriceRefreshTimer = setTimeout(
      refreshOpeningPriceUntilAvailable,
      isEventBoundEquity ? EQUITY_REFERENCE_REFRESH_INTERVAL_MS : OPENING_PRICE_REFRESH_INTERVAL_MS,
    )
  }

  const requestedWindowStart = resolveRequestedWindowStart(request)
  const openingRefreshWindowMs =
    isEventBoundEquity && request.explicitEndTimestamp != null && requestedWindowStart != null
      ? Math.max(0, request.explicitEndTimestamp - requestedWindowStart)
      : OPENING_PRICE_REFRESH_WINDOW_MS
  if (
    requestedWindowStart != null &&
    Date.now() < requestedWindowStart + openingRefreshWindowMs &&
    !hasRequestedOpeningPrice(entry.snapshot.referenceSnapshot, request)
  ) {
    const firstRefreshAtMs = requestedWindowStart + OPENING_PRICE_FIRST_REFRESH_DELAY_MS
    openingPriceRefreshTimer = setTimeout(refreshOpeningPriceUntilAvailable, Math.max(0, firstRefreshAtMs - Date.now()))
  }

  function refreshSnapshotAfterResume() {
    if (document.hidden) {
      return
    }

    if (syncPersistedLivePriceSnapshot(storeKey, request)) {
      onStoreChange()
    }
    void fetchLiveSeriesPriceSnapshot(storeKey, request)
  }

  function handleVisibilityChange() {
    if (!document.hidden) {
      refreshSnapshotAfterResume()
    }
  }

  function handleStorage(event: StorageEvent) {
    const storageKey = event.key
    if (!storageKey) {
      return
    }

    const expectedKey = buildPersistedLivePriceStorageKey(request.topic, request.subscriptionSymbol)
    if (storageKey !== expectedKey) {
      return
    }

    if (syncPersistedLivePriceSnapshot(storeKey, request)) {
      onStoreChange()
      return
    }

    onStoreChange()
  }

  window.addEventListener('storage', handleStorage)
  window.addEventListener('pageshow', refreshSnapshotAfterResume)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  return function unsubscribeFromLiveSeriesPriceSnapshot() {
    isSubscribed = false
    if (canonicalCloseRefreshTimer) {
      clearTimeout(canonicalCloseRefreshTimer)
    }
    if (openingPriceRefreshTimer) {
      clearTimeout(openingPriceRefreshTimer)
    }
    entry.listeners.delete(onStoreChange)
    if (entry.listeners.size === 0 && entry.abortController) {
      entry.fetchToken += 1
      entry.abortController.abort()
      entry.inflightFetch = null
      entry.abortController = null
      pruneLiveSeriesPriceSnapshotStores()
    }
    window.removeEventListener('storage', handleStorage)
    window.removeEventListener('pageshow', refreshSnapshotAfterResume)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }
}

function getLiveSeriesPriceSnapshotSnapshot(
  request: LiveSeriesPriceSnapshotRequest,
): LiveSeriesPriceSnapshotStoreSnapshot {
  const storeKey = buildLiveSeriesPriceSnapshotStoreKey(request)
  const entry = liveSeriesPriceSnapshotStores.get(storeKey)

  if (!entry) {
    return EMPTY_LIVE_SERIES_PRICE_SNAPSHOT
  }

  return entry.snapshot
}

export function useLiveSeriesPriceSnapshot({
  config,
  eventSlug,
  subscriptionSymbol,
  explicitEndTimestamp,
  startTimestamp,
}: UseLiveSeriesPriceSnapshotOptions): LiveSeriesPriceSnapshotResult {
  const seriesSlug = config.series_slug?.trim() ?? ''
  const snapshotRequest = useMemo<LiveSeriesPriceSnapshotRequest | null>(() => {
    if (!seriesSlug) {
      return null
    }

    if (explicitEndTimestamp != null && (!Number.isFinite(explicitEndTimestamp) || explicitEndTimestamp <= 0)) {
      return null
    }

    return {
      seriesSlug,
      eventSlug,
      topic: config.topic,
      subscriptionSymbol,
      activeWindowMinutes: config.active_window_minutes,
      explicitEndTimestamp,
      startTimestamp,
    }
  }, [
    config.active_window_minutes,
    config.topic,
    eventSlug,
    explicitEndTimestamp,
    seriesSlug,
    startTimestamp,
    subscriptionSymbol,
  ])

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!snapshotRequest) {
        return function unsubscribeFromLiveSeriesPriceSnapshot() {}
      }

      return subscribeToLiveSeriesPriceSnapshot(onStoreChange, snapshotRequest)
    },
    [snapshotRequest],
  )

  const getSnapshot = useCallback(() => {
    if (!snapshotRequest) {
      return EMPTY_LIVE_SERIES_PRICE_SNAPSHOT
    }

    return getLiveSeriesPriceSnapshotSnapshot(snapshotRequest)
  }, [snapshotRequest])

  const getServerSnapshot = useCallback(() => EMPTY_LIVE_SERIES_PRICE_SNAPSHOT, [])

  const referenceSnapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  return {
    referenceSnapshot: referenceSnapshot.referenceSnapshot,
    referenceSnapshotStatus: referenceSnapshot.referenceSnapshotStatus,
    persistedFallbackPrice: referenceSnapshot.persistedFallbackPrice,
  }
}
