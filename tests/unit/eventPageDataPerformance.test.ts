import { beforeEach, describe, expect, it, mock } from 'bun:test'

import type { Event, EventSeriesEntry } from '@/types'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  cacheLife: mock(),
  cacheTag: mock(),
  route: mock(),
  event: mock(),
  series: mock(),
  chart: mock(),
  settings: mock(),
  sportsGroup: mock(),
}))

void mock.module('next/cache', () => ({ cacheLife: mocks.cacheLife, cacheTag: mocks.cacheTag }))
void mock.module('@/lib/db/queries/event', () => ({
  EventRepository: {
    getEventRouteBySlug: mocks.route,
    getEventBySlug: mocks.event,
    getSeriesEventsBySeriesSlug: mocks.series,
    getLiveChartConfigBySeriesSlug: mocks.chart,
  },
}))
void mock.module('@/lib/ai/market-context-config', () => ({ loadMarketContextSettings: mocks.settings }))
void mock.module('@/lib/sports-event-group', () => ({ resolveSportsEventGroupPayload: mocks.sportsGroup }))
void mock.module('@/lib/theme-settings', () => ({ loadRuntimeThemeState: mock() }))

const { loadEventPagePublicContentData } = await import('@/lib/event-page-data')

const event = {
  id: 'btc-current',
  slug: 'bitcoin-current',
  title: 'Bitcoin up or down',
  series_slug: 'btc-5m',
  status: 'active',
  end_date: '2026-11-15T16:00:00Z',
  created_at: '2026-11-15T15:55:00Z',
  markets: [],
  tags: [],
} as unknown as Event

describe('event page first-load data', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => fn.mockReset())
    mocks.route.mockResolvedValue({ data: { slug: event.slug, series_slug: event.series_slug }, error: null })
    mocks.event.mockResolvedValue({ data: event, error: null })
    mocks.series.mockResolvedValue({ data: [], error: null })
    mocks.chart.mockResolvedValue({ data: null, error: null })
    mocks.settings.mockResolvedValue({ enabled: true, apiKey: 'configured' })
    mocks.sportsGroup.mockImplementation(async (sourceEvent: Event) => sourceEvent)
  })

  it('starts series and chart queries while the first event price hydration is pending', async () => {
    const pendingEvent = Promise.withResolvers<{ data: Event; error: null }>()
    mocks.event.mockReturnValue(pendingEvent.promise)
    const pending = loadEventPagePublicContentData(event.slug, 'en')
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(mocks.series).toHaveBeenCalledWith('btc-5m')
      expect(mocks.chart).toHaveBeenCalledWith('btc-5m')
    } finally {
      pendingEvent.resolve({ data: event, error: null })
    }

    const result = await pending
    expect(result?.event).toBe(event)
    expect(result?.seriesEvents.some((entry) => entry.slug === event.slug)).toBe(true)
    expect(result?.marketContextEnabled).toBe(true)
  })

  it('retries series loading from the actual event when lightweight route lookup fails', async () => {
    mocks.route.mockResolvedValue({ data: null, error: 'Temporary route lookup failure' })
    const config = { series_slug: 'btc-5m', enabled: true }
    mocks.chart.mockResolvedValue({ data: config, error: null })

    const result = await loadEventPagePublicContentData(event.slug, 'en')

    expect(mocks.series).toHaveBeenCalledTimes(1)
    expect(mocks.series).toHaveBeenCalledWith('btc-5m')
    expect(result?.liveChartConfig).toEqual(config)
    expect(result?.seriesEvents[0]?.slug).toBe(event.slug)
  })

  it('uses the grouped event series when it differs from the initial route', async () => {
    mocks.sportsGroup.mockResolvedValue({ ...event, series_slug: 'group-series' })
    mocks.chart.mockImplementation(async (seriesSlug: string) => ({ data: { series_slug: seriesSlug }, error: null }))

    const result = await loadEventPagePublicContentData(event.slug, 'en')

    expect(mocks.series).toHaveBeenCalledWith('btc-5m')
    expect(mocks.series).toHaveBeenCalledWith('group-series')
    expect(result?.liveChartConfig).toEqual({ series_slug: 'group-series' })
    expect(mocks.cacheTag).toHaveBeenCalledWith('series-events:group-series')
  })

  it('keeps the current event while trimming large resolved history from initial HTML', async () => {
    const history: EventSeriesEntry[] = Array.from({ length: 2_880 }, (_, index) => ({
      id: `past-${index}`,
      slug: `past-${index}`,
      status: 'resolved',
      end_date: new Date(Date.parse(event.end_date!) - (index + 1) * 300_000).toISOString(),
      resolved_at: null,
      created_at: event.created_at,
      resolved_direction: index % 2 === 0 ? 'up' : 'down',
    }))
    mocks.series.mockResolvedValue({ data: history, error: null })

    const result = await loadEventPagePublicContentData(event.slug, 'en')

    expect(result?.seriesEvents.length).toBeLessThanOrEqual(11)
    expect(result?.seriesEvents.some((entry) => entry.slug === event.slug)).toBe(true)
    expect(history).toHaveLength(2_880)
  })

  it.each(['series', 'chart'] as const)(
    'rejects a transient %s failure so enclosing caches cannot store a degraded page',
    async (query) => {
      mocks[query].mockResolvedValueOnce({ data: null, error: 'Database temporarily unavailable' })

      await expect(loadEventPagePublicContentData(event.slug, 'en')).rejects.toThrow('Failed to load event')

      const config = { series_slug: 'btc-5m', enabled: true }
      mocks.chart.mockResolvedValue({ data: config, error: null })
      const result = await loadEventPagePublicContentData(event.slug, 'en')
      expect(result?.liveChartConfig).toEqual(config)
      expect(result?.seriesEvents.some((entry) => entry.slug === event.slug)).toBe(true)
    },
  )
})
