'use client'

import type { SetStateAction } from 'react'

import { useLocale } from 'next-intl'
import dynamic from 'next/dynamic'
import { memo, useCallback, useMemo, useState, useSyncExternalStore } from 'react'

import type { TimeRange } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'
import type { EventChartProps } from '@/app/[locale]/(platform)/event/[slug]/_types/EventChartTypes'
import type { DataPoint, PredictionChartCursorSnapshot, SeriesConfig } from '@/types/PredictionChartTypes'

import { useEventChartAnnotations } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventChartAnnotations'
import { useEventChartTradeFlow } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventChartTradeFlow'
import { useEventMarketChanceData } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventMarketChanceData'
import {
  buildMarketTargets,
  useEventPriceHistory,
} from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'
import { useXTrackerTweetCount } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useXTrackerTweetCount'
import {
  buildCombinedOutcomeHistory,
  getOutcomeTokenIds,
  parseTimestampToMs,
  resolveSelectedMarketIds,
  resolveTweetCount,
  resolveTweetCountdownTargetMs,
} from '@/app/[locale]/(platform)/event/[slug]/_utils/eventChartInternalHelpers'
import {
  buildHistoryWithLatestPointOverride,
  buildChartSeries,
  buildMarketSignature,
  filterChartDataForSeries,
  getMaxSeriesCount,
  getOutcomeLabelForMarket,
  getSportsMoneylineMarketIds,
  getTopMarketIds,
  resolveChartRangeStartMs,
  resolveEventHistoryEndAt,
  shouldHideEventChart,
} from '@/app/[locale]/(platform)/event/[slug]/_utils/EventChartUtils'
import { isTweetMarketsEvent } from '@/app/[locale]/(platform)/event/[slug]/_utils/eventTweetMarkets'
import { useCurrentTimestamp } from '@/hooks/useCurrentTimestamp'
import { useOutcomeLabel } from '@/hooks/useOutcomeLabel'
import { useSiteIdentity } from '@/hooks/useSiteIdentity'
import { useWindowSize } from '@/hooks/useWindowSize'
import { OUTCOME_INDEX } from '@/lib/constants'
import { getUserPublicAddress } from '@/lib/user-address'
import { useUser } from '@/stores/useUser'

import type { ChartSettings } from './EventChartControls'

import {
  getStoredChartSettingsServerSnapshot,
  loadStoredChartSettings,
  storeChartSettings,
  subscribeToChartSettings,
} from '../_utils/chartSettingsStorage'
import EventChartCanvas from './EventChartCanvas'
import EventChartControlsBar from './EventChartControlsBar'
import EventChartHeader from './EventChartHeader'
import EventChartLayout from './EventChartLayout'
import EventChartLegend from './EventChartLegend'
import EventChartSummary from './EventChartSummary'

const EventChartExportDialog = dynamic(() => import('./EventChartExportDialog'), { ssr: false })

function EventChartComponent({
  event,
  forceVisible = false,
  isSingleMarketOverride,
  isMobile,
  seriesEvents = [],
  chartWidth: providedChartWidth,
  chartHeight,
  compactLegend = false,
  disableResetAnimation = false,
  legendVariant,
  showControls = true,
  showSeriesNavigation = true,
  showWatermark = true,
}: EventChartProps) {
  const locale = useLocale()
  const normalizeOutcomeLabel = useOutcomeLabel()
  const site = useSiteIdentity()
  const user = useUser()
  const userAddress = getUserPublicAddress(user)
  const maxSeriesCount = getMaxSeriesCount()
  const sportsMoneylineMarketIds = useMemo(
    () => getSportsMoneylineMarketIds(event).slice(0, maxSeriesCount),
    [event, maxSeriesCount],
  )
  const usesSportsMoneylineSeries = sportsMoneylineMarketIds.length > 1
  const isSingleMarket = usesSportsMoneylineSeries ? false : (isSingleMarketOverride ?? event.total_markets_count === 1)
  const shouldHideChart = shouldHideEventChart(event, {
    forceVisible,
    isSingleMarket,
    sportsMoneylineMarketIds,
    maxSeriesCount,
  })
  const shouldFetchChartData = !shouldHideChart
  const chartSettings = useSyncExternalStore(
    subscribeToChartSettings,
    loadStoredChartSettings,
    getStoredChartSettingsServerSnapshot,
  )

  const [activeTimeRange, setActiveTimeRange] = useState<TimeRange>('ALL')
  const [activeOutcomeIndex, setActiveOutcomeIndex] = useState<typeof OUTCOME_INDEX.YES | typeof OUTCOME_INDEX.NO>(
    OUTCOME_INDEX.YES,
  )
  const [cursorState, setCursorState] = useState<{
    scopeKey: string
    snapshot: PredictionChartCursorSnapshot | null
  }>({
    scopeKey: '',
    snapshot: null,
  })
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [hasOpenedExportDialog, setHasOpenedExportDialog] = useState(false)
  const nowMs = useCurrentTimestamp({ intervalMs: 30_000 })
  const currentTimestampMs = nowMs ?? 0

  const handleChartSettingsChange = useCallback(
    (nextValue: SetStateAction<ChartSettings>) => {
      const nextSettings = typeof nextValue === 'function' ? nextValue(chartSettings) : nextValue

      storeChartSettings(nextSettings)
    },
    [chartSettings],
  )

  const showBothOutcomes = isSingleMarket && chartSettings.bothOutcomes
  const eventHistoryEndAt = useMemo(() => resolveEventHistoryEndAt(event), [event])
  const shouldShowTweetMarketsPanel = useMemo(() => isTweetMarketsEvent(event), [event])
  const tweetCount = useMemo(() => resolveTweetCount(event), [event])
  const tweetCountdownTargetMs = useMemo(() => resolveTweetCountdownTargetMs(event), [event])
  const xtrackerTweetCountQuery = useXTrackerTweetCount(event, shouldShowTweetMarketsPanel)
  const resolvedTweetCount = xtrackerTweetCountQuery.data?.totalCount ?? tweetCount
  const resolvedTweetCountdownTargetMs = useMemo(() => {
    const trackingEndMs = xtrackerTweetCountQuery.data?.trackingEndMs
    if (typeof trackingEndMs === 'number' && Number.isFinite(trackingEndMs) && trackingEndMs > 0) {
      return trackingEndMs
    }

    return tweetCountdownTargetMs
  }, [tweetCountdownTargetMs, xtrackerTweetCountQuery.data?.trackingEndMs])
  const resolvedTweetStartTargetMs = useMemo(() => {
    const trackingStartMs = xtrackerTweetCountQuery.data?.trackingStartMs
    if (typeof trackingStartMs === 'number' && Number.isFinite(trackingStartMs) && trackingStartMs > 0) {
      return trackingStartMs
    }

    return parseTimestampToMs(event.start_date ?? null)
  }, [event.start_date, xtrackerTweetCountQuery.data?.trackingStartMs])
  const shouldRenderTweetMarketsPanel =
    shouldShowTweetMarketsPanel &&
    resolvedTweetStartTargetMs != null &&
    currentTimestampMs >= resolvedTweetStartTargetMs
  const isTweetMarketsFinal =
    Boolean(event.resolved_at || event.status === 'resolved') ||
    (resolvedTweetCountdownTargetMs != null &&
      Number.isFinite(resolvedTweetCountdownTargetMs) &&
      currentTimestampMs >= resolvedTweetCountdownTargetMs)

  const { displayChanceByMarket, yesPriceHistory } = useEventMarketChanceData({
    event,
    range: activeTimeRange,
    enabled: shouldFetchChartData,
  })
  const noMarketTargets = useMemo(
    () => (shouldHideChart || !isSingleMarket ? [] : buildMarketTargets(event.markets, OUTCOME_INDEX.NO)),
    [event.markets, isSingleMarket, shouldHideChart],
  )
  const noPriceHistory = useEventPriceHistory({
    eventId: event.id,
    range: activeTimeRange,
    targets: noMarketTargets,
    eventCreatedAt: event.created_at,
    eventResolvedAt: eventHistoryEndAt,
  })

  const chartHistory = isSingleMarket && activeOutcomeIndex === OUTCOME_INDEX.NO ? noPriceHistory : yesPriceHistory
  const isChartRangeLoading = showBothOutcomes
    ? yesPriceHistory.isRangeTransitioning || noPriceHistory.isRangeTransitioning
    : chartHistory.isRangeTransitioning
  const marketSnapshot = showBothOutcomes ? yesPriceHistory.latestSnapshot : chartHistory.latestSnapshot

  const allMarketIds = useMemo(
    () =>
      event.markets
        .map((market) => market.condition_id)
        .filter((conditionId): conditionId is string => Boolean(conditionId)),
    [event.markets],
  )
  const topMarketIds = useMemo(() => getTopMarketIds(marketSnapshot, maxSeriesCount), [marketSnapshot, maxSeriesCount])
  const fallbackMarketIds = useMemo(() => allMarketIds.slice(0, maxSeriesCount), [allMarketIds, maxSeriesCount])
  const defaultMarketIds = useMemo(
    () =>
      sportsMoneylineMarketIds.length > 1
        ? sportsMoneylineMarketIds
        : topMarketIds.length > 0
          ? topMarketIds
          : fallbackMarketIds,
    [fallbackMarketIds, sportsMoneylineMarketIds, topMarketIds],
  )
  const [customMarketSelection, setCustomMarketSelection] = useState<{
    eventId: string
    marketIds: string[] | null
  }>(() => ({
    eventId: event.id,
    marketIds: null,
  }))
  const activeCustomMarketIds = customMarketSelection.eventId === event.id ? customMarketSelection.marketIds : null
  const selectedMarketIds = useMemo(
    () =>
      isSingleMarket
        ? defaultMarketIds
        : resolveSelectedMarketIds(activeCustomMarketIds, allMarketIds, defaultMarketIds),
    [activeCustomMarketIds, allMarketIds, defaultMarketIds, isSingleMarket],
  )

  const handleToggleMarket = useCallback(
    (marketId: string) => {
      if (isSingleMarket) {
        return
      }

      setCustomMarketSelection((prev) => {
        const currentSelection = resolveSelectedMarketIds(
          prev.eventId === event.id ? prev.marketIds : null,
          allMarketIds,
          defaultMarketIds,
        )
        const isSelected = currentSelection.includes(marketId)
        if (isSelected) {
          const nextSelection = currentSelection.filter((id) => id !== marketId)
          return nextSelection.length > 0 ? { eventId: event.id, marketIds: nextSelection } : prev
        }
        if (currentSelection.length >= maxSeriesCount) {
          return prev
        }
        const nextSet = new Set(currentSelection)
        nextSet.add(marketId)
        return {
          eventId: event.id,
          marketIds: allMarketIds.filter((id) => nextSet.has(id)).slice(0, maxSeriesCount),
        }
      })
    },
    [allMarketIds, defaultMarketIds, event.id, isSingleMarket, maxSeriesCount],
  )

  const chartSeries = useMemo(
    () =>
      buildChartSeries(event, topMarketIds).map((series) => ({
        ...series,
        name: normalizeOutcomeLabel(series.name),
      })),
    [event, normalizeOutcomeLabel, topMarketIds],
  )
  const fallbackChartSeries = useMemo(
    () =>
      buildChartSeries(event, fallbackMarketIds).map((series) => ({
        ...series,
        name: normalizeOutcomeLabel(series.name),
      })),
    [event, fallbackMarketIds, normalizeOutcomeLabel],
  )
  const allSeries = useMemo(
    () =>
      buildChartSeries(event, allMarketIds).map((series) => ({
        ...series,
        name: normalizeOutcomeLabel(series.name),
      })),
    [allMarketIds, event, normalizeOutcomeLabel],
  )
  const selectedSeries = useMemo(
    () =>
      buildChartSeries(event, selectedMarketIds).map((series) => ({
        ...series,
        name: normalizeOutcomeLabel(series.name),
      })),
    [event, normalizeOutcomeLabel, selectedMarketIds],
  )
  const selectedColors = useMemo(
    () => Object.fromEntries(selectedSeries.map((series) => [series.key, series.color])),
    [selectedSeries],
  )
  const marketOptions = useMemo(
    () =>
      allSeries.map((series) => ({
        ...series,
        color: selectedColors[series.key] ?? '#374151',
      })),
    [allSeries, selectedColors],
  )

  const baseSeries = useMemo(() => {
    if (!isSingleMarket) {
      if (selectedSeries.length > 0) {
        return selectedSeries
      }
      return chartSeries.length > 0 ? chartSeries : fallbackChartSeries
    }
    return chartSeries.length > 0 ? chartSeries : fallbackChartSeries
  }, [chartSeries, fallbackChartSeries, isSingleMarket, selectedSeries])

  const primaryMarket = useMemo(() => {
    if (isSingleMarket) {
      return event.markets[0]
    }
    const primaryId = baseSeries[0]?.key
    return (primaryId ? event.markets.find((market) => market.condition_id === primaryId) : null) ?? event.markets[0]
  }, [event.markets, baseSeries, isSingleMarket])

  const primaryConditionId = primaryMarket?.condition_id ?? ''
  const yesSeriesKey = showBothOutcomes && primaryConditionId ? `${primaryConditionId}-yes` : primaryConditionId
  const noSeriesKey = showBothOutcomes && primaryConditionId ? `${primaryConditionId}-no` : primaryConditionId
  const yesOutcomeLabel = normalizeOutcomeLabel(getOutcomeLabelForMarket(primaryMarket, OUTCOME_INDEX.YES))
  const noOutcomeLabel = normalizeOutcomeLabel(getOutcomeLabelForMarket(primaryMarket, OUTCOME_INDEX.NO))
  const bothOutcomeSeries = useMemo(() => {
    if (!showBothOutcomes || !primaryConditionId) {
      return []
    }
    return [
      { key: yesSeriesKey, name: yesOutcomeLabel, color: 'var(--primary)' },
      { key: noSeriesKey, name: noOutcomeLabel, color: '#FF6600' },
    ]
  }, [showBothOutcomes, primaryConditionId, yesSeriesKey, noSeriesKey, yesOutcomeLabel, noOutcomeLabel])

  const effectiveSeries = useMemo(() => {
    if (showBothOutcomes) {
      return bothOutcomeSeries
    }
    if (!isSingleMarket || baseSeries.length === 0) {
      return baseSeries
    }
    const primaryColor = activeOutcomeIndex === OUTCOME_INDEX.NO ? '#FF6600' : 'var(--primary)'
    return baseSeries.map((seriesItem, index) => (index === 0 ? { ...seriesItem, color: primaryColor } : seriesItem))
  }, [activeOutcomeIndex, baseSeries, isSingleMarket, showBothOutcomes, bothOutcomeSeries])

  const watermark = useMemo(
    () => ({
      iconSvg: site.logoSvg,
      iconImageUrl: site.logoImageUrl,
      label: site.name,
    }),
    [site.logoImageUrl, site.logoSvg, site.name],
  )
  const visibleWatermark = showWatermark ? watermark : {}
  const legendSeries = effectiveSeries
  const hasLegendSeries = legendSeries.length > 0
  const oppositeOutcomeIndex = activeOutcomeIndex === OUTCOME_INDEX.YES ? OUTCOME_INDEX.NO : OUTCOME_INDEX.YES
  const oppositeOutcomeLabel = normalizeOutcomeLabel(getOutcomeLabelForMarket(primaryMarket, oppositeOutcomeIndex))
  const activeOutcomeLabel = normalizeOutcomeLabel(getOutcomeLabelForMarket(primaryMarket, activeOutcomeIndex))
  const markerConditionIds = useMemo(() => {
    if (!userAddress) {
      return []
    }

    if (showBothOutcomes || isSingleMarket) {
      return primaryConditionId ? [primaryConditionId] : []
    }

    const unique = new Set<string>()
    effectiveSeries.forEach((seriesItem) => {
      if (seriesItem.key) {
        unique.add(seriesItem.key)
      }
    })
    return Array.from(unique)
  }, [effectiveSeries, isSingleMarket, primaryConditionId, showBothOutcomes, userAddress])

  const chartAnnotationMarkers = useEventChartAnnotations({
    eventId: event.id,
    userAddress,
    markerConditionIds,
    showBothOutcomes,
    annotationsEnabled: chartSettings.annotations,
  })

  const outcomeTokenIds = useMemo(() => {
    return getOutcomeTokenIds(primaryMarket)
  }, [primaryMarket])

  const { tradeFlowItems } = useEventChartTradeFlow(outcomeTokenIds)

  const bothOutcomeHistory = useMemo(() => {
    if (!showBothOutcomes || !primaryConditionId) {
      return { points: [] as DataPoint[], latestSnapshot: {} as Record<string, number> }
    }
    return buildCombinedOutcomeHistory(
      yesPriceHistory.normalizedHistory,
      noPriceHistory.normalizedHistory,
      primaryConditionId,
      yesSeriesKey,
      noSeriesKey,
    )
  }, [
    showBothOutcomes,
    primaryConditionId,
    yesSeriesKey,
    noSeriesKey,
    yesPriceHistory.normalizedHistory,
    noPriceHistory.normalizedHistory,
  ])

  const normalizedHistory = showBothOutcomes ? bothOutcomeHistory.points : chartHistory.normalizedHistory
  const latestPointOverrides = useMemo(() => {
    if (showBothOutcomes && primaryConditionId && yesSeriesKey && noSeriesKey) {
      const liveYesChance = displayChanceByMarket[primaryConditionId]
      if (typeof liveYesChance !== 'number' || !Number.isFinite(liveYesChance)) {
        return {}
      }

      return {
        [yesSeriesKey]: liveYesChance,
        [noSeriesKey]: 100 - liveYesChance,
      }
    }

    if (isSingleMarket && primaryConditionId) {
      const liveYesChance = displayChanceByMarket[primaryConditionId]
      if (typeof liveYesChance !== 'number' || !Number.isFinite(liveYesChance)) {
        return {}
      }

      const activeValue = activeOutcomeIndex === OUTCOME_INDEX.NO ? 100 - liveYesChance : liveYesChance

      return {
        [primaryConditionId]: activeValue,
      }
    }

    const entries = effectiveSeries
      .map((seriesItem) => {
        const liveValue = displayChanceByMarket[seriesItem.key]
        if (typeof liveValue !== 'number' || !Number.isFinite(liveValue)) {
          return null
        }
        return [seriesItem.key, liveValue] as const
      })
      .filter((entry): entry is readonly [string, number] => entry !== null)

    return Object.fromEntries(entries)
  }, [
    activeOutcomeIndex,
    displayChanceByMarket,
    effectiveSeries,
    isSingleMarket,
    noSeriesKey,
    primaryConditionId,
    showBothOutcomes,
    yesSeriesKey,
  ])
  const normalizedHistoryForChart = useMemo(() => {
    const resolvedEndMs = parseTimestampToMs(eventHistoryEndAt)
    const chartEndMs = resolvedEndMs ?? nowMs
    const chartStartMs = resolveChartRangeStartMs(activeTimeRange, event.created_at, chartEndMs)

    return buildHistoryWithLatestPointOverride(normalizedHistory, latestPointOverrides, chartEndMs, chartStartMs)
  }, [activeTimeRange, event.created_at, eventHistoryEndAt, latestPointOverrides, normalizedHistory, nowMs])
  const leadingGapStart = normalizedHistoryForChart[0]?.date ?? null
  const latestSnapshot = showBothOutcomes ? bothOutcomeHistory.latestSnapshot : chartHistory.latestSnapshot

  const chartData = useMemo(
    () =>
      filterChartDataForSeries(
        normalizedHistoryForChart,
        effectiveSeries.map((series) => series.key),
      ),
    [normalizedHistoryForChart, effectiveSeries],
  )
  const hasChartData = chartData.length > 0
  const chartScopeKey = useMemo(() => {
    const seriesKeys = effectiveSeries.map((series) => series.key).join(',')
    return `${event.id}:${activeTimeRange}:${activeOutcomeIndex}:${seriesKeys}`
  }, [event.id, activeTimeRange, activeOutcomeIndex, effectiveSeries])
  const cursorSnapshot = cursorState.scopeKey === chartScopeKey ? cursorState.snapshot : null
  const handleCursorDataChange = useCallback(
    (snapshot: PredictionChartCursorSnapshot | null) => {
      setCursorState({
        scopeKey: chartScopeKey,
        snapshot,
      })
    },
    [chartScopeKey],
  )

  const { width: windowWidth } = useWindowSize()
  const fallbackChartWidth = isMobile ? (windowWidth || 400) * 0.84 : Math.min((windowWidth ?? 1440) * 0.55, 900)
  const chartWidth =
    typeof providedChartWidth === 'number' && Number.isFinite(providedChartWidth) && providedChartWidth > 0
      ? Math.max(1, Math.round(providedChartWidth))
      : fallbackChartWidth

  const legendEntries = useMemo<Array<SeriesConfig & { value: number | null }>>(
    () =>
      legendSeries.map((seriesItem) => {
        const hoveredValue = cursorSnapshot?.values?.[seriesItem.key]
        const snapshotValue = showBothOutcomes
          ? latestSnapshot[seriesItem.key]
          : (displayChanceByMarket[seriesItem.key] ?? latestSnapshot[seriesItem.key])
        const value =
          typeof hoveredValue === 'number' && Number.isFinite(hoveredValue)
            ? hoveredValue
            : Number.isFinite(snapshotValue)
              ? snapshotValue
              : null
        return { ...seriesItem, value }
      }),
    [displayChanceByMarket, legendSeries, cursorSnapshot, latestSnapshot, showBothOutcomes],
  )

  const activeSeriesKey = showBothOutcomes
    ? activeOutcomeIndex === OUTCOME_INDEX.NO
      ? noSeriesKey
      : yesSeriesKey
    : legendSeries[0]?.key
  const primarySeriesColor = showBothOutcomes
    ? activeOutcomeIndex === OUTCOME_INDEX.NO
      ? '#FF6600'
      : 'var(--primary)'
    : (legendSeries[0]?.color ?? 'currentColor')
  const hoveredActiveChance = activeSeriesKey ? cursorSnapshot?.values?.[activeSeriesKey] : null
  const primaryMarketKey = primaryConditionId || legendSeries[0]?.key
  const storedYesChance = primaryMarketKey ? displayChanceByMarket[primaryMarketKey] : null
  const latestYesChance = primaryMarketKey ? yesPriceHistory.latestSnapshot[primaryMarketKey] : null
  const baseYesChance =
    typeof storedYesChance === 'number' && Number.isFinite(storedYesChance)
      ? storedYesChance
      : typeof latestYesChance === 'number' && Number.isFinite(latestYesChance)
        ? latestYesChance
        : null
  const derivedActiveChance =
    typeof baseYesChance === 'number'
      ? activeOutcomeIndex === OUTCOME_INDEX.NO
        ? Math.max(0, Math.min(100, 100 - baseYesChance))
        : baseYesChance
      : null
  const snapshotActiveChance =
    showBothOutcomes && activeSeriesKey
      ? typeof latestSnapshot[activeSeriesKey] === 'number'
        ? latestSnapshot[activeSeriesKey]
        : null
      : null
  const baseActiveChance = snapshotActiveChance ?? derivedActiveChance
  const resolvedActiveChance =
    typeof hoveredActiveChance === 'number' && Number.isFinite(hoveredActiveChance)
      ? hoveredActiveChance
      : typeof baseActiveChance === 'number' && Number.isFinite(baseActiveChance)
        ? baseActiveChance
        : null
  const yesChanceValue = typeof resolvedActiveChance === 'number' ? resolvedActiveChance : null
  const legendEntriesWithValues = useMemo(
    () => legendEntries.filter((entry) => typeof entry.value === 'number' && Number.isFinite(entry.value)),
    [legendEntries],
  )
  const shouldRenderLegendEntries = legendSeries.length > 0 && legendEntriesWithValues.length > 0
  const cursorActiveChance =
    typeof hoveredActiveChance === 'number' && Number.isFinite(hoveredActiveChance) ? hoveredActiveChance : null
  const defaultBaselineYesChance = useMemo(() => {
    if (!activeSeriesKey) {
      return null
    }
    for (const point of chartData) {
      const value = point[activeSeriesKey]
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value
      }
    }
    return null
  }, [chartData, activeSeriesKey])
  const defaultCurrentYesChance = useMemo(() => {
    if (!activeSeriesKey) {
      return null
    }
    for (let index = chartData.length - 1; index >= 0; index -= 1) {
      const value = chartData[index]?.[activeSeriesKey]
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value
      }
    }
    return null
  }, [chartData, activeSeriesKey])
  const isHovering = cursorSnapshot !== null && cursorActiveChance !== null && Number.isFinite(cursorActiveChance)
  const effectiveBaselineYesChance = defaultBaselineYesChance
  const effectiveCurrentYesChance = isHovering ? cursorActiveChance : defaultCurrentYesChance

  const resolvedLegendVariant = legendVariant ?? (compactLegend ? 'compact' : 'default')
  const legendContent = shouldRenderLegendEntries ? (
    <EventChartLegend entries={legendEntries} variant={resolvedLegendVariant} />
  ) : null

  if (shouldHideChart) {
    return <EventChartSummary event={event} showWatermark={showWatermark} />
  }

  if (!hasLegendSeries) {
    return null
  }
  return (
    <>
      <EventChartLayout
        header={
          <EventChartHeader
            isSingleMarket={isSingleMarket}
            activeOutcomeIndex={activeOutcomeIndex}
            activeOutcomeLabel={activeOutcomeLabel}
            primarySeriesColor={primarySeriesColor}
            yesChanceValue={yesChanceValue}
            effectiveBaselineYesChance={effectiveBaselineYesChance}
            effectiveCurrentYesChance={effectiveCurrentYesChance}
            watermark={visibleWatermark}
            currentEventSlug={event.slug}
            seriesEvents={seriesEvents}
            showSeriesNavigation={showSeriesNavigation}
            showTweetMarketsPanel={shouldRenderTweetMarketsPanel}
            tweetCount={resolvedTweetCount}
            tweetCountdownTargetMs={resolvedTweetCountdownTargetMs}
            tweetMarketsFinal={isTweetMarketsFinal}
          />
        }
        chart={
          <EventChartCanvas
            chartData={chartData}
            isLoading={isChartRangeLoading}
            locale={locale}
            legendSeries={legendSeries}
            chartWidth={chartWidth}
            chartHeight={chartHeight}
            chartScopeKey={chartScopeKey}
            onCursorDataChange={handleCursorDataChange}
            isMobile={isMobile}
            isSingleMarket={isSingleMarket}
            chartSettings={chartSettings}
            chartAnnotationMarkers={chartAnnotationMarkers}
            leadingGapStart={leadingGapStart}
            disableResetAnimation={disableResetAnimation}
            legendContent={legendContent}
            watermark={isSingleMarket ? undefined : visibleWatermark}
            tradeFlowItems={tradeFlowItems}
          />
        }
        controls={
          showControls ? (
            <EventChartControlsBar
              event={event}
              nowMs={nowMs || null}
              hasChartData={hasChartData}
              activeTimeRange={activeTimeRange}
              onTimeRangeChange={setActiveTimeRange}
              isSingleMarket={isSingleMarket}
              oppositeOutcomeLabel={oppositeOutcomeLabel}
              onShuffle={() => {
                setActiveOutcomeIndex(oppositeOutcomeIndex)
                handleCursorDataChange(null)
              }}
              marketOptions={marketOptions}
              selectedMarketIds={selectedMarketIds}
              maxSeriesCount={maxSeriesCount}
              onToggleMarket={handleToggleMarket}
              settings={chartSettings}
              onSettingsChange={handleChartSettingsChange}
              onExportData={() => {
                setHasOpenedExportDialog(true)
                setExportDialogOpen(true)
              }}
            />
          ) : undefined
        }
      />
      {hasOpenedExportDialog && (
        <EventChartExportDialog
          open={exportDialogOpen}
          onOpenChange={setExportDialogOpen}
          eventCreatedAt={event.created_at}
          markets={event.markets}
          isMultiMarket={event.total_markets_count > 1}
        />
      )}
    </>
  )
}

function areChartPropsEqual(prev: EventChartProps, next: EventChartProps) {
  if (prev.isMobile !== next.isMobile) {
    return false
  }
  if ((prev.showControls ?? true) !== (next.showControls ?? true)) {
    return false
  }
  if ((prev.showSeriesNavigation ?? true) !== (next.showSeriesNavigation ?? true)) {
    return false
  }
  if ((prev.showWatermark ?? true) !== (next.showWatermark ?? true)) {
    return false
  }
  if ((prev.compactLegend ?? false) !== (next.compactLegend ?? false)) {
    return false
  }
  if ((prev.legendVariant ?? null) !== (next.legendVariant ?? null)) {
    return false
  }
  if ((prev.chartWidth ?? null) !== (next.chartWidth ?? null)) {
    return false
  }
  if ((prev.chartHeight ?? 272) !== (next.chartHeight ?? 272)) {
    return false
  }
  if ((prev.isSingleMarketOverride ?? null) !== (next.isSingleMarketOverride ?? null)) {
    return false
  }
  if ((prev.forceVisible ?? false) !== (next.forceVisible ?? false)) {
    return false
  }
  if ((prev.disableResetAnimation ?? false) !== (next.disableResetAnimation ?? false)) {
    return false
  }
  if (prev.event.id !== next.event.id) {
    return false
  }
  if (prev.event.updated_at !== next.event.updated_at) {
    return false
  }

  return buildMarketSignature(prev.event) === buildMarketSignature(next.event)
}

export default memo(EventChartComponent, areChartPropsEqual)
