import { describe, expect, it } from 'bun:test'

import type { Event, EventSeriesEntry, HomeFeaturedContextItem, HomeFeaturedRolloverEvent } from '@/types'

import {
  applyHomeFeaturedRolloverResponse,
  findNextHomeFeaturedSeriesEvent,
  isHomeFeaturedEventEnded,
  replaceHomeFeaturedRolloverSuccessor,
  resolveHomeFeaturedEventEndTimestamp,
  resolveHomeFeaturedRolloverContextItems,
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
