import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock, jest } from 'bun:test'

import type { EventLiveChartConfig } from '@/types'

import { useLiveSeriesPriceSnapshot } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useLiveSeriesPriceSnapshot'

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
