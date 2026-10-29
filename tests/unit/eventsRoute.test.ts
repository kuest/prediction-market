import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  getCurrentUser: mock(),
  listHomeEventsPage: mock(),
  listEvents: mock(),
}))

void mock.module('@/lib/db/queries/user', () => ({
  UserRepository: {
    getCurrentUser: (...args: any[]) => mocks.getCurrentUser(...args),
  },
}))

void mock.module('@/lib/db/queries/event', () => ({
  EventRepository: {
    listEvents: (...args: any[]) => mocks.listEvents(...args),
  },
}))

void mock.module('@/lib/home-events-page', () => ({
  listHomeEventsPage: (...args: any[]) => mocks.listHomeEventsPage(...args),
}))

const { GET } = await import('@/app/api/events/route')

describe('events route', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset()
    mocks.listHomeEventsPage.mockReset()
    mocks.listEvents.mockReset()
  })

  it('returns an empty payload for anonymous bookmarked requests', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null)

    const response = await GET(new Request('https://example.com/api/events?bookmarked=true&locale=en'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([])
    expect(mocks.listEvents).not.toHaveBeenCalled()
    expect(mocks.listHomeEventsPage).not.toHaveBeenCalled()
  })

  it('skips current user lookup when bookmark state is explicitly excluded', async () => {
    mocks.listEvents.mockResolvedValueOnce({ data: [], error: null })

    const response = await GET(
      new Request('https://example.com/api/events?search=brazil&status=all&includeBookmarkState=false&locale=en'),
    )

    expect(response.status).toBe(200)
    expect(mocks.getCurrentUser).not.toHaveBeenCalled()
    expect(mocks.listEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        search: 'brazil',
        status: 'all',
        userId: undefined,
      }),
    )
  })

  it('forwards mainTag to the events repository', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce({ id: 'user-1' })
    mocks.listEvents.mockResolvedValueOnce({ data: [], error: null })

    const response = await GET(new Request('https://example.com/api/events?tag=ai&mainTag=tech&locale=en'))

    expect(response.status).toBe(200)
    expect(mocks.listEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: 'ai',
        mainTag: 'tech',
        userId: 'user-1',
      }),
    )
  })

  it('forwards validated sort params to the home feed loader', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce({ id: 'user-1' })
    mocks.listHomeEventsPage.mockResolvedValueOnce({ data: [], error: null })

    const response = await GET(new Request('https://example.com/api/events?homeFeed=true&sort=volume_24h&locale=en'))

    expect(response.status).toBe(200)
    expect(mocks.listHomeEventsPage).toHaveBeenCalledWith(
      expect.objectContaining({
        sortBy: 'volume_24h',
        cardPayload: false,
      }),
    )
  })

  it('returns exact page availability when requested by the home grid', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null)
    mocks.listHomeEventsPage.mockResolvedValueOnce({
      data: [{ id: 'event-1' }],
      error: null,
      hasMore: true,
    })

    const response = await GET(
      new Request('https://example.com/api/events?homeFeed=true&includePageInfo=true&cardPayload=true&locale=en'),
    )

    expect(response.status).toBe(200)
    expect(mocks.listHomeEventsPage).toHaveBeenCalledWith(expect.objectContaining({ cardPayload: true }))
    await expect(response.json()).resolves.toEqual({
      events: [{ id: 'event-1' }],
      hasMore: true,
    })
  })
})
