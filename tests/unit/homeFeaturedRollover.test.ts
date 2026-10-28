import { describe, expect, it } from 'bun:test'

import type { Event, EventSeriesEntry, HomeFeaturedContextItem, HomeFeaturedRolloverEvent } from '@/types'

import {
  applyHomeFeaturedRolloverResponse,
  canActivateHomeFeaturedSuccessor,
  findNextHomeFeaturedSeriesEvent,
  isHomeFeaturedEventHref,
  isHomeFeaturedEventEnded,
  isHomeFeaturedEventCurrent,
  replaceHomeFeaturedRolloverSuccessor,
  resolveHomeFeaturedEventEndTimestamp,
  resolveHomeFeaturedLiveLinkFallbackHref,
  resolveHomeFeaturedRolloverContextItems,
  resolveHomeFeaturedRolloverAction,
  resolveHomeFeaturedRolloverWakeTimestamp,
  resolveHomeFeaturedSuccessorHref,
  shouldPreloadHomeFeaturedRollover,
} from '@/lib/home-featured-rollover'

function createEvent(): Event {
  return {
    id: 'current',
    slug: 'current-event',
    end_date: '2026-08-13T16:00:00.000Z',
    markets: [{ end_time: '2026-08-13T16:05:00.000Z' }],
  } as Event
}

function createSeriesEvent(id: string, endDate: string, status: Event['status'] = 'active'): EventSeriesEntry {
  return {
    id,
    slug: `${id}-event`,
    status,
    end_date: endDate,
    resolved_at: null,
    created_at: '2026-08-13T00:00:00.000Z',
    resolved_direction: null,
  }
}

describe('homeFeaturedRollover', () => {
  it('uses the latest market cutoff as the exact rollover time', () => {
    expect(resolveHomeFeaturedEventEndTimestamp(createEvent())).toBe(Date.parse('2026-08-13T16:05:00.000Z'))
  })

  it('allows rollover as soon as the current event is resolved', () => {
    expect(
      isHomeFeaturedEventEnded(
        createEventWithOverrides({ status: 'resolved', resolved_at: '2026-08-13T16:01:00.000Z' }),
        Date.parse('2026-08-13T16:02:00.000Z'),
      ),
    ).toBe(true)
  })

  it('treats an active event as ended after its latest market cutoff', () => {
    expect(isHomeFeaturedEventEnded(createEvent(), Date.parse('2026-08-13T16:05:00.000Z'))).toBe(true)
    expect(isHomeFeaturedEventEnded(createEvent(), Date.parse('2026-08-13T16:04:59.000Z'))).toBe(false)
  })

  it('rolls over at the countdown cutoff, not an earlier event or market cutoff', () => {
    const next = createEventWithOverrides({
      id: 'next',
      slug: 'next-event',
      start_date: '2026-08-13T16:05:00.000Z',
      end_date: '2026-08-13T16:10:00.000Z',
      markets: [{ end_time: '2026-08-13T16:10:00.000Z' }] as Event['markets'],
    })
    expect(canActivateHomeFeaturedSuccessor(createEvent(), next, Date.parse('2026-08-13T16:04:59.000Z'))).toBe(false)
    expect(canActivateHomeFeaturedSuccessor(createEvent(), next, Date.parse('2026-08-13T16:05:00.000Z'))).toBe(true)
  })

  it('keeps a future successor inactive during a gap between periods', () => {
    const future = createEventWithOverrides({
      id: 'tomorrow',
      start_date: '2026-08-14T13:30:00.000Z',
      end_date: '2026-08-14T20:00:00.000Z',
      markets: [{ end_time: '2026-08-14T20:00:00.000Z' }] as Event['markets'],
    })
    expect(isHomeFeaturedEventCurrent(future, Date.parse('2026-08-13T21:00:00.000Z'))).toBe(false)
    expect(canActivateHomeFeaturedSuccessor(createEvent(), future, Date.parse('2026-08-13T21:00:00.000Z'))).toBe(false)
    expect(resolveHomeFeaturedRolloverAction(createEvent(), future, Date.parse('2026-08-13T21:00:00.000Z'))).toBe(
      'wait',
    )
    expect(canActivateHomeFeaturedSuccessor(createEvent(), future, Date.parse('2026-08-14T13:30:00.000Z'))).toBe(true)
    expect(
      resolveHomeFeaturedRolloverWakeTimestamp(createEvent(), future, Date.parse('2026-08-13T16:04:00.000Z')),
    ).toBe(Date.parse('2026-08-13T16:05:00.000Z'))
    expect(
      resolveHomeFeaturedRolloverWakeTimestamp(createEvent(), future, Date.parse('2026-08-13T21:00:00.000Z')),
    ).toBe(Date.parse('2026-08-14T13:30:00.000Z'))
  })

  it('wakes at the successor start if the current event resolved before its scheduled end', () => {
    const current = createEventWithOverrides({ status: 'resolved', resolved_at: '2026-08-13T16:01:00.000Z' })
    const next = createEventWithOverrides({
      id: 'next',
      start_date: '2026-08-13T16:02:00.000Z',
      end_date: '2026-08-13T16:10:00.000Z',
      markets: [{ end_time: '2026-08-13T16:10:00.000Z' }] as Event['markets'],
    })
    expect(resolveHomeFeaturedRolloverWakeTimestamp(current, next, Date.parse('2026-08-13T16:01:30.000Z'))).toBe(
      Date.parse('2026-08-13T16:02:00.000Z'),
    )
  })

  it('pauses preload while hidden and reevaluates missing or expired successors on resume', () => {
    const beforeEnd = Date.parse('2026-08-13T16:04:00.000Z')
    const afterEnd = Date.parse('2026-08-13T16:06:00.000Z')
    const successor = createEventWithOverrides({
      id: 'next',
      end_date: '2026-08-13T16:05:00.000Z',
      markets: [{ end_time: '2026-08-13T16:05:00.000Z' }] as Event['markets'],
    })
    expect(shouldPreloadHomeFeaturedRollover(true, false, null, beforeEnd)).toBe(false)
    expect(shouldPreloadHomeFeaturedRollover(true, true, null, beforeEnd)).toBe(true)
    expect(shouldPreloadHomeFeaturedRollover(true, false, successor, afterEnd)).toBe(false)
    expect(shouldPreloadHomeFeaturedRollover(true, true, successor, beforeEnd)).toBe(false)
    expect(shouldPreloadHomeFeaturedRollover(true, true, successor, afterEnd)).toBe(true)
    expect(shouldPreloadHomeFeaturedRollover(false, true, null, afterEnd)).toBe(false)
  })

  it('selects the nearest active event after the current market', () => {
    const next = findNextHomeFeaturedSeriesEvent(
      [
        createSeriesEvent('later', '2026-08-13T16:15:00.000Z'),
        createSeriesEvent('resolved', '2026-08-13T16:06:00.000Z', 'resolved'),
        createSeriesEvent('next', '2026-08-13T16:10:00.000Z'),
      ],
      createEvent(),
    )

    expect(next?.id).toBe('next')
  })

  it('skips already expired successors when catching a stale featured card up to live', () => {
    const next = findNextHomeFeaturedSeriesEvent(
      [
        createSeriesEvent('expired-next', '2026-08-13T16:10:00.000Z'),
        createSeriesEvent('live-next', '2026-08-13T16:15:00.000Z'),
      ],
      createEvent(),
      Date.parse('2026-08-13T16:11:00.000Z'),
    )

    expect(next?.id).toBe('live-next')
  })

  it('finds no successor if none has been published', () => {
    expect(findNextHomeFeaturedSeriesEvent([], createEvent(), Date.parse('2026-08-13T16:05:00.000Z'))).toBeNull()
    expect(resolveHomeFeaturedRolloverAction(createEvent(), null, Date.parse('2026-08-13T16:05:00.000Z'))).toBe(
      'refresh',
    )
  })

  it('refreshes an expired successor after returning from a suspended tab', () => {
    const expired = createEventWithOverrides({
      id: 'expired',
      end_date: '2026-08-13T16:10:00.000Z',
      markets: [{ end_time: '2026-08-13T16:10:00.000Z' }] as Event['markets'],
    })
    expect(resolveHomeFeaturedRolloverAction(createEvent(), expired, Date.parse('2026-08-13T16:16:00.000Z'))).toBe(
      'refresh',
    )
  })

  it('keeps the outcome and locale when a boundary click uses the prepared successor', () => {
    const current = createEventWithOverrides({
      markets: [
        { slug: 'current-market', condition_id: 'old', title: 'Up or Down', is_active: true, is_resolved: false },
      ] as Event['markets'],
    })
    const next = createEventWithOverrides({
      id: 'next',
      slug: 'next-event',
      markets: [
        { slug: 'next-market', condition_id: 'new', title: 'Up or Down', is_active: true, is_resolved: false },
      ] as Event['markets'],
    })
    expect(
      resolveHomeFeaturedSuccessorHref(current, next, '/pt/event/current-event/current-market?outcomeIndex=1'),
    ).toBe('/pt/event/next-event/next-market?outcomeIndex=1')
    expect(resolveHomeFeaturedSuccessorHref(current, next, '/event/current-event')).toBe('/event/next-event')
    expect(resolveHomeFeaturedSuccessorHref(current, next, '/event/historical-event')).toBeNull()
    expect(isHomeFeaturedEventHref(current, '/event/current-event/current-market?outcomeIndex=1')).toBe(true)
    expect(isHomeFeaturedEventHref(current, '/event/current-event-copy')).toBe(false)

    const multiMarketNext = createEventWithOverrides({
      id: 'next',
      slug: 'next-event',
      markets: [
        { slug: 'other', condition_id: 'other', title: 'Other', is_active: true, is_resolved: false },
        { slug: 'next-market', condition_id: 'new', title: 'Up or Down', is_active: true, is_resolved: false },
      ] as Event['markets'],
    })
    expect(
      resolveHomeFeaturedSuccessorHref(current, multiMarketNext, '/event/current-event?conditionId=old&outcomeIndex=1'),
    ).toBe('/event/next-event/next-market?outcomeIndex=1')
  })

  it('routes a boundary click through live-link when the successor is still loading', () => {
    const current = createEvent()
    const fallback = resolveHomeFeaturedLiveLinkFallbackHref(
      current,
      '/pt/event/current-event/up-down?conditionId=old&outcomeIndex=1',
      'btc-15m',
      'pt',
    )
    expect(fallback).not.toBeNull()
    const query = new URL(fallback!, 'https://example.com').searchParams
    expect(query.get('seriesSlug')).toBe('btc-15m')
    expect(query.get('locale')).toBe('pt')
    expect(query.get('marketSlug')).toBe('up-down')
    expect(query.get('conditionId')).toBe('old')
    expect(query.get('outcomeIndex')).toBe('1')
    expect(resolveHomeFeaturedLiveLinkFallbackHref(current, '/event/historical-event', 'btc-15m', 'en')).toBeNull()
  })

  it('replaces the stale successor before the first rollover', () => {
    const stale = createRolloverEvent('stale')
    const next = createRolloverEvent('next')

    expect(replaceHomeFeaturedRolloverSuccessor([stale], -1, next)).toEqual([next])
  })

  it('clears the successor when the server no longer returns one', () => {
    expect(replaceHomeFeaturedRolloverSuccessor([createRolloverEvent('stale')], -1, null)).toEqual([])
  })

  it('preserves the promoted event and replaces all future entries after rollover', () => {
    const active = createRolloverEvent('active')
    const stale = createRolloverEvent('stale')
    const next = createRolloverEvent('next')
    const result = replaceHomeFeaturedRolloverSuccessor([active, stale, next], 0, next)

    expect(result).toEqual([active, next])
    expect(result[0]).toBe(active)
  })

  it('preserves the promoted event when the successor is removed after rollover', () => {
    const active = createRolloverEvent('active')

    expect(replaceHomeFeaturedRolloverSuccessor([active, createRolloverEvent('stale')], 0, null)).toEqual([active])
  })

  it('uses the refreshed successor data when the event is unchanged', () => {
    const stale = createRolloverEvent('next')
    const next = { ...stale, event: { ...stale.event, title: 'Updated event' } }

    expect(replaceHomeFeaturedRolloverSuccessor([stale], -1, next)[0]).toBe(next)
  })

  it('reconciles a refresh after its stale successor has already been promoted', () => {
    const stale = createRolloverEvent('next')
    const refreshed = { ...stale, contextItems: [{ id: 'fresh-news' }] } as HomeFeaturedRolloverEvent
    const result = applyHomeFeaturedRolloverResponse(
      { activeIndex: 0, events: [stale], contextItems: [], sourceContextItems: [] },
      'previous',
      [],
      { currentEventId: 'previous', nextEvent: refreshed },
    )

    expect(result.events[0]).toBe(refreshed)
    expect(result.contextItems[0]?.id).toBe('fresh-news')
  })

  it('ignores an unrelated delayed rollover response', () => {
    const active = createRolloverEvent('active')
    const current = { activeIndex: 0, events: [active], contextItems: [], sourceContextItems: [] }

    expect(
      applyHomeFeaturedRolloverResponse(current, 'initial', [], {
        currentEventId: 'old',
        nextEvent: createRolloverEvent('different'),
      }),
    ).toBe(current)
  })

  it('uses refreshed props for the current event and queued context after rollover', () => {
    const original: HomeFeaturedContextItem[] = []
    const refreshed: HomeFeaturedContextItem[] = []
    const queued: HomeFeaturedContextItem[] = []
    const queue = { activeIndex: -1, events: [], contextItems: queued, sourceContextItems: original }

    expect(resolveHomeFeaturedRolloverContextItems(queue, refreshed)).toBe(refreshed)
    expect(resolveHomeFeaturedRolloverContextItems({ ...queue, activeIndex: 0 }, refreshed)).toBe(queued)
  })
})

function createRolloverEvent(id: string): HomeFeaturedRolloverEvent {
  return { event: { ...createEvent(), id }, contextItems: [] } as unknown as HomeFeaturedRolloverEvent
}

function createEventWithOverrides(overrides: Partial<Event>): Event {
  return { ...createEvent(), ...overrides }
}
