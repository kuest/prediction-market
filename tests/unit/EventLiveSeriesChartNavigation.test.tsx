import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, mock } from 'bun:test'

import type {
  LiveSeriesPriceSnapshot,
  PersistedLivePrice,
} from '@/app/[locale]/(platform)/event/[slug]/_utils/eventLiveSeriesChartUtils'
import type { Event, EventLiveChartConfig, EventSeriesEntry } from '@/types'

import { hoisted } from '../bun-test-helpers'

const initialNow = Date.parse('2026-11-15T12:02:00Z')
const mocks = hoisted(() => ({
  nowMs: initialNow,
  snapshotClosed: false,
  livePointsAvailable: true,
  feedUnavailable: false,
  canonicalReference: {} as Partial<LiveSeriesPriceSnapshot>,
  persistedFallback: null as PersistedLivePrice | null,
  reference: mock(),
  header: mock(),
  chart: mock(),
  clock: mock(),
  webSocket: mock(),
  seriesControls: mock(),
}))
const chartUtils = await import('@/app/[locale]/(platform)/event/[slug]/_utils/eventLiveSeriesChartUtils')
const findLiveSeriesEvent = mock(chartUtils.findLiveSeriesEvent)

void mock.module('@/app/[locale]/(platform)/event/[slug]/_utils/eventLiveSeriesChartUtils', () => ({
  ...chartUtils,
  findLiveSeriesEvent,
}))
void mock.module('next-intl', () => ({
  useLocale: () => 'en',
  useExtracted: () => (message: string) => message,
}))
void mock.module('next/dynamic', () => ({ default: () => () => null }))
void mock.module('@/hooks/useWindowSize', () => ({ useWindowSize: () => ({ width: 1440 }) }))
void mock.module('@/hooks/useSiteIdentity', () => ({ useSiteIdentity: () => ({ name: 'Kuest' }) }))
void mock.module('@/components/PredictionChart', () => ({
  default: (props: any) => {
    mocks.chart(props)
    return <div data-testid="live-chart" />
  },
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_hooks/useLiveSeriesClock', () => ({
  useLiveSeriesClock: (isLiveView: boolean) => {
    mocks.clock(isLiveView)
    return mocks.nowMs
  },
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_hooks/useLiveSeriesPriceSnapshot', () => ({
  useLiveSeriesPriceSnapshot: (options: unknown) => {
    mocks.reference(options)
    return {
      referenceSnapshot: {
        opening_price: 60_000,
        closing_price: 60_010,
        ...mocks.canonicalReference,
        is_event_closed: mocks.snapshotClosed,
      },
      referenceSnapshotStatus: 'ready',
      persistedFallbackPrice: mocks.persistedFallback,
    }
  },
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_hooks/useLiveSeriesWebSocket', () => ({
  useLiveSeriesWebSocket: (props: any) => {
    mocks.webSocket(props)
    return {
      data: mocks.livePointsAvailable
        ? [
            { date: new Date(mocks.nowMs - 1000), live_price: 60_000 },
            { date: new Date(mocks.nowMs), live_price: 60_010 },
          ]
        : [],
      feedUnavailable: mocks.feedUnavailable,
      idleRecovery: null,
      idleRecoveryVersion: 0,
      resumedAtTimestamp: null,
      status: 'live',
    }
  },
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventLiveSeriesChartHeader', () => ({
  default: (props: { liveMarketHref: string | null }) => {
    mocks.header(props)
    return props.liveMarketHref ? <a href={props.liveMarketHref}>Live successor</a> : null
  },
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventLiveSeriesChartOverlay', () => ({
  default: () => null,
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventLiveSeriesViewSwitch', () => ({
  default: () => null,
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventSeriesPills', () => ({
  default: (props: any) => {
    mocks.seriesControls(props)
    return <div data-testid="series-controls" />
  },
}))

const { default: EventLiveSeriesChart } =
  await import('@/app/[locale]/(platform)/event/[slug]/_components/EventLiveSeriesChart')
const config = {
  topic: 'crypto_prices_chainlink',
  event_type: 'update',
  symbol: 'btc/usd',
  active_window_minutes: 5,
  series_slug: 'btc-up-or-down-5m',
  display_symbol: 'BTC',
  display_name: 'Bitcoin',
} as EventLiveChartConfig
const event = {
  id: 'current-event',
  slug: 'current-event',
  status: 'active',
  start_date: '2026-11-15T12:00:00Z',
  end_date: '2026-11-15T12:05:00Z',
  total_markets_count: 1,
  markets: [{ is_resolved: false }],
} as unknown as Event
const seriesEvents = [
  { id: 'past', slug: 'past-event', status: 'resolved', end_date: '2026-11-15T12:00:00Z' },
  { id: 'current', slug: event.slug, status: 'active', end_date: event.end_date },
  { id: 'next', slug: 'next-event', status: 'active', end_date: '2026-11-15T12:10:00Z' },
] as EventSeriesEntry[]

beforeEach(() => {
  mocks.nowMs = initialNow
  mocks.snapshotClosed = false
  mocks.livePointsAvailable = true
  mocks.feedUnavailable = false
  mocks.canonicalReference = {}
  mocks.persistedFallback = null
  mocks.reference.mockClear()
  mocks.header.mockClear()
  mocks.chart.mockClear()
  mocks.clock.mockClear()
  mocks.webSocket.mockClear()
  mocks.seriesControls.mockClear()
  findLiveSeriesEvent.mockClear()
})

describe('live series chart successor lookup', () => {
  it.each(['empty', 'historical'] as const)(
    'keeps the %s home chart drawing through clock updates without searching hidden navigation data',
    (variant) => {
      const props = {
        event,
        config,
        seriesEvents: variant === 'empty' ? [] : seriesEvents,
        isMobile: false,
        showSeriesControls: false,
        showLiveMarketLink: false,
        preserveSeriesContinuity: true,
      }
      const { rerender } = render(<EventLiveSeriesChart {...props} />)
      expect(screen.getByTestId('live-chart')).toBeInTheDocument()
      expect(screen.queryByTestId('series-controls')).not.toBeInTheDocument()
      const firstRenderCount = mocks.chart.mock.calls.length

      for (const elapsed of [40, 80, 120]) {
        mocks.nowMs = initialNow + elapsed
        rerender(<EventLiveSeriesChart {...props} />)
      }

      expect(mocks.chart.mock.calls.length).toBeGreaterThan(firstRenderCount)
      expect(mocks.chart.mock.lastCall?.[0].data.length).toBeGreaterThan(0)
      expect(mocks.clock).toHaveBeenLastCalledWith(true)
      expect(mocks.webSocket).toHaveBeenLastCalledWith(expect.objectContaining({ isLiveView: true }))
      expect(findLiveSeriesEvent).not.toHaveBeenCalled()
      expect(screen.queryByRole('link', { name: 'Live successor' })).not.toBeInTheDocument()
    },
  )

  it('preserves event page series controls without looking for a successor while the event is live', () => {
    render(<EventLiveSeriesChart event={event} config={config} seriesEvents={seriesEvents} isMobile={false} />)
    expect(screen.getByTestId('live-chart')).toBeInTheDocument()
    expect(screen.getByTestId('series-controls')).toBeInTheDocument()
    expect(mocks.seriesControls).toHaveBeenCalledWith(expect.objectContaining({ seriesEvents }))
    expect(findLiveSeriesEvent).not.toHaveBeenCalled()
  })

  it('uses only Binance Spot live and retains Chainlink for the official hourly close', () => {
    const canonicalConfig: EventLiveChartConfig = {
      ...config,
      series_slug: 'btc-up-or-down-hourly',
      active_window_minutes: 60,
      topic: 'price.crypto.twap',
      provider: 'chainlink',
      window_seconds: 60,
      symbol: 'BTC/USDT',
    }
    const hourlyEvent = { ...event, end_date: '2026-11-15T13:00:00Z' }
    const start = Date.parse('2026-11-15T12:00:00Z')
    const end = Date.parse(hourlyEvent.end_date)
    mocks.canonicalReference = {
      source: 'chainlink',
      interval: '1h',
      interval_ms: 3_600_000,
      event_window_start_ms: start,
      event_window_end_ms: end,
      opening_price: 59_980,
      closing_price: 59_990,
      price_history: [{ timestamp_ms: initialNow - 1000, price: 59_985 }],
    }
    mocks.persistedFallback = { price: 59_975, timestamp: initialNow - 1000 }
    mocks.livePointsAvailable = false

    const props = { event: hourlyEvent, config: canonicalConfig, isMobile: false }
    const { rerender } = render(<EventLiveSeriesChart {...props} />)
    expect(mocks.webSocket).toHaveBeenLastCalledWith(
      expect.objectContaining({
        topic: 'price.crypto',
        provider: 'binance',
        windowSeconds: null,
        subscriptionSymbol: 'btcusd',
        isLiveView: true,
      }),
    )
    expect(mocks.reference).toHaveBeenLastCalledWith(
      expect.objectContaining({
        config: canonicalConfig,
        source: 'chainlink',
        subscriptionSymbol: 'btcusd',
        explicitEndTimestamp: end,
      }),
    )
    expect(mocks.chart.mock.lastCall?.[0].data).toEqual([])

    mocks.livePointsAvailable = true
    rerender(<EventLiveSeriesChart {...props} />)
    expect(mocks.chart.mock.lastCall?.[0].data).toContainEqual({
      date: new Date(initialNow),
      live_price: 60_010,
    })

    mocks.snapshotClosed = true
    mocks.feedUnavailable = true
    mocks.canonicalReference.closing_price = null
    rerender(<EventLiveSeriesChart {...props} />)
    expect(mocks.webSocket).toHaveBeenLastCalledWith(expect.objectContaining({ isLiveView: false }))
    expect(mocks.header).toHaveBeenLastCalledWith(expect.objectContaining({ currentPrice: null }))

    mocks.canonicalReference.closing_price = 59_990
    rerender(<EventLiveSeriesChart {...props} />)
    expect(mocks.header).toHaveBeenLastCalledWith(expect.objectContaining({ currentPrice: 59_990 }))
    const closedPoints = mocks.chart.mock.lastCall?.[0].data as { date: Date; live_price: number }[]
    expect(new Map(closedPoints.map((point) => [point.date.getTime(), point.live_price]))).toEqual(
      new Map([
        [start, 59_980],
        [initialNow - 1000, 59_985],
        [end, 59_990],
      ]),
    )
  })

  it('starts successor lookup when a close snapshot arrives without another clock tick', () => {
    const props = { event, config, seriesEvents, isMobile: false }
    const { rerender } = render(<EventLiveSeriesChart {...props} />)
    expect(findLiveSeriesEvent).not.toHaveBeenCalled()

    mocks.snapshotClosed = true
    rerender(<EventLiveSeriesChart {...props} />)
    expect(findLiveSeriesEvent).toHaveBeenCalledWith(seriesEvents, event.slug, initialNow, 5 * 60 * 1000)
    expect(screen.getByTestId('live-chart')).toBeInTheDocument()
  })

  it('selects the live successor after close and responds to the link visibility flag', () => {
    mocks.nowMs = Date.parse('2026-11-15T12:06:00Z')
    const props = { event, config, seriesEvents, isMobile: false }
    const { rerender } = render(<EventLiveSeriesChart {...props} showLiveMarketLink={false} />)
    expect(findLiveSeriesEvent).not.toHaveBeenCalled()
    expect(screen.getByTestId('live-chart')).toBeInTheDocument()

    rerender(<EventLiveSeriesChart {...props} showLiveMarketLink />)
    expect(findLiveSeriesEvent).toHaveBeenCalledWith(seriesEvents, event.slug, mocks.nowMs, 5 * 60 * 1000)
    expect(screen.getByRole('link', { name: 'Live successor' })).toHaveAttribute('href', '/event/next-event')
    expect(screen.getByTestId('series-controls')).toBeInTheDocument()
    const lookupCount = findLiveSeriesEvent.mock.calls.length

    rerender(<EventLiveSeriesChart {...props} showLiveMarketLink={false} />)
    expect(findLiveSeriesEvent).toHaveBeenCalledTimes(lookupCount)
    expect(screen.queryByRole('link', { name: 'Live successor' })).not.toBeInTheDocument()
  })
})
