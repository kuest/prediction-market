import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, mock, jest, spyOn } from 'bun:test'

import EventsGrid from '@/app/[locale]/(platform)/(home)/_components/EventsGrid'
import * as actualHomeEvents from '@/lib/home-events'
import * as actualMarketChance from '@/lib/market-chance'

import { hoisted, stubGlobal, unstubAllGlobals, useFakeTimers, useRealTimers } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  eventsStaticGrid: mock(),
  filterHomeEvents: mock((events: any[], _options?: any) => events),
  openLoginModal: mock().mockResolvedValue(undefined),
  refetch: mock().mockResolvedValue(undefined),
  useCurrentTimestamp: mock(),
  useInfiniteQuery: mock(),
  useUser: mock(),
}))

void mock.module('@tanstack/react-query', () => ({
  keepPreviousData: Symbol('keepPreviousData'),
  useInfiniteQuery: (options: any) => mocks.useInfiniteQuery(options),
}))

void mock.module('next-intl', () => ({
  useExtracted: () => (value: string) => value,
  useLocale: () => 'en',
}))

void mock.module('@/app/[locale]/(platform)/(home)/_components/EventCardSkeleton', () => ({
  default: () => <div data-testid="event-card-skeleton" />,
}))

void mock.module('@/app/[locale]/(platform)/(home)/_components/EventsGridSkeleton', () => ({
  default: () => <div data-testid="events-grid-skeleton" />,
}))

void mock.module('@/app/[locale]/(platform)/(home)/_components/EventsStaticGrid', () => ({
  default: (props: any) => {
    mocks.eventsStaticGrid(props)
    return <div data-testid="events-static-grid" />
  },
}))

void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventsEmptyState', () => ({
  default: () => <div data-testid="events-empty-state" />,
}))

void mock.module('@/app/[locale]/(platform)/event/[slug]/_hooks/useEventLastTrades', () => ({
  useEventLastTrades: () => ({}),
}))

void mock.module('@/app/[locale]/(platform)/event/[slug]/_hooks/useEventMidPrices', () => ({
  useEventMarketQuotes: () => ({}),
}))

void mock.module('@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory', () => ({
  buildMarketTargets: () => [],
}))

void mock.module('@/hooks/useColumns', () => ({
  useColumns: () => 3,
}))

void mock.module('@/hooks/useCurrentTimestamp', () => ({
  useCurrentTimestamp: (...args: any[]) => mocks.useCurrentTimestamp(...args),
}))

void mock.module('@/hooks/useAppKit', () => ({
  useAppKit: () => ({ open: mocks.openLoginModal }),
}))

void mock.module('@/lib/home-events', () => {
  return {
    ...actualHomeEvents,
    filterHomeEvents: (events: any[], options?: any) => mocks.filterHomeEvents(events, options),
  }
})

void mock.module('@/lib/market-chance', () => {
  return {
    ...actualMarketChance,
    resolveDisplayPrice: () => null,
  }
})

void mock.module('@/stores/useUser', () => ({
  useUser: () => mocks.useUser(),
}))

describe('eventsGrid', () => {
  function createEvent(overrides: Record<string, any>) {
    return {
      id: 'event-1',
      slug: 'event-1',
      title: 'Event 1',
      status: 'active',
      created_at: '2026-03-16T12:00:00.000Z',
      updated_at: '2026-03-16T12:00:00.000Z',
      tags: [],
      markets: [{ is_resolved: false, condition: { resolved: false } }],
      is_bookmarked: false,
      ...overrides,
    } as any
  }

  beforeEach(() => {
    mocks.eventsStaticGrid.mockClear()
    mocks.filterHomeEvents.mockClear()
    mocks.openLoginModal.mockClear()
    mocks.refetch.mockClear()
    mocks.useCurrentTimestamp.mockReset()
    mocks.useInfiniteQuery.mockReset()
    mocks.useUser.mockReset()
    mocks.useCurrentTimestamp.mockReturnValue(Date.parse('2026-03-16T12:00:00.000Z'))
    mocks.useUser.mockReturnValue(null)
    mocks.useInfiniteQuery.mockImplementation(() => ({
      status: 'success',
      data: { pages: [{ events: [], hasMore: false }] },
      dataUpdatedAt: 0,
      isFetching: false,
      isFetchingNextPage: false,
      fetchNextPage: mock(),
      hasNextPage: false,
      isPending: false,
      refetch: mocks.refetch,
    }))
  })

  it('uses a user-scoped query key without forcing an extra refetch when auth hydrates', async () => {
    const filters = {
      tag: 'trending',
      mainTag: 'trending',
      search: '',
      bookmarked: false,
      frequency: 'all',
      sortBy: 'volume_24h',
      status: 'active',
      hideSports: false,
      hideCrypto: false,
      hideEarnings: false,
    } as const

    const { rerender } = render(
      <EventsGrid
        filters={filters}
        initialEvents={[]}
        initialCurrentTimestamp={Date.parse('2026-03-16T12:00:00.000Z')}
        routeMainTag="trending"
        routeTag="trending"
      />,
    )

    expect(mocks.useInfiniteQuery.mock.calls.at(-1)?.[0].queryKey).toContain('guest')
    expect(mocks.useInfiniteQuery.mock.calls.at(-1)?.[0].queryKey).not.toContain('public')

    mocks.useUser.mockReturnValue({ id: 'user-1' })

    rerender(
      <EventsGrid
        filters={filters}
        initialEvents={[]}
        initialCurrentTimestamp={Date.parse('2026-03-16T12:00:00.000Z')}
        routeMainTag="trending"
        routeTag="trending"
      />,
    )

    expect(mocks.useInfiniteQuery.mock.calls.at(-1)?.[0].queryKey).toContain('user-1')
    expect(mocks.refetch).not.toHaveBeenCalled()
  })

  it('does not hydrate a user-scoped query with guest initial data', () => {
    mocks.useUser.mockReturnValue({ id: 'user-1' })

    render(
      <EventsGrid
        filters={{
          tag: 'trending',
          mainTag: 'trending',
          search: '',
          bookmarked: false,
          frequency: 'all',
          sortBy: 'volume_24h',
          status: 'active',
          hideSports: false,
          hideCrypto: false,
          hideEarnings: false,
        }}
        initialEvents={[{ id: 'event-1' } as any]}
        initialCurrentTimestamp={Date.parse('2026-03-16T12:00:00.000Z')}
        routeMainTag="trending"
        routeTag="trending"
      />,
    )

    expect(mocks.useInfiniteQuery.mock.calls.at(-1)?.[0].initialData).toBeUndefined()
  })

  it('loads the next 32 markets only after the show more button is clicked', async () => {
    const event = createEvent({})
    const fetchNextPage = mock().mockResolvedValue({ isError: false })
    mocks.useUser.mockReturnValue({ id: 'user-1' })
    mocks.useInfiniteQuery.mockImplementation(() => ({
      status: 'success',
      data: { pages: [{ events: [event], hasMore: true }] },
      dataUpdatedAt: 1,
      isFetching: false,
      isFetchingNextPage: false,
      fetchNextPage,
      hasNextPage: true,
      isPending: false,
      isPlaceholderData: false,
      refetch: mocks.refetch,
    }))

    render(
      <EventsGrid
        filters={{
          tag: 'trending',
          mainTag: 'trending',
          search: '',
          bookmarked: false,
          frequency: 'all',
          sortBy: 'volume_24h',
          status: 'active',
          hideSports: false,
          hideCrypto: false,
          hideEarnings: false,
        }}
        initialEvents={[]}
        initialCurrentTimestamp={Date.parse('2026-03-16T12:00:00.000Z')}
        routeMainTag="trending"
        routeTag="trending"
      />,
    )

    expect(fetchNextPage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Show more markets' }))

    await waitFor(() => expect(fetchNextPage).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: 'Show more markets' })).not.toBeInTheDocument()
    expect(screen.getByTestId('events-infinite-scroll-sentinel')).toBeInTheDocument()
  })

  it('offers the show more button only when the server confirms a 33rd market', () => {
    const initialEvents = Array.from({ length: 32 }, (_, index) =>
      createEvent({
        id: `event-${index}`,
        slug: `event-${index}`,
      }),
    )

    render(
      <EventsGrid
        filters={{
          tag: 'trending',
          mainTag: 'trending',
          search: '',
          bookmarked: false,
          frequency: 'all',
          sortBy: 'volume_24h',
          status: 'active',
          hideSports: false,
          hideCrypto: false,
          hideEarnings: false,
        }}
        initialEvents={initialEvents}
        initialHasMore={false}
        initialCurrentTimestamp={Date.parse('2026-03-16T12:00:00.000Z')}
        routeMainTag="trending"
        routeTag="trending"
      />,
    )

    const queryOptions = mocks.useInfiniteQuery.mock.calls.at(-1)?.[0]
    const page = queryOptions.initialData.pages[0]
    expect(page.hasMore).toBe(false)
    expect(queryOptions.getNextPageParam(page, [page])).toBeUndefined()
    expect(screen.queryByRole('button', { name: 'Show more markets' })).not.toBeInTheDocument()
  })

  it('opens the login modal instead of loading more markets for guests', async () => {
    const event = createEvent({})
    const fetchNextPage = mock().mockResolvedValue({ isError: false })
    mocks.useInfiniteQuery.mockImplementation(() => ({
      status: 'success',
      data: { pages: [{ events: [event], hasMore: true }] },
      dataUpdatedAt: 1,
      isFetching: false,
      isFetchingNextPage: false,
      fetchNextPage,
      hasNextPage: true,
      isPending: false,
      isPlaceholderData: false,
      refetch: mocks.refetch,
    }))

    render(
      <EventsGrid
        filters={{
          tag: 'trending',
          mainTag: 'trending',
          search: '',
          bookmarked: false,
          frequency: 'all',
          sortBy: 'volume_24h',
          status: 'active',
          hideSports: false,
          hideCrypto: false,
          hideEarnings: false,
        }}
        initialEvents={[]}
        initialCurrentTimestamp={Date.parse('2026-03-16T12:00:00.000Z')}
        routeMainTag="trending"
        routeTag="trending"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show more markets' }))

    await waitFor(() => expect(mocks.openLoginModal).toHaveBeenCalledTimes(1))
    expect(fetchNextPage).not.toHaveBeenCalled()
  })

  it('does not render unbookmarked placeholder rows in resolved bookmarked feeds', () => {
    mocks.useUser.mockReturnValue({ id: 'user-1' })
    const bookmarkedEvent = { id: 'bookmarked-event', is_bookmarked: true }
    mocks.useInfiniteQuery.mockImplementation(() => ({
      status: 'success',
      data: {
        pages: [
          {
            events: [{ id: 'unbookmarked-event', is_bookmarked: false }, bookmarkedEvent],
            hasMore: false,
          },
        ],
      },
      dataUpdatedAt: 0,
      isFetching: true,
      isFetchingNextPage: false,
      fetchNextPage: mock(),
      hasNextPage: false,
      isPending: false,
      refetch: mocks.refetch,
    }))

    render(
      <EventsGrid
        filters={{
          tag: 'trending',
          mainTag: 'trending',
          search: '',
          bookmarked: true,
          frequency: 'all',
          sortBy: 'volume_24h',
          status: 'resolved',
          hideSports: false,
          hideCrypto: false,
          hideEarnings: false,
        }}
        initialEvents={[]}
        initialCurrentTimestamp={Date.parse('2026-03-16T12:00:00.000Z')}
        routeMainTag="trending"
        routeTag="trending"
      />,
    )

    expect(mocks.eventsStaticGrid.mock.calls.at(-1)?.[0].events).toEqual([bookmarkedEvent])
  })

  it('renders only resolved weather events for the resolved weather filter', () => {
    const activeWeatherEvent = createEvent({
      id: 'active-weather',
      slug: 'active-weather',
      title: 'Active weather',
      status: 'active',
      tags: [{ slug: 'weather' }],
      markets: [{ is_resolved: false, condition: { resolved: false } }],
    })
    const resolvedWeatherEvent = createEvent({
      id: 'resolved-weather',
      slug: 'resolved-weather',
      title: 'Resolved weather',
      status: 'resolved',
      tags: [{ slug: 'weather' }],
      markets: [{ is_resolved: true, condition: { resolved: true } }],
    })
    const resolvedFinanceEvent = createEvent({
      id: 'resolved-finance',
      slug: 'resolved-finance',
      title: 'Resolved finance',
      status: 'resolved',
      tags: [{ slug: 'finance' }],
      markets: [{ is_resolved: true, condition: { resolved: true } }],
    })

    mocks.useInfiniteQuery.mockImplementation(() => ({
      status: 'success',
      data: {
        pages: [
          {
            events: [activeWeatherEvent, resolvedWeatherEvent, resolvedFinanceEvent],
            hasMore: false,
          },
        ],
      },
      dataUpdatedAt: 1,
      isFetching: false,
      isFetchingNextPage: false,
      fetchNextPage: mock(),
      hasNextPage: false,
      isPending: false,
      isPlaceholderData: false,
      refetch: mocks.refetch,
    }))

    render(
      <EventsGrid
        filters={{
          tag: 'weather',
          mainTag: 'weather',
          search: '',
          bookmarked: false,
          frequency: 'all',
          sortBy: 'volume_24h',
          status: 'resolved',
          hideSports: false,
          hideCrypto: false,
          hideEarnings: false,
        }}
        initialEvents={[]}
        initialCurrentTimestamp={Date.parse('2026-03-16T12:00:00.000Z')}
        routeMainTag="weather"
        routeTag="weather"
      />,
    )

    expect(mocks.eventsStaticGrid.mock.calls.at(-1)?.[0].events).toEqual([resolvedWeatherEvent])
  })

  it.each([
    { routeTag: '5M', seriesSlug: 'btc-up-or-down-5m' },
    { routeTag: '15M', seriesSlug: 'btc-up-or-down-15m' },
    { routeTag: 'hourly', seriesSlug: 'btc-up-or-down-hourly' },
    { routeTag: '4hour', seriesSlug: 'bitcoin-up-or-down-4h' },
    { routeTag: 'daily', seriesSlug: 'btc-up-or-down-daily' },
  ])('keeps $routeTag crypto series visible after hydration without a cadence tag', ({ routeTag, seriesSlug }) => {
    const cadenceBitcoinEvent = createEvent({
      id: `btc-${routeTag}`,
      slug: `bitcoin-up-or-down-${routeTag}`,
      title: 'Bitcoin Up or Down - July 28, 8AM ET',
      series_slug: seriesSlug,
      series_recurrence: 'daily',
      tags: [{ slug: 'crypto' }],
    })
    const weeklyBitcoinEvent = createEvent({
      id: 'btc-weekly',
      slug: 'bitcoin-up-or-down-this-week',
      title: 'Bitcoin Up or Down This Week?',
      series_slug: 'btc-up-or-down-weekly',
      series_recurrence: 'weekly',
      tags: [{ slug: 'crypto' }],
    })

    mocks.useInfiniteQuery.mockImplementation(() => ({
      status: 'success',
      data: {
        pages: [
          {
            events: [cadenceBitcoinEvent, weeklyBitcoinEvent],
            hasMore: false,
          },
        ],
      },
      dataUpdatedAt: 1,
      isFetching: false,
      isFetchingNextPage: false,
      fetchNextPage: mock(),
      hasNextPage: false,
      isPending: false,
      isPlaceholderData: false,
      refetch: mocks.refetch,
    }))

    render(
      <EventsGrid
        filters={{
          tag: routeTag,
          mainTag: 'crypto',
          search: '',
          bookmarked: false,
          frequency: 'all',
          sortBy: 'volume_24h',
          status: 'active',
          hideSports: false,
          hideCrypto: false,
          hideEarnings: false,
        }}
        initialEvents={[cadenceBitcoinEvent]}
        initialCurrentTimestamp={Date.parse('2026-07-28T12:30:00.000Z')}
        routeMainTag="crypto"
        routeTag={routeTag}
      />,
    )

    expect(mocks.eventsStaticGrid.mock.calls.at(-1)?.[0].events).toEqual([cadenceBitcoinEvent])
  })

  it('does not render stale active weather placeholder data while resolved weather loads', () => {
    const activeWeatherEvent = createEvent({
      id: 'active-weather',
      slug: 'active-weather',
      title: 'Active weather',
      status: 'active',
      tags: [{ slug: 'weather' }],
      markets: [{ is_resolved: false, condition: { resolved: false } }],
    })

    mocks.useInfiniteQuery.mockImplementation(() => ({
      status: 'success',
      data: { pages: [{ events: [activeWeatherEvent], hasMore: false }] },
      dataUpdatedAt: 0,
      isFetching: true,
      isFetchingNextPage: false,
      fetchNextPage: mock(),
      hasNextPage: false,
      isPending: false,
      isPlaceholderData: true,
      refetch: mocks.refetch,
    }))

    const view = render(
      <EventsGrid
        filters={{
          tag: 'weather',
          mainTag: 'weather',
          search: '',
          bookmarked: false,
          frequency: 'all',
          sortBy: 'volume_24h',
          status: 'resolved',
          hideSports: false,
          hideCrypto: false,
          hideEarnings: false,
        }}
        initialEvents={[]}
        initialCurrentTimestamp={Date.parse('2026-03-16T12:00:00.000Z')}
        routeMainTag="weather"
        routeTag="weather"
      />,
    )

    expect(view.getByTestId('events-grid-skeleton')).toBeTruthy()
    expect(mocks.eventsStaticGrid).not.toHaveBeenCalled()
  })

  it('keeps server-rendered events visible while a logged-in query is still hydrating', () => {
    mocks.useUser.mockReturnValue({ id: 'user-1' })
    mocks.useInfiniteQuery.mockImplementation(() => ({
      status: 'pending',
      data: undefined,
      dataUpdatedAt: 0,
      isFetching: true,
      isFetchingNextPage: false,
      fetchNextPage: mock(),
      hasNextPage: false,
      isPending: true,
      refetch: mocks.refetch,
    }))

    const view = render(
      <EventsGrid
        filters={{
          tag: 'trending',
          mainTag: 'trending',
          search: '',
          bookmarked: false,
          frequency: 'all',
          sortBy: 'volume_24h',
          status: 'active',
          hideSports: false,
          hideCrypto: false,
          hideEarnings: false,
        }}
        initialEvents={[{ id: 'event-1' } as any]}
        initialCurrentTimestamp={Date.parse('2026-03-16T12:00:00.000Z')}
        routeMainTag="trending"
        routeTag="trending"
      />,
    )

    expect(view.getByTestId('events-static-grid')).toBeTruthy()
    expect(view.queryByTestId('events-grid-skeleton')).toBeNull()
  })

  it('does not refetch active feeds when hydration only advances the clock by a small amount', async () => {
    const initialCurrentTimestamp = Date.parse('2026-03-16T12:00:00.000Z')
    const filters = {
      tag: 'trending',
      mainTag: 'trending',
      search: '',
      bookmarked: false,
      frequency: 'all',
      sortBy: 'volume_24h',
      status: 'active',
      hideSports: false,
      hideCrypto: false,
      hideEarnings: false,
    } as const

    const { rerender } = render(
      <EventsGrid
        filters={filters}
        initialEvents={[]}
        initialCurrentTimestamp={initialCurrentTimestamp}
        routeMainTag="trending"
        routeTag="trending"
      />,
    )

    mocks.useCurrentTimestamp.mockReturnValue(initialCurrentTimestamp + 500)

    await act(async () => {
      rerender(
        <EventsGrid
          filters={filters}
          initialEvents={[]}
          initialCurrentTimestamp={initialCurrentTimestamp}
          routeMainTag="trending"
          routeTag="trending"
        />,
      )
    })

    expect(mocks.refetch).not.toHaveBeenCalled()
    expect(mocks.useInfiniteQuery.mock.calls.at(-1)?.[0].refetchOnMount).toBe(true)
    expect(mocks.useInfiniteQuery.mock.calls.at(-1)?.[0].staleTime).toBe(60_000)
  })

  it('updates the live series card at its end and refreshes the existing feed once', async () => {
    useFakeTimers()
    const beforeEnd = Date.parse('2026-06-09T12:14:59.000Z')
    jest.setSystemTime(beforeEnd)
    mocks.useCurrentTimestamp.mockReturnValue(beforeEnd)
    mocks.filterHomeEvents.mockImplementation((events: any[], options?: any) =>
      events.filter(
        (event) =>
          Date.parse(event.start_date) <= options.currentTimestamp &&
          options.currentTimestamp < Date.parse(event.end_date),
      ),
    )
    const previous = createEvent({
      id: 'previous',
      slug: 'previous',
      series_slug: 'live-series',
      has_live_chart: true,
      start_date: '2026-06-09T12:00:00.000Z',
      end_date: '2026-06-09T12:15:00.000Z',
    })
    const current = createEvent({
      id: 'current',
      slug: 'current',
      series_slug: 'live-series',
      has_live_chart: true,
      start_date: '2026-06-09T12:15:00.000Z',
      end_date: '2026-06-09T12:30:00.000Z',
    })
    let events = [previous, current]
    let isFetching = true
    mocks.useInfiniteQuery.mockImplementation(() => ({
      status: 'success',
      data: { pages: [{ events, hasMore: false }] },
      dataUpdatedAt: 1,
      isFetching,
      isFetchingNextPage: false,
      fetchNextPage: mock(),
      hasNextPage: false,
      isPending: false,
      refetch: mocks.refetch,
    }))
    const filters = {
      tag: 'trending',
      mainTag: 'trending',
      search: '',
      bookmarked: false,
      frequency: 'all',
      sortBy: 'volume_24h',
      status: 'active',
      hideSports: false,
      hideCrypto: false,
      hideEarnings: false,
    } as const

    try {
      const { rerender } = render(
        <EventsGrid
          filters={filters}
          initialEvents={[]}
          initialCurrentTimestamp={beforeEnd}
          routeMainTag="trending"
          routeTag="trending"
        />,
      )
      expect(mocks.eventsStaticGrid.mock.calls.at(-1)?.[0].events.map((event: any) => event.id)).toEqual(['previous'])
      expect(mocks.refetch).not.toHaveBeenCalled()

      await act(async () => jest.advanceTimersByTime(1_000))
      expect(mocks.eventsStaticGrid.mock.calls.at(-1)?.[0].events.map((event: any) => event.id)).toEqual(['current'])
      expect(mocks.refetch).not.toHaveBeenCalled()

      events = [current]
      isFetching = false
      rerender(
        <EventsGrid
          filters={filters}
          initialEvents={[]}
          initialCurrentTimestamp={beforeEnd}
          routeMainTag="trending"
          routeTag="trending"
        />,
      )
      expect(mocks.refetch).toHaveBeenCalledTimes(1)
      await act(async () => jest.advanceTimersByTime(1_000))
      expect(mocks.refetch).toHaveBeenCalledTimes(1)
    } finally {
      useRealTimers()
    }
  })

  it('hides an expired live card without a successor and refreshes after a hidden-tab rollover', async () => {
    useFakeTimers()
    const beforeEnd = Date.parse('2026-06-09T12:14:59.000Z')
    jest.setSystemTime(beforeEnd)
    mocks.useCurrentTimestamp.mockReturnValue(beforeEnd)
    mocks.filterHomeEvents.mockImplementation((events: any[], options?: any) =>
      events.filter((event) => Date.parse(event.end_date) > options.currentTimestamp),
    )
    const previous = createEvent({
      id: 'previous',
      slug: 'previous',
      series_slug: 'live-series',
      has_live_chart: true,
      start_date: '2026-06-09T12:00:00.000Z',
      end_date: '2026-06-09T12:15:00.000Z',
    })
    mocks.useInfiniteQuery.mockImplementation(() => ({
      status: 'success',
      data: { pages: [{ events: [previous], hasMore: false }] },
      dataUpdatedAt: 1,
      isFetching: false,
      isFetchingNextPage: false,
      fetchNextPage: mock(),
      hasNextPage: false,
      isPending: false,
      refetch: mocks.refetch,
    }))
    const originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    let visibilityState = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibilityState })

    try {
      render(
        <EventsGrid
          filters={{
            tag: 'trending',
            mainTag: 'trending',
            search: '',
            bookmarked: false,
            frequency: 'all',
            sortBy: 'volume_24h',
            status: 'active',
            hideSports: false,
            hideCrypto: false,
            hideEarnings: false,
          }}
          initialEvents={[]}
          initialCurrentTimestamp={beforeEnd}
          routeMainTag="trending"
          routeTag="trending"
        />,
      )
      visibilityState = 'hidden'
      await act(async () => document.dispatchEvent(new Event('visibilitychange')))
      await act(async () => jest.advanceTimersByTime(30 * 60_000))
      expect(mocks.refetch).not.toHaveBeenCalled()

      visibilityState = 'visible'
      await act(async () => document.dispatchEvent(new Event('visibilitychange')))
      expect(mocks.refetch).toHaveBeenCalledTimes(1)
      expect(screen.queryByTestId('events-static-grid')).not.toBeInTheDocument()
      expect(screen.getByTestId('events-empty-state')).toBeInTheDocument()
    } finally {
      if (originalVisibilityState) {
        Object.defineProperty(document, 'visibilityState', originalVisibilityState)
      } else {
        Reflect.deleteProperty(document, 'visibilityState')
      }
      useRealTimers()
    }
  })

  it('caps the rollover timer for a live period more than 24 days away', async () => {
    useFakeTimers()
    const now = Date.parse('2026-06-09T12:00:00.000Z')
    jest.setSystemTime(now)
    mocks.useCurrentTimestamp.mockReturnValue(now)
    const timeoutSpy = spyOn(window, 'setTimeout')
    const future = createEvent({
      id: 'future',
      slug: 'future',
      series_slug: 'live-series',
      has_live_chart: true,
      start_date: '2026-07-20T12:00:00.000Z',
      end_date: '2026-07-20T12:15:00.000Z',
    })
    mocks.useInfiniteQuery.mockImplementation(() => ({
      status: 'success',
      data: { pages: [{ events: [future], hasMore: false }] },
      dataUpdatedAt: 1,
      isFetching: false,
      isFetchingNextPage: false,
      fetchNextPage: mock(),
      hasNextPage: false,
      isPending: false,
      refetch: mocks.refetch,
    }))

    try {
      render(
        <EventsGrid
          filters={{
            tag: 'trending',
            mainTag: 'trending',
            search: '',
            bookmarked: false,
            frequency: 'all',
            sortBy: 'volume_24h',
            status: 'active',
            hideSports: false,
            hideCrypto: false,
            hideEarnings: false,
          }}
          initialEvents={[]}
          initialCurrentTimestamp={now}
          routeMainTag="trending"
          routeTag="trending"
        />,
      )
      expect(timeoutSpy.mock.calls.some(([, delay]) => delay === 2_147_483_647)).toBe(true)
      await act(async () => jest.advanceTimersByTime(1_000))
      expect(mocks.refetch).not.toHaveBeenCalled()
      await act(async () => jest.advanceTimersByTime(2_147_483_647 - 1_000))
      expect(
        timeoutSpy.mock.calls.filter(([, delay]) => typeof delay === 'number' && delay > 24 * 60 * 60_000),
      ).toHaveLength(2)
      expect(mocks.refetch).not.toHaveBeenCalled()
    } finally {
      timeoutSpy.mockRestore()
      useRealTimers()
    }
  })

  it('refreshes active series with the current client timestamp instead of the cached shell timestamp', async () => {
    const cachedTimestamp = Date.parse('2026-03-16T12:00:00.000Z')
    const liveTimestamp = Date.parse('2026-03-16T12:05:01.000Z')
    const fetchMock = mock().mockResolvedValue({
      ok: true,
      json: async () => ({ events: [], hasMore: false }),
    })
    stubGlobal('fetch', fetchMock)
    jest.setSystemTime(liveTimestamp)

    try {
      render(
        <EventsGrid
          filters={{
            tag: 'trending',
            mainTag: 'trending',
            search: '',
            bookmarked: false,
            frequency: 'all',
            sortBy: 'volume_24h',
            status: 'active',
            hideSports: false,
            hideCrypto: false,
            hideEarnings: false,
          }}
          initialEvents={[{ id: 'cached-series-event' } as any]}
          initialCurrentTimestamp={cachedTimestamp}
          routeMainTag="trending"
          routeTag="trending"
        />,
      )

      const queryOptions = mocks.useInfiniteQuery.mock.calls.at(-1)?.[0]
      await queryOptions.queryFn({ pageParam: 0 })

      const requestUrl = fetchMock.mock.calls[0]?.[0] as string
      expect(requestUrl).toContain(`currentTimestamp=${liveTimestamp}`)
      expect(requestUrl).not.toContain(`currentTimestamp=${cachedTimestamp}`)
    } finally {
      unstubAllGlobals()
    }
  })

  it('starts a fresh active feed query when the client timestamp hydrates from null', async () => {
    const filters = {
      tag: 'trending',
      mainTag: 'trending',
      search: '',
      bookmarked: false,
      frequency: 'all',
      sortBy: 'volume_24h',
      status: 'active',
      hideSports: false,
      hideCrypto: false,
      hideEarnings: false,
    } as const

    const hydratedTimestamp = Date.parse('2026-03-16T12:00:00.000Z')
    mocks.useCurrentTimestamp.mockReturnValueOnce(null).mockReturnValue(hydratedTimestamp)

    const { rerender } = render(
      <EventsGrid
        filters={filters}
        initialEvents={[{ id: 'server-seeded-event' } as any]}
        initialCurrentTimestamp={null}
        routeMainTag="trending"
        routeTag="trending"
      />,
    )

    const pendingClockOptions = mocks.useInfiniteQuery.mock.calls.at(-1)?.[0]
    expect(pendingClockOptions.queryKey).toContain('clock-pending')
    expect(pendingClockOptions.enabled).toBe(false)
    expect(pendingClockOptions.initialData).toEqual({
      pages: [{ events: [{ id: 'server-seeded-event' }], hasMore: false }],
      pageParams: [0],
    })

    await act(async () => {
      rerender(
        <EventsGrid
          filters={filters}
          initialEvents={[{ id: 'server-seeded-event' } as any]}
          initialCurrentTimestamp={null}
          routeMainTag="trending"
          routeTag="trending"
        />,
      )
    })

    const readyClockOptions = mocks.useInfiniteQuery.mock.calls.at(-1)?.[0]
    expect(mocks.refetch).not.toHaveBeenCalled()
    expect(readyClockOptions.queryKey).toContain('clock-ready')
    expect(readyClockOptions.enabled).toBe(true)
    expect(readyClockOptions.initialData).toBeUndefined()
    expect(readyClockOptions.refetchInterval).toBe(60_000)
  })

  it('hydrates new route initial data with newest-first sort', async () => {
    const newestLowVolumeEvent = {
      id: 'newer-low-volume-event',
      created_at: '2026-03-16T12:00:00.000Z',
      volume_24h: 1,
    }
    const olderHighVolumeEvent = {
      id: 'older-high-volume-event',
      created_at: '2026-03-15T12:00:00.000Z',
      volume_24h: 10_000,
    }
    const newestFirstEvents = [newestLowVolumeEvent, olderHighVolumeEvent] as any[]
    const fetchMock = mock().mockResolvedValue({
      ok: true,
      json: async () => [],
    })
    stubGlobal('fetch', fetchMock)

    try {
      render(
        <EventsGrid
          filters={{
            tag: 'new',
            mainTag: 'new',
            search: '',
            bookmarked: false,
            frequency: 'all',
            sortBy: 'created_at',
            status: 'active',
            hideSports: false,
            hideCrypto: false,
            hideEarnings: false,
          }}
          initialEvents={newestFirstEvents}
          initialCurrentTimestamp={Date.parse('2026-03-16T12:00:00.000Z')}
          routeMainTag="new"
          routeTag="new"
        />,
      )

      const queryOptions = mocks.useInfiniteQuery.mock.calls.at(-1)?.[0]
      expect(queryOptions.queryKey).toContain('created_at')
      expect(queryOptions.queryKey).not.toContain('volume_24h')
      expect(queryOptions.initialData).toEqual({
        pages: [{ events: newestFirstEvents, hasMore: false }],
        pageParams: [0],
      })
      expect(queryOptions.initialData.pages[0].events.map((event: any) => event.id)).toEqual([
        'newer-low-volume-event',
        'older-high-volume-event',
      ])

      await queryOptions.queryFn({ pageParam: 0 })

      const requestUrl = fetchMock.mock.calls[0]?.[0] as string
      expect(requestUrl).toContain('tag=new')
      expect(requestUrl).toContain('sort=created_at')
    } finally {
      unstubAllGlobals()
    }
  })

  it('passes the selected sort to the events API request', async () => {
    const fetchMock = mock().mockResolvedValue({
      ok: true,
      json: async () => [],
    })
    stubGlobal('fetch', fetchMock)

    render(
      <EventsGrid
        filters={{
          tag: 'trending',
          mainTag: 'trending',
          search: '',
          bookmarked: false,
          frequency: 'all',
          sortBy: 'volume',
          status: 'active',
          hideSports: false,
          hideCrypto: false,
          hideEarnings: false,
        }}
        initialEvents={[]}
        initialCurrentTimestamp={Date.parse('2026-03-16T12:00:00.000Z')}
        routeMainTag="trending"
        routeTag="trending"
      />,
    )

    const queryOptions = mocks.useInfiniteQuery.mock.calls.at(-1)?.[0]
    expect(queryOptions.queryKey).toContain('volume')

    await queryOptions.queryFn({ pageParam: 0 })

    const requestUrl = fetchMock.mock.calls[0]?.[0] as string
    expect(requestUrl).toContain('sort=volume')

    unstubAllGlobals()
  })
})
