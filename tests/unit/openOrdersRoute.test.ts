import { afterEach, beforeEach, describe, expect, it, mock, jest } from 'bun:test'

import { hoisted, stubEnv, stubGlobal, unstubAllEnvs, unstubAllGlobals } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  buildClobHmacSignature: mock(() => 'sig'),
  fetch: mock(),
  findMany: mock(),
  findOutcome: mock(),
  getCurrentUser: mock(),
  getEventMarketMetadata: mock(),
  getPublicAssetUrl: mock((path: string) => `https://assets.test/${path}`),
  getUserTradingAuthSecrets: mock(),
  runQuery: mock(async (callback: () => Promise<unknown>) => await callback()),
}))

void mock.module('@/lib/db/queries/event', () => ({
  EventRepository: {
    getEventMarketMetadata: mocks.getEventMarketMetadata,
  },
}))

void mock.module('@/lib/db/queries/user', () => ({
  UserRepository: {
    getCurrentUser: mocks.getCurrentUser,
  },
}))

void mock.module('@/lib/db/utils/run-query', () => ({
  runQuery: mocks.runQuery,
}))

void mock.module('@/lib/drizzle', () => ({
  db: {
    query: {
      outcomes: { findFirst: mocks.findOutcome },
      markets: {
        findMany: mocks.findMany,
      },
    },
  },
}))

void mock.module('@/lib/hmac', () => ({
  buildClobHmacSignature: mocks.buildClobHmacSignature,
}))

void mock.module('@/lib/storage', () => ({
  getPublicAssetUrl: mocks.getPublicAssetUrl,
}))

void mock.module('@/lib/trading-auth/server', () => ({
  getUserTradingAuthSecrets: mocks.getUserTradingAuthSecrets,
}))

function address(lastByte: string) {
  return `0x${'0'.repeat(40 - lastByte.length)}${lastByte}` as const
}

describe('open orders routes', () => {
  beforeEach(() => {
    stubEnv('CLOB_URL', 'https://clob.local')
    stubGlobal('fetch', mocks.fetch)

    mocks.buildClobHmacSignature.mockReset()
    mocks.buildClobHmacSignature.mockReturnValue('sig')
    mocks.fetch.mockReset()
    mocks.findMany.mockReset()
    mocks.findOutcome.mockReset()
    mocks.getCurrentUser.mockReset()
    mocks.getEventMarketMetadata.mockReset()
    mocks.getPublicAssetUrl.mockReset()
    mocks.getPublicAssetUrl.mockImplementation((path: string) => `https://assets.test/${path}`)
    mocks.getUserTradingAuthSecrets.mockReset()
    mocks.runQuery.mockClear()
  })

  afterEach(() => {
    unstubAllEnvs()
    unstubAllGlobals()
    jest.restoreAllMocks()
  })

  it('normalizes portfolio open orders and keeps GTD intact', async () => {
    const userAddress = address('01')
    const depositWallet = address('02')

    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-1',
      address: userAddress,
      deposit_wallet_address: depositWallet,
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: {
        key: 'api-key',
        secret: 'secret',
        passphrase: 'passphrase',
      },
    })
    mocks.findMany.mockResolvedValueOnce([
      {
        condition_id: 'cond-1',
        title: 'Market title',
        slug: 'market-slug',
        icon_url: '',
        event: {
          slug: 'event-slug',
          title: 'Event title',
          icon_url: 'event-icon.png',
        },
        condition: {
          id: 'cond-1',
          outcomes: [
            {
              token_id: 'token-1',
              outcome_text: 'Yes',
              outcome_index: 0,
            },
          ],
        },
        is_active: true,
        is_resolved: false,
      },
    ])
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: 'order-1',
          status: 'live',
          market: 'cond-1',
          original_size: '12.5',
          outcome: 'token-1',
          maker_address: depositWallet,
          price: '0.7',
          side: 'BUY',
          size_matched: '3',
          asset_id: 'token-1',
          expiration: '0',
          order_type: 'GTD',
          created_at: '2026-05-23T00:00:00.000Z',
        },
      ],
    })

    const { GET } = await import('@/app/api/open-orders/route')
    const response = await GET(new Request('https://example.com/api/open-orders?market=cond-1&next_cursor=cursor-1'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          id: 'order-1',
          side: 'buy',
          type: 'GTD',
          status: 'live',
          price: 0.7,
          maker_amount: 8_750_000,
          taker_amount: 12_500_000,
          size_matched: 3_000_000,
          created_at: '2026-05-23T00:00:00.000Z',
          expiration: 0,
          outcome: {
            index: 0,
            text: 'Yes',
          },
          market: {
            condition_id: 'cond-1',
            title: 'Market title',
            slug: 'market-slug',
            icon_url: 'https://assets.test/event-icon.png',
            event_slug: 'event-slug',
            event_title: 'Event title',
            is_active: true,
            is_resolved: false,
          },
        },
      ],
      next_cursor: '',
    })

    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://clob.local/data/orders?market=cond-1&next_cursor=cursor-1',
      expect.objectContaining({
        method: 'GET',
      }),
    )
  })

  it('resolves the real condition for a portfolio asset-only filter', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce({ id: 'user-1', address: address('01') })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'api-key', secret: 'secret', passphrase: 'passphrase' },
    })
    mocks.findOutcome.mockResolvedValueOnce({ condition_id: 'cond-1' })
    mocks.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [], next_cursor: 'LTE=' }) })
    const { GET } = await import('@/app/api/open-orders/route')
    const response = await GET(new Request('https://example.com/api/open-orders?asset_id=123&next_cursor=cursor-1'))
    expect(response.status).toBe(200)
    expect(mocks.findOutcome).toHaveBeenCalledWith({ where: { token_id: '123' }, columns: { condition_id: true } })
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://clob.local/data/orders?market=cond-1&asset_id=123&next_cursor=cursor-1',
      expect.objectContaining({
        headers: expect.objectContaining({ KUEST_ADDRESS: address('01'), KUEST_API_KEY: 'api-key' }),
      }),
    )
  })

  it('rejects an unresolved asset without broadening the authenticated request', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce({ id: 'user-1', address: address('01') })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'api-key', secret: 'secret', passphrase: 'passphrase' },
    })
    mocks.findOutcome.mockResolvedValueOnce(undefined)
    const { GET } = await import('@/app/api/open-orders/route')
    const response = await GET(new Request('https://example.com/api/open-orders?asset_id=123'))
    expect(response.status).toBe(400)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each(['', '?market=cond-1&asset_id=123'])(
    'does not look up metadata for supplied or unfiltered markets: %s',
    async (query) => {
      mocks.getCurrentUser.mockResolvedValueOnce({ id: 'user-1', address: address('01') })
      mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
        clob: { key: 'api-key', secret: 'secret', passphrase: 'passphrase' },
      })
      mocks.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [], next_cursor: 'LTE=' }) })
      const { GET } = await import('@/app/api/open-orders/route')
      const response = await GET(new Request(`https://example.com/api/open-orders${query}`))
      expect(response.status).toBe(200)
      expect(mocks.findOutcome).not.toHaveBeenCalled()
    },
  )

  it('normalizes event open orders and keeps GTD intact', async () => {
    const userAddress = address('03')
    const depositWallet = address('04')

    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-2',
      address: userAddress,
      deposit_wallet_address: depositWallet,
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: {
        key: 'api-key',
        secret: 'secret',
        passphrase: 'passphrase',
      },
    })
    mocks.getEventMarketMetadata.mockResolvedValueOnce({
      data: [
        {
          condition_id: 'cond-2',
          title: 'Event market',
          slug: 'event-market-slug',
          is_active: true,
          is_resolved: false,
          outcomes: [
            {
              token_id: 'token-2',
              outcome_text: 'No',
              outcome_index: 1,
            },
          ],
        },
      ],
      error: null,
    })
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: 'order-2',
          status: 'live',
          market: 'cond-2',
          original_size: '8',
          outcome: 'token-2',
          maker_address: depositWallet,
          price: '0.25',
          side: 'SELL',
          size_matched: '2',
          asset_id: 'token-2',
          expiration: '0',
          order_type: 'GTD',
          created_at: '2026-05-23T00:00:00.000Z',
        },
      ],
    })

    const { GET } = await import('@/app/api/events/[slug]/open-orders/route')
    const response = await GET(
      new Request('https://example.com/api/events/event-slug/open-orders?conditionId=cond-2&next_cursor=cursor-2'),
      { params: Promise.resolve({ slug: 'event-slug' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          id: 'order-2',
          side: 'sell',
          type: 'GTD',
          status: 'live',
          price: 0.25,
          maker_amount: 8_000_000,
          taker_amount: 2_000_000,
          size_matched: 2_000_000,
          created_at: '2026-05-23T00:00:00.000Z',
          expiration: 0,
          outcome: {
            index: 1,
            text: 'No',
          },
          market: {
            condition_id: 'cond-2',
            title: 'Event market',
            slug: 'event-market-slug',
            is_active: true,
            is_resolved: false,
          },
        },
      ],
      next_cursor: '',
    })

    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://clob.local/data/orders?market=cond-2&next_cursor=cursor-2',
      expect.objectContaining({
        method: 'GET',
      }),
    )
  })
})
