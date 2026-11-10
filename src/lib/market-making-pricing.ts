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

export function resolveSponsorshipSelection(
  config: { sponsorshipOptions?: SponsorshipOptions } | undefined,
  requestedDepth: number,
  requestedSpread: number,
) {
  if (!config) {
    return null
  }
  const options = config.sponsorshipOptions ?? DEFAULT_SPONSORSHIP_OPTIONS
  if (!options.depthPerSideUsdc.length || !options.maxSpreadBps.length) {
    return null
  }
  function select(values: number[], requested: number, preferred: number) {
    return values.includes(requested) ? requested : values.includes(preferred) ? preferred : values[0]!
  }

  return {
    options,
    depth: select(options.depthPerSideUsdc, requestedDepth, 1000),
    spread: select(options.maxSpreadBps, requestedSpread, 300),
    maximumDepth: Math.max(...options.depthPerSideUsdc),
    maximumSpread: Math.max(...options.maxSpreadBps),
  }
}
