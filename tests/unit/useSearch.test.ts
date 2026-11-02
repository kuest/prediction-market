import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock, jest } from 'bun:test'

import { useSearch } from '@/hooks/useSearch'

import { stubGlobal, unstubAllGlobals, useFakeTimers, useRealTimers } from '../bun-test-helpers'

function getRequestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') {
    return input
  }
  return input instanceof URL ? input.href : input.url
}

describe('useSearch', () => {
  const fetchMock = mock((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = getRequestUrl(input)

    if (url.includes('/api/events')) {
      const parsedUrl = new URL(url, 'http://localhost')
      const searchQuery = parsedUrl.searchParams.get('search')

      return Promise.resolve({
        ok: true,
        json: async () =>
          searchQuery === 'resolved'
            ? [
                {
                  id: 'event-1',
                  slug: 'resolved-event',
                  status: 'resolved',
                  title: 'Resolved Event',
                  end_date: '2026-03-20T12:00:00.000Z',
                  resolved_at: '2026-03-21T12:00:00.000Z',
                  created_at: '2026-03-10T12:00:00.000Z',
                  markets: [{ probability: 63 }],
                },
              ]
            : searchQuery === 'mixed'
              ? [
                  {
                    id: 'event-4',
                    slug: 'older-resolved-event',
                    status: 'resolved',
                    title: 'Older Resolved Event',
                    end_date: '2026-03-18T12:00:00.000Z',
                    resolved_at: '2026-03-19T12:00:00.000Z',
                    created_at: '2026-03-01T12:00:00.000Z',
                    markets: [{ probability: 48, is_resolved: true }],
                  },
                  {
                    id: 'event-2',
                    slug: 'later-active-event',
                    status: 'active',
                    title: 'Later Active Event',
                    end_date: '2026-04-12T12:00:00.000Z',
                    resolved_at: null,
                    created_at: '2026-03-05T12:00:00.000Z',
                    markets: [{ probability: 52, is_resolved: false }],
                  },
                  {
                    id: 'event-3',
                    slug: 'newer-resolved-event',
                    status: 'resolved',
                    title: 'Newer Resolved Event',
                    end_date: '2026-03-22T12:00:00.000Z',
                    resolved_at: '2026-03-24T12:00:00.000Z',
                    created_at: '2026-03-15T12:00:00.000Z',
                    markets: [{ probability: 58, is_resolved: true }],
                  },
                  {
                    id: 'event-1',
                    slug: 'sooner-active-event',
                    status: 'active',
                    title: 'Sooner Active Event',
                    end_date: '2026-04-01T12:00:00.000Z',
                    resolved_at: null,
                    created_at: '2026-03-12T12:00:00.000Z',
                    markets: [{ probability: 63, is_resolved: false }],
                  },
                ]
              : [],
      })
    }

    if (url.includes('/api/users')) {
      return Promise.resolve({
        ok: true,
        json: async () => [],
      })
    }

    return Promise.reject(new Error(`Unexpected fetch: ${url}`))
  })

  beforeEach(() => {
    useFakeTimers()
    fetchMock.mockClear()
    stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    useRealTimers()
    unstubAllGlobals()
  })

  it('reopens the existing search results when the input is focused again', async () => {
    const { result } = renderHook(() => useSearch())

    act(() => {
      result.current.handleQueryChange('brazil')
    })

    act(() => {
      result.current.showSearchResults()
    })

    expect(result.current.showResults).toBe(true)

    act(() => {
      result.current.hideResults()
    })

    expect(result.current.showResults).toBe(false)

    act(() => {
      result.current.showSearchResults()
    })

    expect(result.current.showResults).toBe(true)
  })

  it('requests events with the combined status filter and dropdown limit so resolved results are included', async () => {
    const { result } = renderHook(() => useSearch())

    act(() => {
      result.current.handleQueryChange('resolved')
    })

    await act(async () => {
      jest.advanceTimersByTime(299)
      await Promise.resolve()
    })

    expect(fetchMock).not.toHaveBeenCalled()

    await act(async () => {
      jest.advanceTimersByTime(1)
      await Promise.resolve()
    })

    const eventsRequestUrl = fetchMock.mock.calls
      .map(([input]) => getRequestUrl(input))
      .find((url) => url.includes('/api/events'))
    const eventsRequest = new URL(eventsRequestUrl!, 'http://localhost')

    expect(eventsRequest.searchParams.get('search')).toBe('resolved')
    expect(eventsRequest.searchParams.get('status')).toBe('all')
    expect(eventsRequest.searchParams.get('limit')).toBe('5')
    expect(eventsRequest.searchParams.get('includeBookmarkState')).toBe('false')
    expect(result.current.results.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'resolved-event',
          status: 'resolved',
        }),
      ]),
    )
  })

  it('sorts search events with active items first and resolved items by latest resolution date after them', async () => {
    const { result } = renderHook(() => useSearch())

    act(() => {
      result.current.handleQueryChange('mixed')
    })

    await act(async () => {
      jest.advanceTimersByTime(300)
      await Promise.resolve()
    })

    expect(result.current.results.events.map((event) => event.slug)).toEqual([
      'sooner-active-event',
      'later-active-event',
      'newer-resolved-event',
      'older-resolved-event',
    ])
  })

  it('aborts in-flight event and profile searches when the query changes', async () => {
    fetchMock.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal

      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'))
          return
        }

        signal?.addEventListener(
          'abort',
          () => {
            reject(new DOMException('Aborted', 'AbortError'))
          },
          { once: true },
        )
      }) as Promise<Response>
    })

    const { result } = renderHook(() => useSearch())

    act(() => {
      result.current.handleQueryChange('brazil')
    })

    await act(async () => {
      jest.advanceTimersByTime(300)
      await Promise.resolve()
    })

    const initialSignals = fetchMock.mock.calls
      .map(([, init]) => init?.signal)
      .filter((signal): signal is AbortSignal => Boolean(signal))

    expect(initialSignals).toHaveLength(2)
    expect(initialSignals.every((signal) => signal.aborted)).toBe(false)

    act(() => {
      result.current.handleQueryChange('trump')
    })

    expect(initialSignals.every((signal) => signal.aborted)).toBe(true)
  })
})
