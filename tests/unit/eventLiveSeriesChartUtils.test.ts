import { describe, expect, it } from 'bun:test'

import type { Event, EventSeriesEntry } from '@/types'
import type { DataPoint } from '@/types/PredictionChartTypes'

import {
  appendLivePriceTransition,
  buildClosedLiveSeriesData,
  buildLiveSeriesFallbackData,
  classifyLiveSeriesReference,
  findLiveSeriesEvent,
  formatDateAtTimezone,
  formatTimeAtTimezone,
  getVisibleCountdownUnits,
  isCanonicalBinanceDailySnapshot,
  isCanonicalEventBoundEquityCloseSnapshot,
  isCanonicalGoldDailyCloseSnapshot,
  isGoldDailySeries,
  isGoldMarketSessionOpen,
  LIVE_PRICE_TRANSITION_MS,
  LIVE_DATA_RETENTION_MS,
  MAX_POINTS,
  POLYMARKET_CHAINLINK_TWAP_CUTOVER_MS,
  requiresCanonicalBinanceDailyClose,
  resolveRecentPersistedLivePrice,
  resolveLiveChartPaddedDomainEnd,
  resolveDisplayedLiveSeriesBaselinePrice,
  resolveEventEndTimestamp,
  resolveLivePriceTransitionDuration,
  resolveLiveSeriesCountdown,
  resolveLiveSeriesDisplayPrice,
  resolveLiveSeriesRealtimeTopic,
  resolveLiveSeriesStartTimestamp,
  SERIES_KEY,
} from '@/app/[locale]/(platform)/event/[slug]/_utils/eventLiveSeriesChartUtils'

describe('event-bound equity close', () => {
  it('requires the exact closed HOOD event window and a confirmed close', () => {
    const eventWindowStartTimestamp = Date.parse('2026-10-21T13:30:00Z')
    const eventWindowEndTimestamp = Date.parse('2026-10-21T20:00:00Z')
    const snapshot = {
      series_slug: 'hood-daily-up-or-down',
      instrument: 'HOOD',
      interval: '1d' as const,
      source: 'pyth' as const,
      interval_ms: 86_400_000,
      event_window_start_ms: eventWindowStartTimestamp,
      event_window_end_ms: eventWindowEndTimestamp,
      opening_price: 98.22531,
      closing_price: 101.94,
      latest_price: null,
      latest_window_end_ms: null,
      latest_source_timestamp_ms: null,
      is_event_closed: true,
    }
    const request = {
      snapshot,
      snapshotStatus: 'ready' as const,
      eventWindowStartTimestamp,
      eventWindowEndTimestamp,
      expectedInstrument: 'HOOD',
    }
    expect(isCanonicalEventBoundEquityCloseSnapshot(request)).toBe(true)
    expect(
      isCanonicalEventBoundEquityCloseSnapshot({ ...request, snapshot: { ...snapshot, closing_price: null } }),
    ).toBe(false)
    expect(
      isCanonicalEventBoundEquityCloseSnapshot({
        ...request,
        snapshot: { ...snapshot, event_window_end_ms: eventWindowEndTimestamp + 1 },
      }),
    ).toBe(false)
    expect(isCanonicalEventBoundEquityCloseSnapshot({ ...request, expectedInstrument: 'COIN' })).toBe(false)
  })
})

describe('GOLD daily live session', () => {
  it('accepts a final price only from the matching closed Pyth XAUUSD window', () => {
    const eventWindowStartTimestamp = Date.parse('2026-10-21T13:30:00Z')
    const eventWindowEndTimestamp = Date.parse('2026-10-21T21:00:00Z')
    const snapshot = {
      series_slug: 'gold-daily-up-or-down',
      instrument: 'XAUUSD',
      interval: '1d' as const,
      source: 'pyth' as const,
      interval_ms: 86_400_000,
      event_window_start_ms: eventWindowStartTimestamp,
      event_window_end_ms: eventWindowEndTimestamp,
      opening_price: 4100,
      closing_price: 4150,
      latest_price: 4150,
      latest_window_end_ms: eventWindowEndTimestamp,
      latest_source_timestamp_ms: eventWindowEndTimestamp,
      is_event_closed: true,
    }
    const request = {
      snapshot,
      snapshotStatus: 'ready' as const,
      eventWindowStartTimestamp,
      eventWindowEndTimestamp,
    }

    expect(isCanonicalGoldDailyCloseSnapshot(request)).toBe(true)
    expect(isCanonicalGoldDailyCloseSnapshot({ ...request, snapshotStatus: 'unavailable' })).toBe(false)
    expect(isCanonicalGoldDailyCloseSnapshot({ ...request, snapshot: { ...snapshot, source: 'binance' } })).toBe(false)
    expect(isCanonicalGoldDailyCloseSnapshot({ ...request, snapshot: { ...snapshot, instrument: 'AAPL' } })).toBe(false)
    expect(isCanonicalGoldDailyCloseSnapshot({ ...request, snapshot: { ...snapshot, interval: '5m' } })).toBe(false)
    expect(isCanonicalGoldDailyCloseSnapshot({ ...request, snapshot: { ...snapshot, is_event_closed: false } })).toBe(
      false,
    )
    expect(isCanonicalGoldDailyCloseSnapshot({ ...request, snapshot: { ...snapshot, closing_price: null } })).toBe(
      false,
    )
    expect(isCanonicalGoldDailyCloseSnapshot({ ...request, eventWindowStartTimestamp: 0 })).toBe(false)
    expect(isCanonicalGoldDailyCloseSnapshot({ ...request, eventWindowEndTimestamp: 0 })).toBe(false)
  })

  it('uses the 9:30–17:00 ET market window instead of the early event publication date', () => {
    const eventEndTimestamp = Date.parse('2026-10-21T21:00:00Z')
    expect(isGoldDailySeries('gold-daily-up-or-down')).toBe(true)
    expect(
      resolveLiveSeriesStartTimestamp({
        seriesSlug: 'gold-daily-up-or-down',
        eventStartTimestamp: Date.parse('2026-10-20T12:01:22Z'),
        eventEndTimestamp,
        activeWindowMinutes: 450,
      }),
    ).toBe(Date.parse('2026-10-21T13:30:00Z'))
    expect(
      resolveLiveSeriesStartTimestamp({
        seriesSlug: 'aapl-daily-up-down',
        eventStartTimestamp: 123,
        eventEndTimestamp,
        activeWindowMinutes: 390,
      }),
    ).toBe(123)
  })

  it('honors the GOLD event hours, weekend, and daylight saving time', () => {
    expect(isGoldMarketSessionOpen(Date.parse('2026-10-21T13:29:00Z'))).toBe(false)
    expect(isGoldMarketSessionOpen(Date.parse('2026-10-21T13:30:00Z'))).toBe(true)
    expect(isGoldMarketSessionOpen(Date.parse('2026-10-21T20:59:00Z'))).toBe(true)
    expect(isGoldMarketSessionOpen(Date.parse('2026-10-21T21:00:00Z'))).toBe(false)
    expect(isGoldMarketSessionOpen(Date.parse('2026-10-23T20:59:00Z'))).toBe(true)
    expect(isGoldMarketSessionOpen(Date.parse('2026-10-24T16:00:00Z'))).toBe(false)
    expect(isGoldMarketSessionOpen(Date.parse('2026-10-26T13:30:00Z'))).toBe(true)
    expect(isGoldMarketSessionOpen(Date.parse('2026-11-09T14:29:00Z'))).toBe(false)
    expect(isGoldMarketSessionOpen(Date.parse('2026-11-09T14:30:00Z'))).toBe(true)
  })

  it('selects the next GOLD round only when its trading session begins', () => {
    const next = createSeriesEvent({
      slug: 'xauusd-up-or-down-on-october-22-2026',
      end_date: '2026-10-22T21:00:00Z',
    })
    const currentSlug = 'xauusd-up-or-down-on-october-21-2026'
    expect(findLiveSeriesEvent([next], currentSlug, Date.parse('2026-10-22T13:29:00Z'), 450 * 60_000)).toBeNull()
    expect(findLiveSeriesEvent([next], currentSlug, Date.parse('2026-10-22T13:31:00Z'), 450 * 60_000)).toEqual(next)
  })
})

describe('live series date labels', () => {
  it('formats resolution dates and times with the page locale', () => {
    const timestamp = Date.parse('2026-08-30T20:33:00.000Z')

    expect(formatDateAtTimezone(timestamp, 'America/New_York', 'zh')).toBe('2026年8月30日')
    expect(formatTimeAtTimezone(timestamp, 'America/New_York', 'zh')).toBe('16:33')
  })
})

describe('getVisibleCountdownUnits', () => {
  it('hides zero hours when less than one hour remains', () => {
    expect(getVisibleCountdownUnits(false, 0, 0, 42, 15)).toEqual([
      { unit: 'min', value: 42 },
      { unit: 'sec', value: 15 },
    ])
  })

  it('keeps hours when at least one hour remains', () => {
    expect(getVisibleCountdownUnits(false, 0, 1, 0, 0)).toEqual([
      { unit: 'hr', value: 1 },
      { unit: 'min', value: 0 },
      { unit: 'sec', value: 0 },
    ])
  })
})

function createLivePoint(timestamp: number, price: number): DataPoint {
  return {
    date: new Date(timestamp),
    [SERIES_KEY]: price,
  }
}

function createSeriesEvent(overrides: Partial<EventSeriesEntry> = {}): EventSeriesEntry {
  return {
    id: 'series-event-1',
    slug: 'bitcoin-up-or-down-on-june-23-2026',
    status: 'active',
    end_date: '2026-06-24T00:00:00.000Z',
    resolved_at: null,
    created_at: '2026-06-23T00:00:00.000Z',
    ...overrides,
  }
}

function readLivePrice(point: DataPoint) {
  return point[SERIES_KEY] as number
}

describe('resolveLiveSeriesRealtimeTopic', () => {
  it('keeps legacy Chainlink markets on the spot topic before the cutover', () => {
    expect(
      resolveLiveSeriesRealtimeTopic({
        configuredTopic: 'crypto_prices_chainlink',
        activeWindowMinutes: 5,
        eventEndTimestamp: POLYMARKET_CHAINLINK_TWAP_CUTOVER_MS,
      }),
    ).toBe('crypto_prices_chainlink')
  })

  it('uses the 30-second TWAP for five-minute markets after the cutover', () => {
    expect(
      resolveLiveSeriesRealtimeTopic({
        configuredTopic: 'crypto_prices_chainlink',
        activeWindowMinutes: 5,
        eventEndTimestamp: POLYMARKET_CHAINLINK_TWAP_CUTOVER_MS + 5 * 60 * 1000,
      }),
    ).toBe('crypto_prices_twap_thirty')
  })

  it('uses the actual market start when selecting the realtime feed', () => {
    expect(
      resolveLiveSeriesRealtimeTopic({
        configuredTopic: 'crypto_prices_chainlink',
        activeWindowMinutes: 5,
        eventStartTimestamp: POLYMARKET_CHAINLINK_TWAP_CUTOVER_MS - 1,
        eventEndTimestamp: POLYMARKET_CHAINLINK_TWAP_CUTOVER_MS + 5 * 60 * 1000,
      }),
    ).toBe('crypto_prices_chainlink')
    expect(
      resolveLiveSeriesRealtimeTopic({
        configuredTopic: 'crypto_prices_chainlink',
        activeWindowMinutes: 5,
        eventStartTimestamp: POLYMARKET_CHAINLINK_TWAP_CUTOVER_MS,
        eventEndTimestamp: POLYMARKET_CHAINLINK_TWAP_CUTOVER_MS + 10 * 60 * 1000,
      }),
    ).toBe('crypto_prices_twap_thirty')
  })

  it.each([15, 4 * 60])('uses the 60-second TWAP for %s-minute markets after the cutover', (minutes) => {
    expect(
      resolveLiveSeriesRealtimeTopic({
        configuredTopic: 'crypto_prices_chainlink',
        activeWindowMinutes: minutes,
        eventEndTimestamp: POLYMARKET_CHAINLINK_TWAP_CUTOVER_MS + minutes * 60 * 1000,
      }),
    ).toBe('crypto_prices_twap_sixty')
  })

  it('does not change unsupported cadences or unrelated topics', () => {
    expect(
      resolveLiveSeriesRealtimeTopic({
        configuredTopic: 'crypto_prices_chainlink',
        activeWindowMinutes: 60,
        eventEndTimestamp: POLYMARKET_CHAINLINK_TWAP_CUTOVER_MS + 60 * 60 * 1000,
      }),
    ).toBe('crypto_prices_chainlink')
    expect(
      resolveLiveSeriesRealtimeTopic({
        configuredTopic: 'equity_prices',
        activeWindowMinutes: 5,
        eventEndTimestamp: POLYMARKET_CHAINLINK_TWAP_CUTOVER_MS + 5 * 60 * 1000,
      }),
    ).toBe('equity_prices')
  })
})

function createEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'event-1',
    slug: 'bitcoin-up-or-down-on-june-22-2026',
    title: 'Bitcoin Up or Down on June 22, 2026?',
    creator: 'creator',
    icon_url: '',
    show_market_icons: false,
    status: 'active',
    active_markets_count: 1,
    total_markets_count: 1,
    volume: 0,
    start_date: '2026-06-22T23:55:00.000Z',
    end_date: '2026-06-23T00:00:00.000Z',
    resolved_at: null,
    created_at: '2026-06-22T00:00:00.000Z',
    updated_at: '2026-06-22T00:00:00.000Z',
    markets: [
      {
        condition_id: 'condition-1',
        question_id: 'question-1',
        event_id: 'event-1',
        title: 'Bitcoin Up or Down on June 22, 2026?',
        slug: 'bitcoin-up-or-down-on-june-22-2026',
        icon_url: '',
        is_active: false,
        is_resolved: false,
        block_number: 1,
        block_timestamp: '2026-06-22T00:00:00.000Z',
        volume_24h: 0,
        volume: 0,
        end_time: '2026-06-23T00:00:00.000Z',
        created_at: '2026-06-22T00:00:00.000Z',
        updated_at: '2026-06-22T00:00:00.000Z',
        price: 0,
        probability: 0,
        outcomes: [],
        condition: {
          id: 'condition-1',
          oracle: 'oracle',
          question_id: 'question-1',
          outcome_slot_count: 2,
          resolved: false,
          volume: 0,
          open_interest: 0,
          active_positions_count: 0,
          created_at: '2026-06-22T00:00:00.000Z',
          updated_at: '2026-06-22T00:00:00.000Z',
        },
      },
    ],
    tags: [],
    main_tag: 'Crypto',
    is_bookmarked: false,
    is_trending: false,
    ...overrides,
  }
}

describe('event live series chart utils', () => {
  it('pads the chart domain so the line inset and cursor share one x-scale', () => {
    const startTimestamp = 10_000
    const endTimestamp = 50_000
    const chartWidth = 900
    const marginRight = 52
    const rightInset = 34
    const plotWidth = chartWidth - marginRight
    const paddedEndTimestamp = resolveLiveChartPaddedDomainEnd({
      startTimestamp,
      endTimestamp,
      chartWidth,
      marginLeft: 0,
      marginRight,
      rightInset,
    })
    const renderedEndX = ((endTimestamp - startTimestamp) / (paddedEndTimestamp - startTimestamp)) * plotWidth

    expect(renderedEndX).toBeCloseTo(plotWidth - rightInset, 8)
  })

  it('supports positioning the live data endpoint at a requested plot ratio', () => {
    const startTimestamp = 10_000
    const endTimestamp = 50_000
    const chartWidth = 900
    const marginRight = 52
    const plotWidth = chartWidth - marginRight
    const paddedEndTimestamp = resolveLiveChartPaddedDomainEnd({
      startTimestamp,
      endTimestamp,
      chartWidth,
      marginLeft: 0,
      marginRight,
      rightInset: 34,
      dataEndRatio: 0.6,
    })
    const renderedEndX = ((endTimestamp - startTimestamp) / (paddedEndTimestamp - startTimestamp)) * plotWidth

    expect(renderedEndX).toBeCloseTo(plotWidth * 0.6, 8)
  })

  it('builds closed-event history across the event window with canonical endpoints', () => {
    const startTimestamp = Date.parse('2026-08-13T08:00:00.000Z')
    const endTimestamp = Date.parse('2026-08-13T12:00:00.000Z')

    expect(
      buildClosedLiveSeriesData({
        startTimestamp,
        endTimestamp,
        openingPrice: 63_798.82,
        closingPrice: 63_407.97,
        history: [
          { timestamp_ms: startTimestamp - 1, price: 99_999 },
          { timestamp_ms: startTimestamp + 5 * 60 * 1000, price: 63_750 },
          { timestamp_ms: endTimestamp - 5 * 60 * 1000, price: 63_414.66 },
          { timestamp_ms: endTimestamp, price: 63_414.66 },
        ],
      }),
    ).toEqual([
      { date: new Date(startTimestamp), [SERIES_KEY]: 63_798.82 },
      { date: new Date(startTimestamp + 5 * 60 * 1000), [SERIES_KEY]: 63_750 },
      { date: new Date(endTimestamp - 5 * 60 * 1000), [SERIES_KEY]: 63_414.66 },
      { date: new Date(endTimestamp), [SERIES_KEY]: 63_407.97 },
    ])
  })

  it('falls back to the opening and closing prices when closed history is unavailable', () => {
    expect(
      buildClosedLiveSeriesData({
        startTimestamp: 1_000,
        endTimestamp: 2_000,
        openingPrice: 100,
        closingPrice: 90,
        history: [],
      }),
    ).toEqual([
      { date: new Date(1_000), [SERIES_KEY]: 100 },
      { date: new Date(2_000), [SERIES_KEY]: 90 },
    ])
  })

  it('seeds an immediately renderable line from the fallback price', () => {
    const chartEndTimestamp = Date.parse('2026-08-13T15:00:00.000Z')

    expect(buildLiveSeriesFallbackData(63_800, chartEndTimestamp)).toEqual([
      {
        date: new Date(chartEndTimestamp - 40_000),
        [SERIES_KEY]: 63_800,
      },
      {
        date: new Date(chartEndTimestamp),
        [SERIES_KEY]: 63_800,
      },
    ])
  })

  it('supports a shorter fallback window for compact live charts', () => {
    const chartEndTimestamp = Date.parse('2026-08-13T15:00:00.000Z')

    expect(buildLiveSeriesFallbackData(63_800, chartEndTimestamp, 20_000)).toEqual([
      {
        date: new Date(chartEndTimestamp - 20_000),
        [SERIES_KEY]: 63_800,
      },
      {
        date: new Date(chartEndTimestamp),
        [SERIES_KEY]: 63_800,
      },
    ])
  })

  it('does not seed the live line without a valid fallback price', () => {
    expect(buildLiveSeriesFallbackData(null, Date.now())).toEqual([])
    expect(buildLiveSeriesFallbackData(0, Date.now())).toEqual([])
  })

  it('uses only a recent WebSocket price as a live fallback', () => {
    const now = Date.parse('2026-10-27T19:38:00Z')
    expect(resolveRecentPersistedLivePrice({ price: 80_732, timestamp: now - 1_000 }, now)).toBe(80_732)
    expect(
      resolveRecentPersistedLivePrice({ price: 80_811, timestamp: now - LIVE_DATA_RETENTION_MS - 1 }, now),
    ).toBeNull()
    expect(resolveRecentPersistedLivePrice({ price: 80_811, timestamp: now + 1 }, now)).toBeNull()
    expect(resolveRecentPersistedLivePrice({ price: 80_811, timestamp: now - 1_000 }, 0)).toBeNull()
  })

  it('returns a zero countdown for the SSR clock sentinel', () => {
    expect(resolveLiveSeriesCountdown(Date.parse('2026-07-31T00:00:00.000Z'), 0)).toEqual({
      totalSeconds: 0,
      showDays: false,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    })
  })

  it('uses the hydrated client clock for the countdown', () => {
    expect(
      resolveLiveSeriesCountdown(Date.parse('2026-07-31T00:00:00.000Z'), Date.parse('2026-07-30T19:12:13.000Z')),
    ).toEqual({
      totalSeconds: 17_267,
      showDays: false,
      days: 0,
      hours: 4,
      minutes: 47,
      seconds: 47,
    })
  })

  it.each([5, 15])('hides the price to beat before a %d-minute event starts', (windowMinutes) => {
    const tradingWindowStartTimestamp = Date.parse('2026-07-28T12:45:00.000Z')

    expect(
      resolveDisplayedLiveSeriesBaselinePrice({
        baselinePrice: 63_350.01,
        isEventClosed: false,
        nowTimestamp: tradingWindowStartTimestamp - 1,
        tradingWindowStartTimestamp,
        tradingWindowMs: windowMinutes * 60 * 1000,
      }),
    ).toBeNull()
  })

  it('keeps the price to beat once a short-cadence event starts', () => {
    const tradingWindowStartTimestamp = Date.parse('2026-07-28T12:45:00.000Z')

    expect(
      resolveDisplayedLiveSeriesBaselinePrice({
        baselinePrice: 63_350.01,
        isEventClosed: false,
        nowTimestamp: tradingWindowStartTimestamp,
        tradingWindowStartTimestamp,
        tradingWindowMs: 5 * 60 * 1000,
      }),
    ).toBe(63_350.01)
  })

  it('does not change future price-to-beat behavior for longer cadences', () => {
    const tradingWindowStartTimestamp = Date.parse('2026-07-28T12:00:00.000Z')

    expect(
      resolveDisplayedLiveSeriesBaselinePrice({
        baselinePrice: 63_350.01,
        isEventClosed: false,
        nowTimestamp: tradingWindowStartTimestamp - 1,
        tradingWindowStartTimestamp,
        tradingWindowMs: 60 * 60 * 1000,
      }),
    ).toBe(63_350.01)
  })

  it.each([
    { startPrice: 100, targetPrice: 110 },
    { startPrice: 110, targetPrice: 100 },
  ])('builds a monotonic live transition from $startPrice to $targetPrice', ({ startPrice, targetPrice }) => {
    const transitionStart = 10_000
    const result = appendLivePriceTransition([createLivePoint(1_000, startPrice)], targetPrice, transitionStart)
    const transition = result.filter((point) => point.date.getTime() >= transitionStart)
    const prices = transition.map(readLivePrice)

    expect(transition.length).toBeGreaterThan(10)
    expect(transition[0]?.date.getTime()).toBe(transitionStart)
    expect(prices[0]).toBe(startPrice)
    expect(transition.at(-1)?.date.getTime()).toBe(transitionStart + LIVE_PRICE_TRANSITION_MS)
    expect(prices.at(-1)).toBe(targetPrice)

    for (let index = 1; index < transition.length; index += 1) {
      expect(transition[index]!.date.getTime()).toBeGreaterThan(transition[index - 1]!.date.getTime())
      if (targetPrice > startPrice) {
        expect(prices[index]).toBeGreaterThan(prices[index - 1]!)
      } else {
        expect(prices[index]).toBeLessThan(prices[index - 1]!)
      }
    }
  })

  it('retargets an in-flight transition from the currently displayed price', () => {
    const firstTransitionStart = 10_000
    const retargetTimestamp = firstTransitionStart + 173
    const firstTransition = appendLivePriceTransition([createLivePoint(1_000, 100)], 110, firstTransitionStart)
    const pointBeforeRetarget = firstTransition.filter((point) => point.date.getTime() < retargetTimestamp).at(-1)!
    const pointAfterRetarget = firstTransition.find((point) => point.date.getTime() > retargetTimestamp)!
    const interpolationProgress =
      (retargetTimestamp - pointBeforeRetarget.date.getTime()) /
      (pointAfterRetarget.date.getTime() - pointBeforeRetarget.date.getTime())
    const expectedRetargetPrice =
      readLivePrice(pointBeforeRetarget) +
      (readLivePrice(pointAfterRetarget) - readLivePrice(pointBeforeRetarget)) * interpolationProgress
    const result = appendLivePriceTransition(firstTransition, 90, retargetTimestamp)
    const retargetedTransition = result.filter((point) => point.date.getTime() >= retargetTimestamp)
    const retargetedPrices = retargetedTransition.map(readLivePrice)

    expect(retargetedTransition[0]?.date.getTime()).toBe(retargetTimestamp)
    expect(retargetedPrices[0]).toBeCloseTo(expectedRetargetPrice, 8)
    expect(retargetedPrices.at(-1)).toBe(90)
    expect(
      result.some(
        (point) =>
          point.date.getTime() > retargetTimestamp &&
          readLivePrice(point) > (retargetedPrices[0] ?? Number.POSITIVE_INFINITY),
      ),
    ).toBe(false)
  })

  it('does not restart a transition when the WS repeats the same target', () => {
    const transitionStart = 10_000
    const firstTransition = appendLivePriceTransition([createLivePoint(1_000, 100)], 110, transitionStart)
    const repeatedTarget = appendLivePriceTransition(firstTransition, 110, transitionStart + 200)

    expect(repeatedTarget).toEqual(firstTransition)
    expect(repeatedTarget.at(-1)?.date.getTime()).toBe(transitionStart + LIVE_PRICE_TRANSITION_MS)
  })

  it('keeps the smoothed live history within the chart point limit', () => {
    const points = Array.from({ length: MAX_POINTS }, (_value, index) => createLivePoint(index * 10, 100))
    const result = appendLivePriceTransition(points, 110, MAX_POINTS * 10)

    expect(result).toHaveLength(MAX_POINTS)
    expect(result.at(-1)?.[SERIES_KEY]).toBe(110)
  })

  it('adapts the transition duration to the incoming message cadence', () => {
    expect(resolveLivePriceTransitionDuration(null, 10_000)).toBe(LIVE_PRICE_TRANSITION_MS)
    expect(resolveLivePriceTransitionDuration(9_900, 10_000)).toBe(120)
    expect(resolveLivePriceTransitionDuration(9_500, 10_000)).toBe(400)
    expect(resolveLivePriceTransitionDuration(8_000, 10_000)).toBe(LIVE_PRICE_TRANSITION_MS)
  })

  it('keeps up with a rapid sequence of distinct price targets', () => {
    let points = [createLivePoint(0, 100)]
    let previousTimestamp: number | null = null

    for (let update = 1; update <= 20; update += 1) {
      const timestamp = update * 100
      const duration = resolveLivePriceTransitionDuration(previousTimestamp, timestamp)
      points = appendLivePriceTransition(points, 100 + update, timestamp, duration)
      previousTimestamp = timestamp
    }

    const finalTransitionStart = points.find((point) => point.date.getTime() === 2_000)
    expect(finalTransitionStart?.[SERIES_KEY]).toBeGreaterThan(118)
    expect(points.at(-1)?.[SERIES_KEY]).toBe(120)
    expect(points.at(-1)?.date.getTime()).toBe(2_120)
  })

  it('falls back to the default transition duration for a non-finite duration', () => {
    const transitionStart = 10_000
    const result = appendLivePriceTransition(
      [createLivePoint(1_000, 100)],
      110,
      transitionStart,
      Number.POSITIVE_INFINITY,
    )

    expect(result.at(-1)?.date.getTime()).toBe(transitionStart + LIVE_PRICE_TRANSITION_MS)
    expect(result.at(-1)?.[SERIES_KEY]).toBe(110)
  })

  it('uses event resolved_at as the live chart end timestamp', () => {
    const resolvedAt = '2026-06-22T23:59:12.000Z'
    const event = createEvent({
      status: 'resolved',
      resolved_at: resolvedAt,
      end_date: '2026-06-23T00:00:00.000Z',
    })

    expect(resolveEventEndTimestamp(event)).toBe(Date.parse(resolvedAt))
  })

  it('finds the next active series event in its trading window', () => {
    const nowTimestamp = Date.parse('2026-06-23T23:55:00.000Z')
    const liveEvent = createSeriesEvent()
    const laterEvent = createSeriesEvent({
      id: 'series-event-2',
      slug: 'bitcoin-up-or-down-on-june-24-2026',
      end_date: '2026-06-25T00:00:00.000Z',
    })

    expect(
      findLiveSeriesEvent([laterEvent, liveEvent], 'bitcoin-up-or-down-on-june-22-2026', nowTimestamp, 10 * 60 * 1000),
    ).toBe(liveEvent)
  })

  it('does not treat the current, ended, future, or inactive series event as live', () => {
    const currentSlug = 'bitcoin-up-or-down-on-june-23-2026'
    const nowTimestamp = Date.parse('2026-06-24T00:05:00.000Z')

    expect(
      findLiveSeriesEvent(
        [
          createSeriesEvent({ slug: currentSlug, end_date: '2026-06-24T00:10:00.000Z' }),
          createSeriesEvent({ slug: 'ended', end_date: '2026-06-24T00:05:00.000Z' }),
          createSeriesEvent({ slug: 'future', end_date: '2026-06-24T00:20:01.000Z' }),
          createSeriesEvent({ slug: 'draft', status: 'draft', end_date: '2026-06-24T00:10:00.000Z' }),
        ],
        currentSlug,
        nowTimestamp,
        15 * 60 * 1000,
      ),
    ).toBeNull()
  })

  it('falls back to resolved condition timestamps for resolved events', () => {
    const conditionResolvedAt = '2026-06-22T23:59:40.000Z'
    const baseMarket = createEvent().markets[0]!
    const event = createEvent({
      status: 'resolved',
      resolved_at: null,
      markets: [
        {
          ...baseMarket,
          is_resolved: true,
          condition: {
            ...baseMarket.condition,
            resolved: true,
            resolved_at: conditionResolvedAt,
          },
        },
      ],
    })

    expect(resolveEventEndTimestamp(event)).toBe(Date.parse(conditionResolvedAt))
  })

  it('does not use one resolved market timestamp for active multi-market events', () => {
    const conditionResolvedAt = '2026-06-22T23:59:40.000Z'
    const baseMarket = createEvent().markets[0]!
    const event = createEvent({
      status: 'active',
      total_markets_count: 2,
      markets: [
        {
          ...baseMarket,
          is_resolved: true,
          condition: {
            ...baseMarket.condition,
            resolved: true,
            resolved_at: conditionResolvedAt,
          },
        },
        {
          ...baseMarket,
          condition_id: 'condition-2',
          condition: {
            ...baseMarket.condition,
            id: 'condition-2',
          },
        },
      ],
    })

    expect(resolveEventEndTimestamp(event)).toBe(Date.parse('2026-06-23T00:00:00.000Z'))
  })

  it('uses the final price for closed live series charts', () => {
    expect(
      resolveLiveSeriesDisplayPrice({
        isEventClosed: true,
        finalPrice: 105,
        renderedPrice: 104,
        fallbackCurrentPrice: 103,
        requiresCanonicalClose: true,
      }),
    ).toBe(105)
  })

  it('falls back to the rendered chart price for closed live series charts without a final price', () => {
    expect(
      resolveLiveSeriesDisplayPrice({
        isEventClosed: true,
        finalPrice: null,
        renderedPrice: 104,
        fallbackCurrentPrice: 103,
        requiresCanonicalClose: false,
      }),
    ).toBe(104)
  })

  it('does not use the rendered price when a closed market requires a canonical close', () => {
    expect(
      resolveLiveSeriesDisplayPrice({
        isEventClosed: true,
        finalPrice: null,
        renderedPrice: 104,
        fallbackCurrentPrice: 103,
        requiresCanonicalClose: true,
      }),
    ).toBeNull()
  })

  it('uses the live fallback price only for open live series charts without rendered data', () => {
    expect(
      resolveLiveSeriesDisplayPrice({
        isEventClosed: false,
        finalPrice: null,
        renderedPrice: null,
        fallbackCurrentPrice: 103,
        requiresCanonicalClose: false,
      }),
    ).toBe(103)
  })

  it('requires a canonical close for confirmed daily Binance snapshots', () => {
    const snapshot = {
      series_slug: 'btc-up-or-down-daily',
      instrument: 'BTC/USD',
      interval: '1d' as const,
      source: 'binance' as const,
      interval_ms: 86_400_000,
      event_window_start_ms: 100,
      event_window_end_ms: 200,
      opening_price: 100,
      closing_price: null,
      latest_price: 101,
      latest_window_end_ms: 150,
      latest_source_timestamp_ms: 150,
      is_event_closed: true,
    }

    expect(isCanonicalBinanceDailySnapshot(snapshot)).toBe(true)
    expect(
      requiresCanonicalBinanceDailyClose({
        snapshot,
        snapshotStatus: 'ready',
        seriesClassification: 'binance_daily',
      }),
    ).toBe(true)
    expect(
      requiresCanonicalBinanceDailyClose({
        snapshot: { ...snapshot, interval: '5m' },
        snapshotStatus: 'ready',
        seriesClassification: 'other',
      }),
    ).toBe(false)
    expect(
      requiresCanonicalBinanceDailyClose({
        snapshot: { ...snapshot, source: 'chainlink' },
        snapshotStatus: 'ready',
        seriesClassification: 'other',
      }),
    ).toBe(false)
  })

  it('keeps an expected Binance daily close canonical while its snapshot is unavailable', () => {
    expect(
      classifyLiveSeriesReference({
        topic: 'crypto_prices_chainlink',
        activeWindowMinutes: 1440,
      }),
    ).toBe('binance_daily')
    expect(
      requiresCanonicalBinanceDailyClose({
        snapshot: null,
        snapshotStatus: 'loading',
        seriesClassification: 'binance_daily',
      }),
    ).toBe(true)
    expect(
      requiresCanonicalBinanceDailyClose({
        snapshot: null,
        snapshotStatus: 'unavailable',
        seriesClassification: 'binance_daily',
      }),
    ).toBe(true)
    expect(
      requiresCanonicalBinanceDailyClose({
        snapshot: {
          series_slug: 'btc-up-or-down-daily',
          instrument: 'BTC/USD',
          interval: '1d',
          source: 'chainlink',
          interval_ms: 86_400_000,
          event_window_start_ms: 100,
          event_window_end_ms: 200,
          opening_price: 100,
          closing_price: 101,
          latest_price: 101,
          latest_window_end_ms: 200,
          latest_source_timestamp_ms: 200,
          is_event_closed: true,
        },
        snapshotStatus: 'ready',
        seriesClassification: 'binance_daily',
      }),
    ).toBe(true)
  })

  it('does not classify intraday crypto or daily equities as Binance daily series', () => {
    expect(
      classifyLiveSeriesReference({
        topic: 'crypto_prices_chainlink',
        activeWindowMinutes: 60,
      }),
    ).toBe('other')
    expect(
      classifyLiveSeriesReference({
        topic: 'equity_prices',
        activeWindowMinutes: 390,
      }),
    ).toBe('other')
  })
})
