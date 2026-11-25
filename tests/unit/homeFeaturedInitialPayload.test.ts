import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import type { Event, EventSeriesEntry, HomeFeaturedContextMode } from '@/types'

import { findNextHomeFeaturedSeriesEvent } from '@/lib/home-featured-rollover'

import { hoisted, stubEnv, stubGlobal, unstubAllEnvs, unstubAllGlobals } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  settings: mock(),
  targets: mock(),
  events: mock(),
  event: mock(),
  series: mock(),
  chart: mock(),
  news: mock(),
  comments: mock(),
}))

void mock.module('next/cache', () => ({ cacheLife: mock(), cacheTag: mock() }))
void mock.module('@/lib/db/queries/settings', () => ({ SettingsRepository: { getSettings: mocks.settings } }))
void mock.module('@/lib/db/queries/event', () => ({
  EventRepository: {
    getEventsBySlugs: mocks.events,
    getEventBySlug: mocks.event,
    getSeriesEventsBySeriesSlug: mocks.series,
    getLiveChartConfigBySeriesSlug: mocks.chart,
  },
}))
void mock.module('@/lib/db/queries/home-featured-events', () => ({
  HomeFeaturedEventsRepository: { resolvePublicTargets: mocks.targets },
}))
void mock.module('@/lib/home-featured-news', () => ({ loadHomeFeaturedNews: mocks.news }))

const { listHomeFeaturedEvents } = await import('@/lib/home-featured-events')

function createEvent(id: string, endDate: string): Event {
  return {
    id,
    slug: `btc-${id}`,
    title: `Bitcoin ${id}`,
    status: 'active',
    series_slug: 'btc-15m',
    series_recurrence: '15m',
    has_live_chart: true,
    end_date: endDate,
    created_at: '2026-11-15T00:00:00Z',
    total_markets_count: 1,
    active_markets_count: 1,
    tags: [],
    markets: [
      {
        condition_id: `${id}-condition`,
        slug: `${id}-market`,
        title: `Bitcoin ${id}`,
        is_active: true,
        is_resolved: false,
        price: 0.42,
        outcomes: [
          { token_id: `${id}-yes`, outcome_index: 0, outcome_text: 'Up', buy_price: 0.42 },
          { token_id: `${id}-no`, outcome_index: 1, outcome_text: 'Down', buy_price: 0.58 },
        ],
      },
    ],
  } as unknown as Event
}

const current = createEvent('current', '2099-01-01T00:15:00Z')
const next = createEvent('next', '2099-01-01T00:30:00Z')
const later = createEvent('later', '2099-01-01T00:45:00Z')
const chartConfig = { series_slug: 'btc-15m', enabled: true, symbol: 'btc/usd' }
const featuredTarget = {
  featuredId: 'featured-bitcoin',
  eventId: current.id,
  eventSlug: current.slug,
  seriesSlug: current.series_slug,
  targetType: 'series',
  contextMode: 'news',
  source: 'manual',
  rank: 0,
}

function seriesEntry(event: Event): EventSeriesEntry {
  return {
    id: event.id,
    slug: event.slug,
    status: event.status,
    end_date: event.end_date,
    created_at: event.created_at,
    resolved_at: null,
    resolved_direction: null,
  }
}

function setContextMode(contextMode: HomeFeaturedContextMode) {
  mocks.targets.mockResolvedValue({ data: [{ ...featuredTarget, contextMode }], error: null })
}

describe('home featured initial payload', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => fn.mockReset())
    stubEnv('COMMUNITY_URL', 'https://community.example')
    stubGlobal('fetch', mocks.comments)
    mocks.settings.mockResolvedValue({
      data: { home_featured: { enabled: { value: 'true', updated_at: '' } } },
      error: null,
    })
    setContextMode('news')
    mocks.events.mockResolvedValue({ data: [current], error: null })
    mocks.event.mockImplementation(async (slug: string) => ({ data: slug === next.slug ? next : null, error: null }))
    mocks.series.mockResolvedValue({ data: [seriesEntry(later), seriesEntry(current), seriesEntry(next)], error: null })
    mocks.chart.mockResolvedValue({ data: chartConfig, error: null })
    mocks.news.mockImplementation(async (_featuredId: string, event: Pick<Event, 'id' | 'title'>) => [
      { id: `news:${event.id}`, type: 'news', title: `News for ${event.title}` },
    ])
    mocks.comments.mockImplementation(async (input: RequestInfo | URL) => {
      const slug = new URL(String(input)).searchParams.get('event_slug')
      return Response.json(
        Array.from({ length: 3 }, (_, index) => ({
          id: `${slug}-${index}`,
          content: `Comment ${index} for ${slug}`,
          username: 'Reader',
        })),
      )
    })
  })

  afterEach(() => {
    unstubAllGlobals()
    unstubAllEnvs()
  })

  it('keeps a bounded preview and the exact prewarmed successor with 3,000 historical rounds', async () => {
    const history: EventSeriesEntry[] = Array.from({ length: 3_000 }, (_, index) => ({
      id: `history-${index}`,
      slug: `btc-historical-${index}`,
      status: 'resolved',
      end_date: new Date(Date.parse(current.end_date!) - (index + 1) * 900_000).toISOString(),
      created_at: current.created_at,
      resolved_at: current.created_at,
      resolved_direction: index % 2 === 0 ? 'up' : 'down',
    }))
    const fullSeries = [seriesEntry(later), ...history, seriesEntry(current), seriesEntry(next)]
    mocks.series.mockResolvedValue({ data: fullSeries, error: null })

    const withHistory = await listHomeFeaturedEvents('en')

    expect(findNextHomeFeaturedSeriesEvent(fullSeries, current)?.slug).toBe(next.slug)
    expect(mocks.event).toHaveBeenCalledWith(next.slug, '', 'en')
    expect(withHistory[0]?.event).toBe(current)
    expect(withHistory[0]?.liveChartConfig).toEqual(chartConfig)
    expect(withHistory[0]?.seriesEvents).toEqual([])
    expect(withHistory[0]?.nextSeriesEvent?.event).toBe(next)
    expect(withHistory[0]?.nextSeriesEvent?.primaryMarkets).toEqual(next.markets)
    expect(withHistory[0]?.contextItems[0]?.id).toBe('news:current')
    expect(withHistory[0]?.nextSeriesEvent?.contextItems[0]?.id).toBe('news:next')
    expect(JSON.stringify(withHistory).length).toBeLessThan(20_000)
    expect(fullSeries).toHaveLength(3_003)

    mocks.series.mockResolvedValue({ data: [seriesEntry(current), seriesEntry(next), seriesEntry(later)], error: null })
    expect(await listHomeFeaturedEvents('en')).toEqual(withHistory)
  })

  it.each(['comments', 'news', 'auto', 'hidden'] as const)(
    'keeps current and next %s context fully prewarmed',
    async (mode) => {
      setContextMode(mode)
      const [card] = await listHomeFeaturedEvents('en')
      expect(card?.nextSeriesEvent?.event).toBe(next)
      if (mode === 'hidden') {
        expect(card?.contextItems).toEqual([])
        expect(card?.nextSeriesEvent?.contextItems).toEqual([])
        expect(mocks.comments).not.toHaveBeenCalled()
        expect(mocks.news).not.toHaveBeenCalled()
      } else if (mode === 'news') {
        expect(card?.contextItems[0]?.id).toBe('news:current')
        expect(card?.nextSeriesEvent?.contextItems[0]?.id).toBe('news:next')
        expect(mocks.comments).not.toHaveBeenCalled()
      } else {
        expect(card?.contextItems[0]?.title).toContain(current.slug)
        expect(card?.nextSeriesEvent?.contextItems[0]?.title).toContain(next.slug)
        expect(card?.contextItems).toHaveLength(3)
        expect(card?.nextSeriesEvent?.contextItems).toHaveLength(3)
        expect(mocks.news).not.toHaveBeenCalled()
      }
    },
  )

  it('loads current context while series discovery is still pending', async () => {
    setContextMode('comments')
    const pendingSeries = Promise.withResolvers<{ data: EventSeriesEntry[]; error: null }>()
    mocks.series.mockReturnValue(pendingSeries.promise)
    const pending = listHomeFeaturedEvents('en')
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(mocks.comments).toHaveBeenCalledTimes(1)
      expect(new URL(String(mocks.comments.mock.calls[0]?.[0])).searchParams.get('event_slug')).toBe(current.slug)
      expect(mocks.event).not.toHaveBeenCalled()
    } finally {
      pendingSeries.resolve({ data: [seriesEntry(current), seriesEntry(next)], error: null })
    }
    const [card] = await pending
    expect(card?.nextSeriesEvent?.contextItems).toHaveLength(3)
  })

  it('still waits for fully prewarmed next context before returning the first cards', async () => {
    const nextContext = Promise.withResolvers<unknown[]>()
    mocks.news.mockImplementation(async (_featuredId: string, event: Pick<Event, 'id'>) =>
      event.id === next.id ? nextContext.promise : [{ id: 'current-news', type: 'news', title: 'Current news' }],
    )
    let finished = false
    const pending = listHomeFeaturedEvents('en').then((cards) => {
      finished = true
      return cards
    })
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(mocks.news).toHaveBeenCalledTimes(2)
      expect(finished).toBe(false)
    } finally {
      nextContext.resolve([{ id: 'next-news', type: 'news', title: 'Next news' }])
    }
    const [card] = await pending
    expect(card?.contextItems[0]?.id).toBe('current-news')
    expect(card?.nextSeriesEvent?.contextItems[0]?.id).toBe('next-news')
  })

  it('keeps non-series manual cards intact without loading series data', async () => {
    mocks.targets.mockResolvedValue({ data: [{ ...featuredTarget, targetType: 'event' }], error: null })
    const [card] = await listHomeFeaturedEvents('en')
    expect(card?.event).toBe(current)
    expect(card?.source).toBe('manual')
    expect(card?.contextItems[0]?.id).toBe('news:current')
    expect(card?.nextSeriesEvent).toBeNull()
    expect(card?.seriesEvents).toEqual([])
    expect(mocks.series).not.toHaveBeenCalled()
    expect(mocks.chart).not.toHaveBeenCalled()
  })
})
