import { afterEach, describe, expect, it, mock } from 'bun:test'

import { fetchEventsApi, fetchHomeEventsPageApi } from '@/lib/events-api'

import { stubGlobal, unstubAllGlobals } from '../bun-test-helpers'

describe('events API errors', () => {
  afterEach(() => {
    unstubAllGlobals()
  })

  it('distinguishes the generic events request error', async () => {
    stubGlobal('fetch', mock().mockResolvedValue({ ok: false }))

    await expect(fetchEventsApi({ tag: 'trending', locale: 'en' })).rejects.toThrow('Failed to fetch events')
  })

  it('forwards an abort signal to generic event requests', async () => {
    const fetchMock = mock().mockResolvedValue({
      ok: true,
      json: async () => [],
    })
    const controller = new AbortController()
    stubGlobal('fetch', fetchMock)

    await fetchEventsApi({ tag: 'sports', locale: 'en', signal: controller.signal })

    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), { signal: controller.signal })
  })

  it('adds home feed context to page request errors', async () => {
    stubGlobal('fetch', mock().mockResolvedValue({ ok: false }))

    await expect(fetchHomeEventsPageApi({ tag: 'trending', locale: 'en' })).rejects.toThrow(
      'Failed to fetch home feed events',
    )
  })

  it('requests card payloads only through the home grid helper', async () => {
    const fetchMock = mock().mockResolvedValue({
      ok: true,
      json: async () => ({ events: [], hasMore: false }),
    })
    stubGlobal('fetch', fetchMock)

    await fetchEventsApi({ tag: 'sports', locale: 'en' })
    await fetchHomeEventsPageApi({ tag: 'trending', locale: 'en' })

    const genericParams = new URL(String(fetchMock.mock.calls[0]![0]), 'https://example.com').searchParams
    const homeParams = new URL(String(fetchMock.mock.calls[1]![0]), 'https://example.com').searchParams
    expect(genericParams.has('cardPayload')).toBe(false)
    expect(homeParams.get('homeFeed')).toBe('true')
    expect(homeParams.get('includePageInfo')).toBe('true')
    expect(homeParams.get('cardPayload')).toBe('true')
  })
})
