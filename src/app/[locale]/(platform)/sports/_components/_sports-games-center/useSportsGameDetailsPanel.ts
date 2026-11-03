import type { MouseEvent as ReactMouseEventType } from 'react'

import { useQuery } from '@tanstack/react-query'
import { useExtracted } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { SportsGamesButton, SportsGamesCard } from '@/app/[locale]/(platform)/sports/_utils/sports-games-data'
import type { OddsFormat } from '@/lib/odds-format'
import type { Market, Outcome, UserPosition } from '@/types'

import { fetchOrderBookSummaries } from '@/app/[locale]/(platform)/event/[slug]/_utils/EventOrderBookUtils'
import { ORDER_SIDE, ORDER_TYPE, OUTCOME_INDEX } from '@/lib/constants'
import { fetchUserPositionsForMarket } from '@/lib/data-api/user'
import { formatAmountInputValue, formatCentsValueLabel, fromMicro } from '@/lib/formatters'
import { formatOddsFromCents } from '@/lib/odds-format'
import { calculateMarketFill, normalizeBookLevels } from '@/lib/order-panel-utils'
import { resolvePositionRealizedPnl } from '@/lib/position-values'
import { useOrder } from '@/stores/useOrder'
import { useUser } from '@/stores/useUser'

import type {
  DetailsTab,
  LinePickerMarketType,
  SportsCashOutModalPayload,
  SportsGameDetailsPanelProps,
  SportsPositionTag,
} from './sports-games-center-types'

import {
  abbreviatePositionMarketLabel,
  buildLinePickerOptions,
  formatCompactCentsLabel,
  normalizePositionPrice,
  resolveMarketTypeLabel,
  resolvePositionCostValue,
  resolvePositionCurrentValue,
  resolvePositionShares,
  resolvePreferredLinePickerButton,
  resolveSelectedButton,
  resolveSelectedMarket,
  resolveSelectedOrderBookTradeLabel,
  resolveSelectedOutcome,
  resolveSwitchTooltip,
} from './sports-games-center-utils'

export function useSportsGameDetailsPanelOrderStore() {
  const orderMarketConditionId = useOrder((state) => state.market?.condition_id ?? null)
  const orderOutcomeIndex = useOrder((state) => state.outcome?.outcome_index ?? null)
  const setOrderOutcome = useOrder((state) => state.setOutcome)
  const setOrderMarket = useOrder((state) => state.setMarket)
  const setOrderType = useOrder((state) => state.setType)
  const setOrderSide = useOrder((state) => state.setSide)
  const setOrderAmount = useOrder((state) => state.setAmount)
  const setIsMobileOrderPanelOpen = useOrder((state) => state.setIsMobileOrderPanelOpen)

  return {
    orderMarketConditionId,
    orderOutcomeIndex,
    setOrderOutcome,
    setOrderMarket,
    setOrderType,
    setOrderSide,
    setOrderAmount,
    setIsMobileOrderPanelOpen,
  }
}

export function useSportsGameDetailsPanelLocalState() {
  const [cashOutPayload, setCashOutPayload] = useState<SportsCashOutModalPayload | null>(null)
  const [isPositionsExpanded, setIsPositionsExpanded] = useState(false)
  const [convertTagKey, setConvertTagKey] = useState<string | null>(null)

  return {
    cashOutPayload,
    setCashOutPayload,
    isPositionsExpanded,
    setIsPositionsExpanded,
    convertTagKey,
    setConvertTagKey,
  }
}

export function useSportsCardDerivations(card: SportsGamesCard) {
  const cardMarketByConditionId = useMemo(
    () => new Map(card.detailMarkets.map((market) => [market.condition_id, market] as const)),
    [card.detailMarkets],
  )

  const cardButtonsByConditionAndOutcome = useMemo(() => {
    const map = new Map<string, SportsGamesButton>()
    card.buttons.forEach((button) => {
      map.set(`${button.conditionId}:${button.outcomeIndex}`, button)
    })
    return map
  }, [card.buttons])

  const cardFirstButtonByCondition = useMemo(() => {
    const map = new Map<string, SportsGamesButton>()
    card.buttons.forEach((button) => {
      if (!map.has(button.conditionId)) {
        map.set(button.conditionId, button)
      }
    })
    return map
  }, [card.buttons])

  const moneylineConditionIds = useMemo(
    () =>
      new Set(card.buttons.filter((button) => button.marketType === 'moneyline').map((button) => button.conditionId)),
    [card.buttons],
  )

  const isNegRiskEnabled = useMemo(() => {
    return Boolean(
      card.event.neg_risk ||
      card.event.neg_risk_augmented ||
      card.event.neg_risk_market_id ||
      card.detailMarkets.some((market) => market.neg_risk || market.neg_risk_market_id),
    )
  }, [card.detailMarkets, card.event.neg_risk, card.event.neg_risk_augmented, card.event.neg_risk_market_id])

  return {
    cardMarketByConditionId,
    cardButtonsByConditionAndOutcome,
    cardFirstButtonByCondition,
    moneylineConditionIds,
    isNegRiskEnabled,
  }
}

export function useSportsCardUserPositionsQuery({
  ownerAddress,
  cardId,
  showBottomContent,
}: {
  ownerAddress: string | null
  cardId: string
  showBottomContent: boolean
}) {
  const { data: userPositions } = useQuery<UserPosition[]>({
    queryKey: ['sports-card-user-positions', ownerAddress, cardId],
    enabled: Boolean(ownerAddress),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
    refetchInterval: ownerAddress ? (showBottomContent ? 15_000 : false) : false,
    refetchIntervalInBackground: showBottomContent,
    queryFn: ({ signal }) =>
      fetchUserPositionsForMarket({
        pageParam: 0,
        userAddress: ownerAddress!,
        status: 'active',
        signal,
      }),
  })

  return userPositions
}

export function useSportsPositionTags({
  ownerAddress,
  userPositions,
  allowedConditionIds,
  card,
  cardMarketByConditionId,
  cardButtonsByConditionAndOutcome,
  cardFirstButtonByCondition,
}: {
  ownerAddress: string | null
  userPositions: UserPosition[] | undefined
  allowedConditionIds: Set<string> | null
  card: SportsGamesCard
  cardMarketByConditionId: Map<string, Market>
  cardButtonsByConditionAndOutcome: Map<string, SportsGamesButton>
  cardFirstButtonByCondition: Map<string, SportsGamesButton>
}) {
  const positionTags = useMemo<SportsPositionTag[]>(() => {
    if (!ownerAddress || !userPositions?.length) {
      return []
    }

    const aggregated = new Map<
      string,
      {
        conditionId: string
        outcomeIndex: typeof OUTCOME_INDEX.YES | typeof OUTCOME_INDEX.NO
        market: Market
        outcome: Outcome
        button: SportsGamesButton | null
        marketTypeLabel: 'Moneyline' | 'Spread' | 'Total' | 'Both Teams to Score' | 'Market'
        marketLabel: string
        outcomeLabel: string
        shares: number
        totalCost: number | null
        currentValue: number
        realizedPnl: number
        latestActivityAtMs: number
      }
    >()

    userPositions.forEach((position) => {
      const conditionId = position.market?.condition_id
      if (!conditionId) {
        return
      }

      if (allowedConditionIds && !allowedConditionIds.has(conditionId)) {
        return
      }

      const market = cardMarketByConditionId.get(conditionId)
      if (!market) {
        return
      }

      const shares = resolvePositionShares(position)
      if (!(shares > 0)) {
        return
      }

      const explicitOutcomeIndex = typeof position.outcome_index === 'number' ? position.outcome_index : undefined
      const normalizedOutcomeText = position.outcome_text?.trim().toLowerCase()
      const resolvedOutcomeIndex =
        (explicitOutcomeIndex ?? normalizedOutcomeText === 'no') ? OUTCOME_INDEX.NO : OUTCOME_INDEX.YES

      if (resolvedOutcomeIndex !== OUTCOME_INDEX.YES && resolvedOutcomeIndex !== OUTCOME_INDEX.NO) {
        return
      }

      const outcome = market.outcomes.find((item) => item.outcome_index === resolvedOutcomeIndex)
      if (!outcome) {
        return
      }

      const button =
        cardButtonsByConditionAndOutcome.get(`${conditionId}:${resolvedOutcomeIndex}`) ??
        cardFirstButtonByCondition.get(conditionId) ??
        null
      const fallbackMarketLabel = market.sports_group_item_title?.trim() || market.short_title?.trim() || market.title
      const rawMarketLabel =
        button?.marketType === 'binary'
          ? fallbackMarketLabel
          : button?.label?.trim() || outcome.outcome_text?.trim() || fallbackMarketLabel
      const marketLabel =
        abbreviatePositionMarketLabel(rawMarketLabel, card.teams) ||
        abbreviatePositionMarketLabel(fallbackMarketLabel, card.teams)
      const outcomeLabel = resolvedOutcomeIndex === OUTCOME_INDEX.NO ? 'NO' : 'YES'
      const avgPrice =
        normalizePositionPrice(position.avgPrice) ??
        normalizePositionPrice(Number(fromMicro(String(position.average_position ?? 0), 6)))
      const normalizedAvgPrice = Number.isFinite(avgPrice) ? avgPrice : null
      const costValue = resolvePositionCostValue(position, shares, normalizedAvgPrice)
      const normalizedMarketPrice = normalizePositionPrice(outcome.buy_price)
      const currentValue = resolvePositionCurrentValue(position, shares, normalizedAvgPrice, normalizedMarketPrice)
      const realizedPnl = resolvePositionRealizedPnl(position)
      const activityMs = Date.parse(position.last_activity_at)
      const normalizedActivityMs = Number.isFinite(activityMs) ? activityMs : 0
      const key = `${conditionId}:${resolvedOutcomeIndex}`
      const existing = aggregated.get(key)

      if (!existing) {
        aggregated.set(key, {
          conditionId,
          outcomeIndex: resolvedOutcomeIndex,
          market,
          outcome,
          button,
          marketTypeLabel: resolveMarketTypeLabel(button, market),
          marketLabel,
          outcomeLabel,
          shares,
          totalCost: typeof costValue === 'number' ? costValue : null,
          currentValue,
          realizedPnl,
          latestActivityAtMs: normalizedActivityMs,
        })
        return
      }

      existing.shares += shares
      existing.currentValue += currentValue
      existing.realizedPnl += realizedPnl
      existing.latestActivityAtMs = Math.max(existing.latestActivityAtMs, normalizedActivityMs)
      if (typeof costValue === 'number') {
        existing.totalCost = (existing.totalCost ?? 0) + costValue
      }
    })

    return Array.from(aggregated.values())
      .map((item) => {
        const avgPriceCents =
          item.shares > 0 && typeof item.totalCost === 'number' ? (item.totalCost / item.shares) * 100 : null
        const summaryLabel =
          item.marketTypeLabel === 'Moneyline' || item.marketTypeLabel === 'Market'
            ? `${item.marketLabel} ${item.outcomeLabel}`.trim()
            : item.marketLabel.trim()

        return {
          key: `${item.conditionId}:${item.outcomeIndex}`,
          conditionId: item.conditionId,
          outcomeIndex: item.outcomeIndex,
          marketTypeLabel: item.marketTypeLabel,
          marketLabel: item.marketLabel,
          outcomeLabel: item.outcomeLabel,
          summaryLabel,
          shares: item.shares,
          avgPriceCents,
          totalCost: item.totalCost,
          currentValue: item.currentValue,
          realizedPnl: item.realizedPnl,
          market: item.market,
          outcome: item.outcome,
          button: item.button,
          latestActivityAtMs: item.latestActivityAtMs,
        }
      })
      .sort((a, b) => b.latestActivityAtMs - a.latestActivityAtMs)
  }, [
    allowedConditionIds,
    card.teams,
    cardButtonsByConditionAndOutcome,
    cardFirstButtonByCondition,
    cardMarketByConditionId,
    ownerAddress,
    userPositions,
  ])

  const visiblePositionTags = useMemo(() => positionTags.slice(0, 3), [positionTags])

  const hiddenPositionTagsCount = useMemo(
    () => Math.max(0, positionTags.length - visiblePositionTags.length),
    [positionTags.length, visiblePositionTags.length],
  )

  return { positionTags, visiblePositionTags, hiddenPositionTagsCount }
}

export function useSportsConvertDialog({
  convertTagKey,
  positionTags,
  card,
  allowedConditionIds,
}: {
  convertTagKey: string | null
  positionTags: SportsPositionTag[]
  card: SportsGamesCard
  allowedConditionIds: Set<string> | null
}) {
  const activeConvertTagKey = useMemo(
    () => (convertTagKey && positionTags.some((tag) => tag.key === convertTagKey) ? convertTagKey : null),
    [convertTagKey, positionTags],
  )

  const convertDialogTag = useMemo(
    () => (activeConvertTagKey ? (positionTags.find((tag) => tag.key === activeConvertTagKey) ?? null) : null),
    [activeConvertTagKey, positionTags],
  )

  const convertDialogOptions = useMemo(() => {
    if (!convertDialogTag) {
      return []
    }

    return [
      {
        id: convertDialogTag.key,
        conditionId: convertDialogTag.conditionId,
        label: convertDialogTag.market.short_title || convertDialogTag.market.title,
        shares: convertDialogTag.shares,
      },
    ]
  }, [convertDialogTag])

  const convertDialogOutcomes = useMemo(() => {
    const seenConditionIds = new Set<string>()
    return card.detailMarkets
      .filter((market) => {
        if (!market.condition_id || seenConditionIds.has(market.condition_id)) {
          return false
        }
        if (allowedConditionIds && !allowedConditionIds.has(market.condition_id)) {
          return false
        }
        seenConditionIds.add(market.condition_id)
        return true
      })
      .map((market) => ({
        conditionId: market.condition_id,
        questionId: market.question_id,
        label: market.short_title || market.title,
        iconUrl: market.icon_url,
      }))
  }, [allowedConditionIds, card.detailMarkets])

  return { convertDialogTag, convertDialogOptions, convertDialogOutcomes }
}

export function useSportsSelectedMarketDerivations({
  card,
  selectedButtonKey,
  orderMarketConditionId,
  orderOutcomeIndex,
}: {
  card: SportsGamesCard
  selectedButtonKey: string | null
  orderMarketConditionId: string | null
  orderOutcomeIndex: number | null
}) {
  const selectedButton = useMemo(() => resolveSelectedButton(card, selectedButtonKey), [card, selectedButtonKey])

  const selectedMarket = useMemo(() => resolveSelectedMarket(card, selectedButtonKey), [card, selectedButtonKey])

  const selectedOutcome = useMemo(() => {
    if (!selectedMarket) {
      return null
    }

    if (
      orderMarketConditionId === selectedMarket.condition_id &&
      (orderOutcomeIndex === OUTCOME_INDEX.YES || orderOutcomeIndex === OUTCOME_INDEX.NO)
    ) {
      const syncedOutcome = selectedMarket.outcomes.find((outcome) => outcome.outcome_index === orderOutcomeIndex)
      if (syncedOutcome) {
        return syncedOutcome
      }
    }

    return resolveSelectedOutcome(selectedMarket, selectedButton)
  }, [orderMarketConditionId, orderOutcomeIndex, selectedButton, selectedMarket])

  const selectedLinePickerMarketType = useMemo<LinePickerMarketType | null>(() => {
    if (!selectedButton) {
      return null
    }
    return selectedButton.marketType === 'spread' || selectedButton.marketType === 'total'
      ? selectedButton.marketType
      : null
  }, [selectedButton])

  const nextOutcome = useMemo(() => {
    if (!selectedMarket || !selectedOutcome) {
      return null
    }

    return selectedMarket.outcomes.find((outcome) => outcome.outcome_index !== selectedOutcome.outcome_index) ?? null
  }, [selectedMarket, selectedOutcome])

  const nextButton = useMemo(() => {
    if (!selectedMarket || !nextOutcome) {
      return null
    }

    return (
      card.buttons.find(
        (button) =>
          button.conditionId === selectedMarket.condition_id && button.outcomeIndex === nextOutcome.outcome_index,
      ) ?? null
    )
  }, [card.buttons, nextOutcome, selectedMarket])

  const tradeSelectionLabel = useMemo(
    () => resolveSelectedOrderBookTradeLabel(selectedButton, selectedOutcome),
    [selectedButton, selectedOutcome],
  )

  const switchTooltip = useMemo(() => {
    return resolveSwitchTooltip(selectedMarket, nextOutcome)
  }, [nextOutcome, selectedMarket])

  const selectedMarketTokenIds = useMemo(() => {
    if (!selectedMarket) {
      return []
    }

    return selectedMarket.outcomes
      .map((outcome) => outcome.token_id)
      .filter((tokenId): tokenId is string => Boolean(tokenId))
  }, [selectedMarket])

  const isSelectedMarketResolved = Boolean(selectedMarket?.is_resolved || selectedMarket?.condition?.resolved)

  return {
    selectedButton,
    selectedMarket,
    selectedOutcome,
    selectedLinePickerMarketType,
    nextOutcome,
    nextButton,
    tradeSelectionLabel,
    switchTooltip,
    selectedMarketTokenIds,
    isSelectedMarketResolved,
  }
}

export function useSportsLinePicker({
  card,
  allowedConditionIds,
  selectedLinePickerMarketType,
  selectedButton,
  onSelectButton,
}: {
  card: SportsGamesCard
  allowedConditionIds: Set<string> | null
  selectedLinePickerMarketType: LinePickerMarketType | null
  selectedButton: SportsGamesButton | null
  onSelectButton: (buttonKey: string, options?: { panelMode?: 'full' | 'partial' | 'preserve' }) => void
}) {
  const linePickerScrollerRef = useRef<HTMLDivElement | null>(null)
  const linePickerButtonsRef = useRef<Record<string, HTMLButtonElement | null>>({})
  const linePickerScrollSettleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const linePickerSuppressScrollSyncUntilRef = useRef(0)

  const linePickerOptions = useMemo(() => {
    if (!selectedLinePickerMarketType) {
      return []
    }

    const options = buildLinePickerOptions(card, selectedLinePickerMarketType)
    if (!allowedConditionIds) {
      return options
    }

    return options.filter((option) => allowedConditionIds.has(option.conditionId))
  }, [allowedConditionIds, card, selectedLinePickerMarketType])

  const activeLineOptionIndex = useMemo(() => {
    if (!selectedButton || linePickerOptions.length === 0) {
      return -1
    }

    return linePickerOptions.findIndex((option) => option.conditionId === selectedButton.conditionId)
  }, [linePickerOptions, selectedButton])

  const hasLinePicker = selectedLinePickerMarketType !== null && linePickerOptions.length > 1

  const suppressLinePickerScrollSync = useCallback((durationMs = 220) => {
    linePickerSuppressScrollSyncUntilRef.current = Date.now() + durationMs
  }, [])

  const pickLineOption = useCallback(
    (optionIndex: number) => {
      if (!selectedButton) {
        return
      }

      const option = linePickerOptions[optionIndex]
      if (!option) {
        return
      }

      const preferredButton = resolvePreferredLinePickerButton(option.buttons, selectedButton)
      if (!preferredButton) {
        return
      }

      suppressLinePickerScrollSync()
      onSelectButton(preferredButton.key, { panelMode: 'preserve' })
    },
    [linePickerOptions, onSelectButton, selectedButton, suppressLinePickerScrollSync],
  )

  const handlePickPreviousLine = useCallback(() => {
    if (activeLineOptionIndex <= 0) {
      return
    }
    pickLineOption(activeLineOptionIndex - 1)
  }, [activeLineOptionIndex, pickLineOption])

  const handlePickNextLine = useCallback(() => {
    if (activeLineOptionIndex < 0 || activeLineOptionIndex >= linePickerOptions.length - 1) {
      return
    }
    pickLineOption(activeLineOptionIndex + 1)
  }, [activeLineOptionIndex, linePickerOptions.length, pickLineOption])

  const resolveCenteredLineOptionIndex = useCallback(() => {
    const scroller = linePickerScrollerRef.current
    if (!scroller || linePickerOptions.length === 0) {
      return -1
    }

    const scrollerCenter = scroller.scrollLeft + scroller.clientWidth / 2
    let closestIndex = -1
    let smallestDistance = Number.POSITIVE_INFINITY

    linePickerOptions.forEach((option, index) => {
      const button = linePickerButtonsRef.current[option.conditionId]
      if (!button) {
        return
      }

      const buttonCenter = button.offsetLeft + button.offsetWidth / 2
      const distance = Math.abs(buttonCenter - scrollerCenter)
      if (distance < smallestDistance) {
        smallestDistance = distance
        closestIndex = index
      }
    })

    return closestIndex
  }, [linePickerOptions])

  const alignActiveLineOption = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      if (activeLineOptionIndex < 0) {
        return
      }

      const scroller = linePickerScrollerRef.current
      if (!scroller) {
        return
      }

      const activeOption = linePickerOptions[activeLineOptionIndex]
      if (!activeOption) {
        return
      }

      const activeButton = linePickerButtonsRef.current[activeOption.conditionId]
      if (!activeButton) {
        return
      }

      suppressLinePickerScrollSync()
      const targetLeft = activeButton.offsetLeft - (scroller.clientWidth - activeButton.offsetWidth) / 2
      scroller.scrollTo({
        left: Math.max(0, targetLeft),
        behavior,
      })
    },
    [activeLineOptionIndex, linePickerOptions, suppressLinePickerScrollSync],
  )

  useEffect(
    function alignActiveLineOptionOnIndexChange() {
      if (activeLineOptionIndex < 0) {
        return undefined
      }
      alignActiveLineOption('auto')
      return undefined
    },
    [activeLineOptionIndex, alignActiveLineOption],
  )

  useEffect(
    function alignActiveLineOptionOnPickerMount() {
      if (!hasLinePicker) {
        return undefined
      }

      const frame = window.requestAnimationFrame(() => {
        alignActiveLineOption('auto')
      })

      return function cancelAlignActiveLineOptionFrame() {
        window.cancelAnimationFrame(frame)
      }
    },
    [alignActiveLineOption, hasLinePicker],
  )

  useEffect(
    function syncLinePickerScrollToCenteredOption() {
      const scrollerElement = linePickerScrollerRef.current
      if (!hasLinePicker || !scrollerElement) {
        return undefined
      }

      function syncCenteredLineOption() {
        const centeredIndex = resolveCenteredLineOptionIndex()
        if (centeredIndex < 0 || centeredIndex === activeLineOptionIndex) {
          return
        }

        pickLineOption(centeredIndex)
      }

      function handleScroll() {
        if (Date.now() < linePickerSuppressScrollSyncUntilRef.current) {
          return
        }

        if (linePickerScrollSettleTimeoutRef.current) {
          clearTimeout(linePickerScrollSettleTimeoutRef.current)
        }

        linePickerScrollSettleTimeoutRef.current = setTimeout(() => {
          linePickerScrollSettleTimeoutRef.current = null
          syncCenteredLineOption()
        }, 90)
      }

      scrollerElement.addEventListener('scroll', handleScroll, { passive: true })

      return function detachLinePickerScrollSync() {
        scrollerElement.removeEventListener('scroll', handleScroll)
        if (linePickerScrollSettleTimeoutRef.current) {
          clearTimeout(linePickerScrollSettleTimeoutRef.current)
          linePickerScrollSettleTimeoutRef.current = null
        }
      }
    },
    [activeLineOptionIndex, hasLinePicker, pickLineOption, resolveCenteredLineOptionIndex],
  )

  return {
    linePickerScrollerRef,
    linePickerButtonsRef,
    linePickerOptions,
    activeLineOptionIndex,
    hasLinePicker,
    pickLineOption,
    handlePickPreviousLine,
    handlePickNextLine,
  }
}

export function useSportsDetailsTabs({
  activeDetailsTab,
  showBottomContent,
  showAboutTab,
  aboutEvent,
  isSelectedMarketResolved,
  onChangeTab,
}: {
  activeDetailsTab: DetailsTab
  showBottomContent: boolean
  showAboutTab: boolean
  aboutEvent: SportsGamesCard['event'] | null
  isSelectedMarketResolved: boolean
  onChangeTab: (tab: DetailsTab) => void
}) {
  const t = useExtracted()
  const detailTabs = useMemo<Array<{ id: DetailsTab; label: string }>>(() => {
    const tabs: Array<{ id: DetailsTab; label: string }> = []

    if (!isSelectedMarketResolved) {
      tabs.push({ id: 'orderBook', label: t('Order Book') })
    }

    tabs.push({ id: 'graph', label: t('Graph') })

    if (showAboutTab && aboutEvent) {
      tabs.push({ id: 'about', label: t('About') })
    }

    return tabs
  }, [aboutEvent, isSelectedMarketResolved, showAboutTab, t])

  const resolvedActiveDetailsTab = useMemo<DetailsTab>(() => {
    if (detailTabs.some((tab) => tab.id === activeDetailsTab)) {
      return activeDetailsTab
    }

    return detailTabs[0]?.id ?? 'orderBook'
  }, [activeDetailsTab, detailTabs])

  useEffect(
    function syncResolvedDetailsTabUpstream() {
      if (!showBottomContent) {
        return undefined
      }

      if (resolvedActiveDetailsTab !== activeDetailsTab) {
        onChangeTab(resolvedActiveDetailsTab)
      }

      return undefined
    },
    [activeDetailsTab, onChangeTab, resolvedActiveDetailsTab, showBottomContent],
  )

  return { detailTabs, resolvedActiveDetailsTab }
}

export function useSportsOwnerAddress() {
  const user = useUser()
  const ownerAddress = useMemo(() => {
    if (user?.deposit_wallet_address && user.deposit_wallet_status === 'deployed') {
      return user.deposit_wallet_address
    }
    return null
  }, [user?.deposit_wallet_address, user?.deposit_wallet_status])

  return ownerAddress
}

export function useSportsPositionOddsFormatters(oddsFormat: OddsFormat) {
  const formatPositionOddsLabel = useCallback(
    (cents: number | null) => {
      if (oddsFormat === 'price') {
        return formatCompactCentsLabel(cents)
      }
      return formatOddsFromCents(cents, oddsFormat)
    },
    [oddsFormat],
  )

  const formatAverageCellLabel = useCallback(
    (cents: number | null) => {
      if (oddsFormat === 'price') {
        return formatCentsValueLabel(cents, { fallback: '—' })
      }
      return formatOddsFromCents(cents, oddsFormat)
    },
    [oddsFormat],
  )

  return { formatPositionOddsLabel, formatAverageCellLabel }
}

export function useSportsCashOutHandlers({
  card,
  isMobile,
  setCashOutPayload,
  orderStore,
}: {
  card: SportsGamesCard
  isMobile: boolean
  setCashOutPayload: (payload: SportsCashOutModalPayload | null) => void
  orderStore: ReturnType<typeof useSportsGameDetailsPanelOrderStore>
}) {
  const { setOrderType, setOrderSide, setOrderMarket, setOrderOutcome, setOrderAmount, setIsMobileOrderPanelOpen } =
    orderStore

  const handleCashOutTag = useCallback(
    async (tag: SportsPositionTag, event?: ReactMouseEventType<HTMLElement>) => {
      event?.stopPropagation()

      const tokenId = tag.outcome.token_id ? String(tag.outcome.token_id) : null
      if (!tokenId) {
        return
      }

      let summary = await fetchOrderBookSummaries([tokenId])
        .then((result) => result[tokenId])
        .catch(() => null)

      if (!summary) {
        summary = null
      }

      const bids = normalizeBookLevels(summary?.bids, 'bid')
      const asks = normalizeBookLevels(summary?.asks, 'ask')
      const fill = calculateMarketFill(ORDER_SIDE.SELL, tag.shares, bids, asks)

      setOrderType(ORDER_TYPE.MARKET)
      setOrderSide(ORDER_SIDE.SELL)
      setOrderMarket(tag.market)
      setOrderOutcome(tag.outcome)
      setOrderAmount(formatAmountInputValue(tag.shares, { roundingMode: 'floor' }))

      if (isMobile) {
        setIsMobileOrderPanelOpen(true)
      }

      setCashOutPayload({
        outcomeLabel: tag.summaryLabel,
        outcomeShortLabel: card.event.title || tag.market.short_title || tag.market.title,
        outcomeIconUrl: tag.market.icon_url,
        shares: tag.shares,
        filledShares: fill.filledShares,
        avgPriceCents: fill.avgPriceCents,
        receiveAmount: fill.totalCost > 0 ? fill.totalCost : null,
        sellBids: bids,
      })
    },
    [
      card.event.title,
      isMobile,
      setCashOutPayload,
      setIsMobileOrderPanelOpen,
      setOrderAmount,
      setOrderMarket,
      setOrderOutcome,
      setOrderSide,
      setOrderType,
    ],
  )

  const handleCashOutModalChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setCashOutPayload(null)
      }
    },
    [setCashOutPayload],
  )

  const handleCashOutSubmit = useCallback(
    (sharesToSell: number) => {
      if (!(sharesToSell > 0)) {
        return
      }
      setOrderAmount(formatAmountInputValue(sharesToSell, { roundingMode: 'floor' }))
      setCashOutPayload(null)
      const form = document.getElementById('event-order-form') as HTMLFormElement | null
      form?.requestSubmit()
    },
    [setCashOutPayload, setOrderAmount],
  )

  return { handleCashOutTag, handleCashOutModalChange, handleCashOutSubmit }
}

export function useSportsDetailsPanelInteractions({
  selectedMarket,
  nextOutcome,
  nextButton,
  onSelectButton,
  setOrderMarket,
  setOrderOutcome,
  isNegRiskEnabled,
  moneylineConditionIds,
  setConvertTagKey,
}: {
  selectedMarket: Market | null
  nextOutcome: Outcome | null
  nextButton: SportsGamesButton | null
  onSelectButton: SportsGameDetailsPanelProps['onSelectButton']
  setOrderMarket: (market: Market) => void
  setOrderOutcome: (outcome: Outcome) => void
  isNegRiskEnabled: boolean
  moneylineConditionIds: Set<string>
  setConvertTagKey: (key: string | null) => void
}) {
  const handleToggleOutcome = useCallback(() => {
    if (!selectedMarket || !nextOutcome) {
      return
    }

    setOrderMarket(selectedMarket)
    setOrderOutcome(nextOutcome)
    if (nextButton) {
      onSelectButton(nextButton.key, { panelMode: 'preserve' })
    }
  }, [nextButton, nextOutcome, onSelectButton, selectedMarket, setOrderMarket, setOrderOutcome])

  const handleOpenConvert = useCallback(
    (tag: SportsPositionTag, event?: ReactMouseEventType<HTMLElement>) => {
      event?.stopPropagation()
      if (
        !isNegRiskEnabled ||
        !moneylineConditionIds.has(tag.conditionId) ||
        tag.outcomeIndex !== OUTCOME_INDEX.NO ||
        tag.outcome.outcome_index !== OUTCOME_INDEX.NO ||
        tag.shares <= 0
      ) {
        return
      }
      setConvertTagKey(tag.key)
    },
    [isNegRiskEnabled, moneylineConditionIds, setConvertTagKey],
  )

  return { handleToggleOutcome, handleOpenConvert }
}
