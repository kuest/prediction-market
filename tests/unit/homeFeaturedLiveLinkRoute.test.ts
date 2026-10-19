import { beforeEach, describe, expect, it, mock } from 'bun:test'
import * as nextServer from 'next/server'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  resolveLiveSeriesDestination: mock(),
}))

void mock.module('next/server', () => ({
  ...nextServer,
  connection: async () => {},
}))

void mock.module('@/lib/db/queries/home-featured-events', () => ({
  HomeFeaturedEventsRepository: {
    resolveLiveSeriesDestination: (...args: unknown[]) => mocks.resolveLiveSeriesDestination(...args),
  },
}))

describe('home featured live link', () => {
  beforeEach(() => mocks.resolveLiveSeriesDestination.mockReset())

  it('redirects a stale featured card to the live event and keeps the selected outcome and locale', async () => {
    mocks.resolveLiveSeriesDestination.mockResolvedValue({
      data: { eventSlug: 'btc-live', marketSlug: 'up-down', conditionId: 'current-market' },
      error: null,
    })
    const { GET } = await import('@/app/api/home-featured/live-link/route')

    const response = await GET(
      new Request(
        'https://example.com/api/home-featured/live-link?seriesSlug=btc-15m&locale=pt&outcomeIndex=1&marketSlug=old-market&conditionId=old-condition',
      ),
    )

    expect(mocks.resolveLiveSeriesDestination).toHaveBeenCalledWith('btc-15m', 'old-market', 'old-condition')
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://example.com/pt/event/btc-live/up-down?outcomeIndex=1')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('sends the click to predictions when no series event is open', async () => {
    mocks.resolveLiveSeriesDestination.mockResolvedValue({ data: null, error: null })
    const { GET } = await import('@/app/api/home-featured/live-link/route')

    const response = await GET(new Request('https://example.com/api/home-featured/live-link?seriesSlug=btc-15m'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://example.com/predictions')
  })

  it('does not apply an outcome to a different default market when the selected market cannot be matched', async () => {
    mocks.resolveLiveSeriesDestination.mockResolvedValue({
      data: { eventSlug: 'current-event', marketSlug: null, conditionId: null },
      error: null,
    })
    const { GET } = await import('@/app/api/home-featured/live-link/route')

    const response = await GET(
      new Request('https://example.com/api/home-featured/live-link?seriesSlug=series&outcomeIndex=1&marketSlug=old'),
    )

    expect(response.headers.get('location')).toBe('https://example.com/event/current-event')
  })
})
