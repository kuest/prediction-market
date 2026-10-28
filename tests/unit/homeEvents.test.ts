import { describe, expect, it } from 'bun:test'

import {
  filterHomeEvents,
  isCurrentHomeLiveSeriesEvent,
  isEventResolvedLike,
  resolveHomeLiveSeriesEndTimestamp,
} from '@/lib/home-events'

describe('home-events', () => {
  it('treats active events with unresolved markets as not resolved-like', () => {
    const event = {
      id: 'event-1',
      slug: 'highest-temperature-in-sao-paulo-on-march-24-2026',
      status: 'active',
      created_at: '2026-03-24T00:00:00.000Z',
      updated_at: '2026-03-24T00:00:00.000Z',
      markets: [
        {
          is_resolved: true,
          condition: { resolved: true },
        },
        {
          is_resolved: false,
          condition: { resolved: false },
        },
      ],
      tags: [],
    } as any

    expect(isEventResolvedLike(event)).toBe(false)
  })

  it('keeps only fully resolved events in the resolved home filter', () => {
    const partiallyResolvedEvent = {
      id: 'event-1',
      slug: 'highest-temperature-in-sao-paulo-on-march-24-2026',
      status: 'active',
      created_at: '2026-03-24T00:00:00.000Z',
      updated_at: '2026-03-24T00:00:00.000Z',
      markets: [
        {
          is_resolved: true,
          condition: { resolved: true },
        },
        {
          is_resolved: false,
          condition: { resolved: false },
        },
      ],
      tags: [],
    } as any

    const fullyResolvedEvent = {
      id: 'event-2',
      slug: 'bra-san-vas-2026-02-26',
      status: 'active',
      created_at: '2026-03-24T00:00:00.000Z',
      updated_at: '2026-03-24T00:00:00.000Z',
      markets: [
        {
          is_resolved: true,
          condition: { resolved: true },
        },
        {
          is_resolved: true,
          condition: { resolved: true },
        },
      ],
      tags: [],
    } as any

    const resolvedStatusEvent = {
      id: 'event-3',
      slug: 'resolved-event',
      status: 'resolved',
      created_at: '2026-03-24T00:00:00.000Z',
      updated_at: '2026-03-24T00:00:00.000Z',
      markets: [
        {
          is_resolved: true,
          condition: { resolved: true },
        },
      ],
      tags: [],
    } as any

    expect(
      filterHomeEvents([partiallyResolvedEvent, fullyResolvedEvent, resolvedStatusEvent], { status: 'resolved' }),
    ).toEqual([fullyResolvedEvent, resolvedStatusEvent])
  })

  it('keeps resolved events while still deduplicating active series entries for the all status', () => {
    const laterActiveEvent = {
      id: 'later-active-event',
      slug: 'later-active-event',
      series_slug: 'meta-series',
      status: 'active' as const,
      end_date: '2026-03-31T12:00:00.000Z',
      created_at: '2026-03-20T12:00:00.000Z',
      updated_at: '2026-03-20T12:00:00.000Z',
      markets: [{ is_resolved: false }],
    }
    const soonerActiveEvent = {
      id: 'sooner-active-event',
      slug: 'sooner-active-event',
      series_slug: 'meta-series',
      status: 'active' as const,
      end_date: '2026-03-27T12:00:00.000Z',
      created_at: '2026-03-21T12:00:00.000Z',
      updated_at: '2026-03-21T12:00:00.000Z',
      markets: [{ is_resolved: false }],
    }
    const resolvedEvent = {
      id: 'resolved-event',
      slug: 'resolved-event',
      series_slug: 'meta-series',
      status: 'resolved' as const,
      end_date: '2026-03-24T12:00:00.000Z',
      created_at: '2026-03-24T12:00:00.000Z',
      updated_at: '2026-03-24T12:00:00.000Z',
      markets: [{ is_resolved: true }],
    }

    expect(
      filterHomeEvents([laterActiveEvent, soonerActiveEvent, resolvedEvent], {
        currentTimestamp: Date.parse('2026-03-25T12:00:00.000Z'),
        status: 'all',
      }),
    ).toEqual([soonerActiveEvent, resolvedEvent])
  })

  it('keeps sports primary events from the same series while filtering child market rows', () => {
    const moneylineEvent = {
      id: 'moneyline-event',
      slug: 'fifwc-bra-nor-2026-07-05',
      sports_event_slug: 'fifwc-bra-nor-2026-07-05',
      sports_sport_slug: 'soccer',
      sports_parent_event_id: null,
      series_slug: 'soccer-fifwc',
      status: 'active' as const,
      end_date: '2026-07-05T20:00:00.000Z',
      created_at: '2026-07-05T10:53:16.000Z',
      updated_at: '2026-07-05T10:53:16.000Z',
      markets: [{ is_resolved: false }],
    }
    const nextMoneylineEvent = {
      id: 'next-moneyline-event',
      slug: 'fifwc-esp-bel-2026-07-10',
      sports_event_slug: 'fifwc-esp-bel-2026-07-10',
      sports_sport_slug: 'soccer',
      sports_parent_event_id: null,
      series_slug: 'soccer-fifwc',
      status: 'active' as const,
      end_date: '2026-07-10T20:00:00.000Z',
      created_at: '2026-07-06T10:53:16.000Z',
      updated_at: '2026-07-06T10:53:16.000Z',
      markets: [{ is_resolved: false }],
    }
    const firstToScoreEvent = {
      id: 'first-to-score-event',
      slug: 'fifwc-bra-nor-2026-07-05-first-to-score',
      sports_event_slug: 'fifwc-bra-nor-2026-07-05-first-to-score',
      sports_sport_slug: 'soccer',
      sports_parent_event_id: 654615,
      series_slug: 'soccer-fifwc',
      status: 'active' as const,
      end_date: '2026-07-05T20:00:00.000Z',
      created_at: '2026-07-05T12:44:24.000Z',
      updated_at: '2026-07-05T12:44:24.000Z',
      markets: [{ is_resolved: false }],
    }
    const totalCornersEvent = {
      id: 'total-corners-event',
      slug: 'fifwc-bra-nor-2026-07-05-total-corners',
      sports_event_slug: 'fifwc-bra-nor-2026-07-05-total-corners',
      sports_sport_slug: 'soccer',
      sports_parent_event_id: null,
      series_slug: 'soccer-fifwc',
      status: 'active' as const,
      end_date: '2026-07-05T20:00:00.000Z',
      created_at: '2026-07-05T12:45:24.000Z',
      updated_at: '2026-07-05T12:45:24.000Z',
      markets: [{ is_resolved: false }],
    }
    const zeroParentEvent = {
      id: 'zero-parent-event',
      slug: 'nba-bos-nyk-2026-07-05',
      sports_event_slug: 'nba-bos-nyk-2026-07-05',
      sports_sport_slug: 'basketball',
      sports_parent_event_id: 0,
      series_slug: 'basketball-nba',
      status: 'active' as const,
      end_date: '2026-07-05T23:00:00.000Z',
      created_at: '2026-07-05T12:45:24.000Z',
      updated_at: '2026-07-05T12:45:24.000Z',
      markets: [{ is_resolved: false }],
    }

    expect(
      filterHomeEvents([firstToScoreEvent, totalCornersEvent, zeroParentEvent, moneylineEvent, nextMoneylineEvent], {
        currentTimestamp: Date.parse('2026-07-05T14:00:00.000Z'),
        status: 'active',
      }),
    ).toEqual([zeroParentEvent, moneylineEvent, nextMoneylineEvent])
  })

  it('prefers the current active series event over an overdue unresolved entry', () => {
    const overdueEvent = {
      id: 'overdue-event',
      slug: 'meta-up-or-down-on-may-11-2026',
      series_slug: 'meta-daily-up-down',
      status: 'active' as const,
      end_date: '2026-05-11T20:00:00.000Z',
      created_at: '2026-05-08T12:00:00.000Z',
      updated_at: '2026-05-10T12:00:00.000Z',
      markets: [{ is_resolved: false }],
    }
    const currentEvent = {
      id: 'current-event',
      slug: 'meta-up-or-down-on-may-12-2026',
      series_slug: 'meta-daily-up-down',
      status: 'active' as const,
      end_date: '2026-05-12T20:00:00.000Z',
      created_at: '2026-05-11T12:00:00.000Z',
      updated_at: '2026-05-11T12:00:00.000Z',
      markets: [{ is_resolved: false }],
    }
    const futureEvent = {
      id: 'future-event',
      slug: 'meta-up-or-down-on-may-13-2026',
      series_slug: 'meta-daily-up-down',
      status: 'active' as const,
      end_date: '2026-05-13T20:00:00.000Z',
      created_at: '2026-05-12T12:00:00.000Z',
      updated_at: '2026-05-12T12:00:00.000Z',
      markets: [{ is_resolved: false }],
    }

    expect(
      filterHomeEvents([overdueEvent, futureEvent, currentEvent], {
        currentTimestamp: Date.parse('2026-05-12T17:30:00.000Z'),
        status: 'active',
      }),
    ).toEqual([currentEvent])
  })

  it('keeps the same-day overdue unresolved series event over the next occurrence', () => {
    const todayEvent = {
      id: 'today-event',
      slug: 'highest-temperature-in-sao-paulo-on-june-9-2026',
      series_slug: 'sao-paulo-daily-weather',
      status: 'active' as const,
      end_date: '2026-06-09T12:00:00.000Z',
      created_at: '2026-06-08T16:20:05.000Z',
      updated_at: '2026-06-09T12:15:01.833Z',
      markets: [{ is_resolved: false, condition: { resolved: false } }],
    }
    const tomorrowEvent = {
      id: 'tomorrow-event',
      slug: 'highest-temperature-in-sao-paulo-on-june-10-2026',
      series_slug: 'sao-paulo-daily-weather',
      status: 'active' as const,
      end_date: '2026-06-10T12:00:00.000Z',
      created_at: '2026-06-09T03:59:21.000Z',
      updated_at: '2026-06-09T12:15:01.867Z',
      markets: [{ is_resolved: false, condition: { resolved: false } }],
    }

    expect(
      filterHomeEvents([tomorrowEvent, todayEvent], {
        currentTimestamp: Date.parse('2026-06-09T12:30:00.000Z'),
        status: 'active',
      }),
    ).toEqual([todayEvent])
  })

  it('rolls a live series card to its current event at the exact market end', () => {
    const previous = {
      id: 'previous',
      slug: 'previous',
      series_slug: 'live-series',
      has_live_chart: true,
      status: 'active' as const,
      start_date: '2026-06-09T12:00:00.000Z',
      end_date: '2026-06-09T12:15:00.000Z',
      created_at: '2026-06-09T11:55:00.000Z',
      updated_at: '2026-06-09T11:55:00.000Z',
      markets: [{ is_resolved: false, end_time: '2026-06-09T12:15:00.000Z' }],
    }
    const current = {
      ...previous,
      id: 'current',
      slug: 'current',
      start_date: '2026-06-09T12:15:00.000Z',
      end_date: '2026-06-09T12:30:00.000Z',
      created_at: '2026-06-09T12:10:00.000Z',
      updated_at: '2026-06-09T12:10:00.000Z',
      markets: [{ is_resolved: false, end_time: '2026-06-09T12:30:00.000Z' }],
    }
    const future = {
      ...current,
      id: 'future',
      slug: 'future',
      start_date: '2026-06-09T12:30:00.000Z',
      end_date: '2026-06-09T12:45:00.000Z',
      created_at: '2026-06-09T12:25:00.000Z',
      updated_at: '2026-06-09T12:25:00.000Z',
      markets: [{ is_resolved: false, end_time: '2026-06-09T12:45:00.000Z' }],
    }

    expect(
      filterHomeEvents([future, previous, current], {
        currentTimestamp: Date.parse('2026-06-09T12:14:59.999Z'),
      }),
    ).toEqual([previous])
    expect(
      filterHomeEvents([future, previous, current], {
        currentTimestamp: Date.parse('2026-06-09T12:15:00.000Z'),
      }),
    ).toEqual([current])
    expect(filterHomeEvents([previous], { currentTimestamp: Date.parse('2026-06-09T12:15:00.000Z') })).toEqual([])
  })

  it('does not promote a future live period before its start', () => {
    const future = {
      id: 'future',
      slug: 'future',
      series_slug: 'live-series',
      has_live_chart: true,
      status: 'active' as const,
      start_date: '2026-06-10T09:30:00.000Z',
      end_date: '2026-06-10T09:45:00.000Z',
      created_at: '2026-06-09T12:00:00.000Z',
      updated_at: '2026-06-09T12:00:00.000Z',
      markets: [{ is_resolved: false }],
    }
    expect(filterHomeEvents([future], { currentTimestamp: Date.parse('2026-06-09T22:00:00.000Z') })).toEqual([future])
    expect(isCurrentHomeLiveSeriesEvent(future, Date.parse('2026-06-09T22:00:00.000Z'))).toBe(false)
    expect(isCurrentHomeLiveSeriesEvent(future, Date.parse('2026-06-10T09:30:00.000Z'))).toBe(true)
  })

  it('uses UTC and the latest market end for live series rollover', () => {
    const event = {
      id: 'live',
      slug: 'live',
      series_slug: 'live-series',
      has_live_chart: true,
      status: 'active' as const,
      start_date: '2026-06-09 12:00:00',
      end_date: '2026-06-09 12:14:00',
      created_at: '2026-06-09T11:55:00.000Z',
      updated_at: '2026-06-09T11:55:00.000Z',
      markets: [{ is_resolved: false, end_time: '2026-06-09 12:15:00' }],
    }
    expect(resolveHomeLiveSeriesEndTimestamp(event)).toBe(Date.parse('2026-06-09T12:15:00.000Z'))
    expect(isCurrentHomeLiveSeriesEvent(event, Date.parse('2026-06-09T12:14:59.999Z'))).toBe(true)
    expect(filterHomeEvents([event], { currentTimestamp: Date.parse('2026-06-09T12:15:00.000Z') })).toEqual([])
  })
})
