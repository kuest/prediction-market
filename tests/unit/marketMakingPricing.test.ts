import { describe, expect, it } from 'bun:test'

import {
  DEFAULT_SPONSORSHIP_OPTIONS,
  multiMarketDiscountBps,
  resolveSponsorshipSelection,
} from '@/lib/market-making-pricing'
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

  it('waits for config and keeps compatible defaults for older Escrow versions', () => {
    expect(resolveSponsorshipSelection(undefined, 1000, 300)).toBeNull()
    expect(resolveSponsorshipSelection({}, 1000, 300)).toMatchObject({
      depth: 1000,
      spread: 300,
      maximumDepth: 3000,
      maximumSpread: 500,
    })
  })

  it('uses configured choices and maxima when the old selection is removed', () => {
    const config = { sponsorshipOptions: { depthPerSideUsdc: [200, 600, 1500], maxSpreadBps: [400, 600] } }
    expect(resolveSponsorshipSelection(config, 1000, 300)).toEqual({
      options: config.sponsorshipOptions,
      depth: 200,
      spread: 400,
      maximumDepth: 1500,
      maximumSpread: 600,
    })
  })

  it('preserves available user choices and resets only the removed choice', () => {
    const config = { sponsorshipOptions: { depthPerSideUsdc: [90, 500, 1000, 4000], maxSpreadBps: [200, 400, 500] } }
    expect(resolveSponsorshipSelection(config, 500, 400)).toMatchObject({ depth: 500, spread: 400 })
    expect(resolveSponsorshipSelection(config, 3000, 400)).toMatchObject({ depth: 1000, spread: 400 })
    expect(resolveSponsorshipSelection(config, 500, 300)).toMatchObject({ depth: 500, spread: 200 })
    expect(resolveSponsorshipSelection(config, 500, 300)).toMatchObject({ maximumDepth: 4000, maximumSpread: 500 })
  })

  it('does not enable pricing when configured presets are empty', () => {
    expect(
      resolveSponsorshipSelection({ sponsorshipOptions: { depthPerSideUsdc: [], maxSpreadBps: [400] } }, 1000, 300),
    ).toBeNull()
    expect(
      resolveSponsorshipSelection({ sponsorshipOptions: { depthPerSideUsdc: [90], maxSpreadBps: [] } }, 1000, 300),
    ).toBeNull()
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
