import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'

import { useLiveSeriesWebSocket } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useLiveSeriesWebSocket'
import {
  LIVE_DATA_RETENTION_MS,
  resolveLivePriceTransitionDuration,
  SERIES_KEY,
} from '@/app/[locale]/(platform)/event/[slug]/_utils/eventLiveSeriesChartUtils'

import { spyOn, spyOnAccessor, stubGlobal, unstubAllGlobals, useFakeTimers, useRealTimers } from '../bun-test-helpers'

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: MockWebSocket[] = []

  readyState = MockWebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  sentMessages: string[] = []
  private listeners = new Map<string, Set<(event: Event) => void>>()

  constructor(readonly url: string | URL) {
    MockWebSocket.instances.push(this)
  }

  send(payload: string) {
    this.sentMessages.push(payload)
  }

  addEventListener(type: string, listener: EventListener) {
    const eventListeners = this.listeners.get(type) ?? new Set<(event: Event) => void>()
    eventListeners.add(listener)
    this.listeners.set(type, eventListeners)
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener)
  }

  private emitEvent(type: string, event: Event) {
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  emitMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>)
  }

  emitRawMessage(data: string) {
    this.onmessage?.({ data } as MessageEvent<string>)
    this.emitEvent('message', new MessageEvent('message', { data }))
  }
}

describe('useLiveSeriesWebSocket', () => {
  let now = 1_800_000_000_000
  let dateNowSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    now = 1_800_000_000_000
    MockWebSocket.instances = []
    window.localStorage.clear()
    stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    dateNowSpy = spyOn(Date, 'now').mockImplementation(() => now)
  })

  afterEach(() => {
    cleanup()
    jest.restoreAllMocks()
    unstubAllGlobals()
  })

  function mountHook(eventEndTimestamp: number | null = null) {
    const view = renderHook(() =>
      useLiveSeriesWebSocket({
        topic: 'crypto_prices',
        eventType: 'price',
        eventEndTimestamp,
        subscriptionSymbol: 'BTC',
        isLiveView: true,
      }),
    )

    const socket = MockWebSocket.instances[0]!
    act(() => socket.emitOpen())
    return { ...view, socket }
  }

  it.each([{ prices: [100] }, { prices: [100, 101] }])(
    'loads a $prices.length-point subscribe payload as the initial snapshot',
    ({ prices }) => {
      const { result, socket } = mountHook()
      const snapshot = prices.map((price, index) => ({
        symbol: 'BTC',
        value: price,
        timestamp: now - (prices.length - index) * 1_000,
      }))

      act(() =>
        socket.emitMessage({
          type: 'subscribe',
          payload: { data: snapshot },
        }),
      )

      expect(result.current.data.map((point) => [point.date.getTime(), point[SERIES_KEY]])).toEqual(
        snapshot.map((point) => [point.timestamp, point.value]),
      )
      expect(result.current.status).toBe('live')
    },
  )

  it('keeps the RTDS connection alive with application heartbeats', () => {
    useFakeTimers()
    const { socket, unmount } = mountHook()

    act(() => {
      jest.advanceTimersByTime(25_000)
    })

    expect(socket.sentMessages.at(-1)).toBe('PING')
    unmount()
    useRealTimers()
  })

  it('reconnects a stale RTDS stream even when the socket still answers PONG', () => {
    useFakeTimers()
    jest.setSystemTime(now)
    const { result, socket, unmount } = mountHook()

    act(() => {
      jest.advanceTimersByTime(25_000)
    })
    act(() => socket.emitRawMessage('PONG'))
    now += 75_000
    act(() => {
      jest.advanceTimersByTime(25_000)
    })

    expect(socket.readyState).toBe(MockWebSocket.CLOSED)
    expect(result.current.status).toBe('offline')

    act(() => {
      jest.advanceTimersByTime(2_000)
    })
    expect(MockWebSocket.instances).toHaveLength(2)
    unmount()
    useRealTimers()
  })

  it('keeps the heartbeat and socket when a healthy stream becomes visible again', () => {
    useFakeTimers()
    const { socket, unmount } = mountHook()

    expect(jest.getTimerCount()).toBe(2)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(MockWebSocket.instances).toHaveLength(1)
    expect(jest.getTimerCount()).toBe(3)
    act(() => socket.emitRawMessage('PONG'))
    unmount()
    useRealTimers()
  })

  it('uses the latest batch value and retargets from the in-flight visual price', () => {
    const { result, socket } = mountHook()
    const initialNow = now

    act(() =>
      socket.emitMessage({
        type: 'subscribe',
        data: [{ symbol: 'BTC', value: 100, timestamp: initialNow - 500 }],
      }),
    )

    const callsBeforeUpdates = dateNowSpy.mock.calls.length
    act(() => {
      now = initialNow + 100
      socket.emitMessage({
        type: 'update',
        topic: 'crypto_prices',
        symbol: 'BTC',
        value: 110,
        timestamp: now,
      })

      now = initialNow + 200
      socket.emitMessage({
        type: 'update',
        data: [
          { symbol: 'BTC', value: 90, timestamp: initialNow + 195 },
          { symbol: 'BTC', value: 92, timestamp: initialNow + 190 },
        ],
      })
    })

    expect(dateNowSpy.mock.calls.length - callsBeforeUpdates).toBe(2)

    const retargetStart = initialNow + 200
    const transition = result.current.data.filter((point) => point.date.getTime() >= retargetStart)
    const firstPrice = transition[0]?.[SERIES_KEY] as number
    const duration = resolveLivePriceTransitionDuration(initialNow + 100, retargetStart)

    expect(transition[0]?.date.getTime()).toBe(retargetStart)
    expect(firstPrice).toBeGreaterThan(100)
    expect(firstPrice).toBeLessThan(110)
    expect(transition.at(-1)?.date.getTime()).toBe(retargetStart + duration)
    expect(transition.at(-1)?.[SERIES_KEY]).toBe(90)
  })

  it('finishes the last transition at the event cutoff and ignores later updates', () => {
    const initialNow = now
    const eventEndTimestamp = initialNow + 150
    const { result, socket } = mountHook(eventEndTimestamp)

    act(() =>
      socket.emitMessage({
        type: 'subscribe',
        data: [{ symbol: 'BTC', value: 100, timestamp: initialNow - 500 }],
      }),
    )

    now = initialNow + 100
    act(() =>
      socket.emitMessage({
        type: 'update',
        symbol: 'BTC',
        value: 110,
        timestamp: now,
      }),
    )

    expect(result.current.data.at(-1)?.date.getTime()).toBe(eventEndTimestamp)
    expect(result.current.data.at(-1)?.[SERIES_KEY]).toBe(110)

    const dataAtCutoff = result.current.data
    now = eventEndTimestamp + 1
    act(() =>
      socket.emitMessage({
        type: 'update',
        symbol: 'BTC',
        value: 120,
        timestamp: now,
      }),
    )

    expect(result.current.data).toBe(dataAtCutoff)
  })

  it('accepts a pre-close update delivered after the event cutoff', () => {
    const initialNow = now
    const eventEndTimestamp = initialNow + 150
    const { result, socket } = mountHook(eventEndTimestamp)

    act(() =>
      socket.emitMessage({
        type: 'subscribe',
        data: [{ symbol: 'BTC', value: 100, timestamp: initialNow - 500 }],
      }),
    )

    now = eventEndTimestamp + 1_000
    act(() =>
      socket.emitMessage({
        type: 'update',
        symbol: 'BTC',
        value: 110,
        timestamp: eventEndTimestamp - 1,
      }),
    )

    expect(result.current.data.at(-1)).toEqual({
      date: new Date(eventEndTimestamp),
      [SERIES_KEY]: 110,
    })
    expect(JSON.parse(window.localStorage.getItem('kuest-live-ws-last-price:crypto_prices:BTC')!)).toEqual({
      price: 110,
      timestamp: eventEndTimestamp - 1,
    })
  })

  it('keeps the same live connection and data when the featured event rolls forward', () => {
    const initialEndTimestamp = now + 100
    const { result, rerender } = renderHook(
      ({ eventEndTimestamp }) =>
        useLiveSeriesWebSocket({
          topic: 'crypto_prices',
          eventType: 'price',
          eventEndTimestamp,
          subscriptionSymbol: 'BTC',
          isLiveView: true,
        }),
      { initialProps: { eventEndTimestamp: initialEndTimestamp } },
    )
    const socket = MockWebSocket.instances[0]!
    act(() => socket.emitOpen())
    act(() =>
      socket.emitMessage({
        type: 'subscribe',
        data: [{ symbol: 'BTC', value: 100, timestamp: now - 50 }],
      }),
    )

    rerender({ eventEndTimestamp: initialEndTimestamp + 1_000 })
    now = initialEndTimestamp + 200
    act(() =>
      socket.emitMessage({
        type: 'update',
        symbol: 'BTC',
        value: 110,
        timestamp: now,
      }),
    )

    expect(MockWebSocket.instances).toHaveLength(1)
    expect(result.current.data.at(-1)?.[SERIES_KEY]).toBe(110)
    expect(result.current.data.some((point) => point[SERIES_KEY] === 100)).toBe(true)
  })

  it('does not replace an apparently open socket when the tab becomes visible again', () => {
    const hiddenSpy = spyOnAccessor(document, 'hidden', 'get').mockReturnValue(false)
    const { socket } = mountHook()

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(socket.readyState).toBe(MockWebSocket.OPEN)
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(JSON.parse(socket.sentMessages[0]!)).toMatchObject({
      action: 'subscribe',
    })
    expect(socket.sentMessages.at(-1)).toBe('PING')
    act(() => socket.emitRawMessage('PONG'))
    hiddenSpy.mockRestore()
  })

  it('retains rendered history when the tab becomes visible again', () => {
    const hiddenSpy = spyOnAccessor(document, 'hidden', 'get').mockReturnValue(false)
    const { result, socket } = mountHook()

    act(() =>
      socket.emitMessage({
        type: 'subscribe',
        data: [
          { symbol: 'BTC', value: 100, timestamp: now - 1_000 },
          { symbol: 'BTC', value: 101, timestamp: now },
        ],
      }),
    )
    const visibleData = result.current.data

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(result.current.data).toBe(visibleData)
    expect(result.current.data).toHaveLength(2)
    hiddenSpy.mockRestore()
  })

  it('replaces a long-idle window with actual points from the current snapshot', () => {
    const { result, socket } = mountHook()

    act(() =>
      socket.emitMessage({
        type: 'subscribe',
        data: [{ symbol: 'BTC', value: 100, timestamp: now - 1_000 }],
      }),
    )

    now += LIVE_DATA_RETENTION_MS + 1_000
    const snapshot = Array.from({ length: 300 }, (_, index) => ({
      symbol: 'BTC',
      value: 100 + index / 100,
      timestamp: now - 30_000 + index * 100,
    }))

    act(() =>
      socket.emitMessage({
        type: 'subscribe',
        payload: { data: snapshot },
      }),
    )

    expect(result.current.data).toHaveLength(300)
    expect(result.current.data[0]).toEqual({ date: new Date(snapshot[0]!.timestamp), [SERIES_KEY]: 100 })
    expect(result.current.data.at(-1)).toEqual({
      date: new Date(snapshot.at(-1)!.timestamp),
      [SERIES_KEY]: 102.99,
    })
    expect(result.current.idleRecoveryVersion).toBe(1)
    expect(result.current.idleRecovery?.priceSpan).toBeCloseTo(2.99)
  })

  it('reanchors after a long hidden period even when updates arrived while hidden', () => {
    let isHidden = false
    const hiddenSpy = spyOnAccessor(document, 'hidden', 'get').mockImplementation(() => isHidden)
    const { result, socket } = mountHook()

    act(() =>
      socket.emitMessage({
        type: 'subscribe',
        data: [{ symbol: 'BTC', value: 100, timestamp: now - 1_000 }],
      }),
    )

    act(() => {
      isHidden = true
      document.dispatchEvent(new Event('visibilitychange'))
      now += LIVE_DATA_RETENTION_MS + 1_000
      socket.emitMessage({
        type: 'update',
        symbol: 'BTC',
        value: 120,
        timestamp: now,
      })
      isHidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    })

    const resumedSocket = MockWebSocket.instances.at(-1)!
    expect(resumedSocket).not.toBe(socket)
    act(() => resumedSocket.emitOpen())
    act(() =>
      resumedSocket.emitMessage({
        type: 'subscribe',
        payload: {
          data: [
            { symbol: 'BTC', value: 150, timestamp: now - 1_000 },
            { symbol: 'BTC', value: 151, timestamp: now },
          ],
        },
      }),
    )

    expect(result.current.data).toHaveLength(2)
    expect(result.current.data.map((point) => point[SERIES_KEY])).toEqual([150, 151])
    expect(result.current.idleRecoveryVersion).toBe(1)
    hiddenSpy.mockRestore()
  })

  it('leaves a missing part of the resumed window empty when the snapshot lacks those points', () => {
    let isHidden = false
    const hiddenSpy = spyOnAccessor(document, 'hidden', 'get').mockImplementation(() => isHidden)
    const { result, socket } = mountHook()
    act(() => socket.emitMessage({ type: 'subscribe', data: [{ symbol: 'BTC', value: 100, timestamp: now }] }))

    act(() => {
      isHidden = true
      document.dispatchEvent(new Event('visibilitychange'))
      now += LIVE_DATA_RETENTION_MS + 1_000
      isHidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(result.current.data).toEqual([])
    expect(result.current.resumedAtTimestamp).toBe(now)
    const resumedSocket = MockWebSocket.instances.at(-1)!
    expect(resumedSocket).not.toBe(socket)
    act(() => {
      resumedSocket.emitOpen()
      resumedSocket.emitMessage({
        type: 'subscribe',
        data: [
          { symbol: 'BTC', value: 110, timestamp: now - 45_000 },
          { symbol: 'BTC', value: 120, timestamp: now - 20_000 },
          { symbol: 'BTC', value: 121, timestamp: now - 1_000 },
        ],
      })
    })

    expect(result.current.data.map((point) => [point.date.getTime(), point[SERIES_KEY]])).toEqual([
      [now - 20_000, 120],
      [now - 1_000, 121],
    ])
    hiddenSpy.mockRestore()
  })

  it('restores an equal-watermark snapshot after a second return without regressing the saved price', () => {
    useFakeTimers()
    let isHidden = false
    const hiddenSpy = spyOnAccessor(document, 'hidden', 'get').mockImplementation(() => isHidden)
    const { result, socket, unmount } = mountHook()
    act(() => socket.emitMessage({ type: 'subscribe', data: [{ symbol: 'BTC', value: 100, timestamp: now - 1_000 }] }))

    act(() => {
      isHidden = true
      document.dispatchEvent(new Event('visibilitychange'))
      now += 2_000
      isHidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    })
    const firstResumedSocket = MockWebSocket.instances.at(-1)!
    const latestTimestamp = now
    act(() => {
      firstResumedSocket.emitOpen()
      firstResumedSocket.emitMessage({
        type: 'subscribe',
        data: [
          { symbol: 'BTC', value: 101, timestamp: now - 1_000 },
          { symbol: 'BTC', value: 102, timestamp: latestTimestamp },
        ],
      })
      now += 1_250
      jest.advanceTimersByTime(1_250)
    })

    act(() => {
      isHidden = true
      document.dispatchEvent(new Event('visibilitychange'))
      now += 2_000
      isHidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current.data).toEqual([])

    const secondResumedSocket = MockWebSocket.instances.at(-1)!
    act(() => {
      secondResumedSocket.emitOpen()
      secondResumedSocket.emitMessage({
        type: 'subscribe',
        data: [
          { symbol: 'BTC', value: 101, timestamp: latestTimestamp - 1_000 },
          { symbol: 'BTC', value: 102.5, timestamp: latestTimestamp },
        ],
      })
    })
    expect(result.current.data.map((point) => [point.date.getTime(), point[SERIES_KEY]])).toEqual([
      [latestTimestamp - 1_000, 101],
      [latestTimestamp, 102.5],
    ])
    expect(JSON.parse(window.localStorage.getItem('kuest-live-ws-last-price:crypto_prices:BTC')!)).toEqual({
      price: 102,
      timestamp: latestTimestamp,
    })

    const restoredData = result.current.data
    act(() =>
      secondResumedSocket.emitMessage({
        type: 'update',
        symbol: 'BTC',
        value: 1,
        timestamp: latestTimestamp - 1,
      }),
    )
    expect(result.current.data).toBe(restoredData)

    act(() =>
      secondResumedSocket.emitMessage({
        type: 'update',
        symbol: 'BTC',
        value: 103,
        timestamp: now,
      }),
    )
    const newerData = result.current.data
    act(() =>
      secondResumedSocket.emitMessage({
        type: 'update',
        symbol: 'BTC',
        value: 1,
        timestamp: latestTimestamp + 1,
      }),
    )
    expect(result.current.data).toBe(newerData)
    expect(JSON.parse(window.localStorage.getItem('kuest-live-ws-last-price:crypto_prices:BTC')!)).toEqual({
      price: 103,
      timestamp: now,
    })

    const acceptedTimestamp = now
    act(() => {
      isHidden = true
      document.dispatchEvent(new Event('visibilitychange'))
      now += 2_000
      isHidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    })
    const thirdResumedSocket = MockWebSocket.instances.at(-1)!
    act(() => {
      thirdResumedSocket.emitOpen()
      thirdResumedSocket.emitMessage({
        type: 'subscribe',
        data: [{ symbol: 'BTC', value: 103.5, timestamp: acceptedTimestamp }],
      })
    })
    expect(result.current.data.at(-1)?.[SERIES_KEY]).toBe(103.5)

    now += LIVE_DATA_RETENTION_MS + 1_000
    act(() =>
      thirdResumedSocket.emitMessage({
        type: 'update',
        symbol: 'BTC',
        value: 105,
        timestamp: now,
      }),
    )
    expect(result.current.idleRecovery?.priceSpan).toBeCloseTo(1.5)
    unmount()
    hiddenSpy.mockRestore()
    useRealTimers()
  })

  it('coalesces resumed ticks on repeated returns without replaying hidden prices', () => {
    useFakeTimers()
    let isHidden = false
    const hiddenSpy = spyOnAccessor(document, 'hidden', 'get').mockImplementation(() => isHidden)
    const { result, socket: initialSocket, unmount } = mountHook()
    let socket = initialSocket

    act(() => socket.emitMessage({ type: 'subscribe', data: [{ symbol: 'BTC', value: 100, timestamp: now }] }))

    for (const [hiddenPrice, firstPrice, lastPrice] of [
      [110, 120, 130],
      [145, 150, 160],
    ]) {
      act(() => {
        isHidden = true
        document.dispatchEvent(new Event('visibilitychange'))
        now += 2_000
        socket.emitMessage({ type: 'update', symbol: 'BTC', value: hiddenPrice, timestamp: now })
      })
      expect(result.current.data.at(-1)?.[SERIES_KEY]).not.toBe(hiddenPrice)

      act(() => {
        isHidden = false
        document.dispatchEvent(new Event('visibilitychange'))
      })
      const resumedSocket = MockWebSocket.instances.at(-1)!
      expect(resumedSocket).not.toBe(socket)
      socket = resumedSocket
      const snapshot = Array.from({ length: 40 }, (_, index) => ({
        symbol: 'BTC',
        value: firstPrice - 1 + index / 100,
        timestamp: now - 39_000 + index * 1_000,
      }))
      act(() => {
        socket.emitOpen()
        socket.emitMessage({ type: 'subscribe', data: snapshot })
        socket.emitMessage({ type: 'update', symbol: 'BTC', value: firstPrice + 1, timestamp: now + 1 })
        socket.emitMessage({ type: 'update', symbol: 'BTC', value: lastPrice, timestamp: now + 2 })
      })

      expect(result.current.data).toHaveLength(40)
      expect(result.current.data[0]?.date.getTime()).toBe(now - 39_000)
      expect(result.current.data.at(-1)?.[SERIES_KEY]).toBe(snapshot.at(-1)?.value)

      act(() => {
        now += 1_250
        jest.advanceTimersByTime(1_250)
      })
      expect(result.current.data.at(-1)?.[SERIES_KEY]).toBe(lastPrice)
      expect(result.current.data.some((point) => point[SERIES_KEY] === firstPrice + 1)).toBe(false)
      const resumedData = result.current.data
      act(() => socket.emitMessage({ type: 'update', symbol: 'BTC', value: firstPrice + 1, timestamp: now - 1_249 }))
      expect(result.current.data).toBe(resumedData)

      act(() => socket.emitMessage({ type: 'update', symbol: 'BTC', value: lastPrice + 10, timestamp: now }))
      const newerData = result.current.data
      expect(newerData.at(-1)?.[SERIES_KEY]).toBe(lastPrice + 10)
      act(() => socket.emitMessage({ type: 'update', symbol: 'BTC', value: 1, timestamp: now - 500 }))
      expect(result.current.data).toBe(newerData)
      expect(JSON.parse(window.localStorage.getItem('kuest-live-ws-last-price:crypto_prices:BTC')!)).toEqual({
        price: lastPrice + 10,
        timestamp: now,
      })
    }

    expect(result.current.idleRecoveryVersion).toBe(2)
    unmount()
    hiddenSpy.mockRestore()
    useRealTimers()
  })

  it('clears idle recovery state when the websocket effect is recreated', () => {
    const view = renderHook(
      ({ subscriptionSymbol }) =>
        useLiveSeriesWebSocket({
          topic: 'crypto_prices',
          eventType: 'price',
          eventEndTimestamp: null,
          subscriptionSymbol,
          isLiveView: true,
        }),
      { initialProps: { subscriptionSymbol: 'BTC' } },
    )
    const firstSocket = MockWebSocket.instances[0]!
    act(() => firstSocket.emitOpen())

    act(() =>
      firstSocket.emitMessage({
        type: 'subscribe',
        data: [{ symbol: 'BTC', value: 100, timestamp: now - 1_000 }],
      }),
    )

    now += LIVE_DATA_RETENTION_MS + 1_000
    act(() =>
      firstSocket.emitMessage({
        type: 'update',
        symbol: 'BTC',
        value: 120,
        timestamp: now,
      }),
    )

    expect(view.result.current.idleRecoveryVersion).toBe(1)
    expect(view.result.current.idleRecovery).not.toBeNull()

    view.rerender({ subscriptionSymbol: 'ETH' })

    expect(view.result.current.idleRecovery).toBeNull()
    expect(view.result.current.idleRecoveryVersion).toBe(0)
    expect(view.result.current.data).toEqual([])
    const nextSocket = MockWebSocket.instances.at(-1)!
    act(() => nextSocket.emitOpen())
    act(() =>
      nextSocket.emitMessage({
        type: 'subscribe',
        data: [{ symbol: 'ETH', value: 200, timestamp: now }],
      }),
    )
    expect(view.result.current.data.at(-1)?.[SERIES_KEY]).toBe(200)
    view.unmount()
  })
})
