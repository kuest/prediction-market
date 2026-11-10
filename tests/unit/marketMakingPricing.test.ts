import { describe, expect, it } from 'bun:test'

import { DEFAULT_SPONSORSHIP_OPTIONS, multiMarketDiscountBps } from '@/lib/market-making-pricing'
import {
  buildMarketMakerQuoteInput,
  displayedCostAtomic,
  requiredSponsorBalanceAtomic,
} from '@/lib/market-making-series'

describe('market-making pricing options', () => {
  it('offers five depth tiers and only 2, 3, 4 and 5-cent spreads', () => {
    expect(DEFAULT_SPONSORSHIP_OPTIONS.depthPerSideUsdc).toEqual([90, 500, 1000, 2000, 3000])
    expect(DEFAULT_SPONSORSHIP_OPTIONS.maxSpreadBps).toEqual([200, 300, 400, 500])
  })

  it('passes each depth and the new spread unchanged to Escrow', () => {
    for (const depth of DEFAULT_SPONSORSHIP_OPTIONS.depthPerSideUsdc) {
      const quote = buildMarketMakerQuoteInput({
        sponsor: '0x0000000000000000000000000000000000000002',
        importId: null,
        marketSource: 'kuest',
        conditionIds: ['0x' + '11'.repeat(32)],
        depthPerSideAtomic: String(BigInt(depth) * 1_000_000n),
        maxSpreadBps: 400,
        serviceEnd: 2_000_000_000,
        sponsorSeries: false,
        seriesSlug: null,
        creatorFilter: null,
      })
      expect(quote.depthPerSideAtomic).toBe(String(depth * 1_000_000))
      expect(quote.maxSpreadBps).toBe(400)
      expect(quote).not.toHaveProperty('multiMarketDiscountBps')
    }
  })

  it('reads the effective discount without assuming one for older previews', () => {
    expect(multiMarketDiscountBps(null)).toBe(0)
    expect(multiMarketDiscountBps({})).toBe(0)
    expect(multiMarketDiscountBps({ multiMarketDiscountBps: 0 })).toBe(0)
    expect(multiMarketDiscountBps({ multiMarketDiscountBps: 1_250 })).toBe(1_250)
  })

  it('uses already-discounted backend costs without subtracting the discount again', () => {
    const costs = {
      status: 'final' as const,
      campaignFundingTotalAtomic: '900000000',
      initialDeploymentFeeAtomic: '400000',
      totalCostAtomic: '900400000',
      initialDeploymentFeePaid: false,
      initialDeploymentFeeStatus: 'final' as const,
      campaignFundingStatus: 'final' as const,
      totalCostStatus: 'final' as const,
    }
    expect(displayedCostAtomic(costs)).toBe('900400000')
    expect(requiredSponsorBalanceAtomic(costs, true)).toBe(900400000n)
    expect(displayedCostAtomic({ ...costs, initialDeploymentFeePaid: true })).toBe('900000000')
  })
})
