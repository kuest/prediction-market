'use client'

import { useQuery } from '@tanstack/react-query'
import { ChevronDownIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'
import { useCallback, useMemo, useState } from 'react'

import type { MarketPositionTag } from '@/app/[locale]/(platform)/event/[slug]/_components/EventMarketCard'
import type { EventMarketRow } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventMarketRows'
import type { OrderBookSummariesResponse } from '@/app/[locale]/(platform)/event/[slug]/_types/EventOrderBookTypes'
import type { NormalizedBookLevel } from '@/lib/order-panel-utils'
import type { Event, UserPosition } from '@/types'

import SellPositionModal from '@/app/[locale]/(platform)/_components/SellPositionModal'
import EventMarketCard from '@/app/[locale]/(platform)/event/[slug]/_components/EventMarketCard'
import { useOrderBookSummaries } from '@/app/[locale]/(platform)/event/[slug]/_components/EventOrderBook'
import MarketDetailTabs from '@/app/[locale]/(platform)/event/[slug]/_components/MarketDetailTabs'
import OtherOutcomeRow from '@/app/[locale]/(platform)/event/[slug]/_components/OtherOutcomeRow'
import ResolvedMarketRow from '@/app/[locale]/(platform)/event/[slug]/_components/ResolvedMarketRow'
import { useChanceRefresh } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useChanceRefresh'
import { useEventMarketRows } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventMarketRows'
import { useEventMarketQuotes } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventMidPrices'
import { useEventPriceHistory } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'
import { useEventVolumes } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventVolumes'
import { useMarketDetailController } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useMarketDetailController'
import { useUserOpenOrdersQuery } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useUserOpenOrdersQuery'
import { useUserShareBalances } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useUserShareBalances'
import { useXTrackerTweetCount } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useXTrackerTweetCount'
import { applyCachedChartDeltaToEventMarketRow } from '@/app/[locale]/(platform)/event/[slug]/_utils/eventMarketChanceMeta'
import { isMarketResolved } from '@/app/[locale]/(platform)/event/[slug]/_utils/eventMarketUtils'
import { resolveEventResolvedOutcomeIndex } from '@/app/[locale]/(platform)/event/[slug]/_utils/eventResolvedOutcome'
import { buildRowChartDeltaTargets } from '@/app/[locale]/(platform)/event/[slug]/_utils/eventRowChartDeltaTargets'
import { isTweetMarketsEvent } from '@/app/[locale]/(platform)/event/[slug]/_utils/eventTweetMarkets'
import { isResolutionReviewActive } from '@/app/[locale]/(platform)/event/[slug]/_utils/resolution-timeline-builder'
import { useCurrentTimestamp } from '@/hooks/useCurrentTimestamp'
import { useOutcomeLabel } from '@/hooks/useOutcomeLabel'
import { ORDER_SIDE, ORDER_TYPE, OUTCOME_INDEX } from '@/lib/constants'
import { fetchUserOtherBalance, fetchUserPositionsForMarket } from '@/lib/data-api/user'
import { formatAmountInputValue, fromMicro } from '@/lib/formatters'
import { resolveDisplayPrice } from '@/lib/market-chance'
import { resolveMarketOutcome, resolveOutcomeUnitPrice } from '@/lib/market-pricing'
import { calculateMarketFill, normalizeBookLevels } from '@/lib/order-panel-utils'
import { cn } from '@/lib/utils'
import { selectOrderOutcomeAtDisplayedPrice, useIsSingleMarket, useOrder } from '@/stores/useOrder'
import { useUser } from '@/stores/useUser'

interface EventMarketsProps {
  event: Event
  isMobile: boolean
}

function toNumber(value: unknown) {
  if (value === null || value === undefined) {
    return null
  }

  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function getMarketEndTime(market: Event['markets'][number]) {
  if (!market.end_time) {
    return null
  }
  const parsed = Date.parse(market.end_time)
  return Number.isNaN(parsed) ? null : parsed
}

function useTweetMarketResolution({ event, currentTimestamp }: { event: Event; currentTimestamp: number | null }) {
  const isTweetMarketEvent = useMemo(() => isTweetMarketsEvent(event), [event])
  const xtrackerTweetCountQuery = useXTrackerTweetCount(event, isTweetMarketEvent)
  const xtrackerTotalCount = xtrackerTweetCountQuery.data?.totalCount ?? null

  const isTweetMarketFinal = useMemo(() => {
    if (currentTimestamp == null) {
      return false
    }

    const trackingEndMs = xtrackerTweetCountQuery.data?.trackingEndMs
    if (typeof trackingEndMs === 'number' && Number.isFinite(trackingEndMs)) {
      return currentTimestamp >= trackingEndMs
    }

    if (!event.end_date) {
      return false
    }

    const parsedEndMs = Date.parse(event.end_date)
    return Number.isFinite(parsedEndMs) && currentTimestamp >= parsedEndMs
  }, [currentTimestamp, event.end_date, xtrackerTweetCountQuery.data?.trackingEndMs])

  const resolveResolvedOutcomeIndex = useCallback(
    (market: Event['markets'][number]) => {
      if (!isMarketResolved(market)) {
        return null
      }

      return resolveEventResolvedOutcomeIndex(event, market, {
        isTweetMarketEvent,
        isTweetMarketFinal,
        totalCount: xtrackerTotalCount,
      })
    },
    [event, isTweetMarketEvent, isTweetMarketFinal, xtrackerTotalCount],
  )

  return { resolveResolvedOutcomeIndex }
}

function useReviewConditionIds({
  markets,
  currentTimestamp,
}: {
  markets: Event['markets']
  currentTimestamp: number | null
}) {
  return useMemo(() => {
    if (currentTimestamp == null) {
      return new Set<string>()
    }

    const ids = new Set<string>()
    markets.forEach((market) => {
      if (isResolutionReviewActive(market, { nowMs: currentTimestamp })) {
        ids.add(market.condition_id)
      }
    })
    return ids
  }, [currentTimestamp, markets])
}

function useEventTokenIds(markets: Event['markets']) {
  return useMemo(() => {
    const ids = new Set<string>()

    markets.forEach((market) => {
      market.outcomes.forEach((currentOutcome) => {
        if (currentOutcome.token_id) {
          ids.add(currentOutcome.token_id)
        }
      })
    })

    return Array.from(ids)
  }, [markets])
}

function useOwnerAddress(
  user: { deposit_wallet_address?: string | null; deposit_wallet_status?: string | null } | null,
) {
  return useMemo(() => {
    if (user && user.deposit_wallet_address && user.deposit_wallet_status === 'deployed') {
      return user.deposit_wallet_address as `0x${string}`
    }
    return '' as `0x${string}`
  }, [user])
}

function useCashOutFlow({
  isMobile,
  orderBookSummaries,
  orderBookQuery,
  setType,
  setSide,
  setMarket,
  setOutcome,
  setAmount,
  setIsMobileOrderPanelOpen,
}: {
  isMobile: boolean
  orderBookSummaries: OrderBookSummariesResponse | undefined
  orderBookQuery: { refetch: () => Promise<{ data?: OrderBookSummariesResponse }> }
  setType: (type: typeof ORDER_TYPE.MARKET | typeof ORDER_TYPE.LIMIT) => void
  setSide: (side: typeof ORDER_SIDE.BUY | typeof ORDER_SIDE.SELL) => void
  setMarket: (market: Event['markets'][number]) => void
  setOutcome: (outcome: Event['markets'][number]['outcomes'][number]) => void
  setAmount: (value: string) => void
  setIsMobileOrderPanelOpen: (value: boolean) => void
}) {
  const [cashOutPayload, setCashOutPayload] = useState<CashOutModalPayload | null>(null)

  const handleCashOut = useCallback(
    async function handleCashOut(market: Event['markets'][number], tag: MarketPositionTag) {
      const outcome =
        market.outcomes.find((item) => item.outcome_index === tag.outcomeIndex) ?? market.outcomes[tag.outcomeIndex]
      if (!outcome) {
        return
      }

      const tokenId = outcome.token_id ? String(outcome.token_id) : null
      let summary = tokenId ? orderBookSummaries?.[tokenId] : undefined
      if (!summary && tokenId) {
        try {
          const result = await orderBookQuery.refetch()
          summary = result.data?.[tokenId]
        } catch {
          summary = undefined
        }
      }
      const bids = normalizeBookLevels(summary?.bids, 'bid')
      const asks = normalizeBookLevels(summary?.asks, 'ask')
      const fill = calculateMarketFill(ORDER_SIDE.SELL, tag.shares, bids, asks)

      setType(ORDER_TYPE.MARKET)
      setSide(ORDER_SIDE.SELL)
      setMarket(market)
      setOutcome(outcome)
      setAmount(formatAmountInputValue(tag.shares, { roundingMode: 'floor' }))
      if (isMobile) {
        setIsMobileOrderPanelOpen(true)
      }

      setCashOutPayload({
        market,
        outcomeLabel: tag.label,
        outcomeIndex: tag.outcomeIndex,
        shares: tag.shares,
        filledShares: fill.filledShares,
        avgPriceCents: fill.avgPriceCents,
        receiveAmount: fill.totalCost > 0 ? fill.totalCost : null,
        sellBids: bids,
      })
    },
    [
      isMobile,
      orderBookQuery,
      orderBookSummaries,
      setAmount,
      setIsMobileOrderPanelOpen,
      setMarket,
      setOutcome,
      setSide,
      setType,
    ],
  )

  const handleCashOutModalChange = useCallback((open: boolean) => {
    if (!open) {
      setCashOutPayload(null)
    }
  }, [])

  const handleCashOutSubmit = useCallback(
    (sharesToSell: number) => {
      if (!(sharesToSell > 0)) {
        return
      }
      setAmount(formatAmountInputValue(sharesToSell, { roundingMode: 'floor' }))
      setCashOutPayload(null)
      const form = document.getElementById('event-order-form') as HTMLFormElement | null
      form?.requestSubmit()
    },
    [setAmount],
  )

  const dismissCashOut = useCallback(() => {
    setCashOutPayload(null)
  }, [])

  return { cashOutPayload, handleCashOut, handleCashOutModalChange, handleCashOutSubmit, dismissCashOut }
}

function useMarketInteractionHandlers({
  selectedOutcome,
  selectedMarketConditionId,
  toggleMarket,
  expandMarket,
  setMarket,
  setOutcome,
  setLimitPrice,
  setSide,
  setIsMobileOrderPanelOpen,
  inputRef,
}: {
  selectedOutcome: Event['markets'][number]['outcomes'][number] | null | undefined
  selectedMarketConditionId: string | null | undefined
  toggleMarket: (conditionId: string) => void
  expandMarket: (conditionId: string) => void
  setMarket: (market: Event['markets'][number]) => void
  setOutcome: (outcome: Event['markets'][number]['outcomes'][number]) => void
  setLimitPrice: (price: string) => void
  setSide: (side: typeof ORDER_SIDE.BUY | typeof ORDER_SIDE.SELL) => void
  setIsMobileOrderPanelOpen: (value: boolean) => void
  inputRef: React.RefObject<HTMLInputElement | null> | null | undefined
}) {
  const handleToggle = useCallback(
    (market: Event['markets'][number]) => {
      toggleMarket(market.condition_id)
      setMarket(market)
      setSide(ORDER_SIDE.BUY)

      if (!selectedOutcome || selectedOutcome.condition_id !== market.condition_id) {
        const defaultOutcome = market.outcomes[0]
        if (defaultOutcome) {
          setOutcome(defaultOutcome)
        }
      }
    },
    [toggleMarket, selectedOutcome, setMarket, setOutcome, setSide],
  )

  const handleBuy = useCallback(
    (
      market: Event['markets'][number],
      outcomeIndex: number,
      source: 'mobile' | 'desktop',
      displayedPrice: number | null,
    ) => {
      expandMarket(market.condition_id)
      const outcome =
        outcomeIndex === OUTCOME_INDEX.YES || outcomeIndex === OUTCOME_INDEX.NO
          ? resolveMarketOutcome(market, outcomeIndex)
          : null
      setSide(ORDER_SIDE.BUY)
      if (outcome) {
        selectOrderOutcomeAtDisplayedPrice({
          market,
          outcome,
          displayedPrice,
          currentMarketConditionId: selectedMarketConditionId,
          setMarket,
          setOutcome,
          setLimitPrice,
        })
      } else {
        setMarket(market)
      }

      if (source === 'mobile') {
        setIsMobileOrderPanelOpen(true)
      } else {
        inputRef?.current?.focus()
      }
    },
    [
      expandMarket,
      inputRef,
      selectedMarketConditionId,
      setIsMobileOrderPanelOpen,
      setLimitPrice,
      setMarket,
      setOutcome,
      setSide,
    ],
  )

  return { handleToggle, handleBuy }
}

function useEventUserPositionsData({
  event,
  ownerAddress,
  isNegRiskEnabled,
  isNegRiskAugmented,
  userId,
  normalizeOutcomeLabel,
}: {
  event: Event
  ownerAddress: `0x${string}`
  isNegRiskEnabled: boolean
  isNegRiskAugmented: boolean
  userId: string | undefined
  normalizeOutcomeLabel: (value: string | null | undefined) => string
}) {
  const t = useExtracted()
  const { data: userPositions } = useQuery<UserPosition[]>({
    queryKey: ['event-user-positions', ownerAddress, event.id],
    enabled: Boolean(ownerAddress),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
    refetchInterval: ownerAddress ? 15_000 : false,
    refetchIntervalInBackground: true,
    queryFn: ({ signal }) =>
      fetchUserPositionsForMarket({
        pageParam: 0,
        userAddress: ownerAddress,
        status: 'active',
        signal,
      }),
  })

  const { data: otherBalances } = useQuery({
    queryKey: ['event-other-balance', ownerAddress, event.slug],
    enabled: Boolean(ownerAddress && isNegRiskAugmented && userPositions),
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 10,
    queryFn: ({ signal }) =>
      fetchUserOtherBalance({
        eventSlug: event.slug,
        userAddress: ownerAddress,
        signal,
      }),
  })

  const otherShares = useMemo(() => {
    if (!otherBalances?.length) {
      return 0
    }
    return otherBalances.reduce((total, entry) => {
      const size = typeof entry.size === 'number' ? entry.size : 0
      return total + (Number.isFinite(size) ? size : 0)
    }, 0)
  }, [otherBalances])

  const { data: eventOpenOrdersData } = useUserOpenOrdersQuery({
    userId,
    eventSlug: event.slug,
    enabled: Boolean(userId),
  })

  const eventUserPositions = useMemo(() => userPositions ?? [], [userPositions])

  const openOrdersCountByCondition = useMemo(() => {
    const pages = eventOpenOrdersData?.pages ?? []
    return pages.reduce<Record<string, number>>((acc, page) => {
      page.data.forEach((order) => {
        const conditionId = order.market?.condition_id
        if (!conditionId) {
          return
        }
        acc[conditionId] = (acc[conditionId] ?? 0) + 1
      })
      return acc
    }, {})
  }, [eventOpenOrdersData?.pages])

  const positionTagsByCondition = useMemo(() => {
    if (!eventUserPositions.length) {
      return {}
    }

    const validConditionIds = new Set(event.markets.map((market) => market.condition_id))
    const aggregated: Record<
      string,
      Record<
        typeof OUTCOME_INDEX.YES | typeof OUTCOME_INDEX.NO,
        {
          outcomeIndex: typeof OUTCOME_INDEX.YES | typeof OUTCOME_INDEX.NO
          label: string
          shares: number
          totalCost: number | null
        }
      >
    > = {}

    eventUserPositions.forEach((position) => {
      const conditionId = position.market?.condition_id
      if (!conditionId || !validConditionIds.has(conditionId)) {
        return
      }

      const quantity =
        typeof position.total_shares === 'number'
          ? position.total_shares
          : typeof position.size === 'number'
            ? position.size
            : 0
      if (!quantity || quantity <= 0) {
        return
      }

      const normalizedOutcome = position.outcome_text?.toLowerCase()
      const explicitOutcomeIndex = typeof position.outcome_index === 'number' ? position.outcome_index : undefined
      const resolvedOutcomeIndex =
        explicitOutcomeIndex ?? (normalizedOutcome === 'no' ? OUTCOME_INDEX.NO : OUTCOME_INDEX.YES)
      const outcomeLabel =
        normalizeOutcomeLabel(position.outcome_text) || (resolvedOutcomeIndex === OUTCOME_INDEX.NO ? t('No') : t('Yes'))
      const avgPrice = toNumber(position.avgPrice) ?? Number(fromMicro(String(position.average_position ?? 0), 6))
      const normalizedAvgPrice = Number.isFinite(avgPrice) ? avgPrice : null

      if (!aggregated[conditionId]) {
        aggregated[conditionId] = {
          [OUTCOME_INDEX.YES]: { outcomeIndex: OUTCOME_INDEX.YES, label: t('Yes'), shares: 0, totalCost: null },
          [OUTCOME_INDEX.NO]: { outcomeIndex: OUTCOME_INDEX.NO, label: t('No'), shares: 0, totalCost: null },
        }
      }

      const bucket = resolvedOutcomeIndex === OUTCOME_INDEX.NO ? OUTCOME_INDEX.NO : OUTCOME_INDEX.YES
      const entry = aggregated[conditionId][bucket]
      entry.shares += quantity
      entry.label = outcomeLabel
      if (typeof normalizedAvgPrice === 'number') {
        const contribution = normalizedAvgPrice * quantity
        entry.totalCost = (entry.totalCost ?? 0) + contribution
      }
    })

    return Object.entries(aggregated).reduce<Record<string, MarketPositionTag[]>>((acc, [conditionId, entries]) => {
      const tags = [entries[OUTCOME_INDEX.YES], entries[OUTCOME_INDEX.NO]]
        .map((entry) => {
          const avgPrice =
            entry.shares > 0 && typeof entry.totalCost === 'number' ? entry.totalCost / entry.shares : null
          return {
            outcomeIndex: entry.outcomeIndex,
            label: entry.label,
            shares: entry.shares,
            avgPrice,
          }
        })
        .filter((tag) => tag.shares > 0)
      if (tags.length > 0) {
        acc[conditionId] = tags
      }
      return acc
    }, {})
  }, [event.markets, eventUserPositions, normalizeOutcomeLabel, t])

  const convertOptions = useMemo(() => {
    if (!isNegRiskEnabled || !eventUserPositions.length) {
      return []
    }

    const marketsByConditionId = new Map(event.markets.map((market) => [market.condition_id, market]))

    return eventUserPositions.reduce<Array<{ id: string; label: string; shares: number; conditionId: string }>>(
      (options, position, index) => {
        const conditionId = position.market?.condition_id
        if (!conditionId) {
          return options
        }
        const market = marketsByConditionId.get(conditionId)
        if (!market) {
          return options
        }

        const normalizedOutcome = position.outcome_text?.toLowerCase()
        const explicitOutcomeIndex = typeof position.outcome_index === 'number' ? position.outcome_index : undefined
        const resolvedOutcomeIndex =
          explicitOutcomeIndex ?? (normalizedOutcome === 'no' ? OUTCOME_INDEX.NO : OUTCOME_INDEX.YES)
        if (resolvedOutcomeIndex !== OUTCOME_INDEX.NO) {
          return options
        }

        const quantity =
          toNumber(position.size) ?? (typeof position.total_shares === 'number' ? position.total_shares : 0)
        if (!(quantity > 0)) {
          return options
        }

        options.push({
          id: `${conditionId}-no-${index}`,
          label: market.short_title || market.title,
          conditionId,
          shares: quantity,
        })
        return options
      },
      [],
    )
  }, [event.markets, isNegRiskEnabled, eventUserPositions])

  const eventOutcomes = useMemo(() => {
    return event.markets.map((market) => ({
      conditionId: market.condition_id,
      questionId: market.question_id,
      label: market.short_title || market.title,
      iconUrl: market.icon_url,
    }))
  }, [event.markets])

  return {
    otherShares,
    openOrdersCountByCondition,
    positionTagsByCondition,
    convertOptions,
    eventOutcomes,
  }
}

function useMarketRowsByResolution({
  marketRows,
  orderBookSummaries,
}: {
  marketRows: EventMarketRow[]
  orderBookSummaries: OrderBookSummariesResponse | undefined
}) {
  const pricedMarketRows = useMemo(() => {
    return marketRows.map((row) => ({
      ...row,
      yesPriceValue: resolveOutcomeUnitPrice(row.market, OUTCOME_INDEX.YES, {
        orderBookSummaries,
        side: ORDER_SIDE.BUY,
      }),
      noPriceValue: resolveOutcomeUnitPrice(row.market, OUTCOME_INDEX.NO, {
        orderBookSummaries,
        side: ORDER_SIDE.BUY,
      }),
    }))
  }, [marketRows, orderBookSummaries])

  const { activeDisplayRows, resolvedDisplayRows } = useMemo(() => {
    const activeRows: EventMarketRow[] = []
    const resolvedRows: EventMarketRow[] = []

    pricedMarketRows.forEach((row) => {
      if (isMarketResolved(row.market)) {
        resolvedRows.push(row)
        return
      }

      activeRows.push(row)
    })

    return { activeDisplayRows: activeRows, resolvedDisplayRows: resolvedRows }
  }, [pricedMarketRows])

  const sortedResolvedDisplayRows = useMemo(() => {
    if (!resolvedDisplayRows.length) {
      return resolvedDisplayRows
    }

    return resolvedDisplayRows
      .map((row, index) => ({
        row,
        index,
        endTime: getMarketEndTime(row.market),
      }))
      .sort((a, b) => {
        if (a.endTime != null && b.endTime != null) {
          return a.endTime - b.endTime
        }
        return a.index - b.index
      })
      .map((item) => item.row)
  }, [resolvedDisplayRows])

  return { pricedMarketRows, activeDisplayRows, sortedResolvedDisplayRows }
}

interface CashOutModalPayload {
  market: Event['markets'][number]
  outcomeLabel: string
  outcomeIndex: typeof OUTCOME_INDEX.YES | typeof OUTCOME_INDEX.NO
  shares: number
  filledShares: number
  avgPriceCents: number | null
  receiveAmount: number | null
  sellBids: NormalizedBookLevel[]
}

export default function EventMarkets({ event, isMobile }: EventMarketsProps) {
  const t = useExtracted()
  const currentTimestamp = useCurrentTimestamp({ intervalMs: 60_000 })
  const normalizeOutcomeLabel = useOutcomeLabel()
  const selectedMarketId = useOrder((state) => state.market?.condition_id)
  const selectedOutcome = useOrder((state) => state.outcome)
  const setMarket = useOrder((state) => state.setMarket)
  const setOutcome = useOrder((state) => state.setOutcome)
  const setLimitPrice = useOrder((state) => state.setLimitPrice)
  const setSide = useOrder((state) => state.setSide)
  const setType = useOrder((state) => state.setType)
  const setIsMobileOrderPanelOpen = useOrder((state) => state.setIsMobileOrderPanelOpen)
  const setAmount = useOrder((state) => state.setAmount)
  const inputRef = useOrder((state) => state.inputRef)
  const user = useUser()
  const isSingleMarket = useIsSingleMarket()
  const isNegRiskEnabled = Boolean(event.enable_neg_risk || event.neg_risk)
  const isNegRiskAugmented = Boolean(event.neg_risk_augmented)
  const { liveVolumeByCondition, volumeByCondition } = useEventVolumes(event)
  const { rows: marketRows, hasChanceData } = useEventMarketRows(event)
  const { expandedMarketId, toggleMarket, expandMarket, selectDetailTab, getSelectedDetailTab } =
    useMarketDetailController(event.id)
  const rowChartDeltaTargets = useMemo(() => buildRowChartDeltaTargets(event.markets), [event.markets])
  const shouldHydrateChartDeltas = rowChartDeltaTargets.length > 0
  const rowChartDeltaPriceHistory = useEventPriceHistory({
    eventId: event.id,
    range: 'ALL',
    targets: rowChartDeltaTargets,
    eventCreatedAt: event.created_at,
    refetchIntervalMs: false,
  })
  const rowChartDeltaQuotesByMarket = useEventMarketQuotes(rowChartDeltaTargets, { refetchIntervalMs: false })
  const rowChartDeltaLiveYesChanceByMarket = useMemo(() => {
    if (!shouldHydrateChartDeltas) {
      return {}
    }

    return rowChartDeltaTargets.reduce<Record<string, number>>((acc, target) => {
      const quote = rowChartDeltaQuotesByMarket[target.conditionId]
      const lastTrade = rowChartDeltaPriceHistory.latestRawPrices[target.conditionId]
      const displayPrice = resolveDisplayPrice({
        bid: quote?.bid ?? null,
        ask: quote?.ask ?? null,
        midpoint: quote?.mid ?? null,
        lastTrade,
      })

      if (typeof displayPrice === 'number' && Number.isFinite(displayPrice)) {
        acc[target.conditionId] = displayPrice * 100
      }

      return acc
    }, {})
  }, [
    rowChartDeltaPriceHistory.latestRawPrices,
    rowChartDeltaQuotesByMarket,
    rowChartDeltaTargets,
    shouldHydrateChartDeltas,
  ])
  const rowChartDeltaBaselineYesChanceByMarket = useMemo(() => {
    if (!shouldHydrateChartDeltas) {
      return {}
    }

    const baselineByMarket: Record<string, number> = {}
    const unresolvedConditionIds = new Set(rowChartDeltaTargets.map((target) => target.conditionId))

    for (const point of rowChartDeltaPriceHistory.normalizedHistory) {
      if (unresolvedConditionIds.size === 0) {
        break
      }

      Array.from(unresolvedConditionIds).forEach((conditionId) => {
        const value = point[conditionId]
        if (typeof value === 'number' && Number.isFinite(value)) {
          baselineByMarket[conditionId] = value
          unresolvedConditionIds.delete(conditionId)
        }
      })
    }

    return baselineByMarket
  }, [rowChartDeltaPriceHistory.normalizedHistory, rowChartDeltaTargets, shouldHydrateChartDeltas])
  const rowChartDeltaYesByMarket = useMemo(() => {
    if (!shouldHydrateChartDeltas) {
      return {}
    }

    return rowChartDeltaTargets.reduce<Record<string, number>>((acc, target) => {
      const baseline = rowChartDeltaBaselineYesChanceByMarket[target.conditionId]
      const live = rowChartDeltaLiveYesChanceByMarket[target.conditionId]

      if (
        typeof baseline === 'number' &&
        Number.isFinite(baseline) &&
        typeof live === 'number' &&
        Number.isFinite(live)
      ) {
        acc[target.conditionId] = live - baseline
      }

      return acc
    }, {})
  }, [
    rowChartDeltaBaselineYesChanceByMarket,
    rowChartDeltaLiveYesChanceByMarket,
    rowChartDeltaTargets,
    shouldHydrateChartDeltas,
  ])
  const stableRowChartDeltaYesByMarket = rowChartDeltaYesByMarket
  const reviewConditionIds = useReviewConditionIds({ markets: event.markets, currentTimestamp })
  const { resolveResolvedOutcomeIndex } = useTweetMarketResolution({ event, currentTimestamp })
  const chanceRefreshQueryKeys = useMemo(
    () => [['event-price-history', event.id] as const, ['event-market-quotes'] as const],
    [event.id],
  )
  const { isFetching: isPriceHistoryFetching } = useChanceRefresh({ queryKeys: chanceRefreshQueryKeys })
  const [showResolvedMarkets, setShowResolvedMarkets] = useState(false)
  const eventTokenIds = useEventTokenIds(event.markets)
  const shouldEnableOrderBookPolling = !isSingleMarket
  const orderBookQuery = useOrderBookSummaries(eventTokenIds, { enabled: shouldEnableOrderBookPolling })
  const orderBookSummaries = orderBookQuery.data
  const isOrderBookLoading = orderBookQuery.isLoading
  const shouldShowOrderBookLoader = !shouldEnableOrderBookPolling || (isOrderBookLoading && !orderBookSummaries)
  const ownerAddress = useOwnerAddress(user)
  const { sharesByCondition } = useUserShareBalances({ event, ownerAddress })
  const { otherShares, openOrdersCountByCondition, positionTagsByCondition, convertOptions, eventOutcomes } =
    useEventUserPositionsData({
      event,
      ownerAddress,
      isNegRiskEnabled,
      isNegRiskAugmented,
      userId: user?.id,
      normalizeOutcomeLabel,
    })
  const shouldShowOtherRow = isNegRiskAugmented && otherShares > 0
  const { cashOutPayload, handleCashOut, handleCashOutModalChange, handleCashOutSubmit, dismissCashOut } =
    useCashOutFlow({
      isMobile,
      orderBookSummaries,
      orderBookQuery,
      setType,
      setSide,
      setMarket,
      setOutcome,
      setAmount,
      setIsMobileOrderPanelOpen,
    })
  const { handleToggle, handleBuy } = useMarketInteractionHandlers({
    selectedOutcome,
    selectedMarketConditionId: selectedMarketId,
    toggleMarket,
    expandMarket,
    setMarket,
    setOutcome,
    setLimitPrice,
    setSide,
    setIsMobileOrderPanelOpen,
    inputRef,
  })
  const chanceHighlightVersion = hasChanceData ? (isPriceHistoryFetching ? 'fetching' : 'ready') : 'idle'

  const { pricedMarketRows, activeDisplayRows, sortedResolvedDisplayRows } = useMarketRowsByResolution({
    marketRows,
    orderBookSummaries,
  })
  const showResolvedInline =
    pricedMarketRows.length > 0 && pricedMarketRows.every((row) => isMarketResolved(row.market))
  const primaryMarketRows = showResolvedInline ? sortedResolvedDisplayRows : activeDisplayRows
  const shouldShowActiveSection = primaryMarketRows.length > 0 || shouldShowOtherRow
  const shouldShowResolvedSection = !showResolvedInline && sortedResolvedDisplayRows.length > 0

  if (isSingleMarket) {
    return null
  }

  return (
    <>
      <div className="-mr-2 -ml-4 bg-background lg:mx-0">
        {shouldShowActiveSection && <div className="mt-4 mr-2 ml-4 border-b border-border lg:mx-0" />}
        {primaryMarketRows.map((row, index, orderedMarkets) => {
          const { market } = row
          const resolvedRow = applyCachedChartDeltaToEventMarketRow(row, stableRowChartDeltaYesByMarket)
          const isExpanded = expandedMarketId === market.condition_id
          const activeOutcomeForMarket =
            selectedOutcome && selectedOutcome.condition_id === market.condition_id
              ? selectedOutcome
              : market.outcomes[0]
          const chanceHighlightKey = `${market.condition_id}-${event.id}-${chanceHighlightVersion}`
          const activeOutcomeIndex =
            selectedOutcome && selectedOutcome.condition_id === market.condition_id
              ? selectedOutcome.outcome_index
              : null
          const positionTags = positionTagsByCondition[market.condition_id] ?? []
          const shouldShowSeparator = index !== orderedMarkets.length - 1 || shouldShowOtherRow
          const isResolvedInlineRow = showResolvedInline || isMarketResolved(market)
          const showInReviewTag = reviewConditionIds.has(market.condition_id)
          const resolvedOutcomeIndexOverride = isResolvedInlineRow ? resolveResolvedOutcomeIndex(market) : null

          return (
            <div key={market.condition_id} className="transition-colors">
              {isResolvedInlineRow ? (
                <ResolvedMarketRow
                  row={row}
                  showMarketIcon={Boolean(event.show_market_icons)}
                  isExpanded={isExpanded}
                  resolvedOutcomeIndexOverride={resolvedOutcomeIndexOverride}
                  onToggle={() => handleToggle(market)}
                />
              ) : (
                <EventMarketCard
                  row={resolvedRow}
                  showMarketIcon={Boolean(event.show_market_icons)}
                  isExpanded={isExpanded}
                  isActiveMarket={selectedMarketId === market.condition_id}
                  showInReviewTag={showInReviewTag}
                  activeOutcomeIndex={activeOutcomeIndex}
                  onToggle={() => handleToggle(market)}
                  onBuy={(cardMarket, outcomeIndex, source) =>
                    handleBuy(
                      cardMarket,
                      outcomeIndex,
                      source,
                      outcomeIndex === OUTCOME_INDEX.YES ? resolvedRow.yesPriceValue : resolvedRow.noPriceValue,
                    )
                  }
                  chanceHighlightKey={chanceHighlightKey}
                  liveVolume={liveVolumeByCondition[market.condition_id]}
                  volumeOverride={volumeByCondition[market.condition_id]}
                  positionTags={positionTags}
                  openOrdersCount={openOrdersCountByCondition[market.condition_id] ?? 0}
                  onCashOut={handleCashOut}
                />
              )}

              <div
                className={cn(
                  'overflow-hidden transition-all duration-500 ease-in-out',
                  isExpanded
                    ? 'max-h-160 translate-y-0 opacity-100'
                    : 'pointer-events-none max-h-0 -translate-y-2 opacity-0',
                )}
                aria-hidden={!isExpanded}
              >
                <MarketDetailTabs
                  currentTimestamp={currentTimestamp}
                  market={market}
                  event={event}
                  isMobile={isMobile}
                  isNegRiskEnabled={isNegRiskEnabled}
                  isNegRiskAugmented={isNegRiskAugmented}
                  variant={isResolvedInlineRow ? 'resolved' : undefined}
                  resolvedOutcomeIndexOverride={resolvedOutcomeIndexOverride}
                  convertOptions={convertOptions}
                  eventOutcomes={eventOutcomes}
                  activeOutcomeForMarket={activeOutcomeForMarket}
                  tabController={{
                    selected: getSelectedDetailTab(market.condition_id),
                    select: (tabId) => selectDetailTab(market.condition_id, tabId),
                  }}
                  orderBookData={{
                    summaries: orderBookSummaries,
                    isLoading: shouldShowOrderBookLoader,
                    refetch: orderBookQuery.refetch,
                    isRefetching: orderBookQuery.isRefetching,
                  }}
                  sharesByCondition={sharesByCondition}
                />
              </div>

              {shouldShowSeparator && <div className="mr-2 ml-4 border-b border-border lg:mx-0" />}
            </div>
          )
        })}
        {shouldShowOtherRow && (
          <div className="transition-colors">
            <OtherOutcomeRow shares={otherShares} showMarketIcon={Boolean(event.show_market_icons)} />
          </div>
        )}
        {shouldShowActiveSection && <div className="mr-2 mb-4 ml-4 border-b border-border lg:mx-0" />}

        {shouldShowResolvedSection && (
          <div className="pb-4">
            <button
              type="button"
              className={cn(
                'group flex items-center gap-1 px-4 py-2 text-base font-semibold text-foreground',
                'transition-colors hover:text-foreground/80 lg:px-0',
              )}
              onClick={() => setShowResolvedMarkets((open) => !open)}
              aria-expanded={showResolvedMarkets}
              data-state={showResolvedMarkets ? 'open' : 'closed'}
            >
              <span>{showResolvedMarkets ? t('Hide resolved') : t('View resolved')}</span>
              <ChevronDownIcon className="size-6 transition-transform duration-150 group-data-[state=open]:rotate-180" />
            </button>

            {showResolvedMarkets && (
              <div className="mt-4">
                {sortedResolvedDisplayRows.map((row, index, orderedMarkets) => {
                  const { market } = row
                  const isExpanded = expandedMarketId === market.condition_id
                  const activeOutcomeForMarket =
                    selectedOutcome && selectedOutcome.condition_id === market.condition_id
                      ? selectedOutcome
                      : market.outcomes[0]
                  const shouldShowSeparator = index !== orderedMarkets.length - 1
                  const resolvedOutcomeIndexOverride = resolveResolvedOutcomeIndex(market)

                  return (
                    <div key={market.condition_id} className="transition-colors">
                      <ResolvedMarketRow
                        row={row}
                        showMarketIcon={Boolean(event.show_market_icons)}
                        isExpanded={isExpanded}
                        resolvedOutcomeIndexOverride={resolvedOutcomeIndexOverride}
                        onToggle={() => handleToggle(market)}
                      />

                      <div
                        className={cn(
                          'overflow-hidden transition-all duration-500 ease-in-out',
                          isExpanded
                            ? 'max-h-160 translate-y-0 opacity-100'
                            : 'pointer-events-none max-h-0 -translate-y-2 opacity-0',
                        )}
                        aria-hidden={!isExpanded}
                      >
                        <MarketDetailTabs
                          currentTimestamp={currentTimestamp}
                          market={market}
                          event={event}
                          isMobile={isMobile}
                          isNegRiskEnabled={isNegRiskEnabled}
                          isNegRiskAugmented={isNegRiskAugmented}
                          variant="resolved"
                          resolvedOutcomeIndexOverride={resolvedOutcomeIndexOverride}
                          convertOptions={convertOptions}
                          eventOutcomes={eventOutcomes}
                          activeOutcomeForMarket={activeOutcomeForMarket}
                          tabController={{
                            selected: getSelectedDetailTab(market.condition_id),
                            select: (tabId) => selectDetailTab(market.condition_id, tabId),
                          }}
                          orderBookData={{
                            summaries: orderBookSummaries,
                            isLoading: shouldShowOrderBookLoader,
                            refetch: orderBookQuery.refetch,
                            isRefetching: orderBookQuery.isRefetching,
                          }}
                          sharesByCondition={sharesByCondition}
                        />
                      </div>

                      {shouldShowSeparator && <div className="mr-2 ml-4 border-b border-border lg:mx-0" />}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {cashOutPayload && (
        <SellPositionModal
          open={Boolean(cashOutPayload)}
          onOpenChange={handleCashOutModalChange}
          outcomeLabel={cashOutPayload.outcomeLabel}
          outcomeShortLabel={event.title}
          outcomeIconUrl={cashOutPayload.market.icon_url}
          fallbackIconUrl={event.icon_url}
          shares={cashOutPayload.shares}
          filledShares={cashOutPayload.filledShares}
          avgPriceCents={cashOutPayload.avgPriceCents}
          receiveAmount={cashOutPayload.receiveAmount}
          sellBids={cashOutPayload.sellBids}
          onSharesChange={(sharesToSell) => setAmount(formatAmountInputValue(sharesToSell, { roundingMode: 'floor' }))}
          onCashOut={handleCashOutSubmit}
          onEditOrder={(sharesToSell) => {
            setAmount(formatAmountInputValue(sharesToSell, { roundingMode: 'floor' }))
            dismissCashOut()
          }}
        />
      )}
    </>
  )
}
