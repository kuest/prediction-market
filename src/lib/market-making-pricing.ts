export interface SponsorshipOptions {
  depthPerSideUsdc: number[]
  maxSpreadBps: number[]
}

// Safe defaults while config loads, and for Escrow versions without UI presets.
export const DEFAULT_SPONSORSHIP_OPTIONS: SponsorshipOptions = {
  depthPerSideUsdc: [90, 500, 1000, 2000, 3000],
  maxSpreadBps: [200, 300, 400, 500],
}

export function multiMarketDiscountBps(breakdown: { multiMarketDiscountBps?: number } | null) {
  // Historical previews omitted the field because they did not apply a discount.
  return breakdown?.multiMarketDiscountBps ?? 0
}
