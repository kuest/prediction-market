import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  buildSportsGamesCards: mock(),
  cacheLife: mock(),
  cacheTag: mock(),
  getLayoutData: mock(),
  hasDatabaseEnv: mock(),
  listEvents: mock(),
  listSportsFeedEvents: mock(),
}))

void mock.module('next/cache', () => ({
  cacheLife: (...args: any[]) => mocks.cacheLife(...args),
  cacheTag: (...args: any[]) => mocks.cacheTag(...args),
}))

void mock.module('@/app/[locale]/(platform)/sports/_components/SportsGamesCenter', () => ({
  default: function SportsGamesCenter() {
    return null
  },
}))

void mock.module('@/app/[locale]/(platform)/sports/_utils/sports-games-data', () => ({
  buildSportsGamesCards: (...args: any[]) => mocks.buildSportsGamesCards(...args),
}))

void mock.module('@/lib/db/env', () => ({
  hasDatabaseEnv: () => mocks.hasDatabaseEnv(),
}))

void mock.module('@/lib/db/queries/event', () => ({
  EventRepository: {
    listEvents: (...args: any[]) => mocks.listEvents(...args),
    listSportsFeedEvents: (...args: any[]) => mocks.listSportsFeedEvents(...args),
  },
}))

void mock.module('@/lib/db/queries/sports-menu', () => ({
  SportsMenuRepository: {
    getLayoutData: (...args: any[]) => mocks.getLayoutData(...args),
  },
}))

const { default: SportsFeedPageContent } =
  await import('@/app/[locale]/(platform)/sports/_components/SportsFeedPageContent')

describe('sportsFeedPageContent', () => {
  beforeEach(() => {
    mocks.buildSportsGamesCards.mockReset()
    mocks.cacheLife.mockReset()
    mocks.cacheTag.mockReset()
    mocks.getLayoutData.mockReset()
    mocks.hasDatabaseEnv.mockReset()
    mocks.hasDatabaseEnv.mockReturnValue(true)
    mocks.listEvents.mockReset()
    mocks.listSportsFeedEvents.mockReset()
  })

  it('loads soon feeds from the sports metadata feed query instead of the generic event list', async () => {
    const events = [{ id: 'event-1' }]
    const cards = [{ id: 'card-1' }]
    mocks.listSportsFeedEvents.mockResolvedValueOnce({ data: events, error: null })
    mocks.getLayoutData.mockResolvedValueOnce({
      data: { h1TitleBySlug: { soccer: 'Soccer' } },
      error: null,
    })
    mocks.buildSportsGamesCards.mockReturnValueOnce(cards)

    const element = await SportsFeedPageContent({
      pageMode: 'soon',
      sportSlug: 'soon',
      sportTitle: 'Upcoming Sports Games',
      vertical: 'sports',
    })

    expect(mocks.listSportsFeedEvents).toHaveBeenCalledWith({
      cacheVersion: 2,
      locale: 'en',
      mode: 'soon',
      sportsVertical: 'sports',
    })
    expect(mocks.listEvents).not.toHaveBeenCalled()
    expect(mocks.buildSportsGamesCards).toHaveBeenCalledWith(events)
    expect(element.props.children.props).toEqual(
      expect.objectContaining({
        cards,
        categoryTitleBySlug: { soccer: 'Soccer' },
        pageMode: 'soon',
        sportSlug: 'soon',
        sportTitle: 'Upcoming Sports Games',
        vertical: 'sports',
      }),
    )
  })

  it('falls back to the generic sports list when the feed query returns no events', async () => {
    const fallbackEvents = [{ id: 'event-2' }]
    const cards = [{ id: 'card-2' }]
    mocks.listSportsFeedEvents.mockResolvedValueOnce({ data: [], error: null })
    mocks.listEvents.mockResolvedValueOnce({ data: fallbackEvents, error: null })
    mocks.getLayoutData.mockResolvedValueOnce({
      data: { h1TitleBySlug: {} },
      error: null,
    })
    mocks.buildSportsGamesCards.mockReturnValueOnce(cards)

    await SportsFeedPageContent({
      pageMode: 'liveAndSoon',
      sportSlug: 'live',
      sportTitle: 'Live',
      vertical: 'sports',
    })

    expect(mocks.listEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeSportsAuxiliary: true,
        limit: 128,
        locale: 'en',
        sportsSection: 'games',
        sportsVertical: 'sports',
        status: 'active',
        tag: 'sports',
      }),
    )
    expect(mocks.buildSportsGamesCards).toHaveBeenCalledWith(fallbackEvents)
  })

  it('keeps no-database build results out of the runtime feed cache key', async () => {
    mocks.hasDatabaseEnv.mockReturnValueOnce(false)

    const element = await SportsFeedPageContent({
      pageMode: 'soon',
      sportSlug: 'soon',
      sportTitle: 'Upcoming Sports Games',
      vertical: 'sports',
    })

    expect(mocks.listSportsFeedEvents).not.toHaveBeenCalled()
    expect(mocks.listEvents).not.toHaveBeenCalled()
    expect(mocks.getLayoutData).not.toHaveBeenCalled()
    expect(element.props.children.props).toEqual(
      expect.objectContaining({
        cards: [],
        categoryTitleBySlug: {},
      }),
    )
  })
})
