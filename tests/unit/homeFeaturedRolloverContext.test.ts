import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import type { Event } from '@/types'

import { hoisted, stubGlobal, unstubAllGlobals } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  getSettings: mock(),
  getEventBySlug: mock(),
  getSeriesEventsBySeriesSlug: mock(),
  resolvePublicTargets: mock(),
  loadHomeFeaturedNews: mock(),
  fetchComments: mock(),
}))

void mock.module('next/cache', () => ({ cacheLife: mock(), cacheTag: mock(), revalidateTag: mock() }))
void mock.module('@/lib/db/queries/settings', () => ({ SettingsRepository: { getSettings: mocks.getSettings } }))
void mock.module('@/lib/db/queries/event', () => ({
  EventRepository: {
    getEventBySlug: mocks.getEventBySlug,
    getSeriesEventsBySeriesSlug: mocks.getSeriesEventsBySeriesSlug,
  },
}))
void mock.module('@/lib/db/queries/home-featured-events', () => ({
  HomeFeaturedEventsRepository: { resolvePublicTargets: mocks.resolvePublicTargets },
}))
void mock.module('@/lib/home-featured-news', () => ({ loadHomeFeaturedNews: mocks.loadHomeFeaturedNews }))

const currentEvent = {
  id: 'current',
  slug: 'current-event',
  title: 'Current event',
  series_slug: 'daily-market',
  status: 'active',
  markets: [],
  tags: [],
  end_date: '2099-01-01T00:00:00Z',
} as unknown as Event
const nextEvent = {
  ...currentEvent,
  id: 'next',
  slug: 'next-event',
  title: 'Next event',
  end_date: '2099-01-02T00:00:00Z',
}
const target = {
  featuredId: 'featured',
  targetType: 'series',
  contextMode: 'news',
  eventId: currentEvent.id,
  seriesSlug: currentEvent.series_slug,
}

describe('featured series rollover context', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => fn.mockReset())
    stubGlobal('fetch', mocks.fetchComments)
    mocks.fetchComments.mockImplementation(async () =>
      Response.json([{ id: 'available-comment', content: 'A community comment', username: 'reader' }]),
    )
    mocks.getSettings.mockResolvedValue({
      data: { home_featured: { enabled: { value: 'true', updated_at: '' } } },
      error: null,
    })
    mocks.resolvePublicTargets.mockResolvedValue({ data: [target], error: null })
    mocks.getEventBySlug.mockImplementation(async (slug: string) => ({
      data: slug === currentEvent.slug ? currentEvent : nextEvent,
      error: null,
    }))
    mocks.getSeriesEventsBySeriesSlug.mockResolvedValue({ data: [currentEvent, nextEvent], error: null })
    mocks.loadHomeFeaturedNews.mockImplementation(async (_featuredId: string, event: Event) => [
      { id: `news:${event.id}`, type: 'news', title: `News for ${event.title}` },
    ])
  })

  afterEach(() => {
    unstubAllGlobals()
  })

  it('prepares news for the next event and keeps the current event news separate', async () => {
    const { getNextHomeFeaturedSeriesRolloverEvent } = await import('@/lib/home-featured-events')
    const result = await getNextHomeFeaturedSeriesRolloverEvent(currentEvent.slug, 'featured', 'en')

    expect(result?.currentEventId).toBe(currentEvent.id)
    expect(result?.contextItems[0]?.id).toBe('news:current')
    expect(result?.nextEvent?.event.id).toBe(nextEvent.id)
    expect(result?.nextEvent?.contextItems[0]?.id).toBe('news:next')
  })

  it('refreshes the current event even when a successor is not available yet', async () => {
    mocks.getSeriesEventsBySeriesSlug.mockResolvedValue({ data: [currentEvent], error: null })
    const { getNextHomeFeaturedSeriesRolloverEvent } = await import('@/lib/home-featured-events')
    const result = await getNextHomeFeaturedSeriesRolloverEvent(currentEvent.slug, 'featured', 'en')

    expect(result?.nextEvent).toBeNull()
    expect(result?.contextItems[0]?.id).toBe('news:current')
  })

  it('respects hidden context without searching for news', async () => {
    mocks.resolvePublicTargets.mockResolvedValue({ data: [{ ...target, contextMode: 'hidden' }], error: null })
    const { getNextHomeFeaturedSeriesRolloverEvent } = await import('@/lib/home-featured-events')
    const result = await getNextHomeFeaturedSeriesRolloverEvent(currentEvent.slug, 'featured', 'en')

    expect(result?.contextItems).toEqual([])
    expect(result?.nextEvent?.contextItems).toEqual([])
    expect(mocks.loadHomeFeaturedNews).not.toHaveBeenCalled()
  })

  it('keeps explicit news context empty without fetching available comments when no news is found', async () => {
    mocks.loadHomeFeaturedNews.mockResolvedValue([])
    const { getNextHomeFeaturedSeriesRolloverEvent } = await import('@/lib/home-featured-events')
    const result = await getNextHomeFeaturedSeriesRolloverEvent(currentEvent.slug, 'featured', 'en')

    expect(result?.contextItems).toEqual([])
    expect(result?.nextEvent?.contextItems).toEqual([])
    expect(mocks.loadHomeFeaturedNews).toHaveBeenCalledTimes(2)
    expect(mocks.fetchComments).not.toHaveBeenCalled()
  })

  it('falls back to available comments in automatic mode when no news is found', async () => {
    mocks.resolvePublicTargets.mockResolvedValue({ data: [{ ...target, contextMode: 'auto' }], error: null })
    mocks.loadHomeFeaturedNews.mockResolvedValue([])
    const { getNextHomeFeaturedSeriesRolloverEvent } = await import('@/lib/home-featured-events')
    const result = await getNextHomeFeaturedSeriesRolloverEvent(currentEvent.slug, 'featured', 'en')

    expect(result?.contextItems).toEqual([
      expect.objectContaining({ id: 'comment:available-comment', type: 'comment' }),
    ])
    expect(result?.nextEvent?.contextItems).toEqual([
      expect.objectContaining({ id: 'comment:available-comment', type: 'comment' }),
    ])
    expect(mocks.loadHomeFeaturedNews).toHaveBeenCalledTimes(2)
    expect(mocks.fetchComments).toHaveBeenCalledTimes(2)
  })

  it('does not search for an event outside the configured featured series', async () => {
    mocks.getEventBySlug.mockResolvedValue({ data: { ...currentEvent, series_slug: 'other-series' }, error: null })
    const { getNextHomeFeaturedSeriesRolloverEvent } = await import('@/lib/home-featured-events')

    expect(await getNextHomeFeaturedSeriesRolloverEvent(currentEvent.slug, 'featured', 'en')).toBeNull()
    expect(mocks.loadHomeFeaturedNews).not.toHaveBeenCalled()
  })

  it('recovers a just-ended predecessor after the configured target has advanced', async () => {
    const endedEvent = { ...currentEvent, end_date: new Date(Date.now() - 30_000).toISOString() }
    mocks.resolvePublicTargets.mockResolvedValue({ data: [{ ...target, eventId: nextEvent.id }], error: null })
    mocks.getEventBySlug.mockImplementation(async (slug: string) => ({
      data: slug === currentEvent.slug ? endedEvent : nextEvent,
      error: null,
    }))
    mocks.getSeriesEventsBySeriesSlug.mockResolvedValue({ data: [endedEvent, nextEvent], error: null })
    const { getNextHomeFeaturedSeriesRolloverEvent } = await import('@/lib/home-featured-events')
    const result = await getNextHomeFeaturedSeriesRolloverEvent(currentEvent.slug, 'featured', 'en')

    expect(result?.currentEventId).toBe(currentEvent.id)
    expect(result?.nextEvent?.event.id).toBe(nextEvent.id)
    expect(result?.nextEvent?.contextItems[0]?.id).toBe('news:next')
    expect(mocks.loadHomeFeaturedNews).toHaveBeenCalledTimes(1)
    expect(mocks.loadHomeFeaturedNews.mock.calls[0]?.[1].id).toBe(nextEvent.id)
  })

  it.each([{ status: 'resolved' }, { status: 'archived' }, { resolved_at: new Date().toISOString() }])(
    'recovers an early-ended predecessor with %j before its scheduled end',
    async (endedFields) => {
      const endedEvent = { ...currentEvent, ...endedFields }
      mocks.resolvePublicTargets.mockResolvedValue({ data: [{ ...target, eventId: nextEvent.id }], error: null })
      mocks.getEventBySlug.mockImplementation(async (slug: string) => ({
        data: slug === currentEvent.slug ? endedEvent : nextEvent,
        error: null,
      }))
      mocks.getSeriesEventsBySeriesSlug.mockResolvedValue({ data: [endedEvent, nextEvent], error: null })
      const { getNextHomeFeaturedSeriesRolloverEvent } = await import('@/lib/home-featured-events')
      const result = await getNextHomeFeaturedSeriesRolloverEvent(currentEvent.slug, 'featured', 'en')

      expect(result?.currentEventId).toBe(currentEvent.id)
      expect(result?.nextEvent?.event.id).toBe(nextEvent.id)
      expect(mocks.loadHomeFeaturedNews).toHaveBeenCalledTimes(1)
      expect(mocks.loadHomeFeaturedNews.mock.calls[0]?.[1].id).toBe(nextEvent.id)
    },
  )

  it('keeps current news until the latest market cutoff even if the event date has passed', async () => {
    const overlappingEvent = {
      ...currentEvent,
      end_date: new Date(Date.now() - 30_000).toISOString(),
      markets: [{ end_time: new Date(Date.now() + 60_000).toISOString() }],
    }
    mocks.getEventBySlug.mockImplementation(async (slug: string) => ({
      data: slug === currentEvent.slug ? overlappingEvent : nextEvent,
      error: null,
    }))
    mocks.getSeriesEventsBySeriesSlug.mockResolvedValue({ data: [overlappingEvent, nextEvent], error: null })
    const { getNextHomeFeaturedSeriesRolloverEvent } = await import('@/lib/home-featured-events')
    const result = await getNextHomeFeaturedSeriesRolloverEvent(currentEvent.slug, 'featured', 'en')

    expect(result?.contextItems[0]?.id).toBe('news:current')
    expect(result?.nextEvent?.contextItems[0]?.id).toBe('news:next')
  })

  it('recovers the immediate predecessor after a longer interruption while its successor is live', async () => {
    const endedEvent = { ...currentEvent, end_date: new Date(Date.now() - 10 * 60_000).toISOString() }
    mocks.resolvePublicTargets.mockResolvedValue({ data: [{ ...target, eventId: nextEvent.id }], error: null })
    mocks.getEventBySlug.mockImplementation(async (slug: string) => ({
      data: slug === currentEvent.slug ? endedEvent : nextEvent,
      error: null,
    }))
    mocks.getSeriesEventsBySeriesSlug.mockResolvedValue({ data: [endedEvent, nextEvent], error: null })
    const { getNextHomeFeaturedSeriesRolloverEvent } = await import('@/lib/home-featured-events')

    const result = await getNextHomeFeaturedSeriesRolloverEvent(currentEvent.slug, 'featured', 'en')

    expect(result?.currentEventId).toBe(currentEvent.id)
    expect(result?.nextEvent?.event.id).toBe(nextEvent.id)
    expect(mocks.loadHomeFeaturedNews).toHaveBeenCalledTimes(1)
    expect(mocks.loadHomeFeaturedNews.mock.calls[0]?.[1].id).toBe(nextEvent.id)
  })

  it('does not search for an older predecessor when a more recent event has ended', async () => {
    const endedEvent = { ...currentEvent, end_date: new Date(Date.now() - 60_000).toISOString() }
    const newerEndedEvent = {
      ...endedEvent,
      id: 'newer-ended',
      slug: 'newer-ended-event',
      end_date: new Date(Date.now() - 30_000).toISOString(),
    }
    mocks.resolvePublicTargets.mockResolvedValue({ data: [{ ...target, eventId: nextEvent.id }], error: null })
    mocks.getEventBySlug.mockResolvedValue({ data: endedEvent, error: null })
    mocks.getSeriesEventsBySeriesSlug.mockResolvedValue({
      data: [endedEvent, newerEndedEvent, nextEvent],
      error: null,
    })
    const { getNextHomeFeaturedSeriesRolloverEvent } = await import('@/lib/home-featured-events')

    expect(await getNextHomeFeaturedSeriesRolloverEvent(currentEvent.slug, 'featured', 'en')).toBeNull()
    expect(mocks.loadHomeFeaturedNews).not.toHaveBeenCalled()
  })

  it('does not search for an unconfigured ended event without an active successor', async () => {
    const endedEvent = { ...currentEvent, end_date: new Date(Date.now() - 10 * 60_000).toISOString() }
    mocks.resolvePublicTargets.mockResolvedValue({ data: [{ ...target, eventId: nextEvent.id }], error: null })
    mocks.getEventBySlug.mockResolvedValue({ data: endedEvent, error: null })
    mocks.getSeriesEventsBySeriesSlug.mockResolvedValue({ data: [endedEvent], error: null })
    const { getNextHomeFeaturedSeriesRolloverEvent } = await import('@/lib/home-featured-events')

    expect(await getNextHomeFeaturedSeriesRolloverEvent(currentEvent.slug, 'featured', 'en')).toBeNull()
    expect(mocks.loadHomeFeaturedNews).not.toHaveBeenCalled()
  })

  it('does not search for a future event beyond the current live series entry', async () => {
    const futureEvent = { ...nextEvent, id: 'future', slug: 'future-event', end_date: '2099-01-03T00:00:00Z' }
    mocks.getEventBySlug.mockResolvedValue({ data: futureEvent, error: null })
    mocks.getSeriesEventsBySeriesSlug.mockResolvedValue({ data: [currentEvent, nextEvent, futureEvent], error: null })
    const { getNextHomeFeaturedSeriesRolloverEvent } = await import('@/lib/home-featured-events')

    expect(await getNextHomeFeaturedSeriesRolloverEvent(futureEvent.slug, 'featured', 'en')).toBeNull()
    expect(mocks.loadHomeFeaturedNews).not.toHaveBeenCalled()
  })
})
