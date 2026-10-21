import { describe, expect, it } from 'bun:test'

import { resolveQuote } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventMidPrices'
import {
  buildChanceByMarket,
  normalizeMarketPrice,
  resolveDisplayPrice,
  resolveHomeCardDisplayPrice,
} from '@/lib/market-chance'

describe('market chance normalization', () => {
  it('accepts both decimal and percent-style market prices', () => {
    expect(normalizeMarketPrice(0.64)).toBe(0.64)
    expect(normalizeMarketPrice(64)).toBe(0.64)
    expect(normalizeMarketPrice('64')).toBe(0.64)
  })

  it('ignores malformed prices instead of treating them as zero', () => {
    expect(normalizeMarketPrice('oops')).toBeNull()
    expect(normalizeMarketPrice(Number.NaN)).toBeNull()
  })

  it('keeps live quote display prices stable when feeds return cents', () => {
    expect(
      resolveDisplayPrice({
        bid: 63,
        ask: 65,
        midpoint: 64,
        lastTrade: 66,
      }),
    ).toBe(0.64)
  })

  it('uses the midpoint for a wide spread without a matched trade', () => {
    expect(
      resolveDisplayPrice({
        bid: 0.2,
        ask: 0.8,
        lastTrade: null,
      }),
    ).toBe(0.5)
  })

  it('uses the last matched trade for a wide spread when one exists', () => {
    expect(
      resolveDisplayPrice({
        bid: 0.2,
        ask: 0.8,
        lastTrade: 0.42,
      }),
    ).toBe(0.42)
  })

  it('builds chances from percent-style overrides without inflating to 100%', () => {
    expect(
      buildChanceByMarket(
        [
          {
            condition_id: 'market-1',
            price: 0.52,
          },
        ] as any,
        {
          'market-1': 64,
        },
      ),
    ).toEqual({
      'market-1': 64,
    })
  })

  it('uses the same home price for two-sided books without any trade', () => {
    expect(resolveHomeCardDisplayPrice({ bid: 0.63, ask: 0.65, mid: 0.64 }, null)).toBe(0.64)
  })

  it('shows a dash for absent, invalid, or unilateral quotes without a valid midpoint or trade', () => {
    expect(resolveHomeCardDisplayPrice(null, null)).toBeNull()
    expect(resolveHomeCardDisplayPrice({ bid: Number.NaN, ask: null, mid: null }, null)).toBeNull()
    expect(resolveHomeCardDisplayPrice({ bid: 0.6, ask: null, mid: null }, null)).toBeNull()
  })

  it('uses the home midpoint or last trade fallback for unilateral and wide books', () => {
    expect(resolveHomeCardDisplayPrice({ bid: 0.6, ask: null, mid: 0.61 }, null)).toBe(0.61)
    expect(resolveHomeCardDisplayPrice(resolveQuote({ SELL: '0.6' }, null), null)).toBe(0.6)
    expect(resolveHomeCardDisplayPrice({ bid: 0.2, ask: 0.8, mid: 0.5 }, 0.42)).toBe(0.42)
    expect(resolveHomeCardDisplayPrice(null, 0.67)).toBe(0.67)
  })
})
