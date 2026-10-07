import type { ComponentProps, ReactNode } from 'react'

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock, jest } from 'bun:test'
import { useMemo } from 'react'

import EventSeriesPills from '@/app/[locale]/(platform)/event/[slug]/_components/EventSeriesPills'

import { useFakeTimers, useRealTimers } from '../bun-test-helpers'

void mock.module('next-intl', () => ({
  useExtracted: () => (message: string) => message,
  useLocale: () => 'en-US',
}))

void mock.module('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

function createSeriesEvent(
  id: string,
  endDate: string,
  overrides: Partial<NonNullable<ComponentProps<typeof EventSeriesPills>['seriesEvents']>[number]> = {},
): NonNullable<ComponentProps<typeof EventSeriesPills>['seriesEvents']>[number] {
  return {
    id,
    slug: id,
    status: 'active',
    end_date: endDate,
    resolved_at: null,
    created_at: '2026-07-28T00:00:00.000Z',
    ...overrides,
  }
}

describe('eventSeriesPills', () => {
  beforeEach(() => {
    useFakeTimers()
    jest.setSystemTime(new Date('2026-07-28T12:47:00.000Z'))
  })

  afterEach(() => {
    useRealTimers()
  })

  it('moves the live badge to the next trading window when its parent caches navigation', () => {
    const seriesEvents = [
      createSeriesEvent('event-1', '2026-07-28T12:50:00.000Z'),
      createSeriesEvent('event-2', '2026-07-28T12:55:00.000Z'),
    ]

    function CachedSeriesNavigation() {
      return useMemo(
        () => (
          <EventSeriesPills
            currentEventSlug="event-1"
            seriesEvents={seriesEvents}
            tradingWindowMs={5 * 60 * 1000}
            variant="live"
          />
        ),
        [],
      )
    }

    render(<CachedSeriesNavigation />)

    expect(screen.getByText('8:50 AM').closest('a')?.querySelector('.animate-ping')).not.toBeNull()
    expect(screen.getByText('8:55 AM').closest('a')?.querySelector('.animate-ping')).toBeNull()

    act(() => {
      jest.setSystemTime(new Date('2026-07-28T12:50:00.000Z'))
      jest.advanceTimersByTime(1000)
    })

    expect(screen.getByText('8:50 AM').closest('a')?.querySelector('.animate-ping')).toBeNull()
    expect(screen.getByText('8:55 AM').closest('a')?.querySelector('.animate-ping')).not.toBeNull()
  })

  it('keeps LIVE and its next three 5-minute events visible, then moves later events into More', () => {
    render(
      <EventSeriesPills
        currentEventSlug="event-1"
        seriesEvents={[
          createSeriesEvent('past-event', '2026-07-28T12:35:00.000Z', {
            status: 'resolved',
            resolved_at: '2026-07-28T12:35:00.000Z',
            resolved_direction: 'up',
          }),
          createSeriesEvent('event-1', '2026-07-28T12:50:00.000Z'),
          createSeriesEvent('event-2', '2026-07-28T12:55:00.000Z'),
          createSeriesEvent('event-3', '2026-07-28T13:00:00.000Z'),
          createSeriesEvent('event-4', '2026-07-28T13:05:00.000Z'),
          createSeriesEvent('event-5', '2026-07-28T13:10:00.000Z'),
          createSeriesEvent('event-6', '2026-07-28T13:15:00.000Z'),
        ]}
        tradingWindowMs={5 * 60 * 1000}
        variant="live"
      />,
    )

    expect(screen.getByRole('link', { name: '8:35 AM' })).toBeInTheDocument()
    expect(screen.getByText('8:50 AM')).toBeInTheDocument()
    expect(screen.getByText('8:55 AM')).toBeInTheDocument()
    expect(screen.getByText('9:00 AM')).toBeInTheDocument()
    expect(screen.getByText('9:05 AM')).toBeInTheDocument()
    expect(screen.queryByText('9:10 AM')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'More' }))

    expect(screen.getByRole('menu')).toHaveClass('min-w-fit')
    expect(screen.getByText('09:10 AM ET')).toHaveClass('tabular-nums')
    expect(screen.getByText('09:10 AM ET')).not.toHaveClass('w-[5.5rem]')
    expect(screen.getByText('09:15 AM ET')).toBeInTheDocument()
  })

  it.each([
    ['1-hour', 60 * 60 * 1000, '2026-07-28T13:00:00.000Z'],
    ['4-hour', 4 * 60 * 60 * 1000, '2026-07-28T16:00:00.000Z'],
  ])('moves later %s events into More', (_, tradingWindowMs, firstEndDate) => {
    const firstEndTimestamp = Date.parse(firstEndDate)

    render(
      <EventSeriesPills
        currentEventSlug="event-1"
        seriesEvents={[0, 1, 2, 3, 4].map((offset) =>
          createSeriesEvent(
            `event-${offset + 1}`,
            new Date(firstEndTimestamp + offset * tradingWindowMs).toISOString(),
          ),
        )}
        tradingWindowMs={tradingWindowMs}
        variant="live"
      />,
    )

    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
  })

  it('keeps a selected future event visible without hiding LIVE', () => {
    const firstEndTimestamp = Date.parse('2026-07-28T12:50:00.000Z')

    render(
      <EventSeriesPills
        currentEventSlug="event-6"
        seriesEvents={[0, 1, 2, 3, 4, 5].map((offset) =>
          createSeriesEvent(`event-${offset + 1}`, new Date(firstEndTimestamp + offset * 5 * 60 * 1000).toISOString()),
        )}
        tradingWindowMs={5 * 60 * 1000}
        variant="live"
      />,
    )

    expect(screen.getByText('8:50 AM')).toBeInTheDocument()
    expect(screen.getByText('9:15 AM')).toBeInTheDocument()
    expect(screen.queryByText('9:10 AM')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByText('09:10 AM ET')).toBeInTheDocument()
  })

  it('shows past 4-hour results with ET time labels', () => {
    render(
      <EventSeriesPills
        currentEventSlug="event-1"
        seriesEvents={[
          createSeriesEvent('past-event', '2026-07-28T12:00:00.000Z', {
            status: 'resolved',
            resolved_at: '2026-07-28T12:00:00.000Z',
            resolved_direction: 'down',
          }),
          createSeriesEvent('event-1', '2026-07-28T16:00:00.000Z'),
        ]}
        tradingWindowMs={4 * 60 * 60 * 1000}
        variant="live"
      />,
    )

    expect(screen.getByRole('link', { name: '8 AM' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Jul 28' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Past' }))

    expect(screen.getByText('08:00 AM ET')).toBeInTheDocument()
  })

  it.each([5, 15])('shows both future pills without More for %i-minute events', (minutes) => {
    const tradingWindowMs = minutes * 60 * 1000
    const firstEndTimestamp = Date.parse('2026-07-28T12:50:00.000Z')

    render(
      <EventSeriesPills
        currentEventSlug="event-1"
        seriesEvents={[0, 1, 2].map((offset) =>
          createSeriesEvent(
            `event-${offset + 1}`,
            new Date(firstEndTimestamp + offset * tradingWindowMs).toISOString(),
          ),
        )}
        tradingWindowMs={tradingWindowMs}
        variant="live"
      />,
    )

    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(3)
  })
})
