import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import type { TIME_RANGES } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'
import type { SportsGamesCard } from '@/app/[locale]/(platform)/sports/_utils/sports-games-data'
import type { DataPoint, PredictionChartCursorSnapshot } from '@/types/PredictionChartTypes'

import { useOptionalMarketChannelSubscription } from '@/app/[locale]/(platform)/event/[slug]/_components/EventMarketChannelProvider'
import { useEventMarketQuotes } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventMidPrices'
import { useEventPriceHistory } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'
import {
  loadStoredChartSettings,
  storeChartSettings,
} from '@/app/[locale]/(platform)/event/[slug]/_utils/chartSettingsStorage'
import {
  buildHistoryWithLatestPointOverride,
  resolveChartRangeStartMs,
} from '@/app/[locale]/(platform)/event/[slug]/_utils/EventChartUtils'
import { useCurrentTimestamp } from '@/hooks/useCurrentTimestamp'
import { OUTCOME_INDEX } from '@/lib/constants'
import { resolveDisplayPrice } from '@/lib/market-chance'
import { calculateYAxisBounds } from '@/lib/prediction-chart'

import type { SportsPositionedLegendLayout } from './sports-games-center-constants'
import type {
  SportsGameGraphVariant,
  SportsGamesMarketType,
  SportsGraphSeriesTarget,
  SportsTradeFlowLabelItem,
} from './sports-games-center-types'

import {
  SPORTS_CARD_POSITIONED_LEGEND_LAYOUT,
  SPORTS_EVENT_HERO_POSITIONED_LEGEND_LAYOUT,
  TRADE_FLOW_CLEANUP_INTERVAL_MS,
} from './sports-games-center-constants'
import {
  buildMoneylineGraphTargets,
  buildTradeFlowLabel,
  pruneTradeFlowItems,
  resolveGraphSeriesColor,
  resolveGraphSeriesName,
  trimTradeFlowItems,
} from './sports-games-center-utils'

const FONT_SIZE_PATTERN = /(\d+(?:\.\d+)?)px/
const WHITESPACE_PATTERN = /\s/
const NARROW_CHARACTER_PATTERN = /[ilI1|.,'`]/
const WIDE_CHARACTER_PATTERN = /[mw@%&]/i
const SPORTS_LEGEND_CURSOR_RESPONSE_MS = 280
const SPORTS_LEGEND_CURSOR_MAX_ANIMATION_MS = 800

interface SportsLegendTextMeasurements {
  nameWidthsByKey: Map<string, number>
  renderedWidth: number
}

function estimateTextWidthConservatively(text: string, font: string) {
  const fontSize = Number(font.match(FONT_SIZE_PATTERN)?.[1] ?? 14)

  return Array.from(text).reduce((width, character) => {
    if (WHITESPACE_PATTERN.test(character)) {
      return width + fontSize * 0.33
    }
    if (NARROW_CHARACTER_PATTERN.test(character)) {
      return width + fontSize * 0.35
    }
    if (WIDE_CHARACTER_PATTERN.test(character)) {
      return width + fontSize
    }
    if ((character.codePointAt(0) ?? 0) > 0x7f) {
      return width + fontSize
    }
    return width + fontSize * 0.7
  }, 0)
}

function buildSportsLegendTextMeasurements({
  chartSeries,
  positionedLegendLayout,
  measureText,
}: {
  chartSeries: Array<{ key: string; name: string }>
  positionedLegendLayout: SportsPositionedLegendLayout
  measureText: (text: string, font: string) => number
}): SportsLegendTextMeasurements {
  const nameWidthsByKey = new Map<string, number>()
  let longestLabelWidth = 0

  for (const seriesItem of chartSeries) {
    const label = seriesItem.name.trim()
    const width = label ? measureText(label, positionedLegendLayout.nameFont) : 0
    nameWidthsByKey.set(seriesItem.key, width)
    longestLabelWidth = Math.max(longestLabelWidth, width)
  }

  const widestValueWidth = measureText('100%', positionedLegendLayout.valueFont)
  const targetWidth = Math.ceil(
    Math.max(longestLabelWidth, widestValueWidth) + positionedLegendLayout.horizontalPaddingPx,
  )

  return {
    nameWidthsByKey,
    renderedWidth: Math.max(positionedLegendLayout.minWidthPx, targetWidth),
  }
}

function createSportsLegendTextMeasurementStore({
  enabled,
  chartSeries,
  positionedLegendLayout,
}: {
  enabled: boolean
  chartSeries: Array<{ key: string; name: string }>
  positionedLegendLayout: SportsPositionedLegendLayout
}) {
  let measurements = buildSportsLegendTextMeasurements({
    chartSeries,
    positionedLegendLayout,
    measureText: estimateTextWidthConservatively,
  })
  let hasMeasuredRenderedText = false

  function getSnapshot() {
    return measurements
  }

  function subscribe(onStoreChange: () => void) {
    if (!hasMeasuredRenderedText && enabled && chartSeries.length > 0) {
      hasMeasuredRenderedText = true
      const context = document.createElement('canvas').getContext('2d')

      if (context) {
        measurements = buildSportsLegendTextMeasurements({
          chartSeries,
          positionedLegendLayout,
          measureText(text, font) {
            context.font = font
            return context.measureText(text).width
          },
        })
        onStoreChange()
      }
    }

    return function unsubscribeFromSportsLegendTextMeasurements() {}
  }

  return {
    getServerSnapshot: getSnapshot,
    getSnapshot,
    subscribe,
  }
}

function interpolateSportsLegendCursor(
  current: PredictionChartCursorSnapshot,
  target: PredictionChartCursorSnapshot,
  progress: number,
) {
  const values: Record<string, number> = {}
  const keys = new Set([...Object.keys(current.values), ...Object.keys(target.values)])

  keys.forEach((key) => {
    const currentValue = current.values[key]
    const targetValue = target.values[key]

    if (typeof currentValue === 'number' && typeof targetValue === 'number') {
      values[key] = currentValue + (targetValue - currentValue) * progress
    } else if (typeof targetValue === 'number') {
      values[key] = targetValue
    } else if (typeof currentValue === 'number') {
      values[key] = currentValue
    }
  })

  return {
    date: new Date(current.date.getTime() + (target.date.getTime() - current.date.getTime()) * progress),
    values,
  } satisfies PredictionChartCursorSnapshot
}

function useLaggedSportsLegendCursor({
  cursorSnapshot,
  latestSnapshot,
  latestTimestamp,
}: {
  cursorSnapshot: PredictionChartCursorSnapshot | null
  latestSnapshot: Record<string, number>
  latestTimestamp: number | null
}) {
  const [displayedSnapshot, setDisplayedSnapshot] = useState<PredictionChartCursorSnapshot | null>(null)
  const targetRef = useRef<PredictionChartCursorSnapshot | null>(cursorSnapshot)
  const displayedRef = useRef<PredictionChartCursorSnapshot | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameTimestampRef = useRef<number | null>(null)
  const animationStartTimestampRef = useRef<number | null>(null)
  const baselineSnapshot = useMemo<PredictionChartCursorSnapshot | null>(() => {
    if (latestTimestamp == null || !Number.isFinite(latestTimestamp)) {
      return null
    }

    return {
      date: new Date(latestTimestamp),
      values: latestSnapshot,
    }
  }, [latestSnapshot, latestTimestamp])

  useLayoutEffect(
    function animateSportsLegendCursor() {
      targetRef.current = cursorSnapshot

      if (!cursorSnapshot) {
        displayedRef.current = null
        if (animationFrameRef.current != null) {
          cancelAnimationFrame(animationFrameRef.current)
          animationFrameRef.current = null
        }
        lastFrameTimestampRef.current = null
        animationStartTimestampRef.current = null
        return
      }

      if (!displayedRef.current) {
        displayedRef.current = baselineSnapshot ?? cursorSnapshot
      }

      if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        displayedRef.current = cursorSnapshot
        animationStartTimestampRef.current = null
        return
      }

      if (animationFrameRef.current != null) {
        return
      }

      function animate(timestamp: number) {
        const current = displayedRef.current
        const target = targetRef.current
        if (!current || !target) {
          animationFrameRef.current = null
          lastFrameTimestampRef.current = null
          animationStartTimestampRef.current = null
          return
        }

        animationStartTimestampRef.current ??= timestamp
        const previousTimestamp = lastFrameTimestampRef.current ?? timestamp
        const elapsedMs = Math.min(64, Math.max(0, timestamp - previousTimestamp))
        lastFrameTimestampRef.current = timestamp
        const progress = 1 - Math.exp(-elapsedMs / SPORTS_LEGEND_CURSOR_RESPONSE_MS)
        const next = interpolateSportsLegendCursor(current, target, progress)
        const remainingDateMs = Math.abs(target.date.getTime() - next.date.getTime())
        const remainingValue = Math.max(
          0,
          ...Object.keys(target.values).map((key) => Math.abs((target.values[key] ?? 0) - (next.values[key] ?? 0))),
        )
        const animationElapsedMs = timestamp - animationStartTimestampRef.current

        if (
          animationElapsedMs >= SPORTS_LEGEND_CURSOR_MAX_ANIMATION_MS ||
          (remainingDateMs <= 1 && remainingValue <= 0.01)
        ) {
          displayedRef.current = target
          setDisplayedSnapshot(target)
          animationFrameRef.current = null
          lastFrameTimestampRef.current = null
          animationStartTimestampRef.current = null
          return
        }

        displayedRef.current = next
        setDisplayedSnapshot(next)
        animationFrameRef.current = window.requestAnimationFrame(animate)
      }

      animationFrameRef.current = window.requestAnimationFrame(animate)
    },
    [baselineSnapshot, cursorSnapshot],
  )

  useEffect(
    () => () => {
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      animationStartTimestampRef.current = null
      lastFrameTimestampRef.current = null
    },
    [],
  )

  return cursorSnapshot ? (displayedSnapshot ?? baselineSnapshot ?? cursorSnapshot) : null
}

export function useSportsGameGraphChartSettings() {
  const [chartSettings, setChartSettings] = useState(function resolveInitialGraphChartSettings() {
    const stored = loadStoredChartSettings()
    return { ...stored, bothOutcomes: false }
  })

  useEffect(
    function persistGraphChartSettings() {
      storeChartSettings({ ...chartSettings, bothOutcomes: false })
      return function noopGraphChartSettingsCleanup() {}
    },
    [chartSettings],
  )

  return [chartSettings, setChartSettings] as const
}

export function useSportsGameGraphChartDimensions({
  containerWidth,
  chartHeightOffset = 0,
  variant,
}: {
  containerWidth?: number | null
  chartHeightOffset?: number
  variant: SportsGameGraphVariant
}) {
  const isSportsEventHeroVariant = variant === 'sportsEventHero'
  const usesPositionedSeriesLegend = variant === 'sportsEventHero' || variant === 'sportsCardLegend'
  const positionedLegendLayout = isSportsEventHeroVariant
    ? SPORTS_EVENT_HERO_POSITIONED_LEGEND_LAYOUT
    : SPORTS_CARD_POSITIONED_LEGEND_LAYOUT
  const baseChartHeight = isSportsEventHeroVariant ? 332 : 300
  const chartHeight = Math.max(260, baseChartHeight - Math.max(0, chartHeightOffset))
  const positionedLegendChartTopMargin = isSportsEventHeroVariant ? 30 : 22
  const chartMargin = usesPositionedSeriesLegend
    ? { top: positionedLegendChartTopMargin, right: 46, bottom: 40, left: 0 }
    : { top: 12, right: 30, bottom: 40, left: 0 }

  const chartWidth = useMemo(() => {
    if (typeof containerWidth === 'number' && Number.isFinite(containerWidth) && containerWidth > 0) {
      return Math.max(1, Math.round(containerWidth))
    }

    return 860
  }, [containerWidth])

  return {
    isSportsEventHeroVariant,
    usesPositionedSeriesLegend,
    canRenderPositionedSeriesLegend: usesPositionedSeriesLegend,
    positionedLegendLayout,
    chartHeight,
    chartMargin,
    chartWidth,
  }
}

export function useSportsGameGraphSeries({
  card,
  selectedMarketType,
  selectedConditionId,
  selectedOutcomeIndex,
  isSportsEventHeroVariant,
}: {
  card: SportsGamesCard
  selectedMarketType: SportsGamesMarketType
  selectedConditionId: string | null
  selectedOutcomeIndex: number | null
  isSportsEventHeroVariant: boolean
}) {
  const shouldUseCompositeMoneyline = selectedMarketType === 'moneyline' && isSportsEventHeroVariant
  const graphSelectedConditionId = shouldUseCompositeMoneyline ? null : selectedConditionId
  const graphSeriesTargets = useMemo<SportsGraphSeriesTarget[]>(() => {
    if (graphSelectedConditionId) {
      const selectedMarket = card.detailMarkets.find((market) => market.condition_id === graphSelectedConditionId)
      if (selectedMarket) {
        const fallbackColors = ['var(--yes)', 'var(--no)']
        const orderedOutcomes = [...selectedMarket.outcomes].sort((a, b) => a.outcome_index - b.outcome_index)
        const selectedMoneylineOutcomeIndexes =
          selectedMarketType === 'moneyline' && selectedOutcomeIndex != null ? new Set([selectedOutcomeIndex]) : null

        const outcomeTargets = orderedOutcomes
          .filter(
            (outcome) =>
              !selectedMoneylineOutcomeIndexes?.size || selectedMoneylineOutcomeIndexes.has(outcome.outcome_index),
          )
          .map((outcome, index) => {
            const relatedButton = card.buttons.find(
              (button) =>
                button.conditionId === selectedMarket.condition_id && button.outcomeIndex === outcome.outcome_index,
            )
            const fallbackLabel = outcome.outcome_text?.trim() || `Option ${index + 1}`

            return {
              key: `${selectedMarket.condition_id}:${outcome.outcome_index}`,
              tokenId: outcome.token_id ?? null,
              market: selectedMarket,
              outcomeIndex: outcome.outcome_index,
              name: relatedButton ? resolveGraphSeriesName(card, relatedButton, selectedMarket) : fallbackLabel,
              color: resolveGraphSeriesColor(card, relatedButton, fallbackColors[index % fallbackColors.length]!),
            }
          })

        if (outcomeTargets.length > 0) {
          return outcomeTargets
        }
      }
    }

    const fallbackColors = ['var(--yes)', 'var(--primary)', 'var(--no)']

    const moneylineGraphTargets = buildMoneylineGraphTargets(card)
    if (moneylineGraphTargets.length > 0) {
      return moneylineGraphTargets
    }

    const moneylineConditionIds = Array.from(
      new Set(card.buttons.filter((button) => button.marketType === 'moneyline').map((button) => button.conditionId)),
    )

    const moneylineMarkets = moneylineConditionIds
      .map((conditionId) => card.detailMarkets.find((market) => market.condition_id === conditionId) ?? null)
      .filter((market): market is NonNullable<typeof market> => Boolean(market))

    if (moneylineMarkets.length > 0) {
      return moneylineMarkets
        .map<SportsGraphSeriesTarget | null>((market, index) => {
          const yesOutcome =
            market.outcomes.find((outcome) => outcome.outcome_index === OUTCOME_INDEX.YES) ?? market.outcomes[0] ?? null
          if (!yesOutcome?.token_id) {
            return null
          }

          const relatedButton =
            card.buttons.find(
              (button) =>
                button.conditionId === market.condition_id && button.outcomeIndex === yesOutcome.outcome_index,
            ) ?? card.buttons.find((button) => button.conditionId === market.condition_id)

          return {
            key: market.condition_id,
            tokenId: yesOutcome.token_id,
            market,
            outcomeIndex: yesOutcome.outcome_index,
            name: resolveGraphSeriesName(card, relatedButton, market),
            color: resolveGraphSeriesColor(card, relatedButton, fallbackColors[index % fallbackColors.length]!),
          }
        })
        .filter((target): target is SportsGraphSeriesTarget => target !== null)
    }

    const seenConditionIds = new Set<string>()
    const fallbackTargets: SportsGraphSeriesTarget[] = []
    for (const market of card.detailMarkets) {
      if (seenConditionIds.has(market.condition_id)) {
        continue
      }
      seenConditionIds.add(market.condition_id)
      const yesOutcome =
        market.outcomes.find((outcome) => outcome.outcome_index === OUTCOME_INDEX.YES) ?? market.outcomes[0] ?? null
      if (!yesOutcome?.token_id) {
        continue
      }

      const relatedButton =
        card.buttons.find(
          (button) => button.conditionId === market.condition_id && button.outcomeIndex === yesOutcome.outcome_index,
        ) ?? card.buttons.find((button) => button.conditionId === market.condition_id)

      fallbackTargets.push({
        key: market.condition_id,
        tokenId: yesOutcome.token_id,
        market,
        outcomeIndex: yesOutcome.outcome_index,
        name: resolveGraphSeriesName(card, relatedButton, market),
        color: resolveGraphSeriesColor(
          card,
          relatedButton,
          fallbackColors[fallbackTargets.length % fallbackColors.length]!,
        ),
      })
    }

    return fallbackTargets
  }, [card, graphSelectedConditionId, selectedMarketType, selectedOutcomeIndex])

  const tradeFlowSeriesByTokenId = useMemo(() => {
    const map = new Map<string, { color: string }>()
    if (!isSportsEventHeroVariant) {
      return map
    }

    for (const series of graphSeriesTargets) {
      if (!series.tokenId) {
        continue
      }
      map.set(String(series.tokenId), {
        color: series.color,
      })
    }

    return map
  }, [graphSeriesTargets, isSportsEventHeroVariant])

  const marketTargets = useMemo(
    () =>
      graphSeriesTargets
        .filter((target): target is SportsGraphSeriesTarget & { tokenId: string } => Boolean(target.tokenId))
        .map((target) => ({
          conditionId: target.key,
          tokenId: target.tokenId,
        })),
    [graphSeriesTargets],
  )

  const chartSeries = useMemo(() => {
    return graphSeriesTargets.map((target) => ({
      key: target.key,
      name: target.name,
      color: target.color,
    }))
  }, [graphSeriesTargets])

  return { graphSeriesTargets, tradeFlowSeriesByTokenId, marketTargets, chartSeries, graphSelectedConditionId }
}

export function appendLiveSportsHistoryPoint({
  history,
  livePointValues,
  eventCreatedAt,
  eventResolvedAt,
  activeTimeRange,
  now = new Date(),
}: {
  history: DataPoint[]
  livePointValues: Record<string, number>
  eventCreatedAt: string
  eventResolvedAt?: string | null
  activeTimeRange: (typeof TIME_RANGES)[number]
  now?: Date
}) {
  const resolvedAtMs = eventResolvedAt ? Date.parse(eventResolvedAt) : Number.NaN
  const chartEndMs = Number.isFinite(resolvedAtMs) ? resolvedAtMs : now.getTime()
  const chartStartMs = resolveChartRangeStartMs(activeTimeRange, eventCreatedAt, chartEndMs)

  return buildHistoryWithLatestPointOverride(history, livePointValues, chartEndMs, chartStartMs)
}

export function useSportsGameGraphHistory({
  card,
  marketTargets,
  activeTimeRange,
  chartSeries,
  shouldPairOutcomeHistory,
}: {
  card: SportsGamesCard
  marketTargets: Array<{ conditionId: string; tokenId: string }>
  activeTimeRange: (typeof TIME_RANGES)[number]
  chartSeries: Array<{ key: string; name: string; color: string }>
  shouldPairOutcomeHistory: boolean
}) {
  const chartClockMs = useCurrentTimestamp({ intervalMs: card.eventResolvedAt ? false : 30_000 })
  const { normalizedHistory } = useEventPriceHistory({
    eventId: card.id,
    range: activeTimeRange,
    targets: marketTargets,
    eventCreatedAt: card.eventCreatedAt,
    eventResolvedAt: card.eventResolvedAt,
  })
  const marketQuotesByMarket = useEventMarketQuotes(marketTargets)
  const leadingGapStart = normalizedHistory[0]?.date ?? null

  const historyChartData = useMemo<DataPoint[]>(() => {
    return normalizedHistory
      .map((point) => {
        const nextPoint: DataPoint = { date: point.date }
        let hasValue = false

        for (const series of chartSeries) {
          const value = point[series.key]
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            continue
          }

          nextPoint[series.key] = value
          hasValue = true
        }

        return hasValue ? nextPoint : null
      })
      .filter((point): point is DataPoint => point !== null)
  }, [chartSeries, normalizedHistory])

  const pairedHistoryChartData = useMemo<DataPoint[]>(() => {
    if (!shouldPairOutcomeHistory || chartSeries.length !== 2) {
      return historyChartData
    }

    const [firstSeries, secondSeries] = chartSeries
    return historyChartData
      .map((point) => {
        const firstRaw = point[firstSeries.key]
        const secondRaw = point[secondSeries.key]
        const firstValue = typeof firstRaw === 'number' && Number.isFinite(firstRaw) ? firstRaw : null
        const secondValue = typeof secondRaw === 'number' && Number.isFinite(secondRaw) ? secondRaw : null

        if (firstValue === null && secondValue === null) {
          return null
        }

        const nextPoint: DataPoint = { ...point }
        if (firstValue !== null && secondValue === null) {
          nextPoint[secondSeries.key] = Math.max(0, Math.min(100, 100 - firstValue))
        } else if (firstValue === null && secondValue !== null) {
          nextPoint[firstSeries.key] = Math.max(0, Math.min(100, 100 - secondValue))
        }

        return nextPoint
      })
      .filter((point): point is DataPoint => point !== null)
  }, [chartSeries, historyChartData, shouldPairOutcomeHistory])

  const livePointValues = useMemo(() => {
    const entries: Array<[string, number]> = []

    for (const target of marketTargets) {
      const quote = marketQuotesByMarket[target.conditionId]
      const displayPrice = resolveDisplayPrice({
        bid: quote?.bid ?? null,
        ask: quote?.ask ?? null,
        midpoint: quote?.mid ?? null,
        lastTrade: null,
      })

      if (displayPrice != null) {
        entries.push([target.conditionId, Math.max(0, Math.min(100, displayPrice * 100))])
      }
    }

    return Object.fromEntries(entries)
  }, [marketQuotesByMarket, marketTargets])
  const chartData = useMemo(
    () =>
      appendLiveSportsHistoryPoint({
        history: pairedHistoryChartData,
        livePointValues,
        eventCreatedAt: card.eventCreatedAt,
        eventResolvedAt: card.eventResolvedAt,
        activeTimeRange,
        now: chartClockMs == null ? undefined : new Date(chartClockMs),
      }),
    [activeTimeRange, card.eventCreatedAt, card.eventResolvedAt, chartClockMs, livePointValues, pairedHistoryChartData],
  )

  const latestSnapshot = useMemo(() => {
    const nextValues: Record<string, number> = {}

    chartSeries.forEach((seriesItem) => {
      for (let index = chartData.length - 1; index >= 0; index -= 1) {
        const point = chartData[index]
        if (!point) {
          continue
        }

        const value = point[seriesItem.key]
        if (typeof value === 'number' && Number.isFinite(value)) {
          nextValues[seriesItem.key] = value
          break
        }
      }
    })

    return nextValues
  }, [chartData, chartSeries])

  return { chartData, latestSnapshot, leadingGapStart }
}

export function useSportsGameGraphHeroLegend({
  canRenderPositionedSeriesLegend,
  chartSeries,
  chartData,
  chartWidth,
  chartHeight,
  chartMargin,
  cursorSnapshot,
  latestSnapshot,
  positionedLegendLayout,
  usesPositionedSeriesLegend,
}: {
  canRenderPositionedSeriesLegend: boolean
  chartSeries: Array<{ key: string; name: string; color: string }>
  chartData: DataPoint[]
  chartWidth: number
  chartHeight: number
  chartMargin: { top: number; right: number; bottom: number; left: number }
  cursorSnapshot: PredictionChartCursorSnapshot | null
  latestSnapshot: Record<string, number>
  positionedLegendLayout: SportsPositionedLegendLayout
  usesPositionedSeriesLegend: boolean
}) {
  const latestTimestamp = chartData.at(-1)?.date.getTime() ?? null
  const legendCursorSnapshot = useLaggedSportsLegendCursor({
    cursorSnapshot,
    latestSnapshot,
    latestTimestamp,
  })
  const heroLegendSeriesWithValues = useMemo(() => {
    if (!canRenderPositionedSeriesLegend) {
      return []
    }

    return chartSeries
      .map((seriesItem) => {
        const hoveredValue = legendCursorSnapshot?.values?.[seriesItem.key]
        const value =
          typeof hoveredValue === 'number' && Number.isFinite(hoveredValue)
            ? hoveredValue
            : latestSnapshot[seriesItem.key]
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          return null
        }

        return { ...seriesItem, value }
      })
      .filter((entry): entry is { key: string; name: string; color: string; value: number } => entry !== null)
  }, [canRenderPositionedSeriesLegend, chartSeries, latestSnapshot, legendCursorSnapshot])

  const legendTextMeasurementStore = useMemo(
    () =>
      createSportsLegendTextMeasurementStore({
        enabled: canRenderPositionedSeriesLegend,
        chartSeries,
        positionedLegendLayout,
      }),
    [canRenderPositionedSeriesLegend, chartSeries, positionedLegendLayout],
  )
  const legendTextMeasurements = useSyncExternalStore(
    legendTextMeasurementStore.subscribe,
    legendTextMeasurementStore.getSnapshot,
    legendTextMeasurementStore.getServerSnapshot,
  )
  const heroLegendRenderedWidth =
    canRenderPositionedSeriesLegend && chartSeries.length > 0
      ? legendTextMeasurements.renderedWidth
      : positionedLegendLayout.minWidthPx

  const chartXDomain = useMemo(() => {
    if (!usesPositionedSeriesLegend || chartData.length < 2) {
      return undefined
    }

    const firstPoint = chartData[0]
    const lastPoint = chartData.at(-1)
    if (!firstPoint || !lastPoint) {
      return undefined
    }

    const firstTimestamp = firstPoint.date.getTime()
    const lastTimestamp = lastPoint.date.getTime()
    if (!Number.isFinite(firstTimestamp) || !Number.isFinite(lastTimestamp) || lastTimestamp <= firstTimestamp) {
      return undefined
    }

    const dataSpanMs = Math.max(1, lastTimestamp - firstTimestamp)
    const plotWidthPx = Math.max(1, chartWidth - chartMargin.left - chartMargin.right)
    const reservedRightPx = Math.max(
      0,
      heroLegendRenderedWidth + positionedLegendLayout.labelGapPx + positionedLegendLayout.rightInsetPx,
    )

    // Keep enough fixed room on the right for legend so the plotted line ends before chart edge.
    if (reservedRightPx >= plotWidthPx - 1) {
      return {
        start: firstTimestamp,
        end: lastTimestamp,
      }
    }

    const domainSpanMs = Math.round((dataSpanMs * plotWidthPx) / (plotWidthPx - reservedRightPx))
    return {
      start: firstTimestamp,
      end: firstTimestamp + domainSpanMs,
    }
  }, [
    chartData,
    chartMargin.left,
    chartMargin.right,
    chartWidth,
    heroLegendRenderedWidth,
    positionedLegendLayout,
    usesPositionedSeriesLegend,
  ])

  const heroLegendPositionedEntries = useMemo(() => {
    if (!canRenderPositionedSeriesLegend || heroLegendSeriesWithValues.length === 0 || chartData.length === 0) {
      return [] as Array<{
        key: string
        name: string
        color: string
        value: number
        left: number
        top: number
        width: number
        height: number
      }>
    }

    const firstPoint = chartData[0]
    const lastPoint = chartData.at(-1)
    if (!firstPoint || !lastPoint) {
      return []
    }

    const firstTimestamp = firstPoint.date.getTime()
    const lastTimestamp = lastPoint.date.getTime()
    if (!Number.isFinite(firstTimestamp) || !Number.isFinite(lastTimestamp)) {
      return []
    }

    const explicitStart = typeof chartXDomain?.start === 'number' ? chartXDomain.start : Number.NaN
    const explicitEnd = typeof chartXDomain?.end === 'number' ? chartXDomain.end : Number.NaN
    const domainStart = Number.isFinite(explicitStart) ? explicitStart : firstTimestamp
    const domainEndCandidate = Number.isFinite(explicitEnd) ? explicitEnd : lastTimestamp
    const domainEnd = Math.max(domainStart + 1, domainEndCandidate)
    const hoveredTimestampRaw = legendCursorSnapshot?.date.getTime() ?? lastTimestamp
    const hoveredTimestamp = Math.max(firstTimestamp, Math.min(lastTimestamp, hoveredTimestampRaw))

    const xSpan = Math.max(1, domainEnd - domainStart)
    const plotWidth = Math.max(1, chartWidth - chartMargin.left - chartMargin.right)
    const plotHeight = Math.max(1, chartHeight - chartMargin.top - chartMargin.bottom)
    const yAxisMinTicks = Math.max(3, Math.min(5, Math.round(plotHeight / 56)))
    const chartTop = chartMargin.top
    const chartBottom = chartMargin.top + plotHeight
    const dotX = chartMargin.left + ((hoveredTimestamp - domainStart) / xSpan) * plotWidth
    const plotLeft = chartMargin.left
    const plotRight = chartWidth - chartMargin.right
    const availableFullWidth = plotRight - plotLeft - positionedLegendLayout.rightInsetPx
    const effectiveLabelWidth = Math.max(0, Math.min(heroLegendRenderedWidth, availableFullWidth))
    const maxLeft = plotRight - effectiveLabelWidth - positionedLegendLayout.rightInsetPx
    const labelLeft = Math.max(plotLeft, Math.min(maxLeft, dotX + positionedLegendLayout.labelGapPx))
    const availableLabelWidth = Math.max(1, chartWidth - labelLeft - positionedLegendLayout.rightInsetPx)

    const yBounds = calculateYAxisBounds(chartData, chartSeries, yAxisMinTicks, 6)
    const ySpan = Math.max(1, yBounds.max - yBounds.min)
    const preferredEntries = heroLegendSeriesWithValues.map((entry) => {
      const clampedValue = Math.max(yBounds.min, Math.min(yBounds.max, entry.value))
      const dotY = chartMargin.top + ((yBounds.max - clampedValue) / ySpan) * plotHeight
      const normalizedName = entry.name.trim()
      const measuredNameWidth = normalizedName ? (legendTextMeasurements.nameWidthsByKey.get(entry.key) ?? 0) : 0
      const wrappedNameLineCount = Math.max(1, Math.ceil(measuredNameWidth / availableLabelWidth))
      const labelHeight = Math.max(
        positionedLegendLayout.minHeightPx,
        wrappedNameLineCount * positionedLegendLayout.nameLineHeightPx + positionedLegendLayout.valueLineHeightPx,
      )
      const anchorOffset = labelHeight / 2
      const preferredTop = dotY - anchorOffset
      const maxTopForEntry = chartBottom - labelHeight

      return {
        ...entry,
        dotY,
        left: labelLeft,
        width: effectiveLabelWidth,
        height: labelHeight,
        labelHeight,
        preferredTop: Math.max(chartTop, Math.min(maxTopForEntry, preferredTop)),
      }
    })

    const sortedByPreferredTop = [...preferredEntries].sort((left, right) => left.preferredTop - right.preferredTop)

    const stacked: Array<(typeof sortedByPreferredTop)[number] & { top: number }> = []
    sortedByPreferredTop.forEach((entry, index) => {
      const previousBottom = index > 0 ? stacked[index - 1]!.top + stacked[index - 1]!.labelHeight : null
      const top =
        previousBottom == null
          ? entry.preferredTop
          : Math.max(entry.preferredTop, previousBottom + positionedLegendLayout.verticalGapPx)
      const maxTopForEntry = chartBottom - entry.labelHeight
      stacked.push({ ...entry, top: Math.max(chartTop, Math.min(maxTopForEntry, top)) })
    })

    for (let index = stacked.length - 2; index >= 0; index -= 1) {
      const entry = stacked[index]!
      const next = stacked[index + 1]!
      const maxTopForEntry = chartBottom - entry.labelHeight
      const highestTopAllowedByNext = next.top - positionedLegendLayout.verticalGapPx - entry.labelHeight
      entry.top = Math.max(chartTop, Math.min(maxTopForEntry, Math.min(entry.top, highestTopAllowedByNext)))
    }

    const topByKey = new Map(stacked.map((entry) => [entry.key, entry.top] as const))
    return preferredEntries.map((entry) => ({
      ...entry,
      top: topByKey.get(entry.key) ?? entry.preferredTop,
    }))
  }, [
    chartData,
    chartHeight,
    heroLegendRenderedWidth,
    legendTextMeasurements,
    chartMargin.bottom,
    chartMargin.left,
    chartMargin.right,
    chartMargin.top,
    chartSeries,
    chartWidth,
    chartXDomain,
    heroLegendSeriesWithValues,
    canRenderPositionedSeriesLegend,
    legendCursorSnapshot,
    positionedLegendLayout,
  ])

  const legendSeriesWithValues = useMemo(
    () =>
      chartSeries
        .map((seriesItem) => {
          const hoveredValue = legendCursorSnapshot?.values?.[seriesItem.key]
          const value =
            typeof hoveredValue === 'number' && Number.isFinite(hoveredValue)
              ? hoveredValue
              : latestSnapshot[seriesItem.key]

          if (typeof value !== 'number' || !Number.isFinite(value)) {
            return null
          }

          return { ...seriesItem, value }
        })
        .filter((entry): entry is { key: string; name: string; color: string; value: number } => entry !== null),
    [chartSeries, latestSnapshot, legendCursorSnapshot],
  )

  return {
    heroLegendRenderedWidth,
    chartXDomain,
    heroLegendSeriesWithValues,
    heroLegendPositionedEntries,
    legendSeriesWithValues,
  }
}

export function useSportsGameGraphInteractionState(defaultTimeRange: (typeof TIME_RANGES)[number]) {
  const [cursorSnapshot, setCursorSnapshot] = useState<PredictionChartCursorSnapshot | null>(null)
  const [activeTimeRange, setActiveTimeRange] = useState<(typeof TIME_RANGES)[number]>(defaultTimeRange)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)

  return {
    cursorSnapshot,
    setCursorSnapshot,
    activeTimeRange,
    setActiveTimeRange,
    exportDialogOpen,
    setExportDialogOpen,
  }
}

export function useSportsGameGraphTradeFlow({
  isSportsEventHeroVariant,
  tradeFlowSeriesByTokenId,
}: {
  isSportsEventHeroVariant: boolean
  tradeFlowSeriesByTokenId: Map<string, { color: string }>
}) {
  const [tradeFlowItems, setTradeFlowItems] = useState<SportsTradeFlowLabelItem[]>([])
  const tradeFlowIdRef = useRef(0)
  const hasTradeFlowLabels = tradeFlowItems.length > 0

  useOptionalMarketChannelSubscription((payload) => {
    if (!isSportsEventHeroVariant || !payload) {
      return
    }

    if (payload.event_type !== 'last_trade_price') {
      return
    }

    const assetId = String(payload.asset_id ?? '')
    if (!assetId) {
      return
    }

    const matchedSeries = tradeFlowSeriesByTokenId.get(assetId)
    if (!matchedSeries) {
      return
    }

    const price = Number(payload.price)
    const size = Number(payload.size)
    const label = buildTradeFlowLabel(price, size)
    if (!label) {
      return
    }

    const createdAt = Date.now()
    const id = String(tradeFlowIdRef.current)
    tradeFlowIdRef.current += 1

    setTradeFlowItems((previous) => {
      const next = [...previous, { id, label, color: matchedSeries.color, createdAt }]
      return trimTradeFlowItems(pruneTradeFlowItems(next, createdAt))
    })
  })

  useEffect(
    function pruneExpiredTradeFlowItems() {
      if (!isSportsEventHeroVariant || !hasTradeFlowLabels) {
        return undefined
      }

      const interval = window.setInterval(() => {
        const now = Date.now()
        setTradeFlowItems((previous) => {
          const next = pruneTradeFlowItems(previous, now)
          if (next.length === previous.length) {
            return previous
          }
          return next
        })
      }, TRADE_FLOW_CLEANUP_INTERVAL_MS)

      return function clearTradeFlowPruneInterval() {
        window.clearInterval(interval)
      }
    },
    [hasTradeFlowLabels, isSportsEventHeroVariant],
  )

  return { tradeFlowItems, hasTradeFlowLabels }
}
