'use client'

import { useQueryClient } from '@tanstack/react-query'
import { AlignVerticalSpaceAroundIcon, ArrowLeftRightIcon, DropletsIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type {
  EventOrderBookProps,
  OrderBookLevel,
  OrderBookUserOrder,
} from '@/app/[locale]/(platform)/event/[slug]/_types/EventOrderBookTypes'

import { useTradingOnboarding } from '@/app/[locale]/(platform)/_providers/TradingOnboardingProvider'
import { cancelOrderAction } from '@/app/[locale]/(platform)/event/[slug]/_actions/cancel-order'
import EventTradeToast from '@/app/[locale]/(platform)/event/[slug]/_components/EventTradeToast'
import { useOrderBookSummaries } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useOrderBookSummaries'
import {
  buildUserOpenOrdersQueryKey,
  useUserOpenOrdersQuery,
} from '@/app/[locale]/(platform)/event/[slug]/_hooks/useUserOpenOrdersQuery'
import {
  buildOrderBookSnapshot,
  calculateLimitAmount,
  formatOrderBookPrice,
  formatSharesInput,
  getExecutableLimitPrice,
  getOrderBookUserKey,
  getRoundedCents,
  microToUnit,
} from '@/app/[locale]/(platform)/event/[slug]/_utils/EventOrderBookUtils'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCurrentTimestamp } from '@/hooks/useCurrentTimestamp'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useMarketRewards } from '@/hooks/useMarketRewards'
import { useOpenOrdersCacheInvalidation } from '@/hooks/useOpenOrdersCacheInvalidation'
import { useOutcomeLabel } from '@/hooks/useOutcomeLabel'
import { usePolymarketOrderBooks } from '@/hooks/usePolymarketOrderBooks'
import { ORDER_SIDE, ORDER_TYPE } from '@/lib/constants'
import { formatSharePriceLabel, formatSharesLabel } from '@/lib/formatters'
import { canProvideMarketLiquidity } from '@/lib/liquidity-ladder'
import { formatOddsFromCents } from '@/lib/odds-format'
import { isTradingAuthRequiredError } from '@/lib/trading-auth/errors'
import { cn } from '@/lib/utils'
import { useOrder } from '@/stores/useOrder'
import { useUser } from '@/stores/useUser'

import EventOrderBookEmptyRow from './EventOrderBookEmptyRow'
import EventOrderBookRow from './EventOrderBookRow'
import EventProvideLiquidityDialog from './EventProvideLiquidityDialog'
import EventRewardsBadge from './EventRewardsBadge'

export { useOrderBookSummaries }

const orderBookHeaderLabelClass =
  'inline-flex -translate-y-px whitespace-nowrap text-[10px] leading-3 tracking-normal sm:text-xs sm:tracking-wide'
const orderBookHeaderClass = 'py-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase'
const ROW_SHRINK_DELAY_MS = 3_000

function useHeldRowCount(count: number, tokenId: string | undefined) {
  const [held, setHeld] = useState({ count, tokenId })
  const heldCount = held.tokenId === tokenId ? Math.max(count, held.count) : count

  useEffect(() => {
    if (held.tokenId === tokenId && count === held.count) {
      return
    }

    const delay = held.tokenId !== tokenId || count > held.count ? 0 : ROW_SHRINK_DELAY_MS
    const timeout = window.setTimeout(() => setHeld({ count, tokenId }), delay)
    return () => window.clearTimeout(timeout)
  }, [count, held, tokenId])

  return heldCount
}

function EventOrderBookSkeletonRow() {
  return (
    <div className="grid h-9 grid-cols-[40%_20%_20%_20%] items-center pr-4 pl-0">
      <div />
      <div className="flex h-full items-center justify-center px-4">
        <Skeleton className="h-5 w-12 rounded-sm" />
      </div>
      <div className="flex h-full items-center justify-center px-2 sm:px-3">
        <Skeleton className="h-5 w-12 rounded-sm" />
      </div>
      <div className="flex h-full items-center justify-center px-2 sm:px-3">
        <Skeleton className="h-5 w-12 rounded-sm" />
      </div>
    </div>
  )
}

function useOrderBookRecenter(summary: unknown) {
  const orderBookScrollRef = useRef<HTMLDivElement | null>(null)
  const centerRowRef = useRef<HTMLDivElement | null>(null)
  const hasCenteredRef = useRef(false)

  const recenterOrderBook = useCallback(function recenterOrderBook(behavior: ScrollBehavior = 'smooth') {
    const container = orderBookScrollRef.current
    const centerRow = centerRowRef.current
    if (!container || !centerRow) {
      return
    }

    const target = centerRow.offsetTop - container.clientHeight / 2 + centerRow.clientHeight / 2
    const maxScrollTop = container.scrollHeight - container.clientHeight
    const clampedTarget = Math.max(0, Math.min(target, maxScrollTop))

    container.scrollTo({ top: clampedTarget, behavior })
  }, [])

  useLayoutEffect(
    function centerOrderBookOnSummaryReady() {
      if (!summary || hasCenteredRef.current) {
        return
      }

      recenterOrderBook('auto')
      hasCenteredRef.current = true
    },
    [recenterOrderBook, summary],
  )

  return { orderBookScrollRef, centerRowRef, hasCenteredRef, recenterOrderBook }
}

function useResetCenteringOnTokenChange(tokenId: string | undefined, hasCenteredRef: React.RefObject<boolean>) {
  useEffect(
    function resetCenteringFlagOnTokenChange() {
      hasCenteredRef.current = false
    },
    [tokenId, hasCenteredRef],
  )
}

function useRecenterKeyboardShortcut(recenterOrderBook: (behavior?: ScrollBehavior) => void) {
  useEffect(
    function attachRecenterKeyboardShortcut() {
      function handleRecenterKeyDown(event: KeyboardEvent) {
        if (!event.shiftKey || event.key.toLowerCase() !== 'c') {
          return
        }

        const target = event.target as HTMLElement | null
        const tagName = target?.tagName?.toLowerCase()
        const isEditable =
          tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target?.isContentEditable

        if (event.metaKey || event.ctrlKey || event.altKey || isEditable) {
          return
        }

        event.preventDefault()
        recenterOrderBook()
      }

      window.addEventListener('keydown', handleRecenterKeyDown)
      return function detachRecenterKeyboardShortcut() {
        window.removeEventListener('keydown', handleRecenterKeyDown)
      }
    },
    [recenterOrderBook],
  )
}

function useUserOrderBookOrders({
  userId,
  eventSlug,
  conditionId,
}: {
  userId?: string | null
  eventSlug: string
  conditionId?: string
}) {
  const openOrdersQueryKey = useMemo(
    () => buildUserOpenOrdersQueryKey(userId, eventSlug, conditionId),
    [eventSlug, conditionId, userId],
  )
  const eventOpenOrdersQueryKey = useMemo(() => buildUserOpenOrdersQueryKey(userId, eventSlug), [eventSlug, userId])
  const { data: userOpenOrdersData } = useUserOpenOrdersQuery({
    userId,
    eventSlug,
    conditionId,
    enabled: Boolean(userId),
  })
  const userOpenOrders = useMemo(
    () => userOpenOrdersData?.pages.flatMap((page) => page.data) ?? [],
    [userOpenOrdersData?.pages],
  )
  const userOrdersByLevel = useMemo(() => {
    const map = new Map<string, OrderBookUserOrder>()
    userOpenOrders.forEach((order) => {
      const bookSide: 'ask' | 'bid' = order.side === 'sell' ? 'ask' : 'bid'
      const roundedPrice = getRoundedCents(order.price ?? 0, bookSide)
      const totalShares = order.side === 'buy' ? microToUnit(order.taker_amount) : microToUnit(order.maker_amount)

      if (!Number.isFinite(totalShares) || totalShares <= 0) {
        return
      }

      const filledShares = Math.min(microToUnit(order.size_matched), totalShares)
      const key = getOrderBookUserKey(bookSide, roundedPrice)
      if (map.has(key)) {
        return
      }

      map.set(key, {
        id: order.id,
        priceCents: roundedPrice,
        totalShares,
        filledShares,
        side: bookSide,
      })
    })
    return map
  }, [userOpenOrders])

  return { openOrdersQueryKey, eventOpenOrdersQueryKey, userOrdersByLevel }
}

function useOrderBookUserOrderCancellation({
  queryClient,
  openOrdersQueryKey,
  eventOpenOrdersQueryKey,
  openTradeRequirements,
  marketTitle,
  marketImage,
  outcomeLabel,
}: {
  queryClient: ReturnType<typeof useQueryClient>
  openOrdersQueryKey: readonly unknown[]
  eventOpenOrdersQueryKey: readonly unknown[]
  openTradeRequirements: (options: { forceTradingAuth: boolean }) => void
  marketTitle: string
  marketImage?: string
  outcomeLabel: string
}) {
  const t = useExtracted()
  const [pendingCancelIds, setPendingCancelIds] = useState<Set<string>>(() => new Set())
  const openOrdersCacheQueryKeys = useMemo(
    () => [openOrdersQueryKey, eventOpenOrdersQueryKey],
    [eventOpenOrdersQueryKey, openOrdersQueryKey],
  )
  const { removeOrdersFromCache, invalidateAfterCancel } = useOpenOrdersCacheInvalidation({
    queryClient,
    queryKeys: openOrdersCacheQueryKeys,
  })

  const handleCancelUserOrder = useCallback(
    async function handleCancelUserOrder(order: OrderBookUserOrder) {
      const orderId = order.id
      if (!orderId || pendingCancelIds.has(orderId)) {
        return
      }

      setPendingCancelIds((current) => {
        const next = new Set(current)
        next.add(orderId)
        return next
      })

      try {
        const response = await cancelOrderAction(orderId)
        if (response?.error) {
          if (isTradingAuthRequiredError(response.error)) {
            openTradeRequirements({ forceTradingAuth: true })
            return
          }
          throw new Error(response.error)
        }

        const sideLabel = order.side === 'ask' ? t('Sell') : t('Buy')
        const orderDescription = t('{side} {shares} {outcome} shares @ {price}', {
          side: sideLabel,
          shares: formatSharesLabel(order.totalShares),
          outcome: outcomeLabel,
          price: formatSharePriceLabel(order.priceCents / 100, { fallback: '—' }),
        })

        toast.success(t('Order cancelled'), {
          content: (
            <EventTradeToast title={marketTitle} marketImage={marketImage}>
              {orderDescription}
            </EventTradeToast>
          ),
        })
        removeOrdersFromCache([orderId])

        await invalidateAfterCancel()
      } catch (error: any) {
        const message = typeof error?.message === 'string' ? error.message : t('Failed to cancel order.')
        toast.error(message)
      } finally {
        setPendingCancelIds((current) => {
          const next = new Set(current)
          next.delete(orderId)
          return next
        })
      }
    },
    [
      invalidateAfterCancel,
      marketImage,
      marketTitle,
      openTradeRequirements,
      outcomeLabel,
      pendingCancelIds,
      removeOrdersFromCache,
      t,
    ],
  )

  return { pendingCancelIds, handleCancelUserOrder }
}

export default function EventOrderBook({
  market,
  outcome,
  summaries,
  isLoadingSummaries,
  eventSlug,
  surfaceVariant = 'default',
  oddsFormat = 'price',
  tradeLabel,
  onToggleOutcome,
  toggleOutcomeTooltip,
  openMobileOrderPanelOnLevelSelect = false,
  rewardHighlight,
}: EventOrderBookProps) {
  const t = useExtracted()
  const normalizeOutcomeLabel = useOutcomeLabel()
  const user = useUser()
  const { openTradeRequirements } = useTradingOnboarding()
  const queryClient = useQueryClient()
  const tokenId = outcome?.token_id || market.outcomes[0]?.token_id
  const isSportsCardSurface = surfaceVariant === 'sportsCard'
  const surfaceClass = surfaceVariant === 'transparent' ? 'bg-transparent' : 'bg-card'
  const headerSurfaceClass = surfaceVariant === 'transparent' ? 'bg-background' : surfaceClass

  const summary = tokenId ? (summaries?.[tokenId] ?? null) : null
  const setType = useOrder((state) => state.setType)
  const setLimitPrice = useOrder((state) => state.setLimitPrice)
  const setLimitShares = useOrder((state) => state.setLimitShares)
  const setAmount = useOrder((state) => state.setAmount)
  const inputRef = useOrder((state) => state.inputRef)
  const currentOrderType = useOrder((state) => state.type)
  const currentOrderSide = useOrder((state) => state.side)
  const setIsMobileOrderPanelOpen = useOrder((state) => state.setIsMobileOrderPanelOpen)
  const isMobile = useIsMobile()
  const currentTimestamp = useCurrentTimestamp({ intervalMs: 60_000 })
  const [isLiquidityDialogOpen, setIsLiquidityDialogOpen] = useState(false)
  const [internalRewardHighlight, setInternalRewardHighlight] = useState(false)
  const showRewardHighlight = rewardHighlight ?? internalRewardHighlight
  const rewardsQuery = useMarketRewards([market.condition_id])
  const rewardConfig = rewardsQuery.data?.[0] ?? null
  const polymarketTokenId = outcome?.polymarket_token_id ?? null
  const usesPolymarketMidpoint = rewardConfig?.midpointSource.toLowerCase() === 'polymarket'
  const polymarketBooks = usePolymarketOrderBooks(
    polymarketTokenId ? [polymarketTokenId] : [],
    Boolean(usesPolymarketMidpoint && polymarketTokenId),
  )

  const { orderBookScrollRef, centerRowRef, hasCenteredRef, recenterOrderBook } = useOrderBookRecenter(summary)
  useResetCenteringOnTokenChange(tokenId, hasCenteredRef)
  useRecenterKeyboardShortcut(recenterOrderBook)

  const { openOrdersQueryKey, eventOpenOrdersQueryKey, userOrdersByLevel } = useUserOrderBookOrders({
    userId: user?.id,
    eventSlug,
    conditionId: market.condition_id,
  })

  const { asks, bids, lastPrice, spread, maxTotal, outcomeLabel } = useMemo(
    () => buildOrderBookSnapshot(summary, market, outcome),
    [summary, market, outcome],
  )
  const heldAskCount = useHeldRowCount(asks.length, tokenId)
  const heldBidCount = useHeldRowCount(bids.length, tokenId)
  const displayOutcomeLabel = normalizeOutcomeLabel(outcomeLabel) ?? outcomeLabel
  const displayTradeLabel = tradeLabel ?? `${t('Trade')} ${displayOutcomeLabel}`

  const { pendingCancelIds, handleCancelUserOrder } = useOrderBookUserOrderCancellation({
    queryClient,
    openOrdersQueryKey,
    eventOpenOrdersQueryKey,
    openTradeRequirements,
    marketTitle: market.short_title || market.title,
    marketImage: market.icon_url ?? undefined,
    outcomeLabel: displayOutcomeLabel,
  })
  const formatDisplayedPrice = useCallback(
    (priceCents: number | null | undefined) => {
      if (oddsFormat === 'price') {
        return formatOrderBookPrice(priceCents ?? null)
      }
      return formatOddsFromCents(priceCents ?? null, oddsFormat)
    },
    [oddsFormat],
  )

  const renderedAsks = useMemo(() => [...asks].sort((a, b) => b.priceCents - a.priceCents), [asks])
  const kuestMidpointCents =
    asks[0] && bids[0]
      ? (asks[0].priceCents + bids[0].priceCents) / 2
      : typeof lastPrice === 'number'
        ? lastPrice
        : null
  const polymarketSummary = polymarketTokenId ? polymarketBooks.data?.[polymarketTokenId] : null
  const polymarketAskPrices = (polymarketSummary?.asks ?? [])
    .map((level) => Number(level.price) * 100)
    .filter((price) => Number.isFinite(price) && price > 0)
  const polymarketBidPrices = (polymarketSummary?.bids ?? [])
    .map((level) => Number(level.price) * 100)
    .filter((price) => Number.isFinite(price) && price > 0)
  const polymarketMidpointCents =
    polymarketAskPrices.length && polymarketBidPrices.length
      ? (Math.min(...polymarketAskPrices) + Math.max(...polymarketBidPrices)) / 2
      : null
  const midpointCents = usesPolymarketMidpoint ? (polymarketMidpointCents ?? kuestMidpointCents) : kuestMidpointCents
  const isRewardEligible = useCallback(
    (level: OrderBookLevel) =>
      Boolean(
        rewardConfig &&
        midpointCents != null &&
        level.shares >= rewardConfig.minSize &&
        Math.abs(level.priceCents - midpointCents) < rewardConfig.maxSpread,
      ),
    [midpointCents, rewardConfig],
  )
  const hasMarketOrders = useMemo(
    () =>
      market.outcomes.some((marketOutcome) => {
        const marketSummary = marketOutcome.token_id ? summaries?.[marketOutcome.token_id] : null
        return Boolean(marketSummary?.asks?.length || marketSummary?.bids?.length)
      }),
    [market.outcomes, summaries],
  )
  const heldMarketHasOrders = useHeldRowCount(Number(hasMarketOrders), market.condition_id) > 0
  const showLiquidityAction = Boolean(
    summaries &&
    !heldMarketHasOrders &&
    currentTimestamp != null &&
    canProvideMarketLiquidity(market, currentTimestamp),
  )

  const orderBookCenterRow = (
    <div
      ref={centerRowRef}
      className={cn(
        `grid h-9 cursor-pointer grid-cols-[40%_20%_20%_20%] items-center border-y px-2 text-xs font-medium text-muted-foreground transition-colors sm:px-3`,
        isSportsCardSurface && 'sticky top-9 bottom-0 z-10',
        surfaceClass,
        'hover:bg-muted',
      )}
      role="presentation"
    >
      <div className="flex h-full cursor-pointer items-center">
        {t('Last')}
        :&nbsp;
        {lastPrice == null ? '--' : formatDisplayedPrice(lastPrice)}
      </div>
      <div className="flex h-full cursor-pointer items-center justify-center">
        {t('Spread')}
        :&nbsp;
        {formatOrderBookPrice(spread)}
      </div>
      <div className="flex h-full items-center justify-center" />
      <div className="flex h-full items-center justify-center" />
    </div>
  )

  const handleLevelSelect = useCallback(
    (level: OrderBookLevel) => {
      if (currentOrderType !== ORDER_TYPE.LIMIT) {
        setType(ORDER_TYPE.LIMIT)
      }
      const executablePrice = getExecutableLimitPrice(level)
      setLimitPrice(executablePrice)

      const shouldPrefillShares =
        (currentOrderSide === ORDER_SIDE.BUY && level.side === 'ask') ||
        (currentOrderSide === ORDER_SIDE.SELL && level.side === 'bid')

      if (shouldPrefillShares) {
        const limitShares = formatSharesInput(level.cumulativeShares)
        setLimitShares(limitShares)

        const limitAmount = calculateLimitAmount(executablePrice, limitShares)
        if (limitAmount !== null) {
          setAmount(limitAmount)
        }
      }

      if (openMobileOrderPanelOnLevelSelect && isMobile) {
        setIsMobileOrderPanelOpen(true)
      }

      queueMicrotask(() => inputRef?.current?.focus())
    },
    [
      currentOrderType,
      currentOrderSide,
      inputRef,
      isMobile,
      openMobileOrderPanelOnLevelSelect,
      setAmount,
      setIsMobileOrderPanelOpen,
      setLimitPrice,
      setLimitShares,
      setType,
    ],
  )

  if (!tokenId) {
    return (
      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
        {t('Order book data is unavailable for this outcome.')}
      </div>
    )
  }

  return (
    <div ref={orderBookScrollRef} className={cn('relative isolate max-h-90 overflow-y-auto', surfaceClass)}>
      <div className={cn(surfaceClass)}>
        <div
          className={cn(
            orderBookHeaderClass,
            'grid h-9 grid-cols-[40%_20%_20%_20%] items-center border-b pr-4 pl-0',
            'sticky top-0 z-10',
            headerSurfaceClass,
          )}
        >
          <div className="flex h-full min-w-0 items-center gap-1 pl-2 sm:pl-3">
            <span className={orderBookHeaderLabelClass}>{displayTradeLabel}</span>
            {onToggleOutcome && toggleOutcomeTooltip && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className={cn(
                        `inline-flex size-6 translate-y-[-1.5px] items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground`,
                      )}
                      onClick={onToggleOutcome}
                      aria-label={toggleOutcomeTooltip}
                    >
                      <ArrowLeftRightIcon className="size-3.5" />
                    </button>
                  }
                />
                <TooltipContent side="right">{toggleOutcomeTooltip}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className={cn(
                      `inline-flex size-6 translate-y-[-1.5px] items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground`,
                    )}
                    onClick={() => recenterOrderBook()}
                    aria-label={t('Recenter order book')}
                  >
                    <AlignVerticalSpaceAroundIcon className="size-4" />
                  </button>
                }
              />
              <TooltipContent side="right">{t('Recenter Book (Shift + C)')}</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex h-full items-center justify-center">
            <span className={orderBookHeaderLabelClass}>{t('Price')}</span>
          </div>
          <div className="flex h-full items-center justify-center">
            <span className={orderBookHeaderLabelClass}>{t('Shares')}</span>
          </div>
          <div
            className={cn(
              'flex h-full items-center',
              rewardConfig && rewardHighlight === undefined
                ? 'justify-between gap-1 pr-1'
                : 'justify-center px-2 sm:px-3',
            )}
          >
            <span className={orderBookHeaderLabelClass}>{t('Total')}</span>
            {rewardConfig && rewardHighlight === undefined && (
              <EventRewardsBadge
                rewards={[rewardConfig]}
                compact
                active={showRewardHighlight}
                onHighlightChange={setInternalRewardHighlight}
              />
            )}
          </div>
        </div>

        {isLoadingSummaries ? (
          <>
            {Array.from({ length: 4 }, (_, index) => (
              <EventOrderBookSkeletonRow key={`ask-skeleton-${index}`} />
            ))}

            {orderBookCenterRow}

            {Array.from({ length: 4 }, (_, index) => (
              <EventOrderBookSkeletonRow key={`bid-skeleton-${index}`} />
            ))}
          </>
        ) : showLiquidityAction ? (
          <div className="flex min-h-44 flex-col items-center justify-center gap-3 px-6 py-8 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <DropletsIcon className="size-5" />
            </span>
            <div className="space-y-1">
              <p className="text-sm font-semibold">{t('This order book is empty')}</p>
              <p className="max-w-72 text-xs text-muted-foreground">
                {t('Add the first buy and sell orders with a guided liquidity ladder.')}
              </p>
            </div>
            <button
              type="button"
              className={cn(
                `inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none`,
              )}
              onClick={() => setIsLiquidityDialogOpen(true)}
            >
              {t('Provide liquidity')}
            </button>
          </div>
        ) : (
          <>
            {heldAskCount > Math.max(1, renderedAsks.length) && (
              <div aria-hidden="true" style={{ height: (heldAskCount - Math.max(1, renderedAsks.length)) * 36 }} />
            )}
            {renderedAsks.length > 0 ? (
              renderedAsks.map((level, index) => {
                const userOrder = userOrdersByLevel.get(getOrderBookUserKey(level.side, level.priceCents))
                return (
                  <EventOrderBookRow
                    key={`ask-${level.priceCents}-${index}`}
                    level={level}
                    maxTotal={maxTotal}
                    showBadge={index === renderedAsks.length - 1 ? 'ask' : undefined}
                    priceFormatter={formatDisplayedPrice}
                    onSelect={handleLevelSelect}
                    userOrder={userOrder}
                    isCancelling={userOrder ? pendingCancelIds.has(userOrder.id) : false}
                    onCancelUserOrder={handleCancelUserOrder}
                    rewardEligible={isRewardEligible(level)}
                    showRewardHighlight={showRewardHighlight}
                  />
                )
              })
            ) : (
              <EventOrderBookEmptyRow label={t('No asks')} />
            )}

            {orderBookCenterRow}

            {bids.length > 0 ? (
              bids.map((level, index) => {
                const userOrder = userOrdersByLevel.get(getOrderBookUserKey(level.side, level.priceCents))
                return (
                  <EventOrderBookRow
                    key={`bid-${level.priceCents}-${index}`}
                    level={level}
                    maxTotal={maxTotal}
                    showBadge={index === 0 ? 'bid' : undefined}
                    priceFormatter={formatDisplayedPrice}
                    onSelect={handleLevelSelect}
                    userOrder={userOrder}
                    isCancelling={userOrder ? pendingCancelIds.has(userOrder.id) : false}
                    onCancelUserOrder={handleCancelUserOrder}
                    rewardEligible={isRewardEligible(level)}
                    showRewardHighlight={showRewardHighlight}
                  />
                )
              })
            ) : (
              <EventOrderBookEmptyRow label={t('No bids')} />
            )}
            {heldBidCount > Math.max(1, bids.length) && (
              <div aria-hidden="true" style={{ height: (heldBidCount - Math.max(1, bids.length)) * 36 }} />
            )}
          </>
        )}
      </div>
      <EventProvideLiquidityDialog
        open={isLiquidityDialogOpen}
        market={market}
        eventSlug={eventSlug}
        onOpenChange={setIsLiquidityDialogOpen}
      />
    </div>
  )
}
