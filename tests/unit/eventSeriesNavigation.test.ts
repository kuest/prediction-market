import { describe, expect, it } from 'bun:test'

import type { EventSeriesEntry } from '@/types'

import { selectInitialSeriesEvents } from '@/lib/event-series-navigation'

function seriesEvent(index: number, overrides: Partial<EventSeriesEntry> = {}): EventSeriesEntry {
  const timestamp = new Date(Date.UTC(2026, 0, 1) + index * 15 * 60 * 1000).toISOString()
  return {
    id: `round-${index}`,
    slug: `round-${index}`,
    status: 'resolved',
    end_date: timestamp,
    resolved_at: timestamp,
    created_at: timestamp,
    resolved_direction: index % 2 === 0 ? 'up' : 'down',
    ...overrides,
  }
}

describe('initial event series navigation', () => {
  it('keeps a month of 15-minute history out of the initial page while preserving live and future rounds', () => {
    const past = Array.from({ length: 3_000 }, (_, index) => seriesEvent(index))
    const future = Array.from({ length: 12 }, (_, index) =>
      seriesEvent(3_000 + index, { status: 'active', resolved_at: null, resolved_direction: null }),
    )
    const initial = selectInitialSeriesEvents([...past, ...future], future[0]!.slug)

    expect(initial).toHaveLength(17)
    expect(initial.slice(0, 5)).toEqual(past.slice(-5))
    expect(initial.slice(5)).toEqual(future)
    expect(JSON.stringify(initial).length).toBeLessThan(JSON.stringify([...past, ...future]).length / 100)
  })

  it('bounds archived history without resolved timestamps and preserves the selected archived round', () => {
    const archived = Array.from({ length: 3_000 }, (_, index) =>
      seriesEvent(index, { status: 'archived', resolved_at: null }),
    )
    const future = seriesEvent(3_000, { status: 'active', resolved_at: null, resolved_direction: null })

    const initial = selectInitialSeriesEvents([...archived, future], 'round-2')

    expect(initial).toHaveLength(7)
    expect(initial.map((event) => event.slug)).toEqual([
      'round-2',
      'round-2995',
      'round-2996',
      'round-2997',
      'round-2998',
      'round-2999',
      'round-3000',
    ])
    expect(JSON.stringify(initial).length).toBeLessThan(JSON.stringify(archived).length / 100)
  })

  it('retains an old selected resolved round without replacing any of the latest result badges', () => {
    const history = Array.from({ length: 20 }, (_, index) => seriesEvent(index))

    const initial = selectInitialSeriesEvents(history, 'round-2')

    expect(initial.map((event) => event.slug)).toEqual([
      'round-2',
      'round-15',
      'round-16',
      'round-17',
      'round-18',
      'round-19',
    ])
  })

  it('preserves the five latest result badges when newer resolved rounds have no winner yet', () => {
    const history = Array.from({ length: 20 }, (_, index) =>
      seriesEvent(index, index >= 17 ? { resolved_direction: null } : {}),
    )

    const initial = selectInitialSeriesEvents(history, 'round-16')

    expect(initial.filter((event) => event.resolved_direction && event.slug !== 'round-16')).toHaveLength(5)
    expect(initial.slice(-5)).toEqual(history.slice(-5))
    expect(initial.some((event) => event.slug === 'round-11')).toBe(true)
  })

  it('recognizes resolved timestamps even before status is updated and ignores invalid timestamps', () => {
    const history = Array.from({ length: 20 }, (_, index) => seriesEvent(index, { status: 'active' }))
    const future = seriesEvent(20, { status: 'active', resolved_at: 'invalid', resolved_direction: null })

    expect(selectInitialSeriesEvents([...history, future], future.slug)).toHaveLength(6)
    expect(selectInitialSeriesEvents([], 'missing')).toEqual([])
  })

  it('sorts history by valid fallback dates without mutating the repository result', () => {
    const history = [
      seriesEvent(1, { end_date: 'invalid' }),
      seriesEvent(10, { end_date: null, resolved_at: '2026-01-01 02:30:00' }),
      ...Array.from({ length: 10 }, (_, index) => seriesEvent(index + 20)),
    ]
    const originalOrder = history.map((event) => event.id)

    const initial = selectInitialSeriesEvents(history, 'round-1')

    expect(initial.some((event) => event.slug === 'round-1')).toBe(true)
    expect(history.map((event) => event.id)).toEqual(originalOrder)
  })
})
