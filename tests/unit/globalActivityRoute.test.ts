import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import { hoisted, stubGlobal, unstubAllGlobals } from '../bun-test-helpers'

const CONDITION_ALLOWED = `0x${'a'.repeat(64)}`
const CONDITION_BLOCKED = `0x${'b'.repeat(64)}`
const CREATOR_ALLOWED = '0x1111111111111111111111111111111111111111'
const CREATOR_BLOCKED = '0x2222222222222222222222222222222222222222'

const mocks = hoisted(() => ({
  findEvents: mock(),
  findMarkets: mock(),
  loadAllowedMarketCreatorWallets: mock(),
}))

void mock.module('@/lib/allowed-market-creators-server', () => ({
  loadAllowedMarketCreatorWallets: (...args: unknown[]) => mocks.loadAllowedMarketCreatorWallets(...args),
}))

void mock.module('@/lib/drizzle', () => ({
  db: {
    query: {
      events: { findMany: (...args: unknown[]) => mocks.findEvents(...args) },
      markets: { findMany: (...args: unknown[]) => mocks.findMarkets(...args) },
    },
  },
}))

const { GET } = await import('@/app/api/activity/route')

describe('global activity route', () => {
  const originalDataUrl = process.env.DATA_URL

  afterEach(() => {
    unstubAllGlobals()
    if (originalDataUrl === undefined) {
      delete process.env.DATA_URL
    } else {
      process.env.DATA_URL = originalDataUrl
    }
  })

  beforeEach(() => {
    stubGlobal('window', undefined)
    process.env.DATA_URL = 'https://data-api.test'
    mocks.findEvents.mockReset()
    mocks.findMarkets.mockReset()
    mocks.loadAllowedMarketCreatorWallets.mockReset()
    mocks.loadAllowedMarketCreatorWallets.mockResolvedValue({ data: [CREATOR_ALLOWED], error: null })
    mocks.findMarkets.mockResolvedValue([
      {
        condition_id: CONDITION_ALLOWED,
        event_id: 'event-allowed',
        condition: { creator: CREATOR_ALLOWED },
      },
      {
        condition_id: CONDITION_BLOCKED,
        event_id: 'event-blocked',
        condition: { creator: CREATOR_BLOCKED },
      },
    ])
    mocks.findEvents.mockResolvedValue([
      {
        id: 'event-allowed',
        eventTags: [{ tag: { slug: 'politics' } }],
      },
      {
        id: 'event-blocked',
        eventTags: [{ tag: { slug: 'sports' } }],
      },
    ])
  })

  it('loads a Data API page and keeps only trades from allowed market creators', async () => {
    const fetchMock = mock().mockResolvedValue(
      Response.json([
        {
          id: 'fill-allowed',
          conditionId: CONDITION_ALLOWED,
          event_id: 'event-allowed',
          proxyWallet: '0x3333333333333333333333333333333333333333',
          timestamp: 1_786_017_600,
          title: 'Allowed market',
          slug: 'allowed-market',
          eventSlug: 'allowed-event',
          outcome: 'Yes',
          outcomeIndex: 0,
          side: 'BUY',
          price: 0.5,
          size: 20,
        },
        {
          id: 'fill-blocked',
          conditionId: CONDITION_BLOCKED,
          event_id: 'event-blocked',
          proxyWallet: '0x4444444444444444444444444444444444444444',
          timestamp: 1_786_017_599,
          title: 'Blocked market',
          slug: 'blocked-market',
          eventSlug: 'blocked-event',
          outcome: 'No',
          outcomeIndex: 1,
          side: 'SELL',
          price: 0.5,
          size: 20,
        },
      ]),
    )
    stubGlobal('fetch', fetchMock)

    const response = await GET(new Request('https://example.com/api/activity?limit=100&offset=50'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      hasMore: false,
      nextOffset: null,
      items: [
        {
          id: 'fill-allowed:0x3333333333333333333333333333333333333333',
          categoryTags: ['politics'],
          order: {
            market: {
              title: 'Allowed market',
              slug: 'allowed-market',
            },
          },
        },
      ],
    })

    const dataApiUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(dataApiUrl.origin).toBe('https://data-api.test')
    expect(dataApiUrl.pathname).toBe('/trades')
    expect(Object.fromEntries(dataApiUrl.searchParams)).toEqual({
      limit: '50',
      offset: '50',
      takerOnly: 'true',
    })
  })

  it('returns an error when the Data API response is not an array', async () => {
    stubGlobal('fetch', mock().mockResolvedValue(Response.json({ error: 'invalid' })))

    const response = await GET(new Request('https://example.com/api/activity'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error. Try again in a few moments.' })
    expect(mocks.findMarkets).not.toHaveBeenCalled()
  })
})
