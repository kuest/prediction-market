'use client'

import { useExtracted, useLocale } from 'next-intl'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { Event, EventLiveChartConfig, EventSeriesEntry } from '@/types'
import type { DataPoint, SeriesConfig } from '@/types/PredictionChartTypes'

import PredictionChart from '@/components/PredictionChart'
import { useSiteIdentity } from '@/hooks/useSiteIdentity'
import { useWindowSize } from '@/hooks/useWindowSize'
import { resolveEventPagePath } from '@/lib/events-routing'

import { useLiveSeriesClock } from '../_hooks/useLiveSeriesClock'
import { useLiveSeriesPriceSnapshot } from '../_hooks/useLiveSeriesPriceSnapshot'
import { useLiveSeriesWebSocket } from '../_hooks/useLiveSeriesWebSocket'
import {
  classifyLiveSeriesReference,
  buildClosedLiveSeriesData,
  buildLiveSeriesFallbackData,
  findLiveSeriesEvent,
  formatDateAtTimezone,
  formatTimeAtTimezone,
  formatUsd,
  getVisibleCountdownUnits,
  hexToRgba,
  inferIntervalMsFromSeriesSlug,
  isCanonicalBinanceDailySnapshot,
  isShortLiveSeriesCadence,
  isUsEquityMarketOpen,
  LIVE_CHART_HEIGHT,
  LIVE_CHART_MARGIN_BOTTOM,
  LIVE_CHART_MARGIN_LEFT,
  LIVE_CHART_MARGIN_RIGHT,
  LIVE_CHART_MARGIN_TOP,
  LIVE_CURRENT_MARKER_OFFSET_X,
  LIVE_CURSOR_GUIDE_TOP,
  LIVE_PLOT_CLIP_RIGHT_PADDING,
  LIVE_TARGET_MAX_BOTTOM_OFFSET,
  LIVE_WINDOW_MS,
  LIVE_X_AXIS_RIGHT_INSET,
  LIVE_X_AXIS_STEP_MS,
  MAX_POINTS,
  normalizeLiveChartPrice,
  normalizeSubscriptionSymbol,
  parseUtcDate,
  requiresCanonicalBinanceDailyClose,
  resolveLiveChartPaddedDomainEnd,
  resolveDisplayedLiveSeriesBaselinePrice,
  resolveEventEndTimestamp,
  resolveLiveSeriesCountdown,
  resolveLiveSeriesDisplayPrice,
  resolveLiveSeriesRealtimeTopic,
  SERIES_KEY,
  toCountdownLeftLabel,
} from '../_utils/eventLiveSeriesChartUtils'
import {
  buildContinuousLiveAxis,
  buildLiveChartRecoveryValues,
  interpolateLiveChartAxis,
  type LiveChartAxis,
} from '../_utils/liveSeriesChartAxis'
import {
  resolveLiveSeriesAxisPriceDigits,
  resolveLiveSeriesDeltaDisplayDigits,
  resolveLiveSeriesPriceDisplayDigits,
} from '../_utils/liveSeriesPricePrecision'
import EventChart from './EventChart'
import EventLiveSeriesChartHeader from './EventLiveSeriesChartHeader'
import EventLiveSeriesChartOverlay from './EventLiveSeriesChartOverlay'
import EventLiveSeriesViewSwitch from './EventLiveSeriesViewSwitch'
import EventSeriesPills from './EventSeriesPills'

const LIVE_AXIS_RESPONSE_MS = 1_250
const LIVE_AXIS_SETTLE_RATIO = 0.000_05
const LIVE_AXIS_MINIMUM_PRICE_SPAN_RATIO = 0.000_15
const LIVE_AXIS_TARGET_TICK_INTERVALS = 6
const FEATURED_LIVE_X_AXIS_DATA_END_RATIO = 0.6
const FEATURED_LIVE_WINDOW_MS = 8 * 1000
const FEATURED_LIVE_X_AXIS_STEP_MS = 4 * 1000
const FEATURED_LIVE_AXIS_MINIMUM_PRICE_SPAN_RATIO = 0.000_05

function useStableLiveChartAxis(candidate: LiveChartAxis, scopeKey: string) {
  const [state, setState] = useState<{ scopeKey: string; axis: LiveChartAxis }>(() => ({
    scopeKey,
    axis: candidate,
  }))
  const currentRef = useRef({ scopeKey, axis: candidate })
  const targetRef = useRef({ scopeKey, axis: candidate })
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameTimestampRef = useRef<number | null>(null)
  const displayedAxis = state.scopeKey === scopeKey ? state.axis : candidate
  const candidateKey = `${candidate.min}:${candidate.max}:${candidate.step}:${candidate.fractionDigits}:${candidate.tickIntervals}`

  const startAxisAnimation = useCallback(
    function startAxisAnimation() {
      if (animationFrameRef.current != null) {
        return
      }

      function animate(timestamp: number) {
        const current = currentRef.current.axis
        const target = targetRef.current.axis
        const previousTimestamp = lastFrameTimestampRef.current ?? timestamp
        const elapsedMs = Math.min(64, Math.max(0, timestamp - previousTimestamp))
        lastFrameTimestampRef.current = timestamp
        const progress = 1 - Math.exp(-elapsedMs / LIVE_AXIS_RESPONSE_MS)
        const nextAxis = interpolateLiveChartAxis(current, target, progress)
        const targetSpan = Math.max(Number.EPSILON, target.max - target.min)
        const remainingDistance = Math.max(Math.abs(nextAxis.min - target.min), Math.abs(nextAxis.max - target.max))

        if (remainingDistance <= targetSpan * LIVE_AXIS_SETTLE_RATIO) {
          currentRef.current = { scopeKey, axis: target }
          setState({ scopeKey, axis: target })
          animationFrameRef.current = null
          lastFrameTimestampRef.current = null
          return
        }

        currentRef.current = { scopeKey, axis: nextAxis }
        setState({ scopeKey, axis: nextAxis })
        animationFrameRef.current = requestAnimationFrame(animate)
      }

      animationFrameRef.current = requestAnimationFrame(animate)
    },
    [scopeKey],
  )

  useEffect(() => {
    const target = targetRef.current
    if (
      target.scopeKey === scopeKey &&
      target.axis.min === candidate.min &&
      target.axis.max === candidate.max &&
      target.axis.step === candidate.step &&
      target.axis.fractionDigits === candidate.fractionDigits &&
      target.axis.tickIntervals === candidate.tickIntervals
    ) {
      return undefined
    }

    if (currentRef.current.scopeKey !== scopeKey) {
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      lastFrameTimestampRef.current = null
      currentRef.current = { scopeKey, axis: candidate }
      targetRef.current = { scopeKey, axis: candidate }
      const timer = setTimeout(() => setState({ scopeKey, axis: candidate }), 0)
      return () => clearTimeout(timer)
    }

    targetRef.current = { scopeKey, axis: candidate }
    startAxisAnimation()
    return undefined
  }, [candidate, candidateKey, scopeKey, startAxisAnimation])

  useEffect(() => {
    return () => {
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  return displayedAxis
}

function isFinitePositivePrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function normalizeReferencePrice(value: unknown, topic: string) {
  const numeric = typeof value === 'number' ? value : Number(value)
  return normalizeLiveChartPrice(numeric, topic)
}

function resolveTimestampBoundedPrice({
  value,
  topic,
  timestamp,
  endTimestamp,
}: {
  value: unknown
  topic: string
  timestamp: unknown
  endTimestamp: number
}) {
  const numericTimestamp = typeof timestamp === 'number' ? timestamp : Number(timestamp)
  if (!Number.isFinite(numericTimestamp) || numericTimestamp > endTimestamp) {
    return null
  }

  return normalizeReferencePrice(value, topic)
}

interface EventLiveSeriesChartProps {
  event: Event
  isMobile: boolean
  seriesEvents?: EventSeriesEntry[]
  config: EventLiveChartConfig
  chartWidth?: number
  chartHeightOffset?: number
  showSeriesControls?: boolean
  showAreaFill?: boolean
  showCurrentPriceGuide?: boolean
  compactBitcoinHeaderPrices?: boolean
  preserveSeriesContinuity?: boolean
  showLiveMarketLink?: boolean
  featuredChartLayout?: boolean
}

export default function EventLiveSeriesChart({
  event,
  isMobile,
  seriesEvents = [],
  config,
  chartWidth,
  chartHeightOffset = 0,
  showSeriesControls = true,
  showAreaFill = true,
  showCurrentPriceGuide = true,
  compactBitcoinHeaderPrices = false,
  preserveSeriesContinuity = false,
  showLiveMarketLink = true,
  featuredChartLayout = false,
}: EventLiveSeriesChartProps) {
  const subscriptionSymbol = useMemo(
    () => normalizeSubscriptionSymbol(config.topic, config.symbol),
    [config.symbol, config.topic],
  )
  const resetKey = preserveSeriesContinuity
    ? `${config.topic}:${config.event_type}:${subscriptionSymbol}`
    : `${event.id}:${config.topic}:${config.event_type}:${subscriptionSymbol}`

  return (
    <EventLiveSeriesChartContent
      key={resetKey}
      event={event}
      isMobile={isMobile}
      seriesEvents={seriesEvents}
      config={config}
      subscriptionSymbol={subscriptionSymbol}
      chartWidth={chartWidth}
      chartHeightOffset={chartHeightOffset}
      showSeriesControls={showSeriesControls}
      showAreaFill={showAreaFill}
      showCurrentPriceGuide={showCurrentPriceGuide}
      compactBitcoinHeaderPrices={compactBitcoinHeaderPrices}
      preserveSeriesContinuity={preserveSeriesContinuity}
      showLiveMarketLink={showLiveMarketLink}
      featuredChartLayout={featuredChartLayout}
    />
  )
}

interface EventLiveSeriesChartContentProps {
  event: Event
  isMobile: boolean
  seriesEvents: EventSeriesEntry[]
  config: EventLiveChartConfig
  subscriptionSymbol: string
  chartWidth?: number
  chartHeightOffset: number
  showSeriesControls: boolean
  showAreaFill: boolean
  showCurrentPriceGuide: boolean
  compactBitcoinHeaderPrices: boolean
  preserveSeriesContinuity: boolean
  showLiveMarketLink: boolean
  featuredChartLayout: boolean
}

function EventLiveSeriesChartContent({
  event,
  isMobile,
  seriesEvents,
  config,
  subscriptionSymbol,
  chartWidth: providedChartWidth,
  chartHeightOffset,
  showSeriesControls,
  showAreaFill,
  showCurrentPriceGuide,
  compactBitcoinHeaderPrices,
  preserveSeriesContinuity,
  showLiveMarketLink,
  featuredChartLayout,
}: EventLiveSeriesChartContentProps) {
  // Safari's optimizing compiler stalls on the generated memo-cache function during live updates.
  // Keep this hot render function's memoization explicit instead.
  'use no memo'

  const t = useExtracted()
  const locale = useLocale()
  const site = useSiteIdentity()
  const { width: windowWidth } = useWindowSize()
  const liveColor = config.line_color || '#F59E0B'
  const chartHeight = Math.max(260, LIVE_CHART_HEIGHT - Math.max(0, chartHeightOffset))
  const liveWindowMs = featuredChartLayout ? FEATURED_LIVE_WINDOW_MS : LIVE_WINDOW_MS
  const [activeView, setActiveView] = useState<'live' | 'market'>('live')
  const isLiveView = activeView === 'live'
  const startTimestamp = useMemo(() => parseUtcDate(event.start_date ?? null), [event.start_date])
  const resolvedEndTimestamp = useMemo(() => resolveEventEndTimestamp(event), [event])
  const scheduledEndTimestamp = useMemo(() => {
    const timestamps = [
      parseUtcDate(event.end_date ?? null),
      ...event.markets.map((market) => parseUtcDate(market.end_time ?? null)),
    ].filter((timestamp): timestamp is number => timestamp != null)
    return timestamps.length > 0 ? Math.max(...timestamps) : resolvedEndTimestamp
  }, [event.end_date, event.markets, resolvedEndTimestamp])
  const explicitEndTimestamp = scheduledEndTimestamp
  const realtimeTopic = useMemo(
    () =>
      resolveLiveSeriesRealtimeTopic({
        configuredTopic: config.topic,
        activeWindowMinutes: config.active_window_minutes,
        eventStartTimestamp: startTimestamp,
        eventEndTimestamp: scheduledEndTimestamp,
      }),
    [config.active_window_minutes, config.topic, scheduledEndTimestamp, startTimestamp],
  )
  const realtimeConfig = useMemo(
    () => (realtimeTopic === config.topic ? config : { ...config, topic: realtimeTopic }),
    [config, realtimeTopic],
  )
  const hasExplicitEndTimestamp = explicitEndTimestamp != null
  const resolvedMarketsCount = event.markets.filter((market) => market.is_resolved || market.condition?.resolved).length
  const hasResolvedState = Boolean(
    event.resolved_at ||
    event.status === 'resolved' ||
    event.status === 'archived' ||
    (resolvedMarketsCount > 0 && (event.total_markets_count <= 1 || resolvedMarketsCount === event.markets.length)),
  )

  const nowMs = useLiveSeriesClock(isLiveView)
  const endTimestamp = explicitEndTimestamp ?? nowMs

  const {
    referenceSnapshot,
    referenceSnapshotStatus,
    persistedFallbackPrice: snapshotFallbackPrice,
  } = useLiveSeriesPriceSnapshot({
    config: realtimeConfig,
    subscriptionSymbol,
    explicitEndTimestamp,
    startTimestamp,
  })
  const isEventClosed =
    !preserveSeriesContinuity &&
    hasExplicitEndTimestamp &&
    (hasResolvedState || Boolean(referenceSnapshot?.is_event_closed) || nowMs >= endTimestamp)
  const chartNowMs = isEventClosed ? endTimestamp : nowMs

  const persistedFallbackPrice = snapshotFallbackPrice
  const seriesReferenceClassification = useMemo(
    () =>
      classifyLiveSeriesReference({
        topic: realtimeTopic,
        activeWindowMinutes: config.active_window_minutes,
      }),
    [config.active_window_minutes, realtimeTopic],
  )

  const { data, idleRecovery, idleRecoveryVersion, status } = useLiveSeriesWebSocket({
    topic: realtimeTopic,
    eventType: config.event_type,
    eventEndTimestamp: explicitEndTimestamp,
    subscriptionSymbol,
    isLiveView: isLiveView && !isEventClosed,
  })

  const isMarketClosed = useMemo(() => {
    if (realtimeTopic.trim().toLowerCase() !== 'equity_prices') {
      return false
    }
    return !isUsEquityMarketOpen(nowMs)
  }, [nowMs, realtimeTopic])

  const series = useMemo<SeriesConfig[]>(
    () => [
      {
        key: SERIES_KEY,
        name: config.display_symbol || config.display_name,
        color: liveColor,
      },
    ],
    [config.display_name, config.display_symbol, liveColor],
  )

  const fallbackChartWidth = useMemo(() => {
    if (!windowWidth) {
      return 900
    }
    if (isMobile) {
      return Math.max(320, windowWidth * 0.84)
    }
    return Math.min(windowWidth * 0.55, 900)
  }, [isMobile, windowWidth])
  const chartWidth =
    typeof providedChartWidth === 'number' && Number.isFinite(providedChartWidth) && providedChartWidth > 0
      ? Math.max(1, Math.round(providedChartWidth))
      : fallbackChartWidth

  const snapshotOpeningPrice = useMemo(
    () => normalizeReferencePrice(referenceSnapshot?.opening_price, realtimeTopic),
    [realtimeTopic, referenceSnapshot?.opening_price],
  )
  const [retainedOpeningPrice, setRetainedOpeningPrice] = useState<number | null>(snapshotOpeningPrice)
  useLayoutEffect(() => {
    if (!preserveSeriesContinuity || snapshotOpeningPrice == null) {
      return
    }

    let isActive = true
    queueMicrotask(() => {
      if (!isActive) {
        return
      }
      setRetainedOpeningPrice((current) => (current === snapshotOpeningPrice ? current : snapshotOpeningPrice))
    })
    return function cancelRetainedOpeningPriceSync() {
      isActive = false
    }
  }, [preserveSeriesContinuity, snapshotOpeningPrice])
  const referenceOpeningPrice =
    snapshotOpeningPrice ?? (preserveSeriesContinuity ? retainedOpeningPrice : snapshotOpeningPrice)
  const referenceClosingPrice = useMemo(
    () => normalizeReferencePrice(referenceSnapshot?.closing_price, realtimeTopic),
    [realtimeTopic, referenceSnapshot?.closing_price],
  )
  const latestReferencePriceBeforeEnd = useMemo(
    () =>
      resolveTimestampBoundedPrice({
        value: referenceSnapshot?.latest_price,
        topic: realtimeTopic,
        timestamp: referenceSnapshot?.latest_source_timestamp_ms ?? referenceSnapshot?.latest_window_end_ms,
        endTimestamp,
      }),
    [
      realtimeTopic,
      endTimestamp,
      referenceSnapshot?.latest_price,
      referenceSnapshot?.latest_source_timestamp_ms,
      referenceSnapshot?.latest_window_end_ms,
    ],
  )
  const persistedFallbackPriceBeforeEnd = useMemo(() => {
    if (
      !persistedFallbackPrice ||
      !isFinitePositivePrice(persistedFallbackPrice.price) ||
      !Number.isFinite(persistedFallbackPrice.timestamp) ||
      persistedFallbackPrice.timestamp > endTimestamp
    ) {
      return null
    }

    return persistedFallbackPrice.price
  }, [endTimestamp, persistedFallbackPrice])
  const hasCanonicalBinanceDailySnapshot = isCanonicalBinanceDailySnapshot(referenceSnapshot)
  const requiresCanonicalBinanceClose = requiresCanonicalBinanceDailyClose({
    snapshot: referenceSnapshot,
    snapshotStatus: referenceSnapshotStatus,
    seriesClassification: seriesReferenceClassification,
  })
  const finalPrice = isEventClosed
    ? requiresCanonicalBinanceClose
      ? hasCanonicalBinanceDailySnapshot
        ? referenceClosingPrice
        : null
      : (referenceClosingPrice ?? latestReferencePriceBeforeEnd ?? persistedFallbackPriceBeforeEnd)
    : null

  const fallbackCurrentPrice = useMemo(() => {
    if (isEventClosed) {
      return finalPrice
    }

    if (referenceSnapshot) {
      const snapshotPrice = normalizeLiveChartPrice(
        referenceSnapshot.latest_price ?? referenceSnapshot.closing_price ?? Number.NaN,
        realtimeTopic,
      )

      if (typeof snapshotPrice === 'number' && Number.isFinite(snapshotPrice) && snapshotPrice > 0) {
        return snapshotPrice
      }
    }

    if (persistedFallbackPrice && Number.isFinite(persistedFallbackPrice.price) && persistedFallbackPrice.price > 0) {
      return persistedFallbackPrice.price
    }

    return null
  }, [finalPrice, isEventClosed, persistedFallbackPrice, realtimeTopic, referenceSnapshot])

  const tradingWindowMs = useMemo(() => {
    const configuredWindowMinutes = Number(config.active_window_minutes)
    if (Number.isFinite(configuredWindowMinutes) && configuredWindowMinutes > 0) {
      return configuredWindowMinutes * 60 * 1000
    }

    const fromSnapshot = Number(referenceSnapshot?.interval_ms)
    if (Number.isFinite(fromSnapshot) && fromSnapshot > 0) {
      return fromSnapshot
    }

    return inferIntervalMsFromSeriesSlug(config.series_slug)
  }, [config.active_window_minutes, config.series_slug, referenceSnapshot?.interval_ms])

  const tradingWindowStartMs = useMemo(() => {
    if (isShortLiveSeriesCadence(tradingWindowMs)) {
      return endTimestamp - tradingWindowMs
    }

    if (startTimestamp != null && startTimestamp > 0 && startTimestamp < endTimestamp) {
      return startTimestamp
    }

    const snapshotStart = Number(referenceSnapshot?.event_window_start_ms)
    if (Number.isFinite(snapshotStart) && snapshotStart > 0 && snapshotStart < endTimestamp) {
      return snapshotStart
    }

    return endTimestamp - tradingWindowMs
  }, [endTimestamp, referenceSnapshot?.event_window_start_ms, startTimestamp, tradingWindowMs])

  const isTradingWindowActive = !isEventClosed && nowMs >= tradingWindowStartMs
  const liveSeriesEvent = useMemo(
    () => findLiveSeriesEvent(seriesEvents, event.slug, nowMs, tradingWindowMs),
    [event.slug, nowMs, seriesEvents, tradingWindowMs],
  )
  const liveMarketHref =
    showLiveMarketLink && isEventClosed && liveSeriesEvent ? resolveEventPagePath(liveSeriesEvent) : null
  const closedFallbackData = useMemo(
    () =>
      buildClosedLiveSeriesData({
        startTimestamp: tradingWindowStartMs,
        endTimestamp,
        openingPrice: referenceOpeningPrice,
        closingPrice: finalPrice,
        history: (referenceSnapshot?.price_history ?? []).map((point) => ({
          timestamp_ms: point.timestamp_ms,
          price: normalizeReferencePrice(point.price, realtimeTopic) ?? Number.NaN,
        })),
      }),
    [
      endTimestamp,
      finalPrice,
      realtimeTopic,
      referenceOpeningPrice,
      referenceSnapshot?.price_history,
      tradingWindowStartMs,
    ],
  )
  const liveFallbackData = useMemo(
    () => buildLiveSeriesFallbackData(fallbackCurrentPrice, chartNowMs, liveWindowMs),
    [chartNowMs, fallbackCurrentPrice, liveWindowMs],
  )
  const dataSource = useMemo(() => {
    if (!isEventClosed) {
      return data.length > 0 ? data : liveFallbackData
    }

    const preCloseData = data.filter((point) => {
      const timestamp = point.date.getTime()
      return Number.isFinite(timestamp) && timestamp <= endTimestamp
    })

    if (!preCloseData.length) {
      return closedFallbackData
    }

    if (!isFinitePositivePrice(finalPrice)) {
      return requiresCanonicalBinanceClose ? [] : preCloseData
    }

    return [
      ...preCloseData.filter((point) => point.date.getTime() < endTimestamp),
      {
        date: new Date(endTimestamp),
        [SERIES_KEY]: finalPrice,
      },
    ].slice(-MAX_POINTS)
  }, [
    closedFallbackData,
    data,
    endTimestamp,
    finalPrice,
    isEventClosed,
    liveFallbackData,
    requiresCanonicalBinanceClose,
  ])

  const renderData = useMemo(() => {
    if (!dataSource.length) {
      return dataSource
    }

    const domainStart = isEventClosed ? tradingWindowStartMs : chartNowMs - liveWindowMs
    const domainEnd = chartNowMs
    let lastPointBeforeDomainStart: DataPoint | null = null
    const pointsWithinDomain: DataPoint[] = []

    for (const point of dataSource) {
      const timestamp = point.date.getTime()
      if (!Number.isFinite(timestamp)) {
        continue
      }

      if (timestamp < domainStart) {
        lastPointBeforeDomainStart = point
        continue
      }

      if (timestamp <= domainEnd) {
        pointsWithinDomain.push(point)
      }
    }

    let next = pointsWithinDomain
    if (lastPointBeforeDomainStart) {
      next =
        pointsWithinDomain.length > 0
          ? [lastPointBeforeDomainStart, ...pointsWithinDomain]
          : [lastPointBeforeDomainStart]
    } else if (pointsWithinDomain.length > 0) {
      const firstPoint = pointsWithinDomain[0]
      const firstPrice = firstPoint?.[SERIES_KEY]

      if (typeof firstPrice === 'number' && Number.isFinite(firstPrice)) {
        next = [
          {
            date: new Date(domainStart),
            [SERIES_KEY]: firstPrice,
          },
          ...pointsWithinDomain,
        ]
      }
    }

    const lastPoint = next.at(-1)
    const lastPrice = lastPoint?.[SERIES_KEY]
    const lastTimestamp = lastPoint?.date?.getTime?.() ?? Number.NaN

    if (
      typeof lastPrice === 'number' &&
      Number.isFinite(lastPrice) &&
      Number.isFinite(lastTimestamp) &&
      chartNowMs > lastTimestamp
    ) {
      next = [
        ...next,
        {
          date: new Date(chartNowMs),
          [SERIES_KEY]: lastPrice,
        },
      ].slice(-MAX_POINTS)
    }

    return next
  }, [chartNowMs, dataSource, isEventClosed, liveWindowMs, tradingWindowStartMs])

  const lastPoint = renderData.at(-1)
  const rawRenderedPrice = lastPoint?.[SERIES_KEY]
  const renderedPrice =
    typeof rawRenderedPrice === 'number' && Number.isFinite(rawRenderedPrice) ? rawRenderedPrice : null
  const currentPrice = resolveLiveSeriesDisplayPrice({
    isEventClosed,
    finalPrice,
    renderedPrice,
    fallbackCurrentPrice,
    requiresCanonicalClose: requiresCanonicalBinanceClose,
  })
  const resolvedBaselinePrice = referenceOpeningPrice
  const displayedBaselinePrice = resolveDisplayedLiveSeriesBaselinePrice({
    baselinePrice: resolvedBaselinePrice,
    isEventClosed,
    nowTimestamp: nowMs,
    tradingWindowStartTimestamp: tradingWindowStartMs,
    tradingWindowMs,
  })
  const precisionReferencePrice =
    currentPrice ??
    resolvedBaselinePrice ??
    referenceSnapshot?.latest_price ??
    referenceSnapshot?.closing_price ??
    referenceSnapshot?.opening_price ??
    persistedFallbackPrice?.price ??
    null
  const priceDisplayDigits = resolveLiveSeriesPriceDisplayDigits(
    realtimeTopic,
    config.show_price_decimals,
    precisionReferencePrice,
  )
  const axisPriceDisplayDigits = resolveLiveSeriesAxisPriceDigits(priceDisplayDigits, subscriptionSymbol)
  const normalizedPriceSymbol = subscriptionSymbol.toLowerCase().replace(/[^a-z0-9]/g, '')
  const isBitcoinSymbol = normalizedPriceSymbol.startsWith('btc') || normalizedPriceSymbol.startsWith('xbt')
  const headerPriceDisplayDigits = compactBitcoinHeaderPrices && isBitcoinSymbol ? 0 : Math.max(2, priceDisplayDigits)
  const delta = currentPrice != null && displayedBaselinePrice != null ? currentPrice - displayedBaselinePrice : null
  const deltaDisplayDigits = resolveLiveSeriesDeltaDisplayDigits(priceDisplayDigits, delta)
  const latestAxisPointPrice = dataSource.at(-1)?.[SERIES_KEY]
  const axisCurrentPrice =
    typeof latestAxisPointPrice === 'number' && Number.isFinite(latestAxisPointPrice)
      ? latestAxisPointPrice
      : currentPrice
  const candidateAxisValues = useMemo(() => {
    const axisSource = featuredChartLayout ? renderData : dataSource
    const values = axisSource
      .map((point) => point[SERIES_KEY])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

    if (!values.length && typeof axisCurrentPrice === 'number' && Number.isFinite(axisCurrentPrice)) {
      values.push(axisCurrentPrice)
    }

    const recoveryValues = buildLiveChartRecoveryValues(axisCurrentPrice, idleRecovery?.priceSpan ?? null)
    if (recoveryValues.length > 0) {
      // Keep the resumed price centered while the scale absorbs a large idle-time move.
      values.push(...recoveryValues)
    }

    return buildContinuousLiveAxis(
      values,
      axisCurrentPrice,
      axisPriceDisplayDigits,
      featuredChartLayout ? 4 : LIVE_AXIS_TARGET_TICK_INTERVALS,
      featuredChartLayout ? FEATURED_LIVE_AXIS_MINIMUM_PRICE_SPAN_RATIO : LIVE_AXIS_MINIMUM_PRICE_SPAN_RATIO,
    )
  }, [axisCurrentPrice, axisPriceDisplayDigits, dataSource, featuredChartLayout, idleRecovery, renderData])
  const axisInitializationPhase =
    data.length > 0 ? 'realtime-ready' : dataSource.length > 0 ? 'reference-ready' : 'empty'
  const chartScopeKey = preserveSeriesContinuity
    ? `${config.series_slug}:${config.topic}:${config.event_type}:${subscriptionSymbol}`
    : `${event.id}:${realtimeTopic}:${subscriptionSymbol}`
  const axisValues = useStableLiveChartAxis(
    candidateAxisValues,
    `${chartScopeKey}:${axisInitializationPhase}:${idleRecoveryVersion}`,
  )

  const currentLineTop = (() => {
    if (currentPrice == null) {
      return null
    }
    const marginTop = LIVE_CHART_MARGIN_TOP
    const marginBottom = LIVE_CHART_MARGIN_BOTTOM
    const innerHeight = chartHeight - marginTop - marginBottom
    const ratio = (currentPrice - axisValues.min) / Math.max(1e-6, axisValues.max - axisValues.min)
    const clamped = Math.max(0, Math.min(1, ratio))
    return marginTop + innerHeight - innerHeight * clamped
  })()

  const targetLine = (() => {
    if (
      (!isTradingWindowActive && !isEventClosed) ||
      resolvedBaselinePrice == null ||
      !Number.isFinite(resolvedBaselinePrice)
    ) {
      return null
    }

    const marginTop = LIVE_CHART_MARGIN_TOP
    const marginBottom = LIVE_CHART_MARGIN_BOTTOM
    const innerHeight = chartHeight - marginTop - marginBottom
    const ratio = (resolvedBaselinePrice - axisValues.min) / Math.max(1e-6, axisValues.max - axisValues.min)
    const clamped = Math.max(0, Math.min(1, ratio))
    const lineTop = marginTop + innerHeight - innerHeight * clamped
    const maxTop = marginTop + innerHeight - LIVE_TARGET_MAX_BOTTOM_OFFSET

    return {
      badgeTop: Math.min(lineTop, maxTop),
      isAbove: ratio > 1,
      isBelow: ratio < 0,
    }
  })()

  const targetLineGuideColor = '#5D6878'
  const targetBadgeColor = '#5D6878'
  const currentPriceGuideColor = hexToRgba(liveColor, 0.62)

  const countdown = useMemo(() => resolveLiveSeriesCountdown(endTimestamp, nowMs), [endTimestamp, nowMs])

  const shouldShowCountdown = hasExplicitEndTimestamp && !isEventClosed && (nowMs <= 0 || countdown.totalSeconds > 0)

  const liveXAxisDomain = useMemo(() => {
    const startTimestamp = isEventClosed ? tradingWindowStartMs : chartNowMs - liveWindowMs
    const paddedEndTimestamp = resolveLiveChartPaddedDomainEnd({
      startTimestamp,
      endTimestamp: chartNowMs,
      chartWidth,
      marginLeft: LIVE_CHART_MARGIN_LEFT,
      marginRight: LIVE_CHART_MARGIN_RIGHT,
      rightInset: Math.abs(LIVE_CURRENT_MARKER_OFFSET_X),
      dataEndRatio: featuredChartLayout ? FEATURED_LIVE_X_AXIS_DATA_END_RATIO : undefined,
    })

    return {
      start: new Date(startTimestamp),
      end: new Date(paddedEndTimestamp),
    }
  }, [chartNowMs, chartWidth, featuredChartLayout, isEventClosed, liveWindowMs, tradingWindowStartMs])

  const xAxisTickValues = useMemo(() => {
    const startMs = isEventClosed ? tradingWindowStartMs : chartNowMs - liveWindowMs
    if (isEventClosed) {
      const tickCount = isMobile ? 2 : 4
      return Array.from({ length: tickCount }, (_value, index) => {
        const progress = index / (tickCount - 1)
        return new Date(startMs + (chartNowMs - startMs) * progress)
      })
    }

    const xAxisStepMs = featuredChartLayout ? FEATURED_LIVE_X_AXIS_STEP_MS : LIVE_X_AXIS_STEP_MS
    let firstTickMs = Math.floor(startMs / xAxisStepMs) * xAxisStepMs
    if (firstTickMs >= startMs) {
      firstTickMs -= xAxisStepMs
    }
    const lastTickMs = featuredChartLayout
      ? Math.ceil(liveXAxisDomain.end.getTime() / xAxisStepMs) * xAxisStepMs
      : chartNowMs
    const ticks: Date[] = []

    for (let tickMs = firstTickMs; tickMs <= lastTickMs; tickMs += xAxisStepMs) {
      ticks.push(new Date(tickMs))
    }

    if (ticks.length >= 2) {
      return ticks
    }

    return [new Date(startMs), new Date(chartNowMs)]
  }, [
    chartNowMs,
    featuredChartLayout,
    isEventClosed,
    isMobile,
    liveWindowMs,
    liveXAxisDomain.end,
    tradingWindowStartMs,
  ])

  const visibleCountdownUnits = useMemo(
    () =>
      getVisibleCountdownUnits(
        countdown.showDays,
        countdown.days,
        countdown.hours,
        countdown.minutes,
        countdown.seconds,
      ),
    [countdown.showDays, countdown.days, countdown.hours, countdown.minutes, countdown.seconds],
  )

  const countdownLeftLabel = useMemo(
    () =>
      toCountdownLeftLabel(countdown.showDays, countdown.days, countdown.hours, countdown.minutes, countdown.seconds),
    [countdown.showDays, countdown.days, countdown.hours, countdown.minutes, countdown.seconds],
  )

  const etDateLabel = useMemo(
    () => formatDateAtTimezone(endTimestamp, 'America/New_York', locale),
    [endTimestamp, locale],
  )
  const etTimeLabel = useMemo(
    () => formatTimeAtTimezone(endTimestamp, 'America/New_York', locale),
    [endTimestamp, locale],
  )
  const utcDateLabel = useMemo(() => formatDateAtTimezone(endTimestamp, 'UTC', locale), [endTimestamp, locale])
  const utcTimeLabel = useMemo(() => formatTimeAtTimezone(endTimestamp, 'UTC', locale), [endTimestamp, locale])

  const xAxisTickFormatter = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      ...(!isEventClosed ? { second: '2-digit' as const } : {}),
      hour12: false,
    })
    return (date: Date) => formatter.format(date)
  }, [isEventClosed, locale])

  const watermark = useMemo(
    () => ({
      iconSvg: site.logoSvg,
      iconImageUrl: site.logoImageUrl,
      label: site.name,
    }),
    [site.logoImageUrl, site.logoSvg, site.name],
  )

  const seriesControls = useMemo(
    () =>
      showSeriesControls ? (
        <EventSeriesPills
          currentEventSlug={event.slug}
          isDailySeries={tradingWindowMs === 24 * 60 * 60 * 1000}
          tradingWindowMs={tradingWindowMs}
          seriesEvents={seriesEvents}
          variant="live"
          rightSlot={
            <EventLiveSeriesViewSwitch
              activeView={activeView}
              setActiveView={setActiveView}
              liveColor={liveColor}
              config={config}
            />
          }
        />
      ) : null,
    [activeView, config, event.slug, liveColor, seriesEvents, showSeriesControls, tradingWindowMs],
  )

  return (
    <div className="grid gap-4">
      <div className="min-h-96">
        {isLiveView ? (
          <div className="grid gap-1">
            <EventLiveSeriesChartHeader
              resolvedBaselinePrice={displayedBaselinePrice}
              headerPriceDisplayDigits={headerPriceDisplayDigits}
              currentPrice={currentPrice}
              delta={delta}
              deltaDisplayDigits={deltaDisplayDigits}
              liveColor={liveColor}
              shouldShowCountdown={shouldShowCountdown}
              isEventClosed={isEventClosed}
              liveMarketHref={liveMarketHref}
              isMobile={isMobile}
              isTradingWindowActive={isTradingWindowActive}
              visibleCountdownUnits={visibleCountdownUnits}
              countdownLeftLabel={countdownLeftLabel}
              etDateLabel={etDateLabel}
              etTimeLabel={etTimeLabel}
              utcDateLabel={utcDateLabel}
              utcTimeLabel={utcTimeLabel}
              status={status}
              watermark={watermark}
              showCountdownLogo={!featuredChartLayout}
            />

            <div className="relative z-0">
              <EventLiveSeriesChartOverlay
                targetLine={targetLine}
                targetLabel={t('Target')}
                targetLineGuideColor={targetLineGuideColor}
                targetBadgeColor={targetBadgeColor}
                currentLineTop={showCurrentPriceGuide ? currentLineTop : null}
                currentPriceGuideColor={currentPriceGuideColor}
              />
              <PredictionChart
                data={renderData}
                series={series}
                locale={locale}
                dataSyncMode="replace"
                width={chartWidth}
                height={chartHeight}
                margin={{
                  top: LIVE_CHART_MARGIN_TOP,
                  right: LIVE_CHART_MARGIN_RIGHT,
                  bottom: LIVE_CHART_MARGIN_BOTTOM,
                  left: LIVE_CHART_MARGIN_LEFT,
                }}
                dataSignature={chartScopeKey}
                xAxisTickCount={isMobile ? 2 : 4}
                xDomain={liveXAxisDomain}
                xAxisTickValues={xAxisTickValues}
                xAxisTickFormatter={xAxisTickFormatter}
                clipXAxisLabelsToPlot={featuredChartLayout && !isEventClosed}
                xAxisLabelsRightClipRatio={
                  featuredChartLayout && !isEventClosed ? FEATURED_LIVE_X_AXIS_DATA_END_RATIO : undefined
                }
                showVerticalGrid={false}
                showHorizontalGrid
                gridLineStyle="solid"
                gridLineOpacity={0.42}
                showLegend={false}
                xAxisTickFontSize={11}
                yAxisTickFontSize={11}
                centerXAxisTickLabels={!isEventClosed}
                xAxisLabelsRightInset={featuredChartLayout && !isEventClosed ? 0 : LIVE_X_AXIS_RIGHT_INSET}
                alignYAxisLabelsToChartEdge
                fadeYAxisEdges
                neutralAxisColors
                showXAxisTopRule
                showXAxisTopRuleFullWidth
                hideYAxisMinimumLabel
                cursorGuideTop={LIVE_CURSOR_GUIDE_TOP}
                cursorGuideColor="#5D6878"
                clampCursorToDataExtent
                disableCursorSplit
                disableResetAnimation
                markerOuterRadius={10}
                markerInnerRadius={3.4}
                markerPulseStyle="ring"
                markerOffsetX={0}
                lineEndOffsetX={0}
                lineStrokeWidth={2.15}
                plotClipPadding={{
                  top: 0,
                  right: LIVE_PLOT_CLIP_RIGHT_PADDING,
                  bottom: 0,
                  left: 0,
                }}
                showAreaFill={showAreaFill}
                areaFillTopOpacity={0.045}
                areaFillBottomOpacity={0}
                areaFillBottomOffset={5}
                yAxis={{
                  min: axisValues.min,
                  max: axisValues.max,
                  ticks: axisValues.ticks,
                  tickFormat: (value) => formatUsd(value, axisPriceDisplayDigits),
                }}
                tooltipValueFormatter={(value) => formatUsd(value, priceDisplayDigits)}
                tooltipHeaderFontSize={11}
                tooltipDateFontSize={10}
                tooltipDateFormatter={(date) =>
                  date.toLocaleString(locale, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    second: '2-digit',
                  }) + (isMarketClosed ? ` (${t('Closed')})` : '')
                }
                showTooltipSeriesLabels={false}
                tooltipHeader={{
                  iconPath: config.icon_path,
                  color: liveColor,
                }}
                lineCurve="catmullRom"
              />
            </div>
          </div>
        ) : (
          <EventChart
            event={event}
            isMobile={isMobile}
            seriesEvents={seriesEvents}
            chartWidth={providedChartWidth}
            showControls={false}
            showSeriesNavigation={false}
          />
        )}
      </div>

      {seriesControls}
    </div>
  )
}
