import { describe, expect, it } from 'bun:test'

import type { NormalizedBookLevel } from '@/lib/order-panel-utils'

import {
  calculatePolymarketUnitCost,
  constrainArbitrageQuoteForPolymarketFok,
  findMinimumExecutableArbitrageQuote,
  scaleArbitrageQuote,
  selectBestArbitrageQuote,
} from '@/lib/arbitrage-quote'

function level(priceDollars: number, size: number): NormalizedBookLevel {
  return { priceCents: priceDollars * 100, priceDollars, size }
}

describe('arbitrage quotes', () => {
  it('includes the Polymarket taker fee charged to a marketable FOK limit order', () => {
    expect(calculatePolymarketUnitCost(0.5, 0.07, 1)).toBeCloseTo(0.5175, 8)
  })

  it('pairs complementary outcomes and limits size by the smaller venue balance', () => {
    const quote = selectBestArbitrageQuote([
      {
        kuestOutcome: 'YES',
        polymarketOutcome: 'NO',
        kuestTokenId: '1',
        polymarketTokenId: '2',
        kuestAsks: [level(0.42, 100)],
        polymarketAsks: [level(0.53, 100)],
        kuestBalance: 100,
        polymarketBalance: 50,
      },
    ])

    expect(quote).not.toBeNull()
    expect(quote?.polymarketCost).toBeCloseTo(50, 6)
    expect(quote?.shares).toBeCloseTo(50 / 0.53, 6)
    expect(quote?.edge).toBeCloseTo(0.05, 6)
    expect(quote?.profit).toBeCloseTo((50 / 0.53) * 0.05, 6)
  })

  it('excludes levels whose combined price is one dollar or more', () => {
    const quote = selectBestArbitrageQuote([
      {
        kuestOutcome: 'NO',
        polymarketOutcome: 'YES',
        kuestTokenId: '1',
        polymarketTokenId: '2',
        kuestAsks: [level(0.51, 100)],
        polymarketAsks: [level(0.49, 100)],
        kuestBalance: 100,
        polymarketBalance: 100,
      },
    ])

    expect(quote).toBeNull()
  })

  it('does not present a gross price gap that disappears after venue fees', () => {
    const quote = selectBestArbitrageQuote([
      {
        kuestOutcome: 'YES',
        polymarketOutcome: 'NO',
        kuestTokenId: '1',
        polymarketTokenId: '2',
        kuestAsks: [level(0.496, 100)],
        polymarketAsks: [level(0.496, 100)],
        kuestBalance: 100,
        polymarketBalance: 100,
        kuestFeeSchedule: {
          rate: 0.04,
          exponent: 1,
          takerOnly: true,
          rebateRate: 0.25,
        },
        polymarketFeeRate: 0.02,
      },
    ])

    expect(quote).toBeNull()
  })

  it('uses the fee exponent returned by Polymarket', () => {
    const quote = selectBestArbitrageQuote([
      {
        kuestOutcome: 'YES',
        polymarketOutcome: 'NO',
        kuestTokenId: '1',
        polymarketTokenId: '2',
        kuestAsks: [level(0.48, 100)],
        polymarketAsks: [level(0.48, 100)],
        kuestBalance: 100,
        polymarketBalance: 100,
        polymarketFeeRate: 0.05,
        polymarketFeeExponent: 0,
      },
    ])

    expect(quote).toBeNull()
  })

  it('scales the executable book prefix with the slider percentage', () => {
    const quote = selectBestArbitrageQuote([
      {
        kuestOutcome: 'YES',
        polymarketOutcome: 'NO',
        kuestTokenId: '1',
        polymarketTokenId: '2',
        kuestAsks: [level(0.4, 10), level(0.45, 10)],
        polymarketAsks: [level(0.5, 20)],
        kuestBalance: 100,
        polymarketBalance: 100,
      },
    ])

    expect(quote).not.toBeNull()
    const scaled = scaleArbitrageQuote(quote!, 25)
    expect(scaled.shares).toBeCloseTo(5, 6)
    expect(scaled.kuestCost).toBeCloseTo(2, 6)
    expect(scaled.polymarketCost).toBeCloseTo(2.5, 6)
    expect(scaled.profit).toBeCloseTo(0.5, 6)
  })

  it('uses the weighted principal rather than reserving the terminal price for every share', () => {
    const quote = selectBestArbitrageQuote([
      {
        kuestOutcome: 'YES',
        polymarketOutcome: 'NO',
        kuestTokenId: '1',
        polymarketTokenId: '2',
        kuestAsks: [level(0.4, 10), level(0.5, 10)],
        polymarketAsks: [level(0.3, 20)],
        kuestBalance: 9,
        polymarketBalance: 100,
      },
    ])

    expect(quote?.shares).toBe(20)
    expect(quote?.kuestCost).toBe(9)
    expect(constrainArbitrageQuoteForPolymarketFok(quote!)?.kuestOrder).toMatchObject({
      amount: 9,
      price: 0.5,
      shares: 20,
    })
  })

  it('rounds matched shares down to the Polymarket order precision', () => {
    const quote = selectBestArbitrageQuote([
      {
        kuestOutcome: 'YES',
        polymarketOutcome: 'NO',
        kuestTokenId: '1',
        polymarketTokenId: '2',
        kuestAsks: [level(0.4, 10)],
        polymarketAsks: [level(0.5, 10)],
        kuestBalance: 100,
        polymarketBalance: 100,
      },
    ])

    const scaled = scaleArbitrageQuote(quote!, 33.333)

    expect(scaled.shares).toBe(3.33)
  })

  it('requotes shares after rounding the Polymarket principal down to cents', () => {
    const quote = selectBestArbitrageQuote([
      {
        kuestOutcome: 'YES',
        polymarketOutcome: 'NO',
        kuestTokenId: '1',
        polymarketTokenId: '2',
        kuestAsks: [level(0.4, 20)],
        polymarketAsks: [level(0.42, 20)],
        kuestBalance: 100,
        polymarketBalance: 100,
      },
    ])

    const constrained = constrainArbitrageQuoteForPolymarketFok(scaleArbitrageQuote(quote!, 51.25))

    expect(constrained?.shares).toBeCloseTo(4.3 / 0.42, 5)
    expect(constrained?.polymarketOrder).toMatchObject({ price: 0.42, amount: 4.3, tickSize: '0.01' })
    expect(constrained?.kuestOrder?.amount).toBe(4.095238)
    expect(constrained?.payout).toBe(constrained?.shares)
  })

  it('preserves the actual sub-cent tick and stays within the available Polymarket balance', () => {
    const quote = selectBestArbitrageQuote([
      {
        kuestOutcome: 'NO',
        polymarketOutcome: 'YES',
        kuestTokenId: '1',
        polymarketTokenId: '2',
        kuestAsks: [level(0.3, 20)],
        polymarketAsks: [level(0.423, 20)],
        kuestBalance: 100,
        polymarketBalance: 100,
      },
    ])

    const constrained = constrainArbitrageQuoteForPolymarketFok(quote!, 4.3, '0.001')

    expect(constrained?.polymarketOrder?.price).toBe(0.423)
    expect(constrained?.polymarketOrder?.amount).toBeLessThanOrEqual(4.3)
    expect(constrained!.shares).toBeLessThanOrEqual(constrained!.polymarketOrder!.shares)
  })

  it('recomputes the terminal Polymarket limit after share quantization trims a book level', () => {
    const quote = selectBestArbitrageQuote([
      {
        kuestOutcome: 'NO',
        polymarketOutcome: 'YES',
        kuestTokenId: '1',
        polymarketTokenId: '2',
        kuestAsks: [level(0.3, 20)],
        polymarketAsks: [level(0.42, 9.99), level(0.423, 0.009)],
        kuestBalance: 100,
        polymarketBalance: 100,
      },
    ])

    const constrained = constrainArbitrageQuoteForPolymarketFok(quote!, 100, '0.001')

    expect(constrained?.shares).toBeCloseTo(4.19 / 0.42, 5)
    expect(constrained?.polymarketOrder).toMatchObject({
      price: 0.42,
      amount: 4.19,
      tickSize: '0.001',
    })
  })

  it('finds the minimum matched amount accepted by both marketable buy legs', () => {
    const quote = selectBestArbitrageQuote([
      {
        kuestOutcome: 'YES',
        polymarketOutcome: 'NO',
        kuestTokenId: '1',
        polymarketTokenId: '2',
        kuestAsks: [level(0.97, 100)],
        polymarketAsks: [level(0.02, 100)],
        kuestBalance: 100,
        polymarketBalance: 100,
      },
    ])

    const minimum = findMinimumExecutableArbitrageQuote(quote!, {
      minimumShares: 1,
      minimumKuestAmount: 1,
      minimumPolymarketAmount: 1,
    })

    expect(minimum?.shares).toBe(50)
    expect(minimum?.kuestCost).toBeCloseTo(48.5, 6)
    expect(minimum?.polymarketOrder?.amount).toBe(1)
    expect(minimum?.totalCost).toBeCloseTo(49.5, 6)
  })

  it('returns no minimum when available liquidity cannot satisfy both venues', () => {
    const quote = selectBestArbitrageQuote([
      {
        kuestOutcome: 'YES',
        polymarketOutcome: 'NO',
        kuestTokenId: '1',
        polymarketTokenId: '2',
        kuestAsks: [level(0.97, 10)],
        polymarketAsks: [level(0.02, 10)],
        kuestBalance: 100,
        polymarketBalance: 100,
      },
    ])

    expect(
      findMinimumExecutableArbitrageQuote(quote!, {
        minimumShares: 1,
        minimumKuestAmount: 1,
        minimumPolymarketAmount: 1,
      }),
    ).toBeNull()
  })
  it('recomputes a multi-level quote from the SDK budget instead of the old matched quantity', () => {
    const quote = selectBestArbitrageQuote([
      {
        kuestOutcome: 'YES',
        polymarketOutcome: 'NO',
        kuestTokenId: '1',
        polymarketTokenId: '2',
        kuestAsks: [level(0.3, 20)],
        polymarketAsks: [level(0.4, 1.01), level(0.5, 18.99)],
        kuestBalance: 100,
        polymarketBalance: 100,
      },
    ])!
    const executable = constrainArbitrageQuoteForPolymarketFok(quote)!
    expect(executable.polymarketOrder).toMatchObject({ amount: 9.89, price: 0.5 })
    expect(executable.polymarketOrder!.shares).toBeCloseTo(19.982, 6)
    expect(executable.kuestOrder).toMatchObject({ amount: 5.9946, price: 0.3 })
    expect(executable.shares).toBeCloseTo(19.982, 6)
    expect(executable.totalCost).toBeCloseTo(15.8846, 6)
  })

  it('keeps fee estimates outside both signed principal budgets', () => {
    const quote = selectBestArbitrageQuote([
      {
        kuestOutcome: 'YES',
        polymarketOutcome: 'NO',
        kuestTokenId: '1',
        polymarketTokenId: '2',
        kuestAsks: [level(0.4, 10), level(0.5, 10)],
        polymarketAsks: [level(0.3, 20)],
        kuestBalance: 100,
        polymarketBalance: 100,
        kuestFeeSchedule: { rate: 0.04, exponent: 1, takerOnly: true, rebateRate: 0 },
      },
    ])!
    const executable = constrainArbitrageQuoteForPolymarketFok(quote)!
    expect(executable.kuestOrder?.amount).toBe(9)
    expect(executable.polymarketOrder?.amount).toBe(6)
    expect(executable.kuestCost).toBeCloseTo(9.196, 6)
    expect(executable.totalCost).toBeCloseTo(15.196, 6)
  })
})
