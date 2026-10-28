import { beforeEach, describe, expect, it, mock } from 'bun:test'
import * as nextServer from 'next/server'

import type { Event } from '@/types'

import { resolveHomeFeaturedLiveLinkFallbackHref } from '@/lib/home-featured-rollover'

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
    const fallbackHref = resolveHomeFeaturedLiveLinkFallbackHref(
      { slug: 'old-event' } as Event,
      '/pt/event/old-event/old-market?conditionId=old-condition&outcomeIndex=1',
      'btc-15m',
      'pt',
    )
    expect(fallbackHref).not.toBeNull()

    const response = await GET(new Request(`https://example.com${fallbackHref}`))

    expect(mocks.resolveLiveSeriesDestination).toHaveBeenCalledWith('btc-15m', 'old-market', 'old-condition')
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('/pt/event/btc-live/up-down?outcomeIndex=1')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('sends the click to predictions when no series event is open', async () => {
    mocks.resolveLiveSeriesDestination.mockResolvedValue({ data: null, error: null })
    const { GET } = await import('@/app/api/home-featured/live-link/route')

    const response = await GET(new Request('https://example.com/api/home-featured/live-link?seriesSlug=btc-15m'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('/predictions')
  })

  it('keeps the browser origin when the standalone request uses the Docker bind address', async () => {
    mocks.resolveLiveSeriesDestination.mockResolvedValue({
      data: { eventSlug: 'btc-live', marketSlug: 'up-down', conditionId: 'current-market' },
      error: null,
    })
    const { GET } = await import('@/app/api/home-featured/live-link/route')

    const response = await GET(
      new Request('http://0.0.0.0:3000/api/home-featured/live-link?seriesSlug=btc-15m&locale=pt&outcomeIndex=1', {
        headers: { host: 'markets.example.com', 'x-forwarded-proto': 'https' },
      }),
    )

    const location = response.headers.get('location')
    expect(response.status).toBe(307)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(location).toBe('/pt/event/btc-live/up-down?outcomeIndex=1')
    expect(new URL(location!, 'https://markets.example.com').href).toBe(
      'https://markets.example.com/pt/event/btc-live/up-down?outcomeIndex=1',
    )
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

    expect(response.headers.get('location')).toBe('/event/current-event')
  })
})
