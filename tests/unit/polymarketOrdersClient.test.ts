import type { ApiKeyCreds, ClobClient } from '@polymarket/clob-client-v2'

import { ApiError } from '@polymarket/clob-client-v2'
import { afterEach, describe, expect, it, mock, spyOn, jest } from 'bun:test'

import {
  buildPolymarketMarketOrder,
  deriveOrCreatePolymarketCredentials,
  ensurePolymarketOrderReady,
} from '@/lib/polymarket-orders-client'

const credentials: ApiKeyCreds = {
  key: 'key',
  secret: 'secret',
  passphrase: 'passphrase',
}

afterEach(() => {
  jest.restoreAllMocks()
})

function createAuthClient({
  deriveApiKey,
  createApiKey,
}: {
  deriveApiKey: () => Promise<ApiKeyCreds>
  createApiKey: () => Promise<ApiKeyCreds>
}) {
  return { deriveApiKey, createApiKey } as Pick<ClobClient, 'deriveApiKey' | 'createApiKey'>
}

describe('polymarket API credentials', () => {
  it('derives an existing key without attempting to create a duplicate', async () => {
    const deriveApiKey = mock().mockResolvedValue(credentials)
    const createApiKey = mock()

    await expect(
      deriveOrCreatePolymarketCredentials(
        createAuthClient({
          deriveApiKey,
          createApiKey,
        }),
      ),
    ).resolves.toEqual(credentials)
    expect(deriveApiKey).toHaveBeenCalledOnce()
    expect(createApiKey).not.toHaveBeenCalled()
  })

  it('creates a key only when no key exists for the default nonce', async () => {
    const deriveApiKey = mock().mockRejectedValue(new ApiError('Could not derive api key', 400, {}))
    const createApiKey = mock().mockResolvedValue(credentials)

    await expect(
      deriveOrCreatePolymarketCredentials(
        createAuthClient({
          deriveApiKey,
          createApiKey,
        }),
      ),
    ).resolves.toEqual(credentials)
    expect(createApiKey).toHaveBeenCalledOnce()
  })

  it('does not create a key after an unrelated authentication failure', async () => {
    const error = new ApiError('Service unavailable', 503, {})
    const deriveApiKey = mock().mockRejectedValue(error)
    const createApiKey = mock()

    await expect(
      deriveOrCreatePolymarketCredentials(
        createAuthClient({
          deriveApiKey,
          createApiKey,
        }),
      ),
    ).rejects.toBe(error)
    expect(createApiKey).not.toHaveBeenCalled()
  })
})

describe('polymarket arbitrage order', () => {
  it('uses a principal budget with a terminal price and FOK', () => {
    expect(buildPolymarketMarketOrder({ tokenId: '123', price: 0.5, amount: 9 })).toEqual({
      tokenID: '123',
      price: 0.5,
      amount: 9,
      side: 'BUY',
      orderType: 'FOK',
    })
  })

  it('preserves a sub-cent market tick', () => {
    expect(buildPolymarketMarketOrder({ tokenId: '123', price: 0.423, amount: 4.23 }).price).toBe(0.423)
  })

  it('requires the quote to be recalculated before signing a rounded budget', () => {
    expect(() => buildPolymarketMarketOrder({ tokenId: '123', price: 0.5, amount: 9.899 })).toThrow(
      'Polymarket BUY budget must use cents precision.',
    )
  })

  it('rejects a budget below the marketable minimum', () => {
    expect(() => buildPolymarketMarketOrder({ tokenId: '123', price: 0.5, amount: 0.99 })).toThrow(
      'Polymarket marketable BUY amount must be at least $1.',
    )
  })

  it('stops before signing when the server-side order preflight fails', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Polymarket order service is temporarily unavailable.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(ensurePolymarketOrderReady('123')).rejects.toMatchObject({
      status: 503,
    })
  })
})
