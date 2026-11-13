'use client'

import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import { useAppKitAccount } from '@reown/appkit/react'
import { useQueryClient } from '@tanstack/react-query'
import { useExtracted, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSignTypedData } from 'wagmi'

import type {
  MarketStatusFilter,
  SortDirection,
  SortOption,
} from '@/app/[locale]/(platform)/profile/_types/PublicPositionsTypes'
import type { NormalizedBookLevel } from '@/lib/order-panel-utils'
import type { User } from '@/types'

import { PositionShareDialog } from '@/app/[locale]/(platform)/_components/PositionShareDialog'
import SellPositionModal from '@/app/[locale]/(platform)/_components/SellPositionModal'
import { useTradingOnboarding } from '@/app/[locale]/(platform)/_providers/TradingOnboardingProvider'
import {
  handleOrderCancelledFeedback,
  handleOrderErrorFeedback,
  handleOrderSuccessFeedback,
  handleValidationError,
  useOrderFeedbackTranslate,
} from '@/app/[locale]/(platform)/event/[slug]/_components/feedback'
import { useMergePositionsAction } from '@/app/[locale]/(platform)/profile/_hooks/useMergePositionsAction'
import { usePublicPositionsQuery } from '@/app/[locale]/(platform)/profile/_hooks/usePublicPositionsQuery'
import {
  buildMergeableMarkets,
  calculatePositionsTotals,
  getDefaultSortDirection,
  getOutcomeLabel,
  isActiveUserPositionsQueryKeyForAddress,
  matchesPositionsSearchQuery,
  sortPositions,
} from '@/app/[locale]/(platform)/profile/_utils/PublicPositionsUtils'
import { useAppKit } from '@/hooks/useAppKit'
import { useDebounce } from '@/hooks/useDebounce'
import { useInfiniteLoadMore } from '@/hooks/useInfiniteLoadMore'
import { usePublicRuntimeConfig } from '@/hooks/usePublicRuntimeConfig'
import { useSignaturePromptRunner } from '@/hooks/useSignaturePromptRunner'
import { fetchOrderBookSummary } from '@/lib/clob'
import { getExchangeEip712Domain, ORDER_SIDE, ORDER_TYPE, OUTCOME_INDEX } from '@/lib/constants'
import { formatAmountInputValue, formatCentsLabel } from '@/lib/formatters'
import { applyPositionDeltasToPublicPositions, updateQueryDataWhere } from '@/lib/optimistic-trading'
import { calculateMarketFill, normalizeBookLevels } from '@/lib/order-panel-utils'
import { buildShareCardPayload } from '@/lib/share-card'
import { isTradingAuthRequiredError } from '@/lib/trading-auth/errors'
import { resolveViemRpcUrls } from '@/lib/viem-network'
import { isUserRejectedRequestError, normalizeAddress } from '@/lib/wallet'
import { useUser } from '@/stores/useUser'

import type { PublicPosition } from './PublicPositionItem'

import { MergePositionsDialog } from './MergePositionsDialog'
import PublicPositionsFilters from './PublicPositionsFilters'
import PublicPositionsTable from './PublicPositionsTable'

interface PublicPositionsListProps {
  userAddress: string
}

interface SellModalPayload {
  position: PublicPosition
  shares: number
  filledShares: number | null
  avgPriceCents: number | null
  receiveAmount: number | null
  sellBids: NormalizedBookLevel[]
  tokenId: string | null
  isNegRisk: boolean
}

function useUserTradingContext(userAddress: string) {
  const user = useUser()
  const hasDeployedDepositWallet = Boolean(user?.deposit_wallet_address && user?.deposit_wallet_status === 'deployed')
  const depositWalletAddress = hasDeployedDepositWallet ? normalizeAddress(user?.deposit_wallet_address) : null
  const makerAddress = depositWalletAddress ?? null
  const canSell = Boolean(
    hasDeployedDepositWallet &&
    user?.deposit_wallet_address &&
    user.deposit_wallet_address.toLowerCase() === userAddress.toLowerCase(),
  )

  return {
    user,
    makerAddress,
    canSell,
  }
}

function useSearchAndSortState(userAddress: string) {
  const [searchQueryState, setSearchQueryState] = useState<{ key: string; value: string }>({
    key: userAddress,
    value: '',
  })
  const searchQuery = searchQueryState.key === userAddress ? searchQueryState.value : ''
  const debouncedSearchQuery = useDebounce(searchQuery, 300)
  const [sortBy, setSortBy] = useState<SortOption>('currentValue')
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => getDefaultSortDirection('currentValue'))

  const handleSortChange = useCallback((value: SortOption) => {
    setSortBy(value)
    setSortDirection(getDefaultSortDirection(value))
  }, [])

  const handleHeaderSortToggle = useCallback((value: SortOption) => {
    setSortBy((currentSort) => {
      if (currentSort === value) {
        setSortDirection((currentDirection) => (currentDirection === 'asc' ? 'desc' : 'asc'))
        return currentSort
      }

      setSortDirection(getDefaultSortDirection(value))
      return value
    })
  }, [])

  return {
    searchQuery,
    debouncedSearchQuery,
    sortBy,
    sortDirection,
    setSearchQueryState,
    handleSortChange,
    handleHeaderSortToggle,
  }
}

function useRetryCountState(userAddress: string) {
  const [retryCountState, setRetryCountState] = useState<{ key: string; value: number }>({
    key: userAddress,
    value: 0,
  })
  const retryCount = retryCountState.key === userAddress ? retryCountState.value : 0

  return { retryCount, setRetryCountState }
}

function useSearchChangeHandler({
  userAddress,
  resetLoadMoreState,
  setRetryCountState,
  setSearchQueryState,
}: {
  userAddress: string
  resetLoadMoreState: () => void
  setRetryCountState: (value: { key: string; value: number }) => void
  setSearchQueryState: (value: { key: string; value: string }) => void
}) {
  return useCallback(
    (query: string) => {
      resetLoadMoreState()
      setRetryCountState({ key: userAddress, value: 0 })
      setSearchQueryState({ key: userAddress, value: query })
    },
    [resetLoadMoreState, setRetryCountState, setSearchQueryState, userAddress],
  )
}

function useShareDialog() {
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false)
  const [sharePosition, setSharePosition] = useState<PublicPosition | null>(null)

  const handleShareOpenChange = useCallback((open: boolean) => {
    setIsShareDialogOpen(open)
    if (!open) {
      setSharePosition(null)
    }
  }, [])

  const handleShareClick = useCallback((position: PublicPosition) => {
    setSharePosition(position)
    setIsShareDialogOpen(true)
  }, [])

  return {
    isShareDialogOpen,
    sharePosition,
    handleShareOpenChange,
    handleShareClick,
  }
}

function useShareCardPayload({ sharePosition, user }: { sharePosition: PublicPosition | null; user: User | null }) {
  return useMemo(() => {
    if (!sharePosition) {
      return null
    }

    return buildShareCardPayload(sharePosition, {
      userName: user?.username || undefined,
      userImage: user?.image || undefined,
    })
  }, [sharePosition, user?.image, user?.username])
}

function useMergeDialog() {
  const [isMergeDialogOpen, setIsMergeDialogOpen] = useState(false)
  const [mergeSuccess, setMergeSuccess] = useState(false)

  const handleMergeDialogChange = useCallback((open: boolean) => {
    setIsMergeDialogOpen(open)
    if (!open) {
      setMergeSuccess(false)
    }
  }, [])

  return {
    isMergeDialogOpen,
    setIsMergeDialogOpen,
    mergeSuccess,
    setMergeSuccess,
    handleMergeDialogChange,
  }
}

function usePositionsDerivations({
  data,
  debouncedSearchQuery,
  sortBy,
  sortDirection,
}: {
  data: InfiniteData<PublicPosition[]> | undefined
  debouncedSearchQuery: string
  sortBy: SortOption
  sortDirection: SortDirection
}) {
  const positions = useMemo(() => data?.pages.flat() ?? [], [data?.pages])

  const positionsWithIcons = useMemo(() => {
    if (positions.length === 0) {
      return positions
    }

    const iconByCondition = new Map<string, string>()
    positions.forEach((position) => {
      if (position.conditionId && position.icon) {
        iconByCondition.set(position.conditionId, position.icon)
      }
    })

    if (iconByCondition.size === 0) {
      return positions
    }

    const updatedPositions = positions.map((position) => {
      if (position.icon || !position.conditionId) {
        return position
      }

      const fallbackIcon = iconByCondition.get(position.conditionId)
      if (!fallbackIcon) {
        return position
      }

      return { ...position, icon: fallbackIcon }
    })

    return updatedPositions.some((position, index) => position !== positions[index]) ? updatedPositions : positions
  }, [positions])

  const visiblePositions = useMemo(
    () => positionsWithIcons.filter((position) => matchesPositionsSearchQuery(position, debouncedSearchQuery)),
    [debouncedSearchQuery, positionsWithIcons],
  )

  const sortedPositions = useMemo(
    () => sortPositions(visiblePositions, sortBy, sortDirection),
    [sortBy, sortDirection, visiblePositions],
  )

  const totals = useMemo(() => calculatePositionsTotals(visiblePositions), [visiblePositions])

  return {
    positionsWithIcons,
    visiblePositions,
    sortedPositions,
    totals,
  }
}

function useMergeableMarkets({
  canSell,
  positionsWithIcons,
}: {
  canSell: boolean
  positionsWithIcons: PublicPosition[]
}) {
  const mergeableMarkets = useMemo(() => buildMergeableMarkets(positionsWithIcons), [positionsWithIcons])

  return canSell ? mergeableMarkets : []
}

function useScrollToTopOnFilterChange({
  debouncedSearchQuery,
  minAmountFilter,
  marketStatusFilter,
  sortBy,
  sortDirection,
}: {
  debouncedSearchQuery: string
  minAmountFilter: string
  marketStatusFilter: string
  sortBy: SortOption
  sortDirection: SortDirection
}) {
  useEffect(
    function scrollToTopOnFilterChange() {
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    },
    [debouncedSearchQuery, minAmountFilter, marketStatusFilter, sortBy, sortDirection],
  )
}

function useRetryInitialLoad({
  userAddress,
  retryCount,
  refetch,
  setRetryCountState,
  resetLoadMoreState,
}: {
  userAddress: string
  retryCount: number
  refetch: () => Promise<unknown>
  setRetryCountState: (value: { key: string; value: number }) => void
  resetLoadMoreState: () => void
}) {
  return useCallback(() => {
    const currentRetryCount = retryCount + 1
    setRetryCountState({ key: userAddress, value: currentRetryCount })
    resetLoadMoreState()

    const delay = Math.min(1000 * 2 ** (currentRetryCount - 1), 8000)

    setTimeout(() => {
      void refetch()
    }, delay)
  }, [refetch, resetLoadMoreState, retryCount, setRetryCountState, userAddress])
}

function useResolveOutcomeIndex() {
  return useCallback((position: PublicPosition) => {
    if (typeof position.outcomeIndex === 'number') {
      return position.outcomeIndex
    }

    return getOutcomeLabel(position).toLowerCase().includes('no') ? OUTCOME_INDEX.NO : OUTCOME_INDEX.YES
  }, [])
}

function useSellPositionFlow({
  clobUrl,
  userAddress,
  makerAddress,
  user,
  isConnected,
  openWalletModal,
  queryClient,
  router,
  ensureTradingReady,
  openTradeRequirements,
  runWithSignaturePrompt,
  signTypedDataAsync,
  resolveOutcomeIndex,
  translate,
  locale,
}: {
  clobUrl: string
  userAddress: string
  makerAddress: `0x${string}` | null
  user: User | null
  isConnected: boolean
  openWalletModal: ReturnType<typeof useAppKit>['open']
  queryClient: QueryClient
  router: ReturnType<typeof useRouter>
  ensureTradingReady: () => boolean
  openTradeRequirements: (options?: { forceTradingAuth?: boolean }) => void
  runWithSignaturePrompt: ReturnType<typeof useSignaturePromptRunner>['runWithSignaturePrompt']
  signTypedDataAsync: ReturnType<typeof useSignTypedData>['signTypedDataAsync']
  resolveOutcomeIndex: (position: PublicPosition) => number
  translate: (message: string, values?: Record<string, string | number | Date>) => string
  locale: string
}) {
  const [sellModalPayload, setSellModalPayload] = useState<SellModalPayload | null>(null)
  const [isCashOutSubmitting, setIsCashOutSubmitting] = useState(false)
  const sellRequestIdRef = useRef(0)

  const handleSellClick = useCallback(
    async (position: PublicPosition) => {
      const shares = typeof position.size === 'number' ? position.size : 0
      if (!shares) {
        return
      }

      const requestId = sellRequestIdRef.current + 1
      sellRequestIdRef.current = requestId
      const resolvedOutcomeIndex = resolveOutcomeIndex(position)

      setSellModalPayload({
        position,
        shares,
        filledShares: null,
        avgPriceCents: null,
        receiveAmount: null,
        sellBids: [],
        tokenId: position.asset ?? null,
        isNegRisk: false,
      })

      const eventSlug = position.eventSlug || position.slug
      let tokenId = position.asset ?? null
      let isNegRisk = false

      if (eventSlug && position.conditionId) {
        try {
          const response = await fetch(
            `/api/events/${encodeURIComponent(eventSlug)}/market-metadata?conditionId=${encodeURIComponent(position.conditionId)}`,
          )
          if (response.ok) {
            const payload = await response.json()
            const outcomes = payload?.data?.outcomes ?? []
            isNegRisk = Boolean(payload?.data?.event_enable_neg_risk || payload?.data?.neg_risk)
            const matchedOutcome = outcomes.find(
              (outcome: { outcome_index?: number }) => outcome.outcome_index === resolvedOutcomeIndex,
            )
            tokenId = matchedOutcome?.token_id ?? tokenId
            setSellModalPayload((current) => {
              if (!current || current.position.id !== position.id || sellRequestIdRef.current !== requestId) {
                return current
              }
              return {
                ...current,
                tokenId,
                isNegRisk,
              }
            })
          }
        } catch (error) {
          console.error('Failed to resolve token id for sell preview.', error)
        }
      }

      if (!tokenId) {
        if (sellRequestIdRef.current === requestId) {
          setSellModalPayload(null)
          handleOrderErrorFeedback(translate('Sell unavailable'), translate('Market data is unavailable.'))
        }
        return
      }

      try {
        const summary = await fetchOrderBookSummary(tokenId, clobUrl)
        if (sellRequestIdRef.current !== requestId) {
          return
        }

        const bids = normalizeBookLevels(summary?.bids, 'bid')
        const asks = normalizeBookLevels(summary?.asks, 'ask')
        const fill = calculateMarketFill(ORDER_SIDE.SELL, shares, bids, asks)

        setSellModalPayload((current) => {
          if (!current || current.position.id !== position.id || sellRequestIdRef.current !== requestId) {
            return current
          }
          return {
            ...current,
            filledShares: fill.filledShares,
            avgPriceCents: fill.avgPriceCents,
            receiveAmount: fill.totalCost > 0 ? fill.totalCost : null,
            sellBids: bids,
          }
        })
      } catch (error) {
        console.error('Failed to load order book for sell preview.', error)
        if (sellRequestIdRef.current === requestId) {
          handleOrderErrorFeedback(translate('Order book unavailable'), translate('Please try again in a moment.'))
        }
      }
    },
    [clobUrl, resolveOutcomeIndex, translate],
  )

  const handleSellModalChange = useCallback((open: boolean) => {
    if (!open) {
      setSellModalPayload(null)
    }
  }, [])

  const handleEditOrder = useCallback(
    (sharesOverride?: number) => {
      if (!sellModalPayload) {
        return
      }

      const { position, shares } = sellModalPayload
      const eventSlug = position.eventSlug || position.slug
      if (!eventSlug) {
        setSellModalPayload(null)
        return
      }

      const resolvedOutcomeIndex = resolveOutcomeIndex(position)
      const targetShares =
        typeof sharesOverride === 'number' && Number.isFinite(sharesOverride) ? sharesOverride : shares

      const params = new URLSearchParams()
      params.set('side', 'SELL')
      params.set('orderType', 'Market')
      params.set('outcomeIndex', resolvedOutcomeIndex.toString())
      params.set('shares', formatAmountInputValue(targetShares, { roundingMode: 'floor' }))
      if (position.conditionId) {
        params.set('conditionId', position.conditionId)
      }

      setSellModalPayload(null)
      router.push(`/event/${eventSlug}?${params.toString()}`)
    },
    [resolveOutcomeIndex, router, sellModalPayload],
  )

  const handleCashOut = useCallback(
    async (sharesToSell: number) => {
      if (!sellModalPayload || isCashOutSubmitting) {
        return
      }

      const { position, tokenId, isNegRisk, sellBids } = sellModalPayload
      const eventSlug = position.eventSlug || position.slug
      const normalizedSharesToSell = Number.isFinite(sharesToSell) ? Number(sharesToSell.toFixed(4)) : 0
      const fill = calculateMarketFill(ORDER_SIDE.SELL, normalizedSharesToSell, sellBids, [])
      const marketPriceCents = fill.limitPriceCents ?? fill.avgPriceCents ?? null

      if (!marketPriceCents || fill.filledShares <= 0) {
        if (eventSlug) {
          handleEditOrder(normalizedSharesToSell)
          return
        }
        handleOrderErrorFeedback(translate('Trade failed'), translate('No liquidity for this market order.'))
        return
      }

      if (!ensureTradingReady()) {
        return
      }

      if (!isConnected) {
        handleValidationError('NOT_CONNECTED', { openWalletModal, translate })
        return
      }

      if (!user) {
        handleValidationError('MISSING_USER', { openWalletModal, translate })
        return
      }

      if (!makerAddress) {
        handleOrderErrorFeedback(translate('Trade failed'), translate('Wallet not ready for trading.'))
        return
      }

      const conditionId = position.conditionId ?? null
      if (!tokenId || !conditionId || !eventSlug) {
        handleOrderErrorFeedback(translate('Trade failed'), translate('Market data is unavailable.'))
        return
      }

      const effectiveShares = formatAmountInputValue(normalizedSharesToSell, { roundingMode: 'floor' })
      if (!effectiveShares) {
        handleOrderErrorFeedback(translate('Trade failed'), translate('Invalid share amount.'))
        return
      }

      const outcomeIndex = resolveOutcomeIndex(position)
      const outcomeText = getOutcomeLabel(position)
      const timestamp = new Date().toISOString()
      const [{ buildOrderPayload, submitOrder }, { signOrderPayload }] = await Promise.all([
        import('@/lib/orders'),
        import('@/lib/orders/signing'),
      ])

      const outcomePayload = {
        id: `portfolio-${tokenId}`,
        condition_id: conditionId,
        outcome_text: outcomeText,
        outcome_index: outcomeIndex,
        token_id: tokenId,
        is_winning_outcome: false,
        created_at: timestamp,
        updated_at: timestamp,
      }

      const orderDomain = getExchangeEip712Domain(isNegRisk)
      const payload = buildOrderPayload({
        makerAddress,
        outcome: outcomePayload,
        side: ORDER_SIDE.SELL,
        orderType: ORDER_TYPE.MARKET,
        amount: effectiveShares,
        limitPrice: '0',
        limitShares: '0',
        marketPriceCents,
      })

      let signature: string
      try {
        signature = await runWithSignaturePrompt(() =>
          signOrderPayload({
            payload,
            domain: orderDomain,
            signTypedDataAsync,
          }),
        )
      } catch (error) {
        if (isUserRejectedRequestError(error)) {
          handleOrderCancelledFeedback(translate)
          return
        }
        handleOrderErrorFeedback(
          translate('Trade failed'),
          translate('We could not sign your order. Please try again.'),
        )
        return
      }

      setIsCashOutSubmitting(true)
      try {
        const result = await submitOrder({
          order: payload,
          signature,
          orderType: ORDER_TYPE.MARKET,
          conditionId,
          slug: eventSlug,
          locale,
        })

        if (result?.error) {
          if (isTradingAuthRequiredError(result.error)) {
            openTradeRequirements({ forceTradingAuth: true })
            return
          } else {
            handleOrderErrorFeedback(translate('Trade failed'), result.error)
          }
          return
        }

        const avgSellPriceLabel = formatCentsLabel(marketPriceCents / 100, { fallback: '—' })
        handleOrderSuccessFeedback({
          side: ORDER_SIDE.SELL,
          amountInput: effectiveShares,
          sellSharesLabel: effectiveShares,
          isLimitOrder: false,
          outcomeText,
          eventTitle: position.title,
          marketImage: position.icon ? `https://gateway.irys.xyz/${position.icon}` : undefined,
          marketTitle: position.title,
          sellAmountValue: fill.totalCost > 0 ? fill.totalCost : 0,
          avgSellPrice: avgSellPriceLabel,
          queryClient,
          outcomeIndex,
          lastMouseEvent: null,
          translate,
        })

        updateQueryDataWhere<InfiniteData<PublicPosition[]>>(
          queryClient,
          ['user-positions'],
          (currentQueryKey) => isActiveUserPositionsQueryKeyForAddress(currentQueryKey, userAddress),
          (current) =>
            current
              ? {
                  ...current,
                  pages: current.pages.map(
                    (page) =>
                      applyPositionDeltasToPublicPositions(page, [
                        {
                          conditionId,
                          outcomeIndex: outcomeIndex as typeof OUTCOME_INDEX.YES | typeof OUTCOME_INDEX.NO,
                          sharesDelta: -normalizedSharesToSell,
                          currentPrice: marketPriceCents / 100,
                        },
                      ]) ?? page,
                  ),
                }
              : current,
        )

        setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: ['user-positions'] })
          void queryClient.invalidateQueries({ queryKey: ['portfolio-value'] })
        }, 4_000)
        setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: ['user-positions'] })
          void queryClient.invalidateQueries({ queryKey: ['portfolio-value'] })
        }, 12_000)

        setSellModalPayload(null)
      } catch {
        handleOrderErrorFeedback(
          translate('Trade failed'),
          translate('An unexpected error occurred. Please try again.'),
        )
      } finally {
        setIsCashOutSubmitting(false)
      }
    },
    [
      ensureTradingReady,
      handleEditOrder,
      openTradeRequirements,
      isCashOutSubmitting,
      isConnected,
      makerAddress,
      openWalletModal,
      queryClient,
      resolveOutcomeIndex,
      runWithSignaturePrompt,
      sellModalPayload,
      signTypedDataAsync,
      translate,
      locale,
      user,
      userAddress,
    ],
  )

  return {
    sellModalPayload,
    handleSellClick,
    handleSellModalChange,
    handleEditOrder,
    handleCashOut,
  }
}

export default function PublicPositionsList({ userAddress }: PublicPositionsListProps) {
  const t = useExtracted()
  const locale = useLocale()
  const translateFeedback = useOrderFeedbackTranslate()
  const queryClient = useQueryClient()
  const router = useRouter()
  const { open: openAppKit } = useAppKit()
  const { isConnected } = useAppKitAccount()
  const { signTypedDataAsync } = useSignTypedData()
  const { runWithSignaturePrompt } = useSignaturePromptRunner()
  const { clobUrl, polygonRpcUrl } = usePublicRuntimeConfig()
  const viemRpcUrls = useMemo(() => resolveViemRpcUrls(polygonRpcUrl), [polygonRpcUrl])
  const { ensureTradingReady, openTradeRequirements } = useTradingOnboarding()
  const { user, makerAddress, canSell } = useUserTradingContext(userAddress)

  const [marketStatusFilter, setMarketStatusFilter] = useState<MarketStatusFilter>('active')
  const minAmountFilter = 'All'

  const {
    searchQuery,
    debouncedSearchQuery,
    sortBy,
    sortDirection,
    setSearchQueryState,
    handleSortChange,
    handleHeaderSortToggle,
  } = useSearchAndSortState(userAddress)

  const loadMoreScopeKey = `${userAddress}:${debouncedSearchQuery}:${minAmountFilter}:${marketStatusFilter}:${sortBy}:${sortDirection}`

  const { retryCount, setRetryCountState } = useRetryCountState(userAddress)

  const { isShareDialogOpen, sharePosition, handleShareOpenChange, handleShareClick } = useShareDialog()

  const { isMergeDialogOpen, setIsMergeDialogOpen, mergeSuccess, setMergeSuccess, handleMergeDialogChange } =
    useMergeDialog()

  const { status, data, isFetchingNextPage, fetchNextPage, hasNextPage, refetch } = usePublicPositionsQuery({
    userAddress,
    status: marketStatusFilter,
    minAmountFilter,
    sortBy,
    sortDirection,
    searchQuery: debouncedSearchQuery,
  })

  const { positionsWithIcons, sortedPositions, totals } = usePositionsDerivations({
    data,
    debouncedSearchQuery,
    sortBy,
    sortDirection,
  })

  const mergeableMarkets = useMergeableMarkets({ canSell, positionsWithIcons })

  const hasMergeableMarkets = mergeableMarkets.length > 0

  const { isMergeProcessing, mergeBatchCount, handleMergeAll } = useMergePositionsAction({
    mergeableMarkets,
    hasMergeableMarkets,
    user,
    ensureTradingReady,
    openTradeRequirements,
    queryClient,
    viemRpcUrls,
    onSuccess: () => setMergeSuccess(true),
  })

  const shareCardPayload = useShareCardPayload({ sharePosition, user })

  const resolveOutcomeIndex = useResolveOutcomeIndex()

  const { sellModalPayload, handleSellClick, handleSellModalChange, handleEditOrder, handleCashOut } =
    useSellPositionFlow({
      clobUrl,
      userAddress,
      makerAddress,
      user,
      isConnected,
      openWalletModal: openAppKit,
      queryClient,
      router,
      ensureTradingReady,
      openTradeRequirements,
      runWithSignaturePrompt,
      signTypedDataAsync,
      resolveOutcomeIndex,
      translate: translateFeedback,
      locale,
    })

  useScrollToTopOnFilterChange({
    debouncedSearchQuery,
    minAmountFilter,
    marketStatusFilter,
    sortBy,
    sortDirection,
  })

  const handleLoadMoreSuccess = useCallback(() => {
    setRetryCountState({ key: userAddress, value: 0 })
  }, [setRetryCountState, userAddress])

  const { infiniteScrollError, isLoadingMore, loadMoreRef, loadMore, resetLoadMoreState } = useInfiniteLoadMore({
    loadMoreScopeKey,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    errorMessage: t('Failed to load more positions'),
    onSuccess: handleLoadMoreSuccess,
  })

  const handleSearchChange = useSearchChangeHandler({
    userAddress,
    resetLoadMoreState,
    setRetryCountState,
    setSearchQueryState,
  })

  const retryInitialLoad = useRetryInitialLoad({
    userAddress,
    retryCount,
    refetch,
    setRetryCountState,
    resetLoadMoreState,
  })

  const hasUserAddress = Boolean(userAddress)
  const loading = hasUserAddress && status === 'pending'
  const hasInitialError = hasUserAddress && status === 'error'
  const isSearchActive = debouncedSearchQuery.trim().length > 0

  return (
    <div className="space-y-3 pb-0">
      <PublicPositionsFilters
        searchQuery={searchQuery}
        sortBy={sortBy}
        marketStatusFilter={marketStatusFilter}
        onSearchChange={handleSearchChange}
        onSortChange={handleSortChange}
        onMarketStatusChange={setMarketStatusFilter}
        showMergeButton={hasMergeableMarkets && marketStatusFilter === 'active'}
        onMergeClick={() => {
          setMergeSuccess(false)
          setIsMergeDialogOpen(true)
        }}
      />

      <PublicPositionsTable
        positions={sortedPositions}
        totals={totals}
        isLoading={loading}
        hasInitialError={hasInitialError}
        isSearchActive={isSearchActive}
        searchQuery={debouncedSearchQuery}
        retryCount={retryCount}
        marketStatusFilter={marketStatusFilter}
        sortBy={sortBy}
        sortDirection={sortDirection}
        onSortHeaderClick={handleHeaderSortToggle}
        onRetry={retryInitialLoad}
        onRefreshPage={() => window.location.reload()}
        onShareClick={handleShareClick}
        onSellClick={canSell && marketStatusFilter === 'active' ? handleSellClick : undefined}
        loadMoreRef={loadMoreRef}
      />

      {(isFetchingNextPage || isLoadingMore) && (
        <div className="py-4 text-center text-xs text-muted-foreground">{t('Loading more...')}</div>
      )}

      {infiniteScrollError && (
        <div className="py-4 text-center text-xs text-no">
          {infiniteScrollError}{' '}
          <button type="button" onClick={loadMore} className="underline underline-offset-2">
            {t('Retry')}
          </button>
        </div>
      )}

      <MergePositionsDialog
        open={isMergeDialogOpen}
        onOpenChange={handleMergeDialogChange}
        markets={mergeableMarkets}
        isProcessing={isMergeProcessing}
        mergeCount={mergeBatchCount}
        isSuccess={mergeSuccess}
        onConfirm={handleMergeAll}
      />

      <PositionShareDialog open={isShareDialogOpen} onOpenChange={handleShareOpenChange} payload={shareCardPayload} />

      {sellModalPayload && (
        <SellPositionModal
          open={Boolean(sellModalPayload)}
          onOpenChange={handleSellModalChange}
          outcomeLabel={getOutcomeLabel(sellModalPayload.position)}
          outcomeShortLabel={sellModalPayload.position.title}
          outcomeIconUrl={
            sellModalPayload.position.icon ? `https://gateway.irys.xyz/${sellModalPayload.position.icon}` : undefined
          }
          shares={sellModalPayload.shares}
          filledShares={sellModalPayload.filledShares}
          avgPriceCents={sellModalPayload.avgPriceCents}
          receiveAmount={sellModalPayload.receiveAmount}
          sellBids={sellModalPayload.sellBids}
          onCashOut={handleCashOut}
          onEditOrder={handleEditOrder}
        />
      )}
    </div>
  )
}
