'use client'

import type { MouseEvent as ReactMouseEvent, ReactNode, TouchEvent as ReactTouchEvent } from 'react'

import { curveMonotoneX } from '@visx/curve'
import { localPoint } from '@visx/event'
import { Group } from '@visx/group'
import { scaleLinear, scaleTime } from '@visx/scale'
import { AreaClosed, LinePath } from '@visx/shape'
import { CircleHelpIcon, MinusIcon, TriangleIcon } from 'lucide-react'
import { useExtracted, useLocale } from 'next-intl'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'

import type { ProfileForCards } from '@/app/[locale]/(platform)/_components/ProfileOverviewCard'
import type { PnlPoint } from '@/lib/pnl-chart'
import type { PortfolioSnapshot } from '@/lib/portfolio'

import ProfileOverviewCard from '@/app/[locale]/(platform)/_components/ProfileOverviewCard'
import PnlAnimatedCurrency from '@/app/[locale]/(platform)/profile/_components/PnlAnimatedCurrency'
import SiteLogoIcon from '@/components/SiteLogoIcon'
import { Card, CardContent } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { usePublicRuntimeConfig } from '@/hooks/usePublicRuntimeConfig'
import { useSiteIdentity } from '@/hooks/useSiteIdentity'
import { buildDataApiUrl } from '@/lib/data-api/client'
import { calculatePnlGainLossThroughTime, findNearestPnlPointByTime } from '@/lib/pnl-chart'
import { cn } from '@/lib/utils'
import { usePortfolioValueVisibility } from '@/stores/usePortfolioValueVisibility'

const PNL_TIMEFRAMES = ['1D', '1W', '1M', 'ALL'] as const

interface PublicProfileHeroCardsProps {
  profile: ProfileForCards
  snapshot: PortfolioSnapshot
  actions?: ReactNode
  headerActions?: ReactNode
  resolutionHistoryAdornment?: ReactNode
  variant?: 'public' | 'portfolio'
  fallbackChartEndDate?: string
}

function usePnlSeries({
  pnlAddress,
  pnlBaseUrl,
  activeTimeframe,
  pnlSeriesKey,
}: {
  pnlAddress: string | null | undefined
  pnlBaseUrl: string
  activeTimeframe: (typeof PNL_TIMEFRAMES)[number]
  pnlSeriesKey: string
}) {
  const sourceKey = `${pnlAddress ?? ''}:${pnlBaseUrl}`
  const currentRequestKey = useRef(pnlSeriesKey)
  useLayoutEffect(() => {
    currentRequestKey.current = pnlSeriesKey
  }, [pnlSeriesKey])
  const [pnlSeriesState, setPnlSeriesState] = useState<{
    sourceKey: string
    timeframe: (typeof PNL_TIMEFRAMES)[number]
    series: PnlPoint[]
  } | null>(null)

  useEffect(
    function fetchPnlSeriesEffect() {
      if (!pnlAddress || !pnlBaseUrl) {
        return
      }

      const controller = new AbortController()
      const timeframeConfig = {
        '1D': { interval: '1d', fidelity: '1h' },
        '1W': { interval: '1w', fidelity: '3h' },
        '1M': { interval: '1m', fidelity: '18h' },
        ALL: { interval: 'all', fidelity: '12h' },
      } as const
      const { interval, fidelity } = timeframeConfig[activeTimeframe] ?? timeframeConfig.ALL
      const params = new URLSearchParams({
        user_address: pnlAddress,
        interval,
        fidelity,
      })
      fetch(buildDataApiUrl('/user-pnl', params, pnlBaseUrl), {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`PNL request failed: ${response.status}`)
          }
          return await response.json()
        })
        .then((data) => {
          if (controller.signal.aborted || currentRequestKey.current !== pnlSeriesKey || !Array.isArray(data)) {
            return
          }

          const normalized = data
            .map((point: { t?: number; p?: number }) => ({
              date: typeof point.t === 'number' ? new Date(point.t * 1000) : null,
              value: typeof point.p === 'number' ? point.p : null,
            }))
            .filter((point) => point.date && Number.isFinite(point.date.getTime()) && Number.isFinite(point.value))
            .map((point) => ({ date: point.date as Date, value: point.value as number }))
            .sort((a, b) => a.date.getTime() - b.date.getTime())

          if (normalized.length === 0) {
            return
          }

          setPnlSeriesState({ sourceKey, timeframe: activeTimeframe, series: normalized })
        })
        .catch(() => {
          // Keep the last observed value when this period cannot be loaded.
        })

      return function abortPnlFetch() {
        controller.abort()
      }
    },
    [activeTimeframe, pnlAddress, pnlBaseUrl, pnlSeriesKey, sourceKey],
  )

  return { pnlSeries: pnlSeriesState?.sourceKey === sourceKey ? pnlSeriesState : null }
}

function usePnlTimeframeIndicator(activeTimeframe: (typeof PNL_TIMEFRAMES)[number]) {
  const timeRangeContainerRef = useRef<HTMLDivElement | null>(null)
  const timeRangeRef = useRef<(HTMLButtonElement | null)[]>([])
  const indicatorFrameRef = useRef<number | null>(null)
  const [timeRangeIndicator, setTimeRangeIndicator] = useReducer(
    (_current: { width: number; left: number }, next: { width: number; left: number }) => next,
    { width: 0, left: 0 },
  )
  const [timeRangeIndicatorReady, setTimeRangeIndicatorReady] = useReducer(
    (_current: boolean, next: boolean) => next,
    false,
  )

  const cancelQueuedIndicatorFrame = useCallback(() => {
    if (indicatorFrameRef.current != null) {
      window.cancelAnimationFrame(indicatorFrameRef.current)
      indicatorFrameRef.current = null
    }
  }, [])

  const updateIndicator = useCallback(() => {
    const activeIndex = PNL_TIMEFRAMES.findIndex((range) => range === activeTimeframe)
    const activeButton = timeRangeRef.current[activeIndex]
    const container = timeRangeContainerRef.current
    if (!activeButton || !container) {
      return
    }

    const { offsetLeft, offsetWidth } = activeButton
    cancelQueuedIndicatorFrame()
    indicatorFrameRef.current = window.requestAnimationFrame(() => {
      indicatorFrameRef.current = null
      setTimeRangeIndicator({ left: offsetLeft, width: offsetWidth })
      setTimeRangeIndicatorReady(true)
    })
  }, [activeTimeframe, cancelQueuedIndicatorFrame])

  useLayoutEffect(
    function runIndicatorLayoutSync() {
      updateIndicator()

      return function cleanupIndicatorLayoutSync() {
        cancelQueuedIndicatorFrame()
      }
    },
    [cancelQueuedIndicatorFrame, updateIndicator],
  )

  useEffect(
    function bindIndicatorResizeListener() {
      updateIndicator()
      window.addEventListener('resize', updateIndicator)
      return function unbindIndicatorResizeListener() {
        window.removeEventListener('resize', updateIndicator)
        cancelQueuedIndicatorFrame()
      }
    },
    [cancelQueuedIndicatorFrame, updateIndicator],
  )

  return {
    timeRangeContainerRef,
    timeRangeRef,
    timeRangeIndicator,
    timeRangeIndicatorReady,
  }
}

function usePnlChartFallbackData({
  fallbackChartEndDate,
  activeTimeframe,
}: {
  fallbackChartEndDate: string | undefined
  activeTimeframe: (typeof PNL_TIMEFRAMES)[number]
}) {
  const fallbackDurationMs = useMemo(() => {
    const ranges = {
      '1D': 1000 * 60 * 60 * 24,
      '1W': 1000 * 60 * 60 * 24 * 7,
      '1M': 1000 * 60 * 60 * 24 * 30,
      ALL: 1000 * 60 * 60 * 24 * 365,
    }
    return ranges[activeTimeframe] ?? ranges.ALL
  }, [activeTimeframe])
  const fallbackEndDate = useMemo(
    () => new Date(fallbackChartEndDate ?? '1970-01-01T00:00:00.000Z'),
    [fallbackChartEndDate],
  )
  const fallbackStartDate = useMemo(
    () => new Date(fallbackEndDate.getTime() - fallbackDurationMs),
    [fallbackDurationMs, fallbackEndDate],
  )
  return { fallbackEndDate, fallbackStartDate }
}

function usePnlChartDomain(chartData: PnlPoint[]) {
  return useMemo(() => {
    if (!chartData.length) {
      return [0, 0] as const
    }
    let min = chartData[0].value
    let max = chartData[0].value
    for (const point of chartData) {
      if (point.value < min) {
        min = point.value
      }
      if (point.value > max) {
        max = point.value
      }
    }
    return [min, max] as const
  }, [chartData])
}

function usePnlChartScales({
  startDate,
  endDate,
  paddedMin,
  paddedMax,
  innerWidth,
  lineBottom,
  lineTop,
}: {
  startDate: Date
  endDate: Date
  paddedMin: number
  paddedMax: number
  innerWidth: number
  lineBottom: number
  lineTop: number
}) {
  const xScale = useMemo(
    () =>
      scaleTime<number>({
        range: [0, innerWidth],
        domain: [startDate, endDate],
      }),
    [endDate, innerWidth, startDate],
  )
  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        range: [lineBottom, lineTop],
        domain: [paddedMin, paddedMax],
        nice: false,
      }),
    [lineBottom, lineTop, paddedMax, paddedMin],
  )
  return { xScale, yScale }
}

function usePnlCursorInteraction({
  innerWidth,
  innerHeight,
  chartData,
  endValue,
  xScale,
  yScale,
}: {
  innerWidth: number
  innerHeight: number
  chartData: PnlPoint[]
  endValue: number
  xScale: ReturnType<typeof scaleTime<number>>
  yScale: ReturnType<typeof scaleLinear<number>>
}) {
  const [cursorX, setCursorX] = useState<number | null>(null)

  const handlePointerMove = useCallback((event: ReactTouchEvent<SVGRectElement> | ReactMouseEvent<SVGRectElement>) => {
    const point = localPoint(event)
    if (!point) {
      return
    }
    setCursorX(point.x)
  }, [])

  const handlePointerLeave = useCallback(() => {
    setCursorX(null)
  }, [])

  const pointerX = cursorX == null ? null : Math.max(0, Math.min(cursorX, innerWidth))
  const cursorPoint = useMemo(
    () => (pointerX == null ? null : findNearestPnlPointByTime(chartData, xScale.invert(pointerX).getTime())),
    [chartData, pointerX, xScale],
  )
  const clampedCursorX = cursorPoint ? xScale(cursorPoint.date) : null
  const cursorDate = cursorPoint?.date ?? null
  const cursorValue = cursorPoint?.value ?? endValue
  const cursorY = cursorPoint ? yScale(cursorPoint.value) : null
  const cursorDotPosition = useMemo(() => {
    if (clampedCursorX == null || cursorY == null || innerWidth === 0 || innerHeight === 0) {
      return null
    }

    return {
      left: `${(clampedCursorX / innerWidth) * 100}%`,
      top: `${(cursorY / innerHeight) * 100}%`,
    }
  }, [clampedCursorX, cursorY, innerHeight, innerWidth])

  return {
    handlePointerMove,
    handlePointerLeave,
    clampedCursorX,
    cursorDate,
    cursorValue,
    cursorDotPosition,
  }
}

function usePnlGainLoss({
  chartData,
  cursorDate,
  endDate,
  activeTimeframe,
}: {
  chartData: PnlPoint[]
  cursorDate: Date | null
  endDate: Date
  activeTimeframe: (typeof PNL_TIMEFRAMES)[number]
}) {
  return useMemo(() => {
    const targetTime = (cursorDate ?? endDate).getTime()
    const baseline = activeTimeframe === 'ALL' ? 0 : (chartData[0]?.value ?? 0)
    return calculatePnlGainLossThroughTime(chartData, targetTime, baseline)
  }, [activeTimeframe, chartData, cursorDate, endDate])
}

function usePnlChartIds() {
  const chartId = useId().replace(/:/g, '')
  return {
    lineGradientId: `${chartId}-line`,
    areaGradientId: `${chartId}-area`,
    areaFadeId: `${chartId}-fade`,
    areaMaskId: `${chartId}-mask`,
  }
}

function usePnlActiveTimeframe() {
  const [activeTimeframe, setActiveTimeframe] = useState<(typeof PNL_TIMEFRAMES)[number]>('1D')
  return { activeTimeframe, setActiveTimeframe }
}

function ProfitLossCard({
  snapshot: _snapshot,
  portfolioAddress,
  fallbackChartEndDate,
}: {
  snapshot: PortfolioSnapshot
  portfolioAddress?: string | null
  fallbackChartEndDate?: string
}) {
  const t = useExtracted()
  const locale = useLocale()
  const site = useSiteIdentity()
  const { dataUrl } = usePublicRuntimeConfig()
  const platformName = site.name ?? ''
  const { activeTimeframe, setActiveTimeframe } = usePnlActiveTimeframe()
  const { lineGradientId, areaGradientId, areaFadeId, areaMaskId } = usePnlChartIds()
  const logoSvg = site.logoSvg.replace(/fill="url\([^"]+\)"/gi, 'fill="currentColor"')
  const pnlAddress = portfolioAddress
  const pnlBaseUrl = dataUrl
  const pnlSeriesKey = `${pnlAddress ?? ''}:${pnlBaseUrl}:${activeTimeframe}`
  const { pnlSeries } = usePnlSeries({ pnlAddress, pnlBaseUrl, activeTimeframe, pnlSeriesKey })

  const { timeRangeContainerRef, timeRangeRef, timeRangeIndicator, timeRangeIndicatorReady } =
    usePnlTimeframeIndicator(activeTimeframe)

  const { fallbackEndDate, fallbackStartDate } = usePnlChartFallbackData({
    fallbackChartEndDate,
    activeTimeframe,
  })

  const hasPnlSeries = pnlSeries !== null
  const chartData = pnlSeries?.series ?? []
  const displayedTimeframe = pnlSeries?.timeframe ?? activeTimeframe
  const startDate = chartData[0]?.date ?? fallbackStartDate
  const endDate = chartData.at(-1)?.date ?? fallbackEndDate
  const startValue = chartData[0]?.value ?? 0
  const endValue = chartData.at(-1)?.value ?? 0

  const chartWidth = 360
  const chartHeight = 80
  const margin = { top: 0, right: 0, bottom: 0, left: 0 }
  const innerWidth = chartWidth - margin.left - margin.right
  const innerHeight = chartHeight - margin.top - margin.bottom
  const linePadding = Math.round(innerHeight * 0.22)
  const lineTop = linePadding
  const lineBottom = innerHeight - linePadding
  const [minValue, maxValue] = usePnlChartDomain(chartData)
  const domainPadding = minValue === maxValue ? Math.max(1, Math.abs(minValue || 1)) : 0
  const paddedMin = minValue - domainPadding
  const paddedMax = maxValue + domainPadding

  const { xScale, yScale } = usePnlChartScales({
    startDate,
    endDate,
    paddedMin,
    paddedMax,
    innerWidth,
    lineBottom,
    lineTop,
  })

  const { handlePointerMove, handlePointerLeave, clampedCursorX, cursorDate, cursorValue, cursorDotPosition } =
    usePnlCursorInteraction({
      innerWidth,
      innerHeight,
      chartData,
      endValue,
      xScale,
      yScale,
    })

  const displayAbsoluteValue = clampedCursorX == null ? endValue : cursorValue
  const displayBaselineValue = displayedTimeframe === 'ALL' ? 0 : startValue
  const displayNetValue = displayAbsoluteValue - displayBaselineValue
  const isDeltaPositive = hasPnlSeries && displayNetValue > 0
  const isDeltaNegative = hasPnlSeries && displayNetValue < 0
  const areValuesHidden = usePortfolioValueVisibility((state) => state.isHidden)
  const [gainTotal, lossTotal] = usePnlGainLoss({
    chartData,
    cursorDate,
    endDate,
    activeTimeframe: displayedTimeframe,
  })
  const timeframeLabel =
    (
      {
        ALL: t('All-Time'),
        '1D': t('Past Day'),
        '1W': t('Past Week'),
        '1M': t('Past Month'),
      } as const
    )[activeTimeframe] || t('All-Time')
  const timeframeButtonLabels = {
    ALL: t('ALL'),
    '1D': t('1D'),
    '1W': t('1W'),
    '1M': t('1M'),
  } as const
  const hoverDateLabel = cursorDate
    ? `${cursorDate.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })} ${cursorDate.toLocaleTimeString(
        locale,
        { hour: 'numeric', minute: '2-digit' },
      )}`
    : null

  return (
    <Card className="relative h-full overflow-hidden rounded-lg bg-background">
      <CardContent className="relative flex h-full flex-col gap-2.5 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3 sm:gap-4">
          <div className="flex items-center gap-2">
            {isDeltaPositive && <TriangleIcon className="size-4 -translate-y-px fill-yes text-yes" />}
            {isDeltaNegative && <TriangleIcon className="size-4 translate-y-px rotate-180 fill-no text-no" />}
            {!isDeltaPositive && !isDeltaNegative && <MinusIcon className="size-4 text-muted-foreground" />}
            <span className="text-base font-semibold text-foreground">{t('Profit/Loss')}</span>
          </div>

          <div
            ref={timeRangeContainerRef}
            className="relative flex items-center justify-start gap-2 text-xs font-semibold"
          >
            <div
              className={cn(
                'absolute inset-y-0 rounded-md bg-muted',
                timeRangeIndicatorReady ? 'opacity-100 transition-all duration-300' : 'opacity-0 transition-none',
              )}
              style={{
                width: `${timeRangeIndicator.width}px`,
                left: `${timeRangeIndicator.left}px`,
              }}
              aria-hidden={!timeRangeIndicatorReady}
            />
            {PNL_TIMEFRAMES.map((timeframe, index) => (
              <button
                key={timeframe}
                ref={(el) => {
                  timeRangeRef.current[index] = el
                }}
                type="button"
                className={cn(
                  'relative rounded-md px-3 py-2 transition-colors',
                  activeTimeframe === timeframe
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                )}
                onClick={() => setActiveTimeframe(timeframe)}
              >
                {timeframeButtonLabels[timeframe]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 sm:gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="flex items-center gap-2 text-2xl leading-none font-bold tracking-tight sm:text-3xl">
                <span>
                  {areValuesHidden ? (
                    '****'
                  ) : hasPnlSeries ? (
                    <PnlAnimatedCurrency
                      magnitude={displayNetValue}
                      sign={displayNetValue < 0 ? '-' : '+'}
                      size="large"
                    />
                  ) : (
                    '—'
                  )}
                </span>
                <Popover>
                  <PopoverTrigger
                    openOnHover
                    delay={0}
                    closeDelay={150}
                    render={
                      <button
                        type="button"
                        aria-label={t('Net value breakdown')}
                        className="inline-flex translate-y-px text-muted-foreground hover:text-foreground"
                      >
                        <CircleHelpIcon className="size-4" />
                      </button>
                    }
                  />
                  <PopoverContent side="bottom" align="center" className="w-56 p-3 text-left">
                    <PopoverTitle className="sr-only">{t('Net value breakdown')}</PopoverTitle>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span>{t('Gain')}</span>
                        <span>
                          {areValuesHidden ? (
                            '****'
                          ) : hasPnlSeries ? (
                            <PnlAnimatedCurrency magnitude={gainTotal} sign="+" />
                          ) : (
                            '—'
                          )}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>{t('Loss')}</span>
                        <span>
                          {areValuesHidden ? (
                            '****'
                          ) : hasPnlSeries ? (
                            <PnlAnimatedCurrency magnitude={lossTotal} sign="-" />
                          ) : (
                            '—'
                          )}
                        </span>
                      </div>
                      <div className="h-px w-full bg-border/60" />
                      <div className="flex items-center justify-between">
                        <span>{t('Net total')}</span>
                        <span>
                          {areValuesHidden ? (
                            '****'
                          ) : hasPnlSeries ? (
                            <PnlAnimatedCurrency magnitude={displayNetValue} sign={displayNetValue < 0 ? '-' : '+'} />
                          ) : (
                            '—'
                          )}
                        </span>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </p>
            </div>
            <p className="text-sm text-muted-foreground">{hoverDateLabel ?? timeframeLabel}</p>
          </div>

          <div
            className={cn(
              `pointer-events-none flex items-center gap-2 text-xl text-muted-foreground/50 opacity-80 select-none`,
            )}
            aria-hidden="true"
            draggable={false}
          >
            <SiteLogoIcon
              logoSvg={logoSvg}
              logoImageUrl={site.logoImageUrl}
              alt={`${platformName} ${t('logo')}`}
              className="size-[1em] text-current [&_svg]:size-[1em] [&_svg_*]:fill-current [&_svg_*]:stroke-current"
              imageClassName="size-[1em] object-contain"
              size={20}
            />
            <span className="font-semibold">{platformName}</span>
          </div>
        </div>

        <div className="relative mt-auto h-12 w-full overflow-hidden sm:h-18">
          <svg width="100%" height="100%" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
            <defs>
              <linearGradient
                id={lineGradientId}
                x1="0"
                y1={lineTop}
                x2="0"
                y2={lineBottom}
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="#7dd3fc" />
                <stop offset="100%" stopColor="#a855f7" />
              </linearGradient>
              <linearGradient
                id={areaGradientId}
                x1="0"
                y1={lineTop}
                x2="0"
                y2={lineBottom}
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="#7dd3fc" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#a855f7" stopOpacity={0.25} />
              </linearGradient>
              <linearGradient id={areaFadeId} x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity={0.6} />
                <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
              </linearGradient>
              <mask id={areaMaskId} maskUnits="userSpaceOnUse">
                <rect x="0" y="0" width={innerWidth} height={innerHeight} fill={`url(#${areaFadeId})`} />
              </mask>
            </defs>

            <Group left={margin.left} top={margin.top}>
              <AreaClosed
                data={chartData}
                x={(d) => xScale(d.date)}
                y={(d) => yScale(d.value)}
                y0={innerHeight}
                yScale={yScale}
                stroke="none"
                fill={`url(#${areaGradientId})`}
                mask={`url(#${areaMaskId})`}
                curve={curveMonotoneX}
              />

              <LinePath
                data={chartData}
                x={(d) => xScale(d.date)}
                y={(d) => yScale(d.value)}
                stroke={`url(#${lineGradientId})`}
                strokeWidth={2}
                curve={curveMonotoneX}
              />

              {clampedCursorX != null && (
                <line
                  x1={clampedCursorX}
                  x2={clampedCursorX}
                  y1={0}
                  y2={innerHeight}
                  stroke="white"
                  strokeWidth={1}
                  strokeOpacity={0.7}
                />
              )}

              <rect
                x={0}
                y={0}
                width={innerWidth}
                height={innerHeight}
                fill="transparent"
                onMouseMove={handlePointerMove}
                onMouseLeave={handlePointerLeave}
                onTouchStart={handlePointerMove}
                onTouchMove={handlePointerMove}
                onTouchEnd={handlePointerLeave}
              />
            </Group>
          </svg>
          {cursorDotPosition && (
            <div
              className="pointer-events-none absolute rounded-full"
              style={{
                ...cursorDotPosition,
                width: 6,
                height: 6,
                transform: 'translate(-50%, -50%)',
                background: 'radial-gradient(circle at 30% 30%, #7dd3fc 0%, #a855f7 70%)',
              }}
            />
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default function PublicProfileHeroCards({
  profile,
  snapshot,
  actions,
  headerActions,
  resolutionHistoryAdornment,
  variant = 'public',
  fallbackChartEndDate,
}: PublicProfileHeroCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ProfileOverviewCard
        profile={profile}
        snapshot={snapshot}
        actions={actions}
        headerActions={headerActions}
        resolutionHistoryAdornment={resolutionHistoryAdornment}
        variant={variant}
        enableLiveValue={variant === 'portfolio'}
      />
      <ProfitLossCard
        snapshot={snapshot}
        portfolioAddress={profile.portfolioAddress}
        fallbackChartEndDate={fallbackChartEndDate}
      />
    </div>
  )
}
