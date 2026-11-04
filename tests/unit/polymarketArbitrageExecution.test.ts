import * as actualSdk from '@polymarket/clob-client-v2'
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'

const createMarketOrder = mock()
const readOrder = mock()
const readTrades = mock()
const creds = { key: 'key', secret: 'secret', passphrase: 'passphrase' }
void mock.module('@polymarket/clob-client-v2', () => ({
  ...actualSdk,
  ClobClient: class {
    deriveApiKey = async () => creds
    getNegRisk = async () => false
    getServerTime = async () => 123
    createMarketOrder = createMarketOrder
    getOrder = readOrder
    getTrades = readTrades
  },
  createL2Headers: async () => ({ POLY_API_KEY: 'key' }),
  isV2Order: () => true,
  orderToJsonV2: (order: unknown, owner: string, orderType: string) => ({
    order,
    owner,
    orderType,
    postOnly: false,
    deferExec: false,
  }),
}))
void mock.module('wagmi/actions', () => ({
  getConnections: () => [],
  getWalletClient: async () => ({}),
  switchChain: async () => ({}),
}))
void mock.module('@/lib/polymarket-connection', () => ({
  selectPolymarketConnection: () => ({ connector: { getChainId: async () => 137 } }),
  runOnPolymarketChain: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
}))
const { preparePolymarketOrder } = await import('@/lib/polymarket-orders-client')
let fetchSpy: ReturnType<typeof spyOn>
const args = {
  wagmiConfig: {} as never,
  ownerAddress: `0x${'1'.repeat(40)}` as `0x${string}`,
  funderAddress: `0x${'2'.repeat(40)}` as `0x${string}`,
  signatureType: 3 as const,
  connectorId: 'wallet',
  connectorUid: 'wallet-1',
  tokenId: '123',
  amount: 9,
  price: 0.5,
  tickSize: '0.01' as const,
}
beforeEach(() => {
  createMarketOrder.mockReset().mockResolvedValue({ makerAmount: '9000000', takerAmount: '18000000' })
  readOrder.mockReset()
  readTrades.mockReset()
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ ready: true })))
})
afterEach(() => fetchSpy.mockRestore())

describe('Polymarket arbitrage submission', () => {
  it('signs a budget market order with an explicit limit and sends it only once', async () => {
    const prepared = await preparePolymarketOrder(args)
    expect(createMarketOrder).toHaveBeenCalledWith(
      { tokenID: '123', amount: 9, price: 0.5, side: 'BUY', orderType: 'FOK' },
      { tickSize: '0.01', negRisk: false },
    )
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, orderID: 'id-1', status: 'matched', makingAmount: '9', takingAmount: '20' }),
      ),
    )
    expect(await prepared.post()).toMatchObject({ state: 'pending', orderId: 'id-1', shares: 20, principal: 9 })
    expect((await prepared.post()).state).toBe('unknown')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('stops before posting if the SDK changes the quoted principal', async () => {
    createMarketOrder.mockResolvedValueOnce({ makerAmount: '8990000', takerAmount: '17980000' })
    await expect(preparePolymarketOrder(args)).rejects.toThrow('The signed budget changed')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not mistake an HTTP 200 error payload for success', async () => {
    const prepared = await preparePolymarketOrder(args)
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid upstream response' })))
    expect((await prepared.post()).state).toBe('unknown')
  })

  it('retains an order ID even when the HTTP response reports an error', async () => {
    const prepared = await preparePolymarketOrder(args)
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ orderID: 'id-1' }), { status: 502 }))
    expect(await prepared.post()).toMatchObject({ state: 'unknown', orderId: 'id-1' })
  })

  it('keeps network errors unknown without retrying the order', async () => {
    const prepared = await preparePolymarketOrder(args)
    fetchSpy.mockRejectedValueOnce(new Error('network'))
    expect((await prepared.post()).state).toBe('unknown')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('uses confirmed trade quantities rather than the signed minimum', async () => {
    const prepared = await preparePolymarketOrder(args)
    readOrder.mockResolvedValueOnce({
      id: 'id-1',
      asset_id: '123',
      side: 'BUY',
      status: 'MATCHED',
      size_matched: '22',
      associate_trades: ['trade-1'],
    })
    readTrades.mockResolvedValueOnce([
      {
        id: 'trade-1',
        taker_order_id: 'id-1',
        asset_id: '123',
        side: 'BUY',
        size: '22',
        status: 'CONFIRMED',
        transaction_hash: `0x${'a'.repeat(64)}`,
      },
    ])
    expect(await prepared.reconcile({ state: 'pending', orderId: 'id-1', shares: 18 })).toMatchObject({
      state: 'confirmed',
      shares: 22,
    })
  })
})
