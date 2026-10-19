import { beforeEach, describe, expect, it, mock } from 'bun:test'
import * as nextServer from 'next/server'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  resolveLiveSeriesEventSlug: mock(),
}))

void mock.module('next/server', () => ({
  ...nextServer,
  connection: async () => {},
}))

void mock.module('@/lib/db/queries/home-featured-events', () => ({
  HomeFeaturedEventsRepository: {
    resolveLiveSeriesEventSlug: (...args: unknown[]) => mocks.resolveLiveSeriesEventSlug(...args),
  },
}))

describe('home featured live link', () => {
  beforeEach(() => mocks.resolveLiveSeriesEventSlug.mockReset())

  it('redirects a stale featured card to the live event and keeps the selected outcome and locale', async () => {
    mocks.resolveLiveSeriesEventSlug.mockResolvedValue({ data: 'btc-live', error: null })
    const { GET } = await import('@/app/api/home-featured/live-link/route')

    const response = await GET(
      new Request('https://example.com/api/home-featured/live-link?seriesSlug=btc-15m&locale=pt&outcomeIndex=1'),
    )

    expect(mocks.resolveLiveSeriesEventSlug).toHaveBeenCalledWith('btc-15m')
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://example.com/pt/event/btc-live?outcomeIndex=1')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('sends the click to predictions when no series event is open', async () => {
    mocks.resolveLiveSeriesEventSlug.mockResolvedValue({ data: null, error: null })
    const { GET } = await import('@/app/api/home-featured/live-link/route')

    const response = await GET(new Request('https://example.com/api/home-featured/live-link?seriesSlug=btc-15m'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://example.com/predictions')
  })
})
