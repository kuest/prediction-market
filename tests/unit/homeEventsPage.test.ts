import { beforeEach, describe, expect, it, mock } from 'bun:test'

import * as actualHomeEvents from '@/lib/home-events'

import { hoisted } from '../bun-test-helpers'

const realFilterHomeEvents = actualHomeEvents.filterHomeEvents

const mocks = hoisted(() => ({
  cacheTag: mock(),
  filterHomeEvents: mock(),
  getEventsBySlugs: mock(),
  listEvents: mock(),
}))

void mock.module('next/cache', () => ({
  cacheTag: (...args: any[]) => mocks.cacheTag(...args),
}))

void mock.module('@/lib/db/queries/event', () => ({
  EventRepository: {
    getEventsBySlugs: (...args: any[]) => mocks.getEventsBySlugs(...args),
    listEvents: (...args: any[]) => mocks.listEvents(...args),
  },
}))

void mock.module('@/lib/home-events', () => {
  return {
    ...actualHomeEvents,
    filterHomeEvents: (...args: any[]) => mocks.filterHomeEvents(...args),
  }
})

describe('listHomeEventsPage', () => {
  const queryBatchSize = 128
  const initialPageSize = 33

  beforeEach(() => {
    mocks.cacheTag.mockReset()
    mocks.listEvents.mockReset()
    mocks.filterHomeEvents.mockReset()
    mocks.getEventsBySlugs.mockReset()
    mocks.getEventsBySlugs.mockImplementation(async (slugs: string[]) => ({
      data: slugs.map((slug) => ({ id: slug, slug })),
      error: null,
    }))
  })

  it('omits detail text from cards without mutating repository events or market data', async () => {
    const market = Object.freeze({
      condition_id: 'condition-1',
      title: 'Market title',
      market_rules: 'Detailed market resolution rules',
      resolution_source_url: 'https://x.com/example',
      metadata: Object.freeze({ short_title: 'October 29', image: '/market.png' }),
      condition: Object.freeze({ resolved: true, payout_numerators: [1, 0] }),
      outcomes: Object.freeze([{ outcome_index: 0, token_id: 'token-1', buy_price: 0.75 }]),
    })
    const event = Object.freeze({
      id: 'event-1',
      slug: 'event-1',
      title: 'Event title',
      rules: 'Detailed event resolution rules',
      additional_context: 'Detailed event context',
      additional_context_updated_at: '2026-10-29T12:00:00Z',
      markets: Object.freeze([market]),
    })
    mocks.listEvents.mockResolvedValueOnce({ data: [event], error: null })

    const { listHomeEventsPage } = await import('@/lib/home-events-page')
    const result = await listHomeEventsPage({
      bookmarked: false,
      cardPayload: true,
      locale: 'en',
      mainTag: 'trending',
      status: 'resolved',
      tag: 'trending',
      userId: '',
    })

    const card = result.data[0]!
    expect(card).not.toHaveProperty('rules')
    expect(card).not.toHaveProperty('additional_context')
    expect(card).not.toHaveProperty('additional_context_updated_at')
    expect(card.markets[0]).not.toHaveProperty('market_rules')
    expect(card).toMatchObject({ id: event.id, slug: event.slug, title: event.title })
    expect(card.markets[0]).toEqual({
      condition_id: market.condition_id,
      title: market.title,
      resolution_source_url: market.resolution_source_url,
      metadata: market.metadata,
      condition: market.condition,
      outcomes: market.outcomes,
    })
    expect(card).not.toBe(event)
    expect(card.markets).not.toBe(event.markets)
    expect(card.markets[0]).not.toBe(market)
    expect(event.rules).toBe('Detailed event resolution rules')
    expect(event.additional_context).toBe('Detailed event context')
    expect(event.additional_context_updated_at).toBe('2026-10-29T12:00:00Z')
    expect(market.market_rules).toBe('Detailed market resolution rules')
  })

  it('preserves the complete legacy payload unless the card projection is requested', async () => {
    const event = {
      id: 'event-1',
      slug: 'event-1',
      rules: 'Detailed event resolution rules',
      additional_context: 'Detailed event context',
      additional_context_updated_at: '2026-10-29T12:00:00Z',
      markets: [
        {
          condition_id: 'condition-1',
          market_rules: 'Detailed market resolution rules',
          sports: { sports_source_market_id: 'source-market-1' },
          condition: { outcomes: [{ token_id: 'token-1', outcome_index: 0 }] },
          outcomes: [{ token_id: 'token-1', outcome_index: 0, buy_price: 0.75 }],
        },
      ],
    }
    mocks.listEvents.mockResolvedValueOnce({ data: [event], error: null })

    const { listHomeEventsPage } = await import('@/lib/home-events-page')
    const result = await listHomeEventsPage({
      bookmarked: false,
      locale: 'en',
      mainTag: 'trending',
      status: 'resolved',
      tag: 'trending',
      userId: '',
    })

    expect(result.data).toEqual([event])
    expect(result.data[0]).toBe(event)
    expect(result.data[0]?.markets).toBe(event.markets)
  })

  it('queries one SQL-filtered page for resolved pages without home visibility filters', async () => {
    const resolvedPage = Array.from({ length: 32 }, (_, index) => ({ id: `resolved-${index}` }))

    mocks.listEvents.mockResolvedValueOnce({ data: resolvedPage, error: null })
    mocks.filterHomeEvents.mockReturnValueOnce(resolvedPage.slice(0, 20))

    const { listHomeEventsPage } = await import('@/lib/home-events-page')
    const result = await listHomeEventsPage({
      bookmarked: false,
      locale: 'en',
      mainTag: 'trending',
      offset: 96,
      status: 'resolved',
      tag: 'trending',
      userId: '',
    })

    expect(mocks.filterHomeEvents).not.toHaveBeenCalled()
    expect(mocks.listEvents).toHaveBeenCalledTimes(1)
    expect(mocks.listEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeSportsAuxiliary: true,
        hideCrypto: false,
        hideEarnings: false,
        hideSports: false,
        limit: 33,
        offset: 96,
        preferResolvedDateOrder: true,
        skipLivePricing: true,
      }),
    )
    expect(result).toEqual({
      data: resolvedPage,
      error: null,
      currentTimestamp: null,
      hasMore: false,
    })
  })

  it('applies home visibility filters before slicing resolved pages with hide toggles', async () => {
    const hiddenCryptoEvents = Array.from({ length: 100 }, (_, index) => ({
      id: `crypto-event-${index}`,
      slug: `bitcoin-up-or-down-on-june-${index + 1}-2026`,
      main_tag: 'Crypto',
      tags: [{ slug: 'crypto' }],
    }))
    const visibleFinanceEvents = Array.from({ length: 36 }, (_, index) => ({
      id: `finance-event-${index}`,
      slug: `meta-up-or-down-on-june-${index + 1}-2026`,
      main_tag: 'Finance',
      tags: [{ slug: 'finance' }],
    }))
    const firstBatch = [...hiddenCryptoEvents, ...visibleFinanceEvents.slice(0, 28)]
    const secondBatch = visibleFinanceEvents.slice(28)

    mocks.listEvents
      .mockResolvedValueOnce({ data: firstBatch, error: null })
      .mockResolvedValueOnce({ data: secondBatch, error: null })
    mocks.filterHomeEvents.mockImplementation((events: any[]) => events.filter((event) => event.main_tag !== 'Crypto'))

    const { listHomeEventsPage } = await import('@/lib/home-events-page')
    const result = await listHomeEventsPage({
      bookmarked: false,
      hideCrypto: true,
      locale: 'en',
      mainTag: 'trending',
      status: 'resolved',
      tag: 'trending',
      userId: '',
    })

    expect(mocks.listEvents).toHaveBeenCalledTimes(2)
    expect(mocks.listEvents).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        excludeSportsAuxiliary: true,
        hideCrypto: true,
        limit: queryBatchSize,
        offset: 0,
        preferResolvedDateOrder: true,
        skipLivePricing: true,
      }),
    )
    expect(mocks.listEvents).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        excludeSportsAuxiliary: true,
        hideCrypto: true,
        hideEarnings: false,
        hideSports: false,
        limit: queryBatchSize,
        offset: queryBatchSize,
        preferResolvedDateOrder: true,
        skipLivePricing: true,
      }),
    )
    expect(mocks.filterHomeEvents).toHaveBeenNthCalledWith(
      1,
      firstBatch,
      expect.objectContaining({
        hideCrypto: true,
        status: 'resolved',
      }),
    )
    expect(mocks.filterHomeEvents).toHaveBeenNthCalledWith(
      2,
      secondBatch,
      expect.objectContaining({
        hideCrypto: true,
        status: 'resolved',
      }),
    )
    expect(mocks.filterHomeEvents).toHaveBeenNthCalledWith(
      3,
      [...firstBatch, ...secondBatch],
      expect.objectContaining({
        hideCrypto: true,
        status: 'resolved',
      }),
    )
    expect(result).toEqual({
      data: visibleFinanceEvents.slice(0, 32),
      error: null,
      currentTimestamp: null,
      hasMore: true,
    })
  })

  it('forwards bookmarked filters to the resolved repository shortcut', async () => {
    mocks.listEvents.mockResolvedValueOnce({ data: [], error: null })

    const { listHomeEventsPage } = await import('@/lib/home-events-page')
    await listHomeEventsPage({
      bookmarked: true,
      locale: 'en',
      mainTag: 'trending',
      status: 'resolved',
      tag: 'trending',
      userId: 'user-1',
    })

    expect(mocks.listEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        bookmarked: true,
        limit: 33,
        offset: 0,
        preferResolvedDateOrder: true,
        status: 'resolved',
        userId: 'user-1',
      }),
    )
  })

  it('stops after the first page when no recurring series can be replaced', async () => {
    const firstPage = Array.from({ length: initialPageSize }, (_, index) => ({ id: `event-${index}` }))

    mocks.listEvents.mockResolvedValueOnce({ data: firstPage, error: null })
    mocks.filterHomeEvents.mockReturnValueOnce(firstPage)

    const { listHomeEventsPage } = await import('@/lib/home-events-page')
    const result = await listHomeEventsPage({
      bookmarked: false,
      locale: 'en',
      mainTag: 'tech',
      status: 'active',
      tag: 'tech',
      userId: '',
    })

    expect(mocks.listEvents).toHaveBeenCalledTimes(1)
    expect(mocks.listEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeSportsAuxiliary: true,
        limit: initialPageSize,
        offset: 0,
      }),
    )
    expect(result).toEqual({
      data: firstPage.slice(0, 32),
      error: null,
      currentTimestamp: null,
      hasMore: true,
    })
  })

  it('stops after the first page for sports-primary series events', async () => {
    const firstPage = Array.from({ length: initialPageSize }, (_, index) => ({
      id: `event-${index}`,
      ...(index === 0 ? { series_slug: 'sports-series', sports_event_id: 'sports-event-1' } : {}),
    }))

    mocks.listEvents.mockResolvedValueOnce({ data: firstPage, error: null })
    mocks.filterHomeEvents.mockReturnValueOnce(firstPage)

    const { listHomeEventsPage } = await import('@/lib/home-events-page')
    const result = await listHomeEventsPage({
      bookmarked: false,
      locale: 'en',
      mainTag: 'sports',
      status: 'active',
      tag: 'sports',
      userId: '',
    })

    expect(mocks.listEvents).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      data: firstPage.slice(0, 32),
      error: null,
      currentTimestamp: null,
      hasMore: true,
    })
  })

  it('keeps hasMore when the 33rd candidate is an expired live series and a later card is visible', async () => {
    const currentTimestamp = Date.parse('2026-10-29T12:00:00Z')
    const visibleFirstPage = Array.from({ length: 32 }, (_, index) => ({
      id: `event-${index}`,
      slug: `event-${index}`,
      status: 'active' as const,
      created_at: '2026-10-28T12:00:00Z',
      updated_at: '2026-10-28T12:00:00Z',
      markets: [],
    }))
    const expiredLookahead = {
      id: 'expired-live-series',
      slug: 'expired-live-series',
      status: 'active' as const,
      created_at: '2026-10-28T12:00:00Z',
      updated_at: '2026-10-28T12:00:00Z',
      series_slug: 'live-series',
      has_live_chart: true,
      start_date: '2026-10-29T11:00:00Z',
      end_date: '2026-10-29T11:30:00Z',
      markets: [{ is_resolved: false, end_time: '2026-10-29T11:30:00Z' }],
    }
    const nextVisibleEvent = {
      ...visibleFirstPage[0],
      id: 'later-visible-card',
      slug: 'later-visible-card',
    }
    mocks.listEvents
      .mockResolvedValueOnce({ data: [...visibleFirstPage, expiredLookahead], error: null })
      .mockResolvedValueOnce({ data: [nextVisibleEvent], error: null })
    mocks.filterHomeEvents.mockImplementation(realFilterHomeEvents)

    const { listHomeEventsPage } = await import('@/lib/home-events-page')
    const result = await listHomeEventsPage({
      bookmarked: false,
      currentTimestamp,
      locale: 'en',
      mainTag: 'tech',
      status: 'active',
      tag: 'tech',
      userId: '',
    })

    expect(mocks.listEvents).toHaveBeenCalledTimes(2)
    expect(mocks.listEvents).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 33 }))
    expect(mocks.getEventsBySlugs).not.toHaveBeenCalled()
    expect(result.data).toEqual(visibleFirstPage)
    expect(result.hasMore).toBe(true)
  })

  it('forwards active home visibility filters to every candidate batch', async () => {
    const firstBatch = Array.from({ length: queryBatchSize }, (_, index) => ({
      id: `event-${index}`,
      ...(index === 0 ? { series_slug: 'series-1' } : {}),
    }))
    const secondBatch = [{ id: 'event-last' }]

    mocks.listEvents
      .mockResolvedValueOnce({ data: firstBatch, error: null })
      .mockResolvedValueOnce({ data: secondBatch, error: null })
    mocks.filterHomeEvents.mockReturnValueOnce([...firstBatch, ...secondBatch])

    const { listHomeEventsPage } = await import('@/lib/home-events-page')
    await listHomeEventsPage({
      bookmarked: false,
      hideCrypto: true,
      hideEarnings: true,
      hideSports: true,
      locale: 'en',
      mainTag: 'trending',
      status: 'active',
      tag: 'trending',
      userId: '',
    })

    expect(mocks.listEvents).toHaveBeenCalledTimes(2)
    expect(mocks.listEvents).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        hideCrypto: true,
        hideEarnings: true,
        hideSports: true,
        limit: queryBatchSize,
        offset: 0,
      }),
    )
    expect(mocks.listEvents).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        hideCrypto: true,
        hideEarnings: true,
        hideSports: true,
        limit: queryBatchSize,
        offset: queryBatchSize,
      }),
    )
  })

  it('stops a later active page after a complete visible prefix without recurring series', async () => {
    const firstBatch = Array.from({ length: queryBatchSize }, (_, index) => ({
      id: `event-${index}`,
      slug: `event-${index}`,
    }))
    mocks.listEvents.mockResolvedValueOnce({ data: firstBatch, error: null, updatedAt: 20_000 })
    mocks.filterHomeEvents.mockImplementation((events: any[]) => events)

    const { listHomeEventsPage } = await import('@/lib/home-events-page')
    const result = await listHomeEventsPage({
      bookmarked: false,
      includeUpdatedAt: true,
      locale: 'en',
      mainTag: 'tech',
      offset: 32,
      status: 'active',
      tag: 'tech',
      userId: '',
    })

    expect(mocks.listEvents).toHaveBeenCalledTimes(1)
    expect(mocks.getEventsBySlugs).not.toHaveBeenCalled()
    expect(result).toEqual({
      data: firstBatch.slice(32, 64),
      error: null,
      currentTimestamp: null,
      hasMore: true,
      updatedAt: 20_000,
    })
  })

  it('continues an active filtered page until there is a visible lookahead', async () => {
    const firstBatch = Array.from({ length: queryBatchSize }, (_, index) => ({
      id: `event-${index}`,
      slug: `event-${index}`,
      main_tag: index < 96 ? 'Crypto' : 'Finance',
    }))
    const nextVisibleEvent = { id: 'event-next', slug: 'event-next', main_tag: 'Finance' }
    mocks.listEvents
      .mockResolvedValueOnce({ data: firstBatch, error: null })
      .mockResolvedValueOnce({ data: [nextVisibleEvent], error: null })
    mocks.filterHomeEvents.mockImplementation((events: any[]) => events.filter((event) => event.main_tag !== 'Crypto'))

    const { listHomeEventsPage } = await import('@/lib/home-events-page')
    const result = await listHomeEventsPage({
      bookmarked: false,
      hideCrypto: true,
      locale: 'en',
      mainTag: 'trending',
      status: 'active',
      tag: 'trending',
      userId: '',
    })

    expect(mocks.listEvents).toHaveBeenCalledTimes(2)
    expect(result.data).toEqual(firstBatch.slice(96))
    expect(result.hasMore).toBe(true)
  })

  it('checks exhaustion when a full batch has exactly enough events for the final page', async () => {
    const firstBatch = Array.from({ length: queryBatchSize }, (_, index) => ({
      id: `event-${index}`,
      slug: `event-${index}`,
    }))
    mocks.listEvents
      .mockResolvedValueOnce({ data: firstBatch, error: null })
      .mockResolvedValueOnce({ data: [], error: null })
    mocks.filterHomeEvents.mockImplementation((events: any[]) => events)

    const { listHomeEventsPage } = await import('@/lib/home-events-page')
    const result = await listHomeEventsPage({
      bookmarked: false,
      locale: 'en',
      mainTag: 'tech',
      offset: 96,
      status: 'active',
      tag: 'tech',
      userId: '',
    })

    expect(mocks.listEvents).toHaveBeenCalledTimes(2)
    expect(result.data).toEqual(firstBatch.slice(96))
    expect(result.hasMore).toBe(false)
  })

  it('keeps scanning active pages when recurring series can replace earlier events', async () => {
    const firstPage = Array.from({ length: initialPageSize }, (_, index) => ({
      id: `page-1-${index}`,
      slug: `page-1-${index}`,
      ...(index === 0 ? { series_slug: 'series-1' } : {}),
    }))
    const secondBatch = Array.from({ length: queryBatchSize }, (_, index) => ({
      id: `batch-2-${index}`,
      slug: `batch-2-${index}`,
    }))
    const thirdBatch: any[] = []
    const visibleAfterAllBatches = [...secondBatch.slice(0, 8), ...firstPage.slice(8)]

    mocks.listEvents
      .mockResolvedValueOnce({ data: firstPage, error: null, updatedAt: 20_000 })
      .mockResolvedValueOnce({ data: secondBatch, error: null, updatedAt: 10_000 })
      .mockResolvedValueOnce({ data: thirdBatch, error: null, updatedAt: 30_000 })

    mocks.filterHomeEvents.mockReturnValueOnce(visibleAfterAllBatches)

    const { listHomeEventsPage } = await import('@/lib/home-events-page')
    const result = await listHomeEventsPage({
      bookmarked: false,
      includeUpdatedAt: true,
      locale: 'en',
      mainTag: 'trending',
      status: 'active',
      tag: 'trending',
      userId: '',
    })

    expect(mocks.filterHomeEvents).toHaveBeenCalledTimes(1)
    expect(mocks.listEvents).toHaveBeenCalledTimes(3)
    expect(mocks.listEvents).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        excludeSportsAuxiliary: true,
        limit: initialPageSize,
        offset: 0,
      }),
    )
    expect(mocks.listEvents).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        excludeSportsAuxiliary: true,
        limit: queryBatchSize,
        offset: initialPageSize,
        skipLivePricing: true,
      }),
    )
    expect(mocks.listEvents).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        excludeSportsAuxiliary: true,
        limit: queryBatchSize,
        offset: initialPageSize + queryBatchSize,
        skipLivePricing: true,
      }),
    )
    expect(mocks.getEventsBySlugs).toHaveBeenCalledWith(
      secondBatch.slice(0, 8).map((event) => event.slug),
      '',
      'en',
      expect.objectContaining({ status: 'active', tag: 'trending', excludeSportsAuxiliary: true }),
    )
    expect(result).toEqual({
      data: visibleAfterAllBatches.slice(0, 32),
      error: null,
      currentTimestamp: null,
      hasMore: true,
      updatedAt: 10_000,
    })
  })

  it('refreshes only selected crypto cards with live prices after scanning a recurring series', async () => {
    const firstPage = Array.from({ length: initialPageSize }, (_, index) => ({
      id: `crypto-${index}`,
      slug: `crypto-${index}`,
      ...(index === 0 ? { series_slug: 'btc-15m' } : {}),
      price: 0.4,
    }))
    const laterEvent = { id: 'btc-next', slug: 'btc-next', series_slug: 'btc-15m', price: 0.4 }
    const selected = [laterEvent, firstPage[1]]
    mocks.listEvents
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: [laterEvent], error: null })
    mocks.filterHomeEvents.mockReturnValueOnce(selected)
    mocks.getEventsBySlugs.mockResolvedValueOnce({
      data: [{ ...laterEvent, price: 0.6 }],
      error: null,
    })

    const { listHomeEventsPage } = await import('@/lib/home-events-page')
    const result = await listHomeEventsPage({
      bookmarked: false,
      locale: 'en',
      mainTag: 'crypto',
      status: 'active',
      tag: 'crypto',
      userId: '',
    })

    expect(mocks.listEvents).toHaveBeenNthCalledWith(2, expect.objectContaining({ skipLivePricing: true }))
    expect(mocks.getEventsBySlugs).toHaveBeenCalledWith(
      ['btc-next'],
      '',
      'en',
      expect.objectContaining({ status: 'active', tag: 'crypto', excludeSportsAuxiliary: true }),
    )
    expect(result.data.map((event: { id: string; price: number }) => [event.id, event.price])).toEqual([
      ['btc-next', 0.6],
      ['crypto-1', 0.4],
    ])
  })

  it('does not refetch prices when all selected cards came from the priced first page', async () => {
    const firstPage = Array.from({ length: initialPageSize }, (_, index) => ({
      id: `first-${index}`,
      slug: `first-${index}`,
      ...(index === 0 ? { series_slug: 'btc-15m' } : {}),
      price: 0.4,
    }))
    mocks.listEvents
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: [], error: null })
    mocks.filterHomeEvents.mockReturnValueOnce(firstPage.slice(0, 32))

    const { listHomeEventsPage } = await import('@/lib/home-events-page')
    const result = await listHomeEventsPage({
      bookmarked: false,
      locale: 'en',
      mainTag: 'crypto',
      status: 'active',
      tag: 'crypto',
      userId: '',
    })

    expect(mocks.listEvents).toHaveBeenNthCalledWith(2, expect.objectContaining({ skipLivePricing: true }))
    expect(mocks.getEventsBySlugs).not.toHaveBeenCalled()
    expect(result.data).toEqual(firstPage.slice(0, 32))
  })

  it('keeps private recurring-series listings on the existing pricing path', async () => {
    const firstPage = Array.from({ length: initialPageSize }, (_, index) => ({
      id: `private-${index}`,
      slug: `private-${index}`,
      ...(index === 0 ? { series_slug: 'private-series' } : {}),
    }))
    mocks.listEvents
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: [], error: null })
    mocks.filterHomeEvents.mockReturnValueOnce(firstPage)

    const { listHomeEventsPage } = await import('@/lib/home-events-page')
    await listHomeEventsPage({
      bookmarked: true,
      locale: 'en',
      mainTag: 'crypto',
      status: 'active',
      tag: 'crypto',
      userId: 'user-1',
    })

    expect(mocks.listEvents).toHaveBeenNthCalledWith(2, expect.objectContaining({ skipLivePricing: false }))
    expect(mocks.getEventsBySlugs).not.toHaveBeenCalled()
  })

  it.each(['draft', 'hidden'])('omits a selected card that became %s before hydration', async () => {
    const firstPage = Array.from({ length: initialPageSize }, (_, index) => ({
      id: `event-${index}`,
      slug: `event-${index}`,
      ...(index === 0 ? { series_slug: 'btc-15m' } : {}),
    }))
    const laterEvent = { id: 'btc-next', slug: 'btc-next', series_slug: 'btc-15m' }
    mocks.listEvents
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: [laterEvent], error: null })
    mocks.filterHomeEvents.mockReturnValueOnce([laterEvent, firstPage[1]])
    mocks.getEventsBySlugs.mockResolvedValueOnce({ data: [], error: null })

    const { listHomeEventsPage } = await import('@/lib/home-events-page')
    const result = await listHomeEventsPage({
      bookmarked: false,
      locale: 'en',
      mainTag: 'trending',
      status: 'active',
      tag: 'trending',
      userId: '',
    })

    expect(mocks.getEventsBySlugs).toHaveBeenCalledWith(
      ['btc-next'],
      '',
      'en',
      expect.objectContaining({ status: 'active', tag: 'trending', excludeSportsAuxiliary: true }),
    )
    expect(result.data).toEqual([firstPage[1]])
    expect(mocks.listEvents).toHaveBeenCalledTimes(2)
  })

  it('does not restore unpriced cards from a cached scan if hydration fails', async () => {
    const firstPage = Array.from({ length: initialPageSize }, (_, index) => ({
      id: `event-${index}`,
      slug: `event-${index}`,
      ...(index === 0 ? { series_slug: 'btc-15m' } : {}),
    }))
    const laterEvent = { id: 'btc-next', slug: 'btc-next', series_slug: 'btc-15m' }
    const selected = [laterEvent, firstPage[1]]
    mocks.listEvents
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: [laterEvent], error: null })
    mocks.filterHomeEvents.mockReturnValueOnce(selected)
    mocks.getEventsBySlugs.mockResolvedValueOnce({ data: null, error: 'refresh failed' })

    const { listHomeEventsPage } = await import('@/lib/home-events-page')
    const result = await listHomeEventsPage({
      bookmarked: false,
      locale: 'en',
      mainTag: 'trending',
      status: 'active',
      tag: 'trending',
      userId: '',
    })

    expect(mocks.listEvents).toHaveBeenCalledTimes(2)
    expect(result.data).toEqual([firstPage[1]])
  })

  it('forwards sortBy to the events repository', async () => {
    mocks.listEvents.mockResolvedValueOnce({ data: [], error: null })
    mocks.filterHomeEvents.mockReturnValueOnce([])

    const { listHomeEventsPage } = await import('@/lib/home-events-page')
    await listHomeEventsPage({
      bookmarked: false,
      locale: 'en',
      mainTag: 'trending',
      sortBy: 'volume_24h',
      status: 'active',
      tag: 'trending',
      userId: '',
    })

    expect(mocks.listEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeSportsAuxiliary: true,
        limit: initialPageSize,
        sortBy: 'volume_24h',
      }),
    )
  })
})
