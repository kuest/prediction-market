import { afterEach, describe, expect, it, mock } from 'bun:test'

import type { ActivityOrder } from '@/types'

import { GET as getEventActivity } from '@/app/api/event-activity/route'
import { EVENT_ACTIVITY_REFRESH_SIZE, fetchEventTrades } from '@/lib/data-api/trades'

import { stubGlobal, unstubAllGlobals } from '../bun-test-helpers'

describe('fetchEventTrades', () => {
  const originalDataUrl = process.env.DATA_URL

  afterEach(() => {
    unstubAllGlobals()
    if (originalDataUrl === undefined) {
      delete process.env.DATA_URL
    } else {
      process.env.DATA_URL = originalDataUrl
    }
  })

  it('requests a bounded page with the timestamp and event id cursor', async () => {
    const fetchMock = mock().mockResolvedValue(
      new Response(JSON.stringify([]), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    )
    stubGlobal('fetch', fetchMock)

    await fetchEventTrades({
      marketIds: ['condition-1'],
      pageParam: 0,
      pageSize: EVENT_ACTIVITY_REFRESH_SIZE,
      cursorTimestamp: 1_786_017_600,
      cursorId: 'fill-9',
      cursorUser: '0xabc',
    })

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]), 'https://example.com')
    expect(requestUrl.pathname).toBe('/api/event-activity')
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      cursorId: 'fill-9',
      cursorTimestamp: '1786017600',
      cursorUser: '0xabc',
      limit: '50',
      market: 'condition-1',
      offset: '0',
      takerOnly: 'true',
    })
  })

  it('rejects a partial cursor before sending a request', async () => {
    const fetchMock = mock()
    stubGlobal('fetch', fetchMock)

    await expect(
      fetchEventTrades({
        marketIds: ['condition-1'],
        pageParam: 0,
        cursorTimestamp: 1_786_017_600,
      }),
    ).rejects.toThrow('cursorTimestamp, cursorId, and cursorUser must be provided together.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards the complete cursor through the event activity proxy', async () => {
    stubGlobal('window', undefined)
    process.env.DATA_URL = 'https://data-api.test'
    const fetchMock = mock().mockResolvedValue(
      new Response(JSON.stringify([]), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    )
    stubGlobal('fetch', fetchMock)

    const response = await getEventActivity(
      new Request(
        'https://example.com/api/event-activity?market=condition-1&cursorTimestamp=1786017600&cursorId=fill-9&cursorUser=0xabc',
      ),
    )

    expect(response.status).toBe(200)
    const dataApiUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(dataApiUrl.origin).toBe('https://data-api.test')
    expect(dataApiUrl.pathname).toBe('/trades')
    expect(dataApiUrl.searchParams.get('cursorTimestamp')).toBe('1786017600')
    expect(dataApiUrl.searchParams.get('cursorId')).toBe('fill-9')
    expect(dataApiUrl.searchParams.get('cursorUser')).toBe('0xabc')
    expect(dataApiUrl.searchParams.get('takerOnly')).toBe('true')
  })

  it('keeps up to 50 markets in one request and only splits the overflow', async () => {
    const fetchMock = mock().mockImplementation(
      async () => new Response(JSON.stringify([]), { headers: { 'content-type': 'application/json' }, status: 200 }),
    )
    stubGlobal('fetch', fetchMock)

    await fetchEventTrades({
      marketIds: Array.from({ length: 50 }, (_, index) => `condition-${index}`),
      pageParam: 0,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockClear()
    await fetchEventTrades({
      marketIds: Array.from({ length: 51 }, (_, index) => `condition-${index}`),
      pageParam: 0,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const marketCounts = fetchMock.mock.calls.map(([input]) => {
      const requestUrl = new URL(String(input), 'https://example.com')
      return requestUrl.searchParams.get('market')?.split(',').length
    })
    expect(marketCounts).toEqual([50, 1])
  })

  it('merges same-second batches using the Data API keyset ordering', async () => {
    process.env.DATA_URL = 'https://data-api.test'
    function activity(id: string, eventId: string, address: string): ActivityOrder {
      return {
        id,
        event_id: eventId,
        user: { id: address, username: address, address, image: '' },
        side: 'buy',
        amount: '0',
        price: '0',
        outcome: { index: 0, text: 'Outcome' },
        market: { title: 'Market', slug: 'market', icon_url: '' },
        total_value: 0,
        created_at: new Date(100_000).toISOString(),
        status: 'completed',
      }
    }
    const fetchMock = mock().mockImplementation(async (input: string | URL | Request) => {
      const requestUrl = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
        'https://example.com',
      )
      const market = requestUrl.searchParams.get('market')
      const activities = market?.split(',').includes('condition-0')
        ? [
            activity('trade-event-2', 'event-2', '0x0000000000000000000000000000000000000001'),
            activity('trade-event-1-a', 'event-1', '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'),
          ]
        : [
            activity('trade-event-10', 'event-10', '0x0000000000000000000000000000000000000002'),
            activity('trade-event-1-b', 'event-1', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
          ]
      return Response.json(activities)
    })
    stubGlobal('fetch', fetchMock)

    const activities = await fetchEventTrades({
      marketIds: ['condition-0', ...Array.from({ length: 49 }, (_, index) => `condition-${index + 1}`), 'condition-50'],
      pageParam: 0,
      pageSize: 50,
    })

    expect(activities.map((activity) => `${activity.event_id}:${activity.user.address.toLowerCase()}`)).toEqual([
      'event-2:0x0000000000000000000000000000000000000001',
      'event-10:0x0000000000000000000000000000000000000002',
      'event-1:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'event-1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ])
  })

  it('forwards start only when explicitly requested', async () => {
    const fetchMock = mock().mockResolvedValue(
      new Response(JSON.stringify([]), { headers: { 'content-type': 'application/json' }, status: 200 }),
    )
    stubGlobal('fetch', fetchMock)

    await fetchEventTrades({ marketIds: ['condition-1'], pageParam: 0, start: 1_786_017_600 })

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]), 'https://example.com')
    expect(requestUrl.searchParams.get('start')).toBe('1786017600')
  })

  it('limits market batch concurrency without changing the logical result', async () => {
    let activeRequests = 0
    let maxActiveRequests = 0
    const fetchMock = mock().mockImplementation(async () => {
      activeRequests += 1
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
      await new Promise((resolve) => setTimeout(resolve, 1))
      activeRequests -= 1
      return new Response(JSON.stringify([]), { headers: { 'content-type': 'application/json' }, status: 200 })
    })
    stubGlobal('fetch', fetchMock)

    await fetchEventTrades({
      marketIds: Array.from({ length: 251 }, (_, index) => `condition-${index}`),
      pageParam: 0,
    })

    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(maxActiveRequests).toBe(4)
  })

  it.each(['cursorId', 'cursorUser'])('rejects a whitespace-only %s in the event activity proxy', async (field) => {
    process.env.DATA_URL = 'https://data-api.test'
    const fetchMock = mock()
    stubGlobal('fetch', fetchMock)

    const params = new URLSearchParams({ market: 'condition-1', [field]: '   ' })
    const response = await getEventActivity(new Request(`https://example.com/api/event-activity?${params}`))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'cursorTimestamp, cursorId, and cursorUser must be provided together.',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
