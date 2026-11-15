import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import { PUBLIC_EVENT_PAGE_CACHE_LIFE } from '@/lib/event-page-cache'
import { buildSportsSlugResolver } from '@/lib/sports-slug-mapping'

import { hoisted, stubGlobal, unstubAllGlobals } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  select: mock(),
  findFirst: mock(),
  cacheLife: mock(),
  cacheTag: mock(),
  sportsResolver: mock(),
  outcomePrices: mock(),
}))

void mock.module('next/cache', () => ({ cacheLife: mocks.cacheLife, cacheTag: mocks.cacheTag }))
void mock.module('@/lib/drizzle', () => ({
  db: { select: mocks.select, query: { events: { findFirst: mocks.findFirst } } },
}))
void mock.module('@/lib/db/queries/sports-menu', () => ({ getSportsSlugResolverFromDb: mocks.sportsResolver }))
void mock.module('@/lib/clob-event-prices', () => ({
  fetchOutcomePrices: mocks.outcomePrices,
  EVENT_PRICES_TIMEOUT_MS: 2_000,
  isPrerenderAbortError: () => false,
}))

const { EventRepository } = await import('@/lib/db/queries/event')

function queryResult<T>(result: Promise<T>, onStart = () => {}) {
  const query = {
    from: () => query,
    leftJoin: () => query,
    innerJoin: () => query,
    where: () => query,
    orderBy: () => query,
    limit: () => query,
    then: (resolve: (value: T) => unknown, reject: (error: unknown) => unknown) => {
      onStart()
      return result.then(resolve, reject)
    },
  }
  return query
}

function nextTask() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
const createdAt = new Date('2026-11-15T00:00:00Z')

describe('event repository first-load queries', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => fn.mockReset())
    mocks.sportsResolver.mockResolvedValue(buildSportsSlugResolver([]))
    mocks.outcomePrices.mockResolvedValue(new Map())
  })

  afterEach(() => {
    unstubAllGlobals()
  })

  it('loads market states and winning outcomes together and retains full series history', async () => {
    const pendingMarkets = Promise.withResolvers<Array<{ event_id: string; is_resolved: boolean }>>()
    let marketsStarted = false
    let winnersStarted = false
    const rows = Array.from({ length: 30 }, (_, index) => ({
      id: `event-${index}`,
      slug: `round-${index}`,
      status: 'active',
      end_date: createdAt,
      resolved_at: null,
      created_at: createdAt,
      sports_sport_slug: null,
      sports_series_slug: null,
      sports_tags: null,
    }))
    mocks.select
      .mockReturnValueOnce(queryResult(Promise.resolve(rows)))
      .mockReturnValueOnce(
        queryResult(pendingMarkets.promise, () => {
          marketsStarted = true
        }),
      )
      .mockReturnValueOnce(
        queryResult(Promise.resolve([{ event_id: 'event-0', outcome_text: 'Up' }]), () => {
          winnersStarted = true
        }),
      )

    const pending = EventRepository.getSeriesEventsBySeriesSlug('btc-up-or-down-5m')
    try {
      await nextTask()
      expect(marketsStarted).toBe(true)
      expect(winnersStarted).toBe(true)
    } finally {
      pendingMarkets.resolve(rows.map((row) => ({ event_id: row.id, is_resolved: true })))
    }

    const result = await pending
    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(30)
    expect(result.data?.[0]).toMatchObject({ slug: 'round-0', status: 'resolved', resolved_direction: 'up' })
    expect(mocks.sportsResolver).not.toHaveBeenCalled()
    expect(mocks.cacheLife).toHaveBeenCalledWith(PUBLIC_EVENT_PAGE_CACHE_LIFE)
    expect(mocks.cacheTag).toHaveBeenCalledWith(
      'series-events:btc-up-or-down-5m',
      'series-events:visibility',
      'sports:menu:structure',
    )
    expect(mocks.cacheTag.mock.calls.flat()).not.toContain('events:list')
  })

  it('loads route tags before the event row completes and exposes the series for early loading', async () => {
    const pendingRoute = Promise.withResolvers<Array<Record<string, unknown>>>()
    let tagsStarted = false
    mocks.select.mockReturnValueOnce(queryResult(pendingRoute.promise)).mockReturnValueOnce(
      queryResult(Promise.resolve([{ slug: 'crypto' }]), () => {
        tagsStarted = true
      }),
    )

    const pending = EventRepository.getEventRouteBySlug('bitcoin-round')
    try {
      await nextTask()
      expect(tagsStarted).toBe(true)
    } finally {
      pendingRoute.resolve([{ id: 'btc', slug: 'bitcoin-round', series_slug: 'btc-5m' }])
    }

    expect((await pending).data).toMatchObject({
      slug: 'bitcoin-round',
      series_slug: 'btc-5m',
      sports_sport_slug: null,
      tags: [{ slug: 'crypto' }],
    })
  })

  it('keeps real live prices while avoiding the sports menu for crypto events', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'btc',
      slug: 'bitcoin-round',
      title: 'Bitcoin up or down',
      created_at: createdAt,
      updated_at: createdAt,
      series_slug: 'btc-5m',
      eventTags: [],
      markets: [
        {
          condition_id: 'condition-1',
          title: 'Up or down',
          slug: 'up-or-down',
          condition: { outcomes: [{ token_id: 'up-token', outcome_index: 0, outcome_text: 'Up' }] },
        },
      ],
    })
    mocks.select.mockReturnValue(queryResult(Promise.resolve([])))
    mocks.outcomePrices.mockResolvedValue(new Map([['up-token', { buy: 0.43, sell: 0.41 }]]))
    stubGlobal(
      'fetch',
      mock(async () => Response.json([{ token_id: 'up-token', price: '0.42', side: 'BUY' }])),
    )

    const result = await EventRepository.getEventBySlug('bitcoin-round', '', 'en')

    expect(result.error).toBeNull()
    expect(mocks.sportsResolver).not.toHaveBeenCalled()
    expect(result.data?.markets[0]?.outcomes[0]).toMatchObject({
      buy_price: 0.43,
      sell_price: 0.41,
      last_trade_price: 0.42,
    })
  })

  it('tags shared chart configuration with the same series invalidation and lifetime', async () => {
    const config = { series_slug: 'btc-5m', enabled: true }
    mocks.select.mockReturnValue(queryResult(Promise.resolve([config])))

    expect(await EventRepository.getLiveChartConfigBySeriesSlug('btc-5m')).toEqual({ data: config, error: null })
    expect(mocks.cacheLife).toHaveBeenCalledWith(PUBLIC_EVENT_PAGE_CACHE_LIFE)
    expect(mocks.cacheTag).toHaveBeenCalledWith('series-events:btc-5m')
  })

  it('returns a transient series database error through QueryResult and retries the next read', async () => {
    mocks.select
      .mockImplementationOnce(() => {
        throw new Error('Database temporarily unavailable')
      })
      .mockReturnValueOnce(queryResult(Promise.resolve([])))

    const failed = await EventRepository.getSeriesEventsBySeriesSlug('btc-5m')
    expect(failed.data).toBeNull()
    expect(failed.error).toBeString()
    expect(await EventRepository.getSeriesEventsBySeriesSlug('btc-5m')).toEqual({ data: [], error: null })
    expect(mocks.select).toHaveBeenCalledTimes(2)
  })

  it('returns a transient chart database error through QueryResult and recovers without caching a missing config', async () => {
    const config = { series_slug: 'btc-5m', enabled: true }
    mocks.select
      .mockImplementationOnce(() => {
        throw new Error('Database temporarily unavailable')
      })
      .mockReturnValueOnce(queryResult(Promise.resolve([config])))

    const failed = await EventRepository.getLiveChartConfigBySeriesSlug('btc-5m')
    expect(failed.data).toBeNull()
    expect(failed.error).toBeString()
    expect(await EventRepository.getLiveChartConfigBySeriesSlug('btc-5m')).toEqual({ data: config, error: null })
    expect(mocks.select).toHaveBeenCalledTimes(2)
  })
})
