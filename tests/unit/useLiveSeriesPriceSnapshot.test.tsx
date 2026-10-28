import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock, jest } from 'bun:test'

import type { EventLiveChartConfig } from '@/types'

import { useLiveSeriesPriceSnapshot } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useLiveSeriesPriceSnapshot'
import { writePersistedLivePrice } from '@/app/[locale]/(platform)/event/[slug]/_utils/eventLiveSeriesChartUtils'

import {
  advanceTimersByTimeAsync,
  spyOn,
  spyOnAccessor,
  stubGlobal,
  unstubAllGlobals,
  useFakeTimers,
  useRealTimers,
} from '../bun-test-helpers'

function getRequestUrl(input: unknown) {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.href
  }
  return input instanceof Request ? input.url : ''
}

describe('useLiveSeriesPriceSnapshot', () => {
  let now: number

  beforeEach(() => {
    now = 1_800_000_000_000
    spyOn(Date, 'now').mockImplementation(() => now)
    spyOnAccessor(document, 'hidden', 'get').mockReturnValue(false)
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    useRealTimers()
    jest.restoreAllMocks()
    unstubAllGlobals()
  })

  it('requests a current snapshot again when a live tab becomes visible', async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL) => ({
      ok: true,
      json: async () => ({
        opening_price: 100,
        latest_price: 101,
        latest_source_timestamp_ms: now,
        event_window_end_ms: now,
      }),
    }))
    stubGlobal('fetch', fetchMock)

    const config = {
      series_slug: 'snapshot-resume-test',
      topic: 'crypto_prices',
      active_window_minutes: 60,
    } as EventLiveChartConfig

    renderHook(() =>
      useLiveSeriesPriceSnapshot({
        config,
        subscriptionSymbol: 'BTC',
        explicitEndTimestamp: null,
        startTimestamp: null,
      }),
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const firstUrl = new URL(getRequestUrl(fetchMock.mock.calls[0]?.[0]), 'https://example.test')
    expect(firstUrl.searchParams.get('eventEndMs')).toBe(String(now))

    now += 2 * 60 * 60 * 1000
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const resumedUrl = new URL(getRequestUrl(fetchMock.mock.calls[1]?.[0]), 'https://example.test')
    expect(resumedUrl.searchParams.get('eventEndMs')).toBe(String(now))
  })

  it.each(['reference-first', 'websocket-first'] as const)(
    'keeps the live WebSocket price when a stale reference arrives %s',
    async (arrivalOrder) => {
      const storageKey = 'kuest-live-ws-last-price:crypto_prices:BTC'
      window.localStorage.setItem(
        'kuest-live-last-price:crypto_prices:BTC',
        JSON.stringify({ price: 80_811, timestamp: now - 1_000 }),
      )
      if (arrivalOrder === 'websocket-first') {
        writePersistedLivePrice('crypto_prices', 'BTC', 80_732, now - 1_000)
      }

      let resolveFetch: ((value: { ok: boolean; json: () => Promise<unknown> }) => void) | null = null
      const fetchMock = mock(
        () =>
          new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
            resolveFetch = resolve
          }),
      )
      stubGlobal('fetch', fetchMock)

      const { result } = renderHook(() =>
        useLiveSeriesPriceSnapshot({
          config: {
            series_slug: `snapshot-arrival-order-${arrivalOrder}`,
            topic: 'crypto_prices',
            active_window_minutes: 15,
          } as EventLiveChartConfig,
          subscriptionSymbol: 'BTC',
          explicitEndTimestamp: now + 10 * 60_000,
          startTimestamp: now - 5 * 60_000,
        }),
      )

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      await act(async () => {
        resolveFetch?.({
          ok: true,
          json: async () => ({
            opening_price: 80_811,
            latest_price: 80_811,
            latest_source_timestamp_ms: now - 5 * 60_000,
            event_window_end_ms: now + 10 * 60_000,
          }),
        })
      })
      await waitFor(() => expect(result.current.referenceSnapshotStatus).toBe('ready'))
      expect(result.current.referenceSnapshot?.opening_price).toBe(80_811)

      if (arrivalOrder === 'reference-first') {
        expect(result.current.persistedFallbackPrice).toBeNull()
        act(() => {
          writePersistedLivePrice('crypto_prices', 'BTC', 80_732, now - 1_000)
          window.dispatchEvent(new StorageEvent('storage', { key: storageKey }))
        })
      }

      expect(result.current.persistedFallbackPrice).toEqual({ price: 80_732, timestamp: now - 1_000 })
      expect(JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')).toEqual({
        price: 80_732,
        timestamp: now - 1_000,
      })
    },
  )

  it('exposes loading and unavailable states before a reference snapshot is confirmed', async () => {
    let resolveFetch: ((value: { ok: boolean }) => void) | null = null
    const fetchMock = mock(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolveFetch = resolve
        }),
    )
    stubGlobal('fetch', fetchMock)

    const config = {
      series_slug: 'snapshot-status-test',
      topic: 'crypto_prices_chainlink',
      active_window_minutes: 1440,
    } as EventLiveChartConfig

    const { result } = renderHook(() =>
      useLiveSeriesPriceSnapshot({
        config,
        subscriptionSymbol: 'BTC',
        explicitEndTimestamp: now - 1000,
        startTimestamp: null,
      }),
    )

    expect(result.current.referenceSnapshotStatus).toBe('loading')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    await act(async () => {
      resolveFetch?.({ ok: false })
    })

    await waitFor(() => expect(result.current.referenceSnapshotStatus).toBe('unavailable'))
    expect(result.current.referenceSnapshot).toBeNull()
  })

  it('retries five seconds after a new window starts until its opening price is available', async () => {
    useFakeTimers()
    const eventStartTimestamp = now
    const eventEndTimestamp = eventStartTimestamp + 5 * 60 * 1000
    const fetchMock = mock()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          opening_price: null,
          event_window_start_ms: eventStartTimestamp,
          event_window_end_ms: eventEndTimestamp,
        }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          opening_price: 123,
          latest_price: 124,
          latest_source_timestamp_ms: eventStartTimestamp + 5_000,
          event_window_start_ms: eventStartTimestamp,
          event_window_end_ms: eventEndTimestamp,
        }),
      })
    stubGlobal('fetch', fetchMock)

    const config = {
      series_slug: 'snapshot-opening-retry-test',
      topic: 'crypto_prices_chainlink',
      active_window_minutes: 5,
    } as EventLiveChartConfig

    const { result } = renderHook(() =>
      useLiveSeriesPriceSnapshot({
        config,
        subscriptionSymbol: 'BTC',
        explicitEndTimestamp: eventEndTimestamp,
        startTimestamp: eventStartTimestamp,
      }),
    )

    await act(async () => {
      await advanceTimersByTimeAsync(0)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.referenceSnapshot?.opening_price).toBeNull()

    now += 5_000
    await act(async () => {
      await advanceTimersByTimeAsync(5_000)
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.referenceSnapshot?.opening_price).toBe(123)
  })

  it('keeps checking a delayed HOOD event reference after the usual two-minute window', async () => {
    useFakeTimers()
    const eventStartTimestamp = now - 3 * 60_000
    const eventEndTimestamp = now + 6 * 60 * 60_000
    function snapshot(openingPrice: number | null) {
      return {
        instrument: 'HOOD',
        interval: '1d',
        source: 'pyth',
        opening_price: openingPrice,
        event_window_start_ms: eventStartTimestamp,
        event_window_end_ms: eventEndTimestamp,
      }
    }
    const fetchMock = mock()
      .mockResolvedValueOnce({ ok: true, json: async () => snapshot(null) })
      .mockResolvedValueOnce({ ok: true, json: async () => snapshot(null) })
      .mockResolvedValue({ ok: true, json: async () => snapshot(101.94) })
    stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() =>
      useLiveSeriesPriceSnapshot({
        config: {
          series_slug: 'hood-daily-up-or-down',
          topic: 'equity_prices',
          active_window_minutes: 390,
        } as EventLiveChartConfig,
        eventSlug: 'hood-up-or-down-on-october-22-2026',
        subscriptionSymbol: 'HOOD',
        explicitEndTimestamp: eventEndTimestamp,
        startTimestamp: eventStartTimestamp,
      }),
    )
    await act(async () => {
      await advanceTimersByTimeAsync(0)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(
      new URL(getRequestUrl(fetchMock.mock.calls[0]?.[0]), 'https://kuest.test').searchParams.get('eventSlug'),
    ).toBe('hood-up-or-down-on-october-22-2026')

    now += 60_000
    await act(async () => {
      await advanceTimersByTimeAsync(60_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    now += 60_000
    await act(async () => {
      await advanceTimersByTimeAsync(60_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.current.referenceSnapshot?.opening_price).toBe(101.94)
  })

  it('keeps checking HOOD after a non-canonical close until the event close arrives', async () => {
    useFakeTimers()
    const eventEndTimestamp = now + 10_000
    const eventStartTimestamp = eventEndTimestamp - 390 * 60_000
    function snapshot(closingPrice: number | null, eventWindowEndMs = eventEndTimestamp) {
      return {
        series_slug: 'hood-daily-up-or-down',
        instrument: 'HOOD',
        interval: '1d',
        source: 'pyth',
        interval_ms: 86_400_000,
        event_window_start_ms: eventStartTimestamp,
        event_window_end_ms: eventWindowEndMs,
        opening_price: 98,
        closing_price: closingPrice,
        is_event_closed: true,
      }
    }
    const fetchMock = mock()
      .mockResolvedValueOnce({ ok: true, json: async () => snapshot(null) })
      .mockResolvedValueOnce({ ok: true, json: async () => snapshot(999, eventEndTimestamp + 1) })
      .mockResolvedValue({ ok: true, json: async () => snapshot(105) })
    stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() =>
      useLiveSeriesPriceSnapshot({
        config: {
          series_slug: 'hood-daily-up-or-down',
          topic: 'equity_prices',
          active_window_minutes: 390,
        } as EventLiveChartConfig,
        eventSlug: 'hood-up-or-down-on-october-22-2026',
        subscriptionSymbol: 'HOOD',
        explicitEndTimestamp: eventEndTimestamp,
        startTimestamp: eventStartTimestamp,
      }),
    )

    await act(async () => {
      await advanceTimersByTimeAsync(0)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    now = eventEndTimestamp + 65_000
    await act(async () => {
      await advanceTimersByTimeAsync(75_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.referenceSnapshot?.closing_price).toBe(999)

    now += 60_000
    await act(async () => {
      await advanceTimersByTimeAsync(60_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.current.referenceSnapshot?.closing_price).toBe(105)
  })

  it('keeps checking a closed GOLD round until the canonical close arrives', async () => {
    useFakeTimers()
    const eventEndTimestamp = now + 10_000
    const eventStartTimestamp = eventEndTimestamp - 450 * 60_000
    function snapshot(closingPrice: number | null, isEventClosed: boolean) {
      return {
        series_slug: 'gold-daily-up-or-down',
        instrument: 'XAUUSD',
        interval: '1d',
        source: 'pyth',
        interval_ms: 86_400_000,
        event_window_start_ms: eventStartTimestamp,
        event_window_end_ms: eventEndTimestamp,
        opening_price: 4100,
        closing_price: closingPrice,
        latest_price: closingPrice,
        latest_window_end_ms: eventEndTimestamp,
        latest_source_timestamp_ms: eventEndTimestamp,
        is_event_closed: isEventClosed,
      }
    }
    const fetchMock = mock()
      .mockResolvedValueOnce({ ok: true, json: async () => snapshot(null, false) })
      .mockResolvedValueOnce({ ok: true, json: async () => snapshot(null, true) })
      .mockResolvedValue({ ok: true, json: async () => snapshot(4150, true) })
    stubGlobal('fetch', fetchMock)

    const config = {
      series_slug: 'gold-daily-up-or-down',
      topic: 'equity_prices',
      active_window_minutes: 450,
    } as EventLiveChartConfig
    const { result } = renderHook(() =>
      useLiveSeriesPriceSnapshot({
        config,
        subscriptionSymbol: 'XAUUSD',
        explicitEndTimestamp: eventEndTimestamp,
        startTimestamp: eventStartTimestamp,
      }),
    )

    await act(async () => {
      await advanceTimersByTimeAsync(0)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    now = eventEndTimestamp + 65_000
    await act(async () => {
      await advanceTimersByTimeAsync(75_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.referenceSnapshot?.closing_price).toBeNull()

    now += 60_000
    await act(async () => {
      await advanceTimersByTimeAsync(60_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.current.referenceSnapshot?.closing_price).toBe(4150)

    now += 60_000
    await act(async () => {
      await advanceTimersByTimeAsync(60_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('keeps checking GOLD after a delayed close without an immediate duplicate request', async () => {
    useFakeTimers()
    const eventEndTimestamp = now - 60 * 60_000
    const eventStartTimestamp = eventEndTimestamp - 450 * 60_000
    function snapshot(closingPrice: number | null) {
      return {
        series_slug: 'gold-daily-up-or-down',
        instrument: 'XAUUSD',
        interval: '1d',
        source: 'pyth',
        interval_ms: 86_400_000,
        event_window_start_ms: eventStartTimestamp,
        event_window_end_ms: eventEndTimestamp,
        opening_price: 4100,
        closing_price: closingPrice,
        is_event_closed: true,
      }
    }
    const fetchMock = mock()
      .mockResolvedValueOnce({ ok: true, json: async () => snapshot(null) })
      .mockResolvedValue({ ok: true, json: async () => snapshot(4150) })
    stubGlobal('fetch', fetchMock)

    const config = {
      series_slug: 'gold-daily-up-or-down',
      topic: 'equity_prices',
      active_window_minutes: 450,
    } as EventLiveChartConfig
    const { result } = renderHook(() =>
      useLiveSeriesPriceSnapshot({
        config,
        subscriptionSymbol: 'XAUUSD',
        explicitEndTimestamp: eventEndTimestamp,
        startTimestamp: eventStartTimestamp,
      }),
    )

    await act(async () => {
      await advanceTimersByTimeAsync(0)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.referenceSnapshot?.closing_price).toBeNull()

    now += 5 * 60_000
    await act(async () => {
      await advanceTimersByTimeAsync(5 * 60_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.referenceSnapshot?.closing_price).toBe(4150)
  })
})
