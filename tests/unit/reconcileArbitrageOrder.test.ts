import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'

const wallet = `0x${'1'.repeat(40)}`
const getUser = mock()
const getAuth = mock()
void mock.module('@/lib/db/queries/user', () => ({ UserRepository: { getCurrentUser: getUser } }))
void mock.module('@/lib/trading-auth/server', () => ({ getUserTradingAuthSecrets: getAuth }))
void mock.module('@/lib/public-runtime-config.shared', () => ({
  resolvePublicRuntimeEnv: () => ({ clobUrl: 'https://clob.test' }),
}))
void mock.module('@/lib/hmac', () => ({ buildClobHmacSignature: () => 'test-signature' }))
const { reconcileArbitrageOrder } =
  await import('@/app/[locale]/(platform)/event/[slug]/_actions/reconcile-arbitrage-order')
let fetchSpy: ReturnType<typeof spyOn>
beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ id: 'user-1', address: wallet, deposit_wallet_address: wallet })
  getAuth.mockReset().mockResolvedValue({ clob: { key: 'key', secret: 'secret', passphrase: 'passphrase' } })
  fetchSpy = spyOn(globalThis, 'fetch')
})
afterEach(() => fetchSpy.mockRestore())

const order = {
  id: 'id-1',
  side: 'BUY',
  maker_address: wallet,
  asset_id: '123',
  status: 'MATCHED',
  size_matched: '20',
  associate_trades: ['trade-1'],
}
const trade = {
  id: 'trade-1',
  taker_order_id: 'id-1',
  side: 'buy',
  asset_id: '123',
  size: '20',
  status: 'CONFIRMED',
  transaction_hash: `0x${'a'.repeat(64)}`,
}

describe('authenticated arbitrage reconciliation', () => {
  it('reads the existing order and trade endpoints with server-held credentials', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify(order)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [trade] })))
    expect(await reconcileArbitrageOrder('id-1', '123')).toMatchObject({
      state: 'confirmed',
      orderId: 'id-1',
      shares: 20,
    })
    expect(fetchSpy.mock.calls[0][0]).toBe('https://clob.test/data/order/id-1')
    expect(fetchSpy.mock.calls[1][0]).toBe('https://clob.test/data/trades?id=trade-1')
    expect(fetchSpy.mock.calls[1][1]?.headers).toMatchObject({
      KUEST_API_KEY: 'key',
      KUEST_SIGNATURE: 'test-signature',
    })
  })

  it('does not read fills for an order belonging to another wallet', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ...order, maker_address: `0x${'2'.repeat(40)}` })))
    expect((await reconcileArbitrageOrder('id-1', '123')).state).toBe('unknown')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not issue requests without an authenticated wallet or for invalid ids', async () => {
    getUser.mockResolvedValueOnce(null)
    expect((await reconcileArbitrageOrder('id-1', '123')).state).toBe('unknown')
    expect((await reconcileArbitrageOrder('../other', '123')).state).toBe('unknown')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('preserves the reference when the read endpoint is unavailable', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 503 }))
    expect(await reconcileArbitrageOrder('id-1', '123')).toMatchObject({ state: 'unknown', orderId: 'id-1' })
  })

  it('keeps the order id when the token reference is invalid', async () => {
    expect(await reconcileArbitrageOrder('id-1', 'invalid-token')).toEqual({
      state: 'unknown',
      orderId: 'id-1',
      error: 'Invalid order reference.',
    })
    expect(getUser).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
