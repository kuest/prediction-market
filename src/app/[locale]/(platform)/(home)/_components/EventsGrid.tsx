'use client'

import type { InfiniteData } from '@tanstack/react-query'

import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useExtracted, useLocale } from 'next-intl'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import type { FilterState } from '@/app/[locale]/(platform)/_providers/FilterProvider'
import type { HomeEventsApiPage } from '@/lib/events-api'
import type { Event } from '@/types'

import EventCardSkeleton from '@/app/[locale]/(platform)/(home)/_components/EventCardSkeleton'
import EventsGridSkeleton from '@/app/[locale]/(platform)/(home)/_components/EventsGridSkeleton'
import EventsStaticGrid from '@/app/[locale]/(platform)/(home)/_components/EventsStaticGrid'
import EventsEmptyState from '@/app/[locale]/(platform)/event/[slug]/_components/EventsEmptyState'
import { useEventLastTrades } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventLastTrades'
import { useEventMarketQuotes } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventMidPrices'
import { buildMarketTargets } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'
import { useAppKit } from '@/hooks/useAppKit'
import { useColumns } from '@/hooks/useColumns'
import { useCurrentTimestamp } from '@/hooks/useCurrentTimestamp'
import { useDebounce } from '@/hooks/useDebounce'
import { useHasHydrated } from '@/hooks/useHasHydrated'
import { matchesCryptoCadenceRoute } from '@/lib/crypto-cadence-event'
import {
  filterHomeEvents,
  isEventResolvedLike,
  resolveHomeLiveSeriesEndTimestamp,
  resolveHomeLiveSeriesStartTimestamp,
} from '@/lib/home-events'
import {
  fetchHomeEventsQueryPage,
  getHomeEventsNextPageParam,
  getHomeEventsQueryKey,
  HOME_FEED_REFRESH_INTERVAL_MS,
} from '@/lib/home-events-query'
import { getDefaultHomeRouteSortBy } from '@/lib/home-route-sort'
import { resolveHomeCardDisplayPrice } from '@/lib/market-chance'
import { buildHomeSportsMoneylineModel } from '@/lib/sports-home-card'
import { useUser } from '@/stores/useUser'

interface EventsGridProps {
  filters: FilterState
  initialEvents: Event[]
  initialEventsUpdatedAt?: number
  initialHasMore?: boolean
  initialCurrentTimestamp: number | null
  maxColumns?: number
  onClearFilters?: () => void
  routeMainTag: string
  routeTag: string
}

const EMPTY_EVENTS: Event[] = []
const EMPTY_PRICE_OVERRIDES: Record<string, number> = {}
const eventsSnapshotCache = new Map<string, Event[]>()
const EVENTS_SNAPSHOT_CACHE_LIMIT = 24
const HOME_LIVE_PRICE_OBSERVER_ROOT_MARGIN = '200px 0px'
const HOME_LIVE_OVERRIDE_SETTLE_DELAY_MS = 2_000
const MAX_HOME_ROLLOVER_TIMEOUT_MS = 2_147_483_647
function subscribeHomeVisibility(listener: () => void) {
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}

function getHomeVisibilitySnapshot() {
  return document.visibilityState !== 'hidden'
}

function hasFiniteTimestamp(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
}

function resolveCardMarkets(event: Event) {
  const activeMarkets = isEventResolvedLike(event)
    ? event.markets
    : event.markets.filter((market) => !market.is_resolved && !market.condition?.resolved)

  return activeMarkets.length > 0 ? activeMarkets : event.markets
}

function resolveHomeCardMarkets(event: Event) {
  const sportsMoneylineModel = buildHomeSportsMoneylineModel(event)
  if (!sportsMoneylineModel) {
    return resolveCardMarkets(event)
  }

  const marketIds = new Set(
    [
      sportsMoneylineModel.team1Button.conditionId,
      sportsMoneylineModel.team2Button.conditionId,
      sportsMoneylineModel.drawButton?.conditionId,
    ].filter(Boolean),
  )

  const matchingMarkets = event.markets.filter((market) => marketIds.has(market.condition_id))
  return matchingMarkets.length > 0 ? matchingMarkets : resolveCardMarkets(event)
}

function peekEventsSnapshot(key: string) {
  return eventsSnapshotCache.get(key) ?? null
}

function setEventsSnapshot(key: string, events: Event[]) {
  if (events.length === 0) {
    eventsSnapshotCache.delete(key)
    return
  }

  if (eventsSnapshotCache.has(key)) {
    eventsSnapshotCache.delete(key)
  }

  eventsSnapshotCache.set(key, events)

  while (eventsSnapshotCache.size > EVENTS_SNAPSHOT_CACHE_LIMIT) {
    const oldestKey = eventsSnapshotCache.keys().next().value
    if (!oldestKey) {
      break
    }

    eventsSnapshotCache.delete(oldestKey)
  }
}

interface UseEventsListParams {
  bookmarkedOnly: boolean
  currentTimestamp: number | null
  data: InfiniteData<HomeEventsApiPage, unknown> | undefined
  filters: FilterState
  snapshotKey: string
  status: string
  initialSnapshotEvents: Event[]
}

function syncVisibleEventsSnapshotCache(snapshotKey: string, visibleEvents: Event[]) {
  if (visibleEvents.length === 0) {
    return
  }

  setEventsSnapshot(snapshotKey, visibleEvents)
}

function deleteEmptySuccessEventsSnapshot(snapshotKey: string, status: string, visibleEventsLength: number) {
  if (status !== 'success' || visibleEventsLength > 0) {
    return
  }

  eventsSnapshotCache.delete(snapshotKey)
}

function filterBookmarkedOnlyEvents(events: Event[], bookmarkedOnly: boolean) {
  return bookmarkedOnly ? events.filter((event) => event.is_bookmarked) : events
}

function normalizeFilterSlug(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase()
  return normalized || null
}

function eventMatchesSelectedTags(event: Event, tag: string, mainTag: string) {
  const requiredSlugs = Array.from(
    new Set(
      [tag, mainTag]
        .map(normalizeFilterSlug)
        .filter((slug): slug is string => Boolean(slug) && slug !== 'trending' && slug !== 'new'),
    ),
  )

  if (requiredSlugs.length === 0) {
    return true
  }

  const eventTagSlugs = new Set(
    (event.tags ?? [])
      .map((eventTag) => normalizeFilterSlug(eventTag?.slug))
      .filter((slug): slug is string => Boolean(slug)),
  )

  return requiredSlugs.every((slug) => eventTagSlugs.has(slug) || matchesCryptoCadenceRoute(event, slug))
}

function hasKnownEventStatus(event: Event) {
  return (
    event.status === 'draft' || event.status === 'active' || event.status === 'resolved' || event.status === 'archived'
  )
}

function eventMatchesSelectedStatus(event: Event, status: FilterState['status']) {
  if (!hasKnownEventStatus(event)) {
    return true
  }

  if (status === 'resolved') {
    return isEventResolvedLike(event)
  }

  return event.status === 'active' && !isEventResolvedLike(event)
}

function eventMatchesSelectedFrequency(event: Event, frequency: FilterState['frequency']) {
  if (frequency === 'all') {
    return true
  }

  const recurrence = event.series_recurrence?.trim().toLowerCase()
  return recurrence ? recurrence === frequency : true
}

function eventMatchesSelectedSearch(event: Event, search: string) {
  const searchTerms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (searchTerms.length === 0) {
    return true
  }

  const title = event.title?.toLowerCase()
  return title ? searchTerms.every((term) => title.includes(term)) : true
}

function filterEventsForCurrentFilters(events: Event[], filters: FilterState, currentTimestamp: number | null) {
  if (events.length === 0) {
    return EMPTY_EVENTS
  }

  const matchingEvents = events.filter(
    (event) =>
      eventMatchesSelectedTags(event, filters.tag, filters.mainTag) &&
      eventMatchesSelectedStatus(event, filters.status) &&
      eventMatchesSelectedFrequency(event, filters.frequency) &&
      eventMatchesSelectedSearch(event, filters.search),
  )

  if (matchingEvents.length === 0) {
    return EMPTY_EVENTS
  }

  return filterHomeEvents(matchingEvents, {
    currentTimestamp,
    hideSports: filters.hideSports,
    hideCrypto: filters.hideCrypto,
    hideEarnings: filters.hideEarnings,
    status: filters.status,
  })
}

function useEventsList({
  bookmarkedOnly,
  currentTimestamp,
  data,
  filters,
  snapshotKey,
  status,
  initialSnapshotEvents,
}: UseEventsListParams) {
  const allEvents = useMemo(() => {
    const currentEvents = data ? data.pages.flatMap((page) => page.events) : []
    const matchingEvents = filterEventsForCurrentFilters(currentEvents, filters, currentTimestamp)
    return filterBookmarkedOnlyEvents(matchingEvents, bookmarkedOnly)
  }, [bookmarkedOnly, currentTimestamp, data, filters])
  const visibleEvents = useMemo(() => (allEvents.length === 0 ? EMPTY_EVENTS : allEvents), [allEvents])
  const cachedSnapshotEvents = useMemo(
    () => filterBookmarkedOnlyEvents(peekEventsSnapshot(snapshotKey) ?? initialSnapshotEvents, bookmarkedOnly),
    [bookmarkedOnly, initialSnapshotEvents, snapshotKey],
  )

  useEffect(
    function persistVisibleEventsSnapshot() {
      syncVisibleEventsSnapshotCache(snapshotKey, visibleEvents)
    },
    [snapshotKey, visibleEvents],
  )

  useEffect(
    function clearStaleEventsSnapshotOnEmptySuccess() {
      deleteEmptySuccessEventsSnapshot(snapshotKey, status, visibleEvents.length)
    },
    [snapshotKey, status, visibleEvents.length],
  )

  return { allEvents, visibleEvents, cachedSnapshotEvents }
}

function useHomeLivePriceVisibility(hydrationSafeEventsToRender: Event[]) {
  const parentRef = useRef<HTMLDivElement | null>(null)
  const [livePriceEventIds, setLivePriceEventIds] = useState<string[]>([])

  useEffect(
    function observeVisibleHomeEventCards() {
      if (!parentRef.current || hydrationSafeEventsToRender.length === 0) {
        return
      }

      const observedIds = new Set<string>()
      const cardElements = Array.from(parentRef.current.querySelectorAll<HTMLElement>('[data-home-event-id]'))

      if (cardElements.length === 0) {
        return
      }

      const observer = new IntersectionObserver(
        (entries) => {
          let hasChanges = false

          entries.forEach((entry) => {
            const eventId = entry.target.getAttribute('data-home-event-id')
            if (!eventId) {
              return
            }

            if (entry.isIntersecting) {
              if (!observedIds.has(eventId)) {
                observedIds.add(eventId)
                hasChanges = true
              }
              return
            }

            if (observedIds.delete(eventId)) {
              hasChanges = true
            }
          })

          if (hasChanges) {
            setLivePriceEventIds(Array.from(observedIds))
          }
        },
        { rootMargin: HOME_LIVE_PRICE_OBSERVER_ROOT_MARGIN },
      )

      cardElements.forEach((element) => observer.observe(element))

      return function disconnectHomeEventCardObserver() {
        observer.disconnect()
      }
    },
    [hydrationSafeEventsToRender],
  )

  return { parentRef, livePriceEventIds }
}

interface UseHomeLivePriceOverridesParams {
  hydrationSafeEventsToRender: Event[]
  livePriceEventIds: string[]
}

function useHomeLivePriceOverrides({
  hydrationSafeEventsToRender,
  livePriceEventIds,
}: UseHomeLivePriceOverridesParams) {
  const livePriceEvents = useMemo(
    () => hydrationSafeEventsToRender.filter((event) => livePriceEventIds.includes(String(event.id))),
    [hydrationSafeEventsToRender, livePriceEventIds],
  )
  const marketTargets = useMemo(
    () => livePriceEvents.flatMap((event) => buildMarketTargets(resolveHomeCardMarkets(event))),
    [livePriceEvents],
  )
  const marketQuotesByMarket = useEventMarketQuotes(marketTargets)
  const lastTradesByMarket = useEventLastTrades(marketTargets)
  const priceOverridesByMarket = useMemo(() => {
    if (livePriceEvents.length === 0) {
      return EMPTY_PRICE_OVERRIDES
    }

    const strictPriceByMarket: Record<string, number> = {}
    Object.keys({ ...marketQuotesByMarket, ...lastTradesByMarket }).forEach((conditionId) => {
      const quote = marketQuotesByMarket[conditionId]
      const lastTrade = lastTradesByMarket[conditionId]
      const displayPrice = resolveHomeCardDisplayPrice(quote, lastTrade)

      if (displayPrice != null) {
        strictPriceByMarket[conditionId] = displayPrice
      }
    })

    const nextOverrides: Record<string, number> = {}
    livePriceEvents.forEach((event) => {
      const displayMarkets = resolveHomeCardMarkets(event)
      if (displayMarkets.length === 0) {
        return
      }

      displayMarkets.forEach((market) => {
        const displayPrice = strictPriceByMarket[market.condition_id]
        if (displayPrice != null) {
          nextOverrides[market.condition_id] = displayPrice
        }
      })
    })

    return nextOverrides
  }, [lastTradesByMarket, livePriceEvents, marketQuotesByMarket])
  const priceOverrideSignature = useMemo(
    () =>
      Object.entries(priceOverridesByMarket)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([marketId, price]) => `${marketId}:${price}`)
        .join('|'),
    [priceOverridesByMarket],
  )
  const debouncedPriceOverridesByMarket = useDebounce(priceOverridesByMarket, HOME_LIVE_OVERRIDE_SETTLE_DELAY_MS)
  const stablePriceOverridesByMarket = priceOverrideSignature ? debouncedPriceOverridesByMarket : EMPTY_PRICE_OVERRIDES

  return { stablePriceOverridesByMarket }
}

interface UseInfiniteScrollLoadMoreParams {
  enabled: boolean
  hasNextPage: boolean
  fetchNextPage: () => Promise<unknown>
  isFetching: boolean
  isFetchingNextPage: boolean
  loadMoreStateKey: string
  fallbackErrorMessage: string
}

function useInfiniteScrollLoadMore({
  enabled,
  hasNextPage,
  fetchNextPage,
  isFetching,
  isFetchingNextPage,
  loadMoreStateKey,
  fallbackErrorMessage,
}: UseInfiniteScrollLoadMoreParams) {
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const canRetryLoadMoreAfterErrorRef = useRef(true)
  const [infiniteScrollErrorState, setInfiniteScrollErrorState] = useState<{
    key: string
    value: string | null
  }>({
    key: loadMoreStateKey,
    value: null,
  })
  const infiniteScrollError = infiniteScrollErrorState.key === loadMoreStateKey ? infiniteScrollErrorState.value : null

  useEffect(
    function observeLoadMoreSentinelForFetch() {
      if (infiniteScrollErrorState.key !== loadMoreStateKey) {
        canRetryLoadMoreAfterErrorRef.current = true
      }

      if (!enabled || !loadMoreRef.current || !hasNextPage || typeof IntersectionObserver === 'undefined') {
        return
      }

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry) {
            return
          }

          if (!entry.isIntersecting) {
            canRetryLoadMoreAfterErrorRef.current = true
            return
          }

          if (isFetching || isFetchingNextPage) {
            return
          }

          if (infiniteScrollError) {
            if (!canRetryLoadMoreAfterErrorRef.current) {
              return
            }

            setInfiniteScrollErrorState({ key: loadMoreStateKey, value: null })
          }

          fetchNextPage().catch((error: any) => {
            if (error?.name === 'CanceledError' || error?.name === 'AbortError') {
              return
            }

            canRetryLoadMoreAfterErrorRef.current = false
            setInfiniteScrollErrorState({
              key: loadMoreStateKey,
              value: error?.message || fallbackErrorMessage,
            })
          })
        },
        { rootMargin: '200px 0px' },
      )

      observer.observe(loadMoreRef.current)
      return function disconnectLoadMoreObserver() {
        observer.disconnect()
      }
    },
    [
      enabled,
      fetchNextPage,
      fallbackErrorMessage,
      hasNextPage,
      infiniteScrollError,
      infiniteScrollErrorState.key,
      isFetching,
      isFetchingNextPage,
      loadMoreStateKey,
    ],
  )

  return { loadMoreRef, infiniteScrollError }
}
export default function EventsGrid({
  filters,
  initialEvents,
  initialEventsUpdatedAt = 0,
  initialHasMore = false,
  initialCurrentTimestamp,
  maxColumns,
  onClearFilters,
  routeMainTag,
  routeTag,
}: EventsGridProps) {
  const t = useExtracted()
  const locale = useLocale()
  const user = useUser()
  const { open: openAppKit } = useAppKit()
  const queryUserScope = user?.id ?? 'guest'
  const sampledCurrentTimestamp = useCurrentTimestamp({
    initialTimestamp: initialCurrentTimestamp,
    intervalMs: HOME_FEED_REFRESH_INTERVAL_MS,
  })
  const [rolloverTimestamp, setRolloverTimestamp] = useState<number | null>(null)
  const lastVisibleTimestampRef = useRef<number | null>(initialCurrentTimestamp)
  const pendingRolloverRefreshRef = useRef(false)
  const isPageVisible = useSyncExternalStore(subscribeHomeVisibility, getHomeVisibilitySnapshot, () => true)
  const currentTimestamp =
    rolloverTimestamp != null && (sampledCurrentTimestamp == null || rolloverTimestamp > sampledCurrentTimestamp)
      ? rolloverTimestamp
      : sampledCurrentTimestamp
  const hasHydrated = useHasHydrated()
  const routeDefaultSortBy = getDefaultHomeRouteSortBy(routeTag)
  const snapshotKey = [
    locale,
    routeMainTag,
    routeTag,
    filters.tag,
    filters.mainTag,
    filters.search,
    filters.bookmarked ? 'bookmarked' : 'all-events',
    queryUserScope,
    filters.frequency,
    filters.sortBy,
    filters.status,
    filters.hideSports ? 'hide-sports' : 'show-sports',
    filters.hideCrypto ? 'hide-crypto' : 'show-crypto',
    filters.hideEarnings ? 'hide-earnings' : 'show-earnings',
  ].join(':')
  const isRouteInitialState =
    filters.tag === routeTag &&
    filters.mainTag === routeMainTag &&
    filters.search === '' &&
    !filters.bookmarked &&
    filters.frequency === 'all' &&
    filters.sortBy === routeDefaultSortBy &&
    filters.status === 'active' &&
    !filters.hideSports &&
    !filters.hideCrypto &&
    !filters.hideEarnings
  const initialSnapshotEvents = isRouteInitialState ? initialEvents : EMPTY_EVENTS
  const shouldAutoRefreshEvents = filters.status === 'active'
  const resolvedCurrentTimestamp = currentTimestamp ?? initialCurrentTimestamp
  const hasResolvedCurrentTimestamp = hasFiniteTimestamp(resolvedCurrentTimestamp)
  const hasInitialCurrentTimestamp = hasFiniteTimestamp(initialCurrentTimestamp)
  const homeFeedClockState = shouldAutoRefreshEvents
    ? hasResolvedCurrentTimestamp
      ? 'clock-ready'
      : 'clock-pending'
    : 'clock-static'
  const shouldUseInitialData =
    isRouteInitialState &&
    initialEvents.length > 0 &&
    queryUserScope === 'guest' &&
    (!shouldAutoRefreshEvents || !hasResolvedCurrentTimestamp || hasInitialCurrentTimestamp)
  const shouldEnableEventsQuery = !shouldAutoRefreshEvents || hasResolvedCurrentTimestamp
  const loadMoreStateKey = [
    filters.tag,
    filters.mainTag,
    filters.search,
    filters.bookmarked ? 'bookmarked' : 'all-events',
    filters.frequency,
    filters.sortBy,
    filters.status,
    filters.hideSports ? 'hide-sports' : 'show-sports',
    filters.hideCrypto ? 'hide-crypto' : 'show-crypto',
    filters.hideEarnings ? 'hide-earnings' : 'show-earnings',
    locale,
    queryUserScope,
  ].join(':')
  const [loadMoreErrorState, setLoadMoreErrorState] = useState<{ key: string; value: string | null }>({
    key: loadMoreStateKey,
    value: null,
  })
  const loadMoreError = loadMoreErrorState.key === loadMoreStateKey ? loadMoreErrorState.value : null
  const [infiniteScrollState, setInfiniteScrollState] = useState({
    key: loadMoreStateKey,
    enabled: false,
  })
  const infiniteScrollEnabled = infiniteScrollState.key === loadMoreStateKey && infiniteScrollState.enabled

  const eventsQueryKey = getHomeEventsQueryKey({ filters, locale, queryUserScope, homeFeedClockState })

  const {
    status,
    data,
    dataUpdatedAt,
    isFetching,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    isPending,
    isPlaceholderData,
    refetch,
  } = useInfiniteQuery({
    queryKey: eventsQueryKey,
    queryFn: ({ pageParam }) =>
      fetchHomeEventsQueryPage({
        pageParam,
        currentTimestamp: shouldAutoRefreshEvents ? Date.now() : resolvedCurrentTimestamp,
        filters,
        locale,
      }),
    getNextPageParam: getHomeEventsNextPageParam,
    initialPageParam: 0,
    initialData: shouldUseInitialData
      ? { pages: [{ events: initialEvents, hasMore: initialHasMore }], pageParams: [0] }
      : undefined,
    enabled: shouldEnableEventsQuery,
    refetchOnMount: shouldAutoRefreshEvents ? true : false,
    refetchOnWindowFocus: false,
    staleTime: shouldAutoRefreshEvents ? HOME_FEED_REFRESH_INTERVAL_MS : 'static',
    refetchInterval: shouldAutoRefreshEvents
      ? (query) => {
          if (typeof window === 'undefined') {
            return HOME_FEED_REFRESH_INTERVAL_MS
          }

          const remaining = HOME_FEED_REFRESH_INTERVAL_MS - (Date.now() - query.state.dataUpdatedAt)
          return remaining > 0 ? remaining : HOME_FEED_REFRESH_INTERVAL_MS
        }
      : false,
    refetchIntervalInBackground: true,
    initialDataUpdatedAt: shouldUseInitialData ? initialEventsUpdatedAt : 0,
    placeholderData: keepPreviousData,
  })

  const { allEvents, visibleEvents, cachedSnapshotEvents } = useEventsList({
    bookmarkedOnly: filters.bookmarked,
    currentTimestamp: resolvedCurrentTimestamp,
    data,
    filters,
    snapshotKey,
    status,
    initialSnapshotEvents,
  })

  const columns = useColumns(maxColumns)
  const loadingMoreColumns = Math.max(1, columns)
  const hasFreshQueryData = !shouldUseInitialData || dataUpdatedAt > initialEventsUpdatedAt
  const shouldShowSnapshotFallback =
    visibleEvents.length === 0 && cachedSnapshotEvents.length > 0 && status !== 'success'
  const eventsToRender = shouldShowSnapshotFallback ? cachedSnapshotEvents : visibleEvents
  const hydrationSafeEventsToRender = !hasHydrated && isRouteInitialState ? initialEvents : eventsToRender
  const rolloverCandidates = useMemo(
    () => (data ? data.pages.flatMap((page) => page.events) : initialEvents),
    [data, initialEvents],
  )

  useEffect(
    function scheduleHomeLiveSeriesRollover() {
      if (!shouldAutoRefreshEvents || !hasHydrated || !isPageVisible) {
        return
      }

      let timeoutId: number | null = null
      function reconcileTime() {
        if (timeoutId != null) {
          window.clearTimeout(timeoutId)
          timeoutId = null
        }
        if (!getHomeVisibilitySnapshot()) {
          return
        }

        const now = Date.now()
        const lastVisibleTimestamp = lastVisibleTimestampRef.current ?? now
        lastVisibleTimestampRef.current = now
        let nextTransition = Number.POSITIVE_INFINITY
        let crossedTransition = false

        for (const event of rolloverCandidates) {
          if (!event.has_live_chart || !event.series_slug?.trim()) {
            continue
          }
          const endTimestamp = resolveHomeLiveSeriesEndTimestamp(event)
          const startTimestamp = resolveHomeLiveSeriesStartTimestamp(event)
          for (const timestamp of [startTimestamp, endTimestamp]) {
            if (!Number.isFinite(timestamp)) {
              continue
            }
            if (timestamp > lastVisibleTimestamp && timestamp <= now) {
              crossedTransition = true
            } else if (timestamp > now) {
              nextTransition = Math.min(nextTransition, timestamp)
            }
          }
        }

        if (crossedTransition) {
          setRolloverTimestamp(now)
          pendingRolloverRefreshRef.current = true
        }
        if (pendingRolloverRefreshRef.current && !isFetching) {
          pendingRolloverRefreshRef.current = false
          void refetch()
        }
        if (Number.isFinite(nextTransition)) {
          timeoutId = window.setTimeout(
            reconcileTime,
            Math.min(MAX_HOME_ROLLOVER_TIMEOUT_MS, Math.max(1, nextTransition - now)),
          )
        }
      }

      reconcileTime()
      return function cancelHomeLiveSeriesRollover() {
        if (timeoutId != null) {
          window.clearTimeout(timeoutId)
        }
      }
    },
    [hasHydrated, isFetching, isPageVisible, refetch, rolloverCandidates, shouldAutoRefreshEvents],
  )

  const { parentRef, livePriceEventIds } = useHomeLivePriceVisibility(hydrationSafeEventsToRender)
  const { stablePriceOverridesByMarket } = useHomeLivePriceOverrides({
    hydrationSafeEventsToRender,
    livePriceEventIds,
  })

  const isLoadingNewData =
    eventsToRender.length === 0 &&
    (isPending || (isFetching && !isFetchingNextPage && (!data || data.pages.length === 0 || isPlaceholderData)))

  const { loadMoreRef, infiniteScrollError } = useInfiniteScrollLoadMore({
    enabled: infiniteScrollEnabled,
    hasNextPage,
    fetchNextPage,
    isFetching,
    isFetchingNextPage,
    loadMoreStateKey,
    fallbackErrorMessage: t('Failed to load more events.'),
  })

  async function handleLoadMore() {
    if (!hasNextPage || isFetching || isFetchingNextPage) {
      return
    }

    if (!user) {
      await openAppKit()
      return
    }

    setLoadMoreErrorState({ key: loadMoreStateKey, value: null })
    try {
      const result = await fetchNextPage()
      if (result.isError) {
        throw result.error
      }
      setInfiniteScrollState({ key: loadMoreStateKey, enabled: true })
    } catch (error: any) {
      if (error?.name === 'CanceledError' || error?.name === 'AbortError') {
        return
      }

      setLoadMoreErrorState({
        key: loadMoreStateKey,
        value: error?.message || 'Failed to load more events.',
      })
    }
  }

  if (isLoadingNewData) {
    return (
      <div ref={parentRef}>
        <EventsGridSkeleton maxColumns={maxColumns} />
      </div>
    )
  }

  if (status === 'error') {
    return <p className="text-center text-sm text-muted-foreground">{t('Could not load more events.')}</p>
  }

  if (hydrationSafeEventsToRender.length === 0 && (!allEvents || allEvents.length === 0)) {
    return <EventsEmptyState tag={filters.tag} searchQuery={filters.search} onClearFilters={onClearFilters} />
  }

  if (hydrationSafeEventsToRender.length === 0) {
    return (
      <div ref={parentRef} className="flex min-h-50 min-w-0 items-center justify-center text-sm text-muted-foreground">
        {t('No events match your filters.')}
      </div>
    )
  }

  return (
    <div ref={parentRef} className="w-full space-y-3 transition-opacity duration-200">
      <EventsStaticGrid
        events={hydrationSafeEventsToRender}
        priceOverridesByMarket={hasHydrated ? stablePriceOverridesByMarket : EMPTY_PRICE_OVERRIDES}
        maxColumns={maxColumns}
        isFetching={visibleEvents.length === 0 || (isFetching && hasFreshQueryData)}
        currentTimestamp={currentTimestamp}
      />

      {isFetchingNextPage && (
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${loadingMoreColumns}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: loadingMoreColumns }).map((_, index) => (
            <EventCardSkeleton key={`loading-more-${index}`} />
          ))}
        </div>
      )}

      {(loadMoreError || infiniteScrollError) && (
        <p className="text-center text-sm text-muted-foreground">{loadMoreError || infiniteScrollError}</p>
      )}

      {!infiniteScrollEnabled && hasNextPage && (
        <div className="flex justify-center pt-5">
          <button
            type="button"
            onClick={() => void handleLoadMore()}
            disabled={isFetching || isFetchingNextPage}
            className="rounded-full border border-border px-6 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-foreground/30 hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isFetchingNextPage ? t('Loading...') : t('Show more markets')}
          </button>
        </div>
      )}

      {infiniteScrollEnabled && hasNextPage && (
        <div
          ref={loadMoreRef}
          className="h-1 w-full"
          aria-hidden="true"
          data-testid="events-infinite-scroll-sentinel"
        />
      )}
    </div>
  )
}
