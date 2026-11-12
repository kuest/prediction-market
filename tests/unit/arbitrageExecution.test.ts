import { describe, expect, it, mock } from 'bun:test'

import { parseArbitragePlacement, readArbitrageExecution, summarizeArbitrageExecution } from '@/lib/arbitrage-execution'

const hash = `0x${'a'.repeat(64)}`
const order = {
  id: 'order-1',
  asset_id: '123',
  side: 'BUY',
  status: 'MATCHED',
  size_matched: '20',
  market: 'market-1',
}
const trade = {
  id: 'trade-1',
  taker_order_id: 'order-1',
  asset_id: '123',
  side: 'BUY',
  size: '20',
  status: 'CONFIRMED',
  transaction_hash: hash,
}
const pending = { state: 'pending' as const, orderId: 'order-1' }

function read(overrides: { order?: unknown; trades?: unknown[] } = {}) {
  return readArbitrageExecution({
    previous: pending,
    tokenId: '123',
    readOrder: async () => overrides.order ?? order,
    readTrades: async () => ({ trades: overrides.trades ?? [trade], nextCursor: 'LTE=' }),
  })
}

describe('arbitrage execution confirmation', () => {
  it('normalizes venue-specific response units without treating matching as settlement', () => {
    expect(
      parseArbitragePlacement(
        { success: true, orderID: 'id', makingAmount: '9000000', takingAmount: '20000000' },
        'kuest',
      ),
    ).toMatchObject({ state: 'pending', principal: 9, shares: 20 })
    expect(
      parseArbitragePlacement({ success: true, orderID: 'id', makingAmount: '9', takingAmount: '20' }, 'polymarket'),
    ).toMatchObject({ state: 'pending', principal: 9, shares: 20 })
  })

  it('keeps malformed or lost responses unknown, including HTTP 200 error payloads', () => {
    expect(parseArbitragePlacement({ error: 'invalid response' }, 'polymarket').state).toBe('unknown')
    expect(parseArbitragePlacement(null, 'kuest').state).toBe('unknown')
    expect(parseArbitragePlacement({ success: true }, 'polymarket').state).toBe('unknown')
  })

  it('recognizes explicit rejection without an order id', () => {
    expect(parseArbitragePlacement({ success: false, orderID: '', errorMsg: 'FOK rejected' }, 'kuest').state).toBe(
      'failed',
    )
  })

  it('confirms real quantities only after every associated fill is confirmed', async () => {
    await expect(read()).resolves.toMatchObject({ state: 'confirmed', shares: 20, orderId: 'order-1' })
    await expect(read({ trades: [{ ...trade, status: 'MATCHED' }] })).resolves.toMatchObject({ state: 'pending' })
    await expect(read({ trades: [{ ...trade, status: 'MINED' }] })).resolves.toMatchObject({ state: 'pending' })
  })

  it.each(['BUY', 'buy'])('confirms a buy fill with side %s', async (side) => {
    await expect(read({ trades: [{ ...trade, side }] })).resolves.toMatchObject({
      state: 'confirmed',
      shares: 20,
      orderId: 'order-1',
    })
  })

  it.each(['SELL', 'sell', '', 'BUY ', null, undefined, 0, {}])(
    'does not confirm a buy from a sell or invalid side %j',
    async (side) => {
      await expect(read({ trades: [{ ...trade, side }] })).resolves.toMatchObject({ state: 'pending' })
    },
  )

  it('does not infer success from an empty or incomplete trade lookup', async () => {
    await expect(read({ trades: [] })).resolves.toMatchObject({ state: 'pending' })
    await expect(read({ order: { ...order, size_matched: '21' } })).resolves.toMatchObject({ state: 'pending' })
  })

  it('requires a transaction hash for confirmed fills', async () => {
    await expect(read({ trades: [{ ...trade, transaction_hash: undefined }] })).resolves.toMatchObject({
      state: 'unknown',
    })
  })

  it('does not combine another order or token with this execution', async () => {
    await expect(read({ trades: [{ ...trade, taker_order_id: 'other' }] })).resolves.toMatchObject({ state: 'pending' })
    await expect(read({ order: { ...order, asset_id: 'other' } })).resolves.toMatchObject({ state: 'unknown' })
  })

  it('keeps read failures unknown while retaining the order id', async () => {
    const result = await readArbitrageExecution({
      previous: pending,
      tokenId: '123',
      readOrder: async () => {
        throw new Error('network')
      },
      readTrades: async () => ({ trades: [], nextCursor: 'LTE=' }),
    })
    expect(result).toMatchObject({ state: 'unknown', orderId: 'order-1' })
  })

  it('records final failed settlement instead of the placement quantity', async () => {
    await expect(read({ trades: [{ ...trade, status: 'FAILED' }] })).resolves.toMatchObject({
      state: 'failed',
      shares: 0,
    })
  })

  it('uses only confirmed quantities if a subset of fills fails', async () => {
    const second = { ...trade, id: 'trade-2', size: '10', status: 'FAILED' }
    await expect(
      read({
        order,
        trades: [{ ...trade, size: '10' }, second],
      }),
    ).resolves.toMatchObject({ state: 'confirmed', shares: 10 })
  })

  it('does not finalize a partial fill list even when a reported fill failed', async () => {
    await expect(read({ trades: [{ ...trade, size: '10', status: 'FAILED' }] })).resolves.toMatchObject({
      state: 'pending',
    })
  })

  it('does not retry an unknown submission without an id', async () => {
    const readOrder = mock()
    const previous = { state: 'unknown' as const }
    await expect(readArbitrageExecution({ previous, tokenId: '123', readOrder, readTrades: mock() })).resolves.toEqual(
      previous,
    )
    expect(readOrder).not.toHaveBeenCalled()
  })

  it('finalizes an unmatched terminal order without reading trade history', async () => {
    const pages = mock()
    expect(
      await readArbitrageExecution({
        previous: pending,
        tokenId: '123',
        readOrder: async () => ({ ...order, status: 'CANCELED', size_matched: '0' }),
        readTrades: pages,
      }),
    ).toMatchObject({ state: 'failed', shares: 0, principal: 0 })
    expect(pages).not.toHaveBeenCalled()
  })

  it('paginates market history, ignores other orders and deduplicates fills', async () => {
    const pages = mock()
      .mockResolvedValueOnce({ trades: [{ ...trade, taker_order_id: 'other' }], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ trades: [trade, trade], nextCursor: 'LTE=' })
    expect(
      await readArbitrageExecution({
        previous: pending,
        tokenId: '123',
        readOrder: async () => order,
        readTrades: pages,
      }),
    ).toMatchObject({ state: 'confirmed', shares: 20 })
    expect(pages).toHaveBeenNthCalledWith(1, 'market-1', undefined)
    expect(pages).toHaveBeenNthCalledWith(2, 'market-1', 'page-2')
  })

  it('stops once all matched quantity is found without scanning older market trades', async () => {
    const pages = mock().mockResolvedValueOnce({ trades: [trade], nextCursor: 'older-history' })
    expect(
      await readArbitrageExecution({
        previous: pending,
        tokenId: '123',
        readOrder: async () => order,
        readTrades: pages,
      }),
    ).toMatchObject({ state: 'confirmed', shares: 20 })
    expect(pages).toHaveBeenCalledTimes(1)
  })

  it('does not confirm an incomplete or repeating cursor history', async () => {
    const pages = mock().mockResolvedValue({ trades: [{ ...trade, size: '10' }], nextCursor: 'same-page' })
    expect(
      await readArbitrageExecution({
        previous: pending,
        tokenId: '123',
        readOrder: async () => order,
        readTrades: pages,
      }),
    ).toMatchObject({ state: 'pending' })
    expect(pages).toHaveBeenCalledTimes(2)
  })

  it('bounds history reads without falsely confirming a truncated scan', async () => {
    let calls = 0
    expect(
      await readArbitrageExecution({
        previous: pending,
        tokenId: '123',
        readOrder: async () => order,
        readTrades: async () => ({ trades: [{ ...trade, size: '10' }], nextCursor: String(++calls) }),
      }),
    ).toMatchObject({ state: 'pending' })
    expect(calls).toBe(20)
  })

  it('only concludes a balanced hedge from both confirmed actual quantities', () => {
    expect(
      summarizeArbitrageExecution({ state: 'confirmed', shares: 22 }, { state: 'confirmed', shares: 20 }),
    ).toMatchObject({ balanced: false, finalized: true, matchedShares: 20 })
    expect(
      summarizeArbitrageExecution({ state: 'confirmed', shares: 20 }, { state: 'pending', shares: 20 }).balanced,
    ).toBe(false)
    expect(
      summarizeArbitrageExecution({ state: 'confirmed', shares: 20 }, { state: 'confirmed', shares: 20 }).balanced,
    ).toBe(true)
    expect(summarizeArbitrageExecution({ state: 'failed' }, { state: 'failed' }).balanced).toBe(false)
  })
})
