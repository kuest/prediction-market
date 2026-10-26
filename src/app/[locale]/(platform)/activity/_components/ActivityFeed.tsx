'use client'

import type { Route } from 'next'

import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { SquareArrowOutUpRightIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import type { DataApiActivity } from '@/lib/data-api/user'
import type { ActivityOrder } from '@/types'

import { usePlatformNavigationData } from '@/app/[locale]/(platform)/_providers/PlatformNavigationProvider'
import AlertBanner from '@/components/AlertBanner'
import EventIconImage from '@/components/EventIconImage'
import ProfileLink from '@/components/ProfileLink'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import useLocalizedTimeAgo from '@/hooks/useLocalizedTimeAgo'
import { useNowTimestamp } from '@/hooks/useNowTimestamp'
import { useOutcomeLabel } from '@/hooks/useOutcomeLabel'
import { usePublicRuntimeConfig } from '@/hooks/usePublicRuntimeConfig'
import { Link, useRouter } from '@/i18n/navigation'
import { filterActivitiesByMinAmount } from '@/lib/activity/filter'
import {
  GLOBAL_ACTIVITY_PAGE_SIZE,
  getNextGlobalActivityPageParam,
  mergeGlobalActivityItems,
  type GlobalActivityItem,
  type GlobalActivityPage,
} from '@/lib/activity/global'
import { PUBLIC_ALLOWED_MARKET_CREATORS_PATH } from '@/lib/allowed-market-creators'
import { MICRO_UNIT } from '@/lib/constants'
import { mapDataApiActivityToActivityOrder } from '@/lib/data-api/user'
import { formatDollarValueLabel, formatSharePriceLabel, toMicro } from '@/lib/formatters'
import { POLYGON_SCAN_BASE } from '@/lib/network'
import { buildPublicProfilePath, isPlatformMainCategorySlug } from '@/lib/platform-routing'
import { cn } from '@/lib/utils'
import {
  closeWebSocketWhenReady,
  createWebSocketHeartbeatController,
  createWebSocketReconnectController,
  probeWebSocketWithPong,
} from '@/lib/websocket-reconnect'

type LiveActivityPayload = DataApiActivity & {
  category?: string
  creator?: string
  mainCategory?: string
  main_category?: string
  tag?: string
  tags?: string[]
  eventTags?: string[]
  event_tags?: string[]
  categoryName?: string
  eventCategory?: string
  eventTag?: string
}

interface LiveActivityMessage {
  topic?: string
  type?: string
  payload?: LiveActivityPayload | LiveActivityPayload[]
}

interface LiveActivityItem {
  id: string
  categories: string[]
  order: ActivityOrder
}

interface ActivityCategoryOption {
  label: string
  value: string
}

interface LiveActivityStoreInput {
  wsUrl: string | undefined
  allowedCreatorWallets: ReadonlySet<string> | null
  categoryValues: ReadonlySet<string>
}

const MIN_AMOUNT_OPTIONS = [
  { value: 'none', label: 'None', display: 'Min amount' },
  { value: '10', label: '$10', display: 'Min $10' },
  { value: '100', label: '$100', display: 'Min $100' },
  { value: '1000', label: '$1,000', display: 'Min $1,000' },
  { value: '10000', label: '$10,000', display: 'Min $10,000' },
  { value: '100000', label: '$100,000', display: 'Min $100,000' },
] as const

const MAX_ITEMS = 100
const MAX_SEEN_ITEMS = MAX_ITEMS * 6
const EMPTY_LIVE_ACTIVITY_ITEMS: LiveActivityItem[] = []
const ROW_HEIGHT_ESTIMATE = 64
const MIN_VISIBLE_ITEMS = 12
const MAX_VISIBLE_ITEMS = 28
const DEFAULT_VIEWPORT_HEIGHT = 800

function isGlobalActivityPage(payload: unknown): payload is GlobalActivityPage {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  const candidate = payload as Partial<GlobalActivityPage>
  return (
    Array.isArray(candidate.items) &&
    candidate.items.every((item) => {
      if (!item || typeof item !== 'object') {
        return false
      }

      const activityItem = item as Partial<GlobalActivityItem>
      return (
        typeof activityItem.id === 'string' &&
        Array.isArray(activityItem.categoryTags) &&
        activityItem.categoryTags.every((tag) => typeof tag === 'string') &&
        Boolean(activityItem.order && typeof activityItem.order === 'object')
      )
    }) &&
    typeof candidate.hasMore === 'boolean' &&
    (typeof candidate.nextOffset === 'number' || candidate.nextOffset === null)
  )
}

async function fetchGlobalActivityPage({ pageParam, signal }: { pageParam: number; signal: AbortSignal }) {
  const params = new URLSearchParams({
    limit: GLOBAL_ACTIVITY_PAGE_SIZE.toString(),
    offset: pageParam.toString(),
  })
  const response = await fetch(`/api/activity?${params.toString()}`, {
    signal,
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error('Failed to load activity.')
  }

  const payload: unknown = await response.json().catch(() => null)
  if (!isGlobalActivityPage(payload)) {
    throw new Error('The activity response is invalid.')
  }

  return payload
}

function clampBaseVisibleCount(viewportHeight: number) {
  const estimate = Math.ceil(viewportHeight / ROW_HEIGHT_ESTIMATE) + 6
  return Math.min(MAX_VISIBLE_ITEMS, Math.max(MIN_VISIBLE_ITEMS, estimate))
}

function subscribeToViewportResize(onStoreChange: () => void) {
  window.addEventListener('resize', onStoreChange)
  return () => window.removeEventListener('resize', onStoreChange)
}

function getViewportHeightSnapshot() {
  return window.innerHeight || DEFAULT_VIEWPORT_HEIGHT
}

function getServerViewportHeightSnapshot() {
  return DEFAULT_VIEWPORT_HEIGHT
}

function normalizeCategoryValue(value: string | null | undefined, categoryValues: ReadonlySet<string>) {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const normalized = trimmed
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')

  if (normalized === 'climate and science' || normalized === 'climate science') {
    return 'weather'
  }

  if (normalized === 'geo politics' || normalized === 'geopolitics') {
    return 'geopolitics'
  }

  const slug = normalized.replace(/\s+/g, '-')
  if (categoryValues.has(slug)) {
    return slug
  }

  return null
}

function isActivityCategorySlug(slug: string) {
  return isPlatformMainCategorySlug(slug)
}

function buildActivityCategoryValues(tags: Array<{ slug: string }>) {
  return new Set(tags.filter((tag) => isActivityCategorySlug(tag.slug)).map((tag) => tag.slug))
}

function buildActivityCategoryOptions(
  tags: Array<{ slug: string; name: string }>,
  allLabel: string,
): ActivityCategoryOption[] {
  return [
    { value: 'all', label: allLabel },
    ...tags
      .filter((tag) => isActivityCategorySlug(tag.slug))
      .map((tag) => ({
        value: tag.slug,
        label: tag.name,
      })),
  ]
}

function resolveCategoryMatches(tags: string[] | null | undefined, categoryValues: ReadonlySet<string>) {
  if (!tags || tags.length === 0) {
    return []
  }

  const normalized = new Set<string>()
  for (const tag of tags) {
    const normalizedTag = normalizeCategoryValue(tag, categoryValues)
    if (normalizedTag) {
      normalized.add(normalizedTag)
    }
  }

  if (normalized.size === 0) {
    return []
  }

  return Array.from(normalized)
}

function resolveCategories(payload: LiveActivityPayload, categoryValues: ReadonlySet<string>) {
  const categories = new Set<string>()
  const tagMatches = resolveCategoryMatches(payload.tags ?? payload.eventTags ?? payload.event_tags, categoryValues)
  for (const match of tagMatches) {
    categories.add(match)
  }

  const rawCategory =
    payload.category ??
    payload.mainCategory ??
    payload.main_category ??
    payload.tag ??
    payload.categoryName ??
    payload.eventCategory ??
    payload.eventTag

  const normalizedCategory = normalizeCategoryValue(rawCategory, categoryValues)
  if (normalizedCategory) {
    categories.add(normalizedCategory)
  }

  return Array.from(categories)
}

function resolveMarketIcon(iconUrl?: string | null) {
  if (!iconUrl) {
    return null
  }

  return iconUrl.startsWith('http') ? iconUrl : `https://gateway.irys.xyz/${iconUrl}`
}

function resolveOutcomeColorClass(outcomeText?: string | null) {
  const normalized = (outcomeText ?? '').toLowerCase()
  if (normalized.includes('yes') || normalized.includes('up') || normalized.includes('true')) {
    return 'text-yes'
  }
  return 'text-no'
}

function hasText(value?: string | null) {
  return Boolean(value && value.trim())
}

function normalizeWalletAddress(value?: string | null) {
  if (!value) {
    return null
  }

  const normalized = value.trim().toLowerCase()
  return normalized || null
}

function resolveActivityCreatorWallet(payload: LiveActivityPayload) {
  return normalizeWalletAddress(payload.creator)
}

function useBaseVisibleCount() {
  const viewportHeight = useSyncExternalStore(
    subscribeToViewportResize,
    getViewportHeightSnapshot,
    getServerViewportHeightSnapshot,
  )
  return useMemo(() => clampBaseVisibleCount(viewportHeight), [viewportHeight])
}

function useAllowedCreatorWallets() {
  const [allowedCreatorWallets, setAllowedCreatorWallets] = useState<ReadonlySet<string> | null>(null)

  useEffect(function loadAllowedCreatorWalletsEffect() {
    const abortController = new AbortController()

    async function loadAllowedCreators() {
      try {
        const response = await fetch(PUBLIC_ALLOWED_MARKET_CREATORS_PATH, {
          signal: abortController.signal,
          cache: 'no-store',
        })

        if (!response.ok) {
          setAllowedCreatorWallets(new Set())
          return
        }

        const payload = (await response.json()) as { wallets: string[] }

        const wallets = payload.wallets
          .map((wallet) => normalizeWalletAddress(wallet))
          .filter((wallet): wallet is string => Boolean(wallet))
        setAllowedCreatorWallets(new Set(wallets))
      } catch (error) {
        if (abortController.signal.aborted) {
          return
        }
        console.error('Failed to load allowed market creator wallets:', error)
        setAllowedCreatorWallets(new Set())
      }
    }

    void loadAllowedCreators()

    return function abortLoadAllowedCreators() {
      abortController.abort()
    }
  }, [])

  return allowedCreatorWallets
}

function createLiveActivityStore() {
  let items = EMPTY_LIVE_ACTIVITY_ITEMS
  let seenIds = new Set<string>()
  let activeInputKey = ''

  function buildInputKey({ wsUrl, allowedCreatorWallets, categoryValues }: LiveActivityStoreInput) {
    const allowedCreatorsKey = allowedCreatorWallets ? Array.from(allowedCreatorWallets).sort().join('\0') : ''
    const categoryValuesKey = Array.from(categoryValues).sort().join('\0')
    return `${wsUrl ?? ''}\u0001${allowedCreatorsKey}\u0001${categoryValuesKey}`
  }

  function reset() {
    items = EMPTY_LIVE_ACTIVITY_ITEMS
    seenIds = new Set<string>()
  }

  function getSnapshot() {
    return items
  }

  function getServerSnapshot() {
    return EMPTY_LIVE_ACTIVITY_ITEMS
  }

  function subscribe(onStoreChange: () => void, input: LiveActivityStoreInput) {
    const inputKey = buildInputKey(input)
    if (activeInputKey !== inputKey) {
      activeInputKey = inputKey
      reset()
      onStoreChange()
    }

    const { wsUrl, allowedCreatorWallets, categoryValues } = input
    if (!wsUrl || !allowedCreatorWallets) {
      return () => {}
    }
    const activeWsUrl = wsUrl

    let isActive = true
    let ws: WebSocket | null = null

    function buildSubscriptionPayload(action: 'subscribe' | 'unsubscribe') {
      return JSON.stringify({
        action,
        subscriptions: [
          {
            topic: 'activity',
            type: 'orders_matched',
          },
        ],
      })
    }

    function handleOpen(socket: WebSocket) {
      if (socket !== ws) {
        return
      }
      reconnectController?.markConnected()
      heartbeatController?.markOpen(socket)
      socket.send(buildSubscriptionPayload('subscribe'))
    }

    function handleMessage(socket: WebSocket, eventMessage: MessageEvent<string>) {
      if (!isActive || socket !== ws) {
        return
      }
      heartbeatController?.markActivity(socket)

      let payload: LiveActivityMessage | null = null
      try {
        payload = JSON.parse(eventMessage.data)
      } catch {
        return
      }

      if (payload?.topic !== 'activity' || payload.type !== 'orders_matched' || !payload.payload) {
        return
      }

      const rawItems = Array.isArray(payload.payload) ? payload.payload : [payload.payload]
      const nextItems: LiveActivityItem[] = []

      for (const rawPayload of rawItems) {
        const creatorWallet = resolveActivityCreatorWallet(rawPayload)
        if (!creatorWallet || !allowedCreatorWallets?.has(creatorWallet)) {
          continue
        }

        const hasTitle = hasText(rawPayload.title)
        const hasMarketSlug = hasText(rawPayload.slug)
        const hasUser = hasText(rawPayload.pseudonym) || hasText(rawPayload.name) || hasText(rawPayload.proxyWallet)
        const hasSide = hasText(rawPayload.side)
        const hasOutcomeText = hasText(rawPayload.outcome)
        const hasOutcomeIndex = typeof rawPayload.outcomeIndex === 'number'
        const hasOutcome = hasOutcomeText || hasOutcomeIndex
        const hasPrice = Number.isFinite(rawPayload.price) && Number(rawPayload.price) > 0
        const hasTimestamp = Number.isFinite(rawPayload.timestamp)
        const hasSize = Number.isFinite(rawPayload.size) && Number(rawPayload.size) > 0
        const hasUsd = Number.isFinite(rawPayload.usdcSize) && Number(rawPayload.usdcSize) > 0
        const hasValue = hasPrice && (hasSize || hasUsd)

        if (
          !hasTitle ||
          !hasMarketSlug ||
          !hasUser ||
          !hasSide ||
          !hasOutcome ||
          !hasPrice ||
          !hasTimestamp ||
          !hasValue
        ) {
          continue
        }

        const order = mapDataApiActivityToActivityOrder(rawPayload)
        if (hasOutcomeText) {
          order.outcome.text = rawPayload.outcome!.trim()
        } else if (hasOutcomeIndex) {
          order.outcome.text = rawPayload.outcomeIndex === 0 ? 'Yes' : 'No'
        }
        if (hasOutcomeIndex) {
          order.outcome.index = rawPayload.outcomeIndex as number
        }
        const categories = resolveCategories(rawPayload, categoryValues)
        nextItems.push({
          id: order.id,
          categories,
          order,
        })
      }

      const uniqueNextItems = nextItems.filter((item) => {
        if (seenIds.has(item.id)) {
          return false
        }
        seenIds.add(item.id)
        return true
      })

      if (uniqueNextItems.length === 0) {
        return
      }

      const next = [...uniqueNextItems, ...items]
      const trimmed = next.slice(0, MAX_ITEMS)
      if (seenIds.size > MAX_SEEN_ITEMS) {
        seenIds = new Set(trimmed.map((item) => item.id))
      }
      items = trimmed
      onStoreChange()
    }

    function handleError() {
      // no-op
    }

    let reconnectController: ReturnType<typeof createWebSocketReconnectController> | null = null
    let heartbeatController: ReturnType<typeof createWebSocketHeartbeatController> | null = null

    function clearReconnect() {
      reconnectController?.clearReconnect()
    }

    function handleVisibilityChange() {
      reconnectController?.handleVisibilityChange()
    }

    function scheduleReconnect() {
      reconnectController?.scheduleReconnect()
    }

    function handleClose(socket: WebSocket) {
      if (socket !== ws) {
        return
      }
      heartbeatController?.clear()
      if (!isActive) {
        return
      }
      ws = null
      scheduleReconnect()
    }

    function connect() {
      if (!isActive || ws || document.hidden) {
        return
      }
      const socket = new WebSocket(activeWsUrl)
      socket.onopen = () => handleOpen(socket)
      socket.onmessage = (eventMessage) => handleMessage(socket, eventMessage)
      socket.onerror = handleError
      socket.onclose = () => handleClose(socket)
      ws = socket
      heartbeatController?.markConnecting(socket)
    }

    reconnectController = createWebSocketReconnectController({
      connect,
      getWebSocket: () => ws,
      isActive: () => isActive,
      probeWebSocket: probeWebSocketWithPong,
      resetWebSocket: () => {
        heartbeatController?.clear()
        ws = null
      },
    })
    heartbeatController = createWebSocketHeartbeatController({
      getWebSocket: () => ws,
      isActive: () => isActive,
      onConnectionLost: (socket) => {
        ws = null
        closeWebSocketWhenReady(socket)
        scheduleReconnect()
      },
    })

    connect()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return function teardownLiveActivityStream() {
      isActive = false
      clearReconnect()
      heartbeatController.clear()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      const socket = ws
      if (socket) {
        socket.onopen = null
        socket.onmessage = null
        socket.onerror = null
        socket.onclose = null
        closeWebSocketWhenReady(socket, (currentSocket) => {
          currentSocket.send(buildSubscriptionPayload('unsubscribe'))
          currentSocket.close()
        })
      }
    }
  }

  return { getSnapshot, getServerSnapshot, subscribe }
}

function useLiveActivityStream({
  wsUrl,
  allowedCreatorWallets,
  categoryValues,
}: {
  wsUrl: string | undefined
  allowedCreatorWallets: ReadonlySet<string> | null
  categoryValues: ReadonlySet<string>
}) {
  const [store] = useState(createLiveActivityStore)
  const categoryValuesKey = Array.from(categoryValues).sort().join('\0')
  const stableCategoryValues = useMemo(
    () => new Set(categoryValuesKey ? categoryValuesKey.split('\0') : []),
    [categoryValuesKey],
  )
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      store.subscribe(onStoreChange, {
        wsUrl,
        allowedCreatorWallets,
        categoryValues: stableCategoryValues,
      }),
    [allowedCreatorWallets, stableCategoryValues, store, wsUrl],
  )

  return useSyncExternalStore(subscribe, store.getSnapshot, store.getServerSnapshot)
}

function useHistoricalActivity({ allowedCreatorWallets }: { allowedCreatorWallets: ReadonlySet<string> | null }) {
  const allowedCreatorWalletsKey = useMemo(
    () => (allowedCreatorWallets ? Array.from(allowedCreatorWallets).sort().join('\0') : ''),
    [allowedCreatorWallets],
  )
  const canLoadActivity = allowedCreatorWallets !== null && allowedCreatorWallets.size > 0

  return useInfiniteQuery<
    GlobalActivityPage,
    Error,
    InfiniteData<GlobalActivityPage>,
    ['global-activity', string],
    number
  >({
    queryKey: ['global-activity', allowedCreatorWalletsKey],
    queryFn: ({ pageParam, signal }) => fetchGlobalActivityPage({ pageParam, signal }),
    enabled: canLoadActivity,
    initialPageParam: 0,
    getNextPageParam: getNextGlobalActivityPageParam,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  })
}

function useActivityItems({
  categoryValues,
  historicalPages,
  liveItems,
}: {
  categoryValues: ReadonlySet<string>
  historicalPages: GlobalActivityPage[] | undefined
  liveItems: LiveActivityItem[]
}) {
  const historicalItems = useMemo(
    () =>
      historicalPages?.flatMap((page) =>
        page.items.map((item) => ({
          id: item.id,
          categories: resolveCategoryMatches(item.categoryTags, categoryValues),
          order: item.order,
        })),
      ) ?? [],
    [categoryValues, historicalPages],
  )

  return useMemo(() => mergeGlobalActivityItems(liveItems, historicalItems), [historicalItems, liveItems])
}

function useFilteredActivityOrders({
  items,
  activeCategoryFilter,
  minAmountFilter,
}: {
  items: LiveActivityItem[]
  activeCategoryFilter: string
  minAmountFilter: string
}) {
  const minAmountMicro = useMemo(() => {
    const parsed = Number(minAmountFilter)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return undefined
    }
    return Number(toMicro(parsed))
  }, [minAmountFilter])

  return useMemo(() => {
    let filtered = items
    if (activeCategoryFilter !== 'all') {
      filtered = filtered.filter((item) => item.categories.includes(activeCategoryFilter))
    }
    return filterActivitiesByMinAmount(
      filtered.map((item) => item.order),
      minAmountMicro,
    )
  }, [activeCategoryFilter, items, minAmountMicro])
}

function useActivityCategoryOptions(tags: Array<{ slug: string; name: string }>, allLabel: string) {
  const categoryValues = useMemo(() => buildActivityCategoryValues(tags), [tags])
  const categoryOptions = useMemo(() => buildActivityCategoryOptions(tags, allLabel), [allLabel, tags])
  return { categoryValues, categoryOptions }
}

function useActivityFilters() {
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [minAmountFilter, setMinAmountFilter] = useState<string>('none')
  return { categoryFilter, setCategoryFilter, minAmountFilter, setMinAmountFilter }
}

function useActivityFilterLabels({
  categoryOptions,
  activeCategoryFilter,
  minAmountFilter,
  allLabel,
}: {
  categoryOptions: ActivityCategoryOption[]
  activeCategoryFilter: string
  minAmountFilter: string
  allLabel: string
}) {
  const minAmountDisplay = useMemo(() => {
    return MIN_AMOUNT_OPTIONS.find((option) => option.value === minAmountFilter)?.display ?? 'Min amount'
  }, [minAmountFilter])

  const categoryDisplay = useMemo(() => {
    return categoryOptions.find((option) => option.value === activeCategoryFilter)?.label ?? allLabel
  }, [activeCategoryFilter, allLabel, categoryOptions])

  return { minAmountDisplay, categoryDisplay }
}

function useActivityVisibleWindow({
  filteredOrdersLength,
  baseVisibleCount,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  visibleKey,
}: {
  filteredOrdersLength: number
  baseVisibleCount: number
  fetchNextPage: () => Promise<unknown>
  hasNextPage: boolean
  isFetchingNextPage: boolean
  visibleKey: string
}) {
  const [visibleWindow, setVisibleWindow] = useState<{ key: string; extra: number }>({ key: '', extra: 0 })
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const fetchInFlightRef = useRef(false)

  const visibleExtra = visibleWindow.key === visibleKey ? visibleWindow.extra : 0
  const visibleCount = Math.min(filteredOrdersLength, baseVisibleCount + visibleExtra)
  const pageSize = Math.max(6, Math.round(baseVisibleCount * 0.6))
  const hasHiddenItems = visibleCount < filteredOrdersLength
  const hasMoreItems = hasHiddenItems || hasNextPage

  useEffect(
    function observeActivityFeedSentinel() {
      const node = loadMoreRef.current
      if (!node || !hasMoreItems) {
        return
      }

      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0]
          if (!entry?.isIntersecting) {
            return
          }

          if (hasHiddenItems) {
            setVisibleWindow((current) => ({
              key: visibleKey,
              extra: (current.key === visibleKey ? current.extra : 0) + pageSize,
            }))
            return
          }

          if (!hasNextPage || isFetchingNextPage || fetchInFlightRef.current) {
            return
          }

          fetchInFlightRef.current = true
          void fetchNextPage().finally(() => {
            fetchInFlightRef.current = false
          })
        },
        { rootMargin: '200px 0px' },
      )

      observer.observe(node)
      return function unobserveActivityFeedSentinel() {
        observer.disconnect()
      }
    },
    [fetchNextPage, hasHiddenItems, hasMoreItems, hasNextPage, isFetchingNextPage, pageSize, visibleKey],
  )

  return { loadMoreRef, visibleCount, hasMoreItems, hasHiddenItems }
}

export default function ActivityFeed() {
  const t = useExtracted()
  const { formatTimeAgo } = useLocalizedTimeAgo()
  const normalizeOutcomeLabel = useOutcomeLabel()
  const { tags } = usePlatformNavigationData()
  const { wsLiveDataUrl } = usePublicRuntimeConfig()
  const wsUrl = wsLiveDataUrl
  const router = useRouter()
  const allLabel = t('All')
  const { categoryFilter, setCategoryFilter, minAmountFilter, setMinAmountFilter } = useActivityFilters()
  const { categoryValues, categoryOptions } = useActivityCategoryOptions(tags, allLabel)
  const baseVisibleCount = useBaseVisibleCount()
  const nowTimestamp = useNowTimestamp()
  const activeCategoryFilter = categoryValues.has(categoryFilter) ? categoryFilter : 'all'

  const allowedCreatorWallets = useAllowedCreatorWallets()
  const liveItems = useLiveActivityStream({ wsUrl, allowedCreatorWallets, categoryValues })
  const historicalActivityQuery = useHistoricalActivity({ allowedCreatorWallets })
  const items = useActivityItems({
    categoryValues,
    historicalPages: historicalActivityQuery.data?.pages,
    liveItems,
  })

  const filteredOrders = useFilteredActivityOrders({ items, activeCategoryFilter, minAmountFilter })

  const { minAmountDisplay, categoryDisplay } = useActivityFilterLabels({
    categoryOptions,
    activeCategoryFilter,
    minAmountFilter,
    allLabel,
  })

  const visibleKey = `${activeCategoryFilter}:${minAmountFilter}:${baseVisibleCount}`
  const { loadMoreRef, visibleCount, hasHiddenItems } = useActivityVisibleWindow({
    filteredOrdersLength: filteredOrders.length,
    baseVisibleCount,
    fetchNextPage: historicalActivityQuery.fetchNextPage,
    hasNextPage: historicalActivityQuery.hasNextPage,
    isFetchingNextPage: historicalActivityQuery.isFetchingNextPage,
    visibleKey,
  })
  const visibleOrders = filteredOrders.slice(0, visibleCount)

  const hasHistoricalActivityPages = (historicalActivityQuery.data?.pages.length ?? 0) > 0
  const isLoading = allowedCreatorWallets === null || (historicalActivityQuery.isFetching && items.length === 0)
  const hasActivityError = historicalActivityQuery.isError && !hasHistoricalActivityPages
  const hasNoActivity =
    !isLoading && !hasActivityError && filteredOrders.length === 0 && !historicalActivityQuery.hasNextPage

  const rowClassName = cn(
    `group relative z-0 grid w-full cursor-pointer grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 p-3 transition-all duration-200 ease-in-out before:pointer-events-none before:absolute before:-inset-x-3 before:inset-y-0 before:-z-10 before:rounded-lg before:bg-black/5 before:opacity-0 before:transition-opacity before:duration-200 before:content-[''] hover:before:opacity-100 sm:flex sm:gap-4 dark:before:bg-white/5`,
  )

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-semibold text-foreground md:text-3xl">{t('Activity')}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={activeCategoryFilter} onValueChange={(value) => value !== null && setCategoryFilter(value)}>
            <SelectTrigger className="h-10 text-base font-medium text-foreground">
              <SelectValue className="line-clamp-1">{categoryDisplay}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="start">
              {categoryOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={minAmountFilter} onValueChange={(value) => value !== null && setMinAmountFilter(value)}>
            <SelectTrigger className="h-10 text-base font-medium text-foreground">
              <SelectValue className="line-clamp-1">{minAmountDisplay}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="start">
              {MIN_AMOUNT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="divide-y divide-border/80">
        {isLoading &&
          !hasActivityError &&
          Array.from({ length: 10 }).map((_, index) => (
            <div key={`activity-skeleton-${index}`} className={rowClassName}>
              <div className="contents sm:flex sm:min-w-0 sm:flex-1 sm:items-start sm:gap-3">
                <Skeleton className="size-12 shrink-0 rounded-md" />
                <div className="contents sm:block sm:min-w-0 sm:flex-1 sm:space-y-2">
                  <Skeleton className="h-4 w-full rounded-full sm:w-2/5" />
                  <div className="col-span-3 flex items-center gap-2 sm:col-auto">
                    <Skeleton className="size-2 rounded-full" />
                    <Skeleton className="h-3 w-1/2 rounded-full" />
                  </div>
                </div>
              </div>
              <Skeleton className="col-start-3 row-start-1 h-3 w-14 rounded-full sm:col-auto sm:row-auto" />
            </div>
          ))}

        {hasNoActivity && (
          <div className="py-8 text-center text-base text-muted-foreground">{t('No activity found.')}</div>
        )}

        {hasActivityError && (
          <AlertBanner
            title={t('Failed to load activity')}
            description={
              <Button type="button" onClick={() => void historicalActivityQuery.refetch()} size="sm" variant="link">
                {t('Try again')}
              </Button>
            }
          />
        )}

        {!isLoading &&
          visibleOrders.length > 0 &&
          visibleOrders.map((activity) => {
            const eventSlug = activity.market.event?.slug || activity.market.slug
            const marketSlug = activity.market.event?.slug ? activity.market.slug : null
            const eventHref = (marketSlug ? `/event/${eventSlug}/${marketSlug}` : `/event/${eventSlug}`) as Route
            const marketIcon = resolveMarketIcon(activity.market.icon_url)
            const rawOutcomeText = activity.outcome.text || ''
            const outcomeText = normalizeOutcomeLabel(rawOutcomeText) || rawOutcomeText
            const outcomeColorClass = resolveOutcomeColorClass(rawOutcomeText)
            const priceLabel = formatSharePriceLabel(Number(activity.price), { fallback: '—' })
            const totalValue = Number.isFinite(activity.total_value) ? Number(activity.total_value) / MICRO_UNIT : 0
            const totalValueLabel =
              totalValue > 0
                ? formatDollarValueLabel(totalValue, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                : null
            const timeAgoLabel = nowTimestamp === null ? '—' : formatTimeAgo(activity.created_at, nowTimestamp)
            const txUrl = activity.tx_hash ? `${POLYGON_SCAN_BASE}/tx/${activity.tx_hash}` : null
            const username = activity.user.username || activity.user.address || ''

            return (
              <div
                key={activity.id}
                className={rowClassName}
                role="link"
                tabIndex={0}
                onClick={() => router.push(eventHref)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    router.push(eventHref)
                  }
                }}
              >
                <div className="contents sm:flex sm:min-w-0 sm:flex-1 sm:items-start sm:gap-3">
                  <Link
                    href={eventHref}
                    onClick={(event) => event.stopPropagation()}
                    className="relative size-12 shrink-0 overflow-hidden rounded-md"
                  >
                    {marketIcon ? (
                      <EventIconImage
                        src={marketIcon}
                        alt={activity.market.title}
                        sizes="48px"
                        containerClassName="size-full"
                      />
                    ) : (
                      <div className="size-full" aria-hidden />
                    )}
                  </Link>

                  <div className="contents sm:block sm:min-w-0 sm:flex-1 sm:space-y-1">
                    <Link
                      href={eventHref}
                      onClick={(event) => event.stopPropagation()}
                      className={cn(
                        `block max-w-[64ch] min-w-0 truncate text-sm text-muted-foreground underline-offset-2 hover:underline`,
                      )}
                      title={activity.market.title}
                    >
                      {activity.market.title}
                    </Link>

                    <div
                      className="col-span-3 min-w-0 sm:col-auto"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <ProfileLink
                        user={{
                          image: activity.user.image,
                          username,
                          address: activity.user.address,
                        }}
                        avatarSize={24}
                        profileSlug={activity.user.address || username}
                        profileHref={
                          activity.user.address || username
                            ? (buildPublicProfilePath(activity.user.address || username) ?? undefined)
                            : undefined
                        }
                        layout="inline"
                        containerClassName="gap-2 text-sm leading-tight [&_[data-avatar]]:h-6 [&_[data-avatar]]:w-6"
                        inlineRowClassName="max-sm:w-full"
                        inlineTriggerClassName="max-sm:min-w-20 max-sm:max-w-max max-sm:flex-[1_1_5rem]"
                        usernameClassName="font-semibold text-foreground underline-offset-2 hover:underline max-sm:text-[13.5px]"
                        usernameMaxWidthClassName="max-w-full sm:max-w-40"
                        inlineContent={
                          <>
                            <span className="text-muted-foreground">
                              {activity.side === 'sell' ? t('sold') : t('bought')}
                            </span>
                            <span
                              className={cn('max-w-full font-semibold [overflow-wrap:anywhere]', outcomeColorClass)}
                            >
                              {outcomeText}
                            </span>
                            <span className="max-w-full [overflow-wrap:anywhere] text-muted-foreground">
                              {t('at')}
                              {`\u00a0${priceLabel}`}
                              {totalValueLabel && `\u00a0(${totalValueLabel})`}
                            </span>
                          </>
                        }
                      />
                    </div>
                  </div>
                </div>

                <div
                  className={cn(
                    `col-start-3 row-start-1 flex shrink-0 items-center justify-end gap-1.5 text-xs whitespace-nowrap text-muted-foreground sm:col-auto sm:row-auto`,
                  )}
                >
                  {txUrl ? (
                    <>
                      <span>{timeAgoLabel}</span>
                      <a
                        href={txUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        aria-label={t('View transaction on Polygonscan')}
                      >
                        <SquareArrowOutUpRightIcon className="size-3" />
                      </a>
                    </>
                  ) : (
                    <span>{timeAgoLabel}</span>
                  )}
                </div>
              </div>
            )
          })}

        {!isLoading && (hasHiddenItems || historicalActivityQuery.isFetchingNextPage) && (
          <div className="flex items-center justify-center gap-2 py-3 text-base text-muted-foreground">
            <Spinner className="size-6" />
            {t('Loading more...')}
          </div>
        )}

        {!isLoading &&
          !hasHiddenItems &&
          historicalActivityQuery.hasNextPage &&
          !historicalActivityQuery.isFetchingNextPage && (
            <div className="flex items-center justify-center gap-2 py-3 text-base text-muted-foreground">
              <Spinner className="size-6" />
              {t('Loading more...')}
            </div>
          )}

        <div ref={loadMoreRef} className="h-1 w-full opacity-0" aria-hidden />
      </div>
    </div>
  )
}
