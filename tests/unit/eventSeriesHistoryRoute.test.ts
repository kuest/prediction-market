import { beforeEach, describe, expect, it, mock } from 'bun:test'
import * as nextServer from 'next/server'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  findPublicEvent: mock(),
  getSeriesEventsBySeriesSlug: mock(),
  select: mock(),
}))

const query = {
  from: () => query,
  where: () => query,
  limit: mocks.findPublicEvent,
}

void mock.module('next/server', () => ({
  ...nextServer,
  connection: async () => {},
}))

void mock.module('@/lib/drizzle', () => ({ db: { select: mocks.select } }))
void mock.module('@/lib/db/queries/event', () => ({
  EventRepository: { getSeriesEventsBySeriesSlug: mocks.getSeriesEventsBySeriesSlug },
}))

const { GET } = await import('@/app/api/events/series/route')

describe('event series history route', () => {
  beforeEach(() => {
    mocks.select.mockReset().mockReturnValue(query)
    mocks.findPublicEvent.mockReset()
    mocks.getSeriesEventsBySeriesSlug.mockReset()
  })

  it('rejects a missing event slug without querying the database', async () => {
    const response = await GET(new Request('https://example.com/api/events/series'))

    expect(response.status).toBe(400)
    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.getSeriesEventsBySeriesSlug).not.toHaveBeenCalled()
  })

  it('does not disclose series history when the current event is missing or not public', async () => {
    mocks.findPublicEvent.mockResolvedValue([])

    const response = await GET(new Request('https://example.com/api/events/series?eventSlug=hidden-event'))

    expect(response.status).toBe(404)
    expect(mocks.getSeriesEventsBySeriesSlug).not.toHaveBeenCalled()
  })

  it('resolves the series from the event instead of accepting a caller-supplied series slug', async () => {
    const history = [{ id: 'old-round', slug: 'old-round', status: 'resolved' }]
    mocks.findPublicEvent.mockResolvedValue([{ series_slug: ' btc-15m ' }])
    mocks.getSeriesEventsBySeriesSlug.mockResolvedValue({ data: history, error: null })

    const response = await GET(
      new Request('https://example.com/api/events/series?eventSlug=live-round&seriesSlug=private-series'),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.getSeriesEventsBySeriesSlug).toHaveBeenCalledWith('btc-15m')
    await expect(response.json()).resolves.toEqual(history)
  })

  it('returns no history for an event without a series', async () => {
    mocks.findPublicEvent.mockResolvedValue([{ series_slug: null }])

    const response = await GET(new Request('https://example.com/api/events/series?eventSlug=single-event'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([])
    expect(mocks.getSeriesEventsBySeriesSlug).not.toHaveBeenCalled()
  })

  it('returns a retryable server error instead of treating a failed history query as empty', async () => {
    mocks.findPublicEvent.mockResolvedValue([{ series_slug: 'btc-15m' }])
    mocks.getSeriesEventsBySeriesSlug.mockResolvedValue({ data: null, error: 'unavailable' })

    const response = await GET(new Request('https://example.com/api/events/series?eventSlug=live-round'))

    expect(response.status).toBe(500)
  })
})
