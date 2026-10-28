import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, jest, mock } from 'bun:test'

import EventsStaticGrid, {
  getStaticGridColumnsClassName,
} from '@/app/[locale]/(platform)/(home)/_components/EventsStaticGrid'

import { useFakeTimers, useRealTimers } from '../bun-test-helpers'

void mock.module('next-intl', () => ({ useLocale: () => 'en' }))

void mock.module('@/app/[locale]/(platform)/(home)/_components/EventCard', () => ({
  default: function MockEventCard({ event }: { event: { slug: string; title: string } }) {
    return <a href={`/event/${event.slug}`}>{event.title}</a>
  },
}))

describe('eventsStaticGrid', () => {
  it('uses responsive columns when no max column limit is provided', () => {
    expect(getStaticGridColumnsClassName()).toBe('grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4')
  })

  it('renders server-visible event cards with the expected column cap', () => {
    const events = [
      {
        id: '1',
        title: 'First event',
      },
      {
        id: '2',
        title: 'Second event',
      },
    ] as any[]

    const { container } = render(<EventsStaticGrid events={events} priceOverridesByMarket={{}} maxColumns={3} />)

    expect(screen.getByText('First event')).toBeInTheDocument()
    expect(screen.getByText('Second event')).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('grid-cols-1', 'md:grid-cols-2', 'lg:grid-cols-3')
  })

  it('uses the live series resolver only for a stale card clicked at rollover', () => {
    useFakeTimers()
    const endTimestamp = Date.parse('2026-06-09T12:15:00.000Z')
    jest.setSystemTime(endTimestamp - 1)
    const event = {
      id: 'previous',
      slug: 'previous',
      title: 'Previous round',
      series_slug: 'live-series',
      has_live_chart: true,
      end_date: '2026-06-09T12:15:00.000Z',
      markets: [],
    } as any

    try {
      const { rerender } = render(<EventsStaticGrid events={[event]} priceOverridesByMarket={{}} />)
      const link = screen.getByRole('link', { name: 'Previous round' }) as HTMLAnchorElement
      fireEvent.click(link)
      expect(link.getAttribute('href')).toBe('/event/previous')

      jest.setSystemTime(endTimestamp)
      fireEvent.click(link)
      expect(link.getAttribute('href')).toContain('/api/home-featured/live-link?')
      expect(link.getAttribute('href')).toContain('seriesSlug=live-series')

      rerender(
        <EventsStaticGrid
          events={[{ ...event, id: 'historical', slug: 'historical', has_live_chart: false }]}
          priceOverridesByMarket={{}}
        />,
      )
      const historicalLink = screen.getByRole('link', { name: 'Previous round' }) as HTMLAnchorElement
      fireEvent.click(historicalLink)
      expect(historicalLink.getAttribute('href')).toBe('/event/historical')
    } finally {
      useRealTimers()
    }
  })
})
