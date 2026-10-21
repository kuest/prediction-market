import type { Market } from '@/types'

const MAX_DISPLAY_SPREAD = 0.1

export function normalizeMarketPrice(value: number | string | null | undefined) {
  if (value == null) {
    return null
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return null
  }

  const normalized = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed

  if (normalized < 0) {
    return 0
  }
  if (normalized > 1) {
    return 1
  }

  return normalized
}

export function resolveDisplayPrice({
  bid,
  ask,
  midpoint,
  lastTrade,
  maxSpread = MAX_DISPLAY_SPREAD,
  strictFallbacks = false,
}: {
  bid: number | null | undefined
  ask: number | null | undefined
  midpoint?: number | null | undefined
  lastTrade: number | null | undefined
  maxSpread?: number
  strictFallbacks?: boolean
}) {
  const hasBid = typeof bid === 'number' && Number.isFinite(bid)
  const hasAsk = typeof ask === 'number' && Number.isFinite(ask)
  const hasMidpoint = typeof midpoint === 'number' && Number.isFinite(midpoint)
  const hasLastTrade = typeof lastTrade === 'number' && Number.isFinite(lastTrade)
  const normalizedBid = hasBid ? normalizeMarketPrice(bid as number) : null
  const normalizedAsk = hasAsk ? normalizeMarketPrice(ask as number) : null
  const normalizedMidpoint = hasMidpoint ? normalizeMarketPrice(midpoint as number) : null
  const normalizedLastTrade = hasLastTrade ? normalizeMarketPrice(lastTrade as number) : null

  if (hasBid && hasAsk) {
    const mid = normalizedMidpoint ?? ((normalizedAsk ?? 0) + (normalizedBid ?? 0)) / 2
    const spread = Math.max(0, (normalizedAsk ?? 0) - (normalizedBid ?? 0))
    if (spread <= maxSpread) {
      return mid
    }
    return normalizedLastTrade ?? (strictFallbacks ? null : mid)
  }

  if (hasMidpoint) {
    return normalizedMidpoint
  }

  if (hasAsk || hasBid) {
    return normalizedLastTrade ?? (strictFallbacks ? null : (normalizedAsk ?? normalizedBid))
  }

  return normalizedLastTrade
}

export function resolveHomeCardDisplayPrice(
  quote: { bid: number | null; ask: number | null; mid: number | null } | null | undefined,
  lastTrade: number | null | undefined,
) {
  return resolveDisplayPrice({
    bid: quote?.bid ?? null,
    ask: quote?.ask ?? null,
    midpoint: quote?.mid ?? null,
    lastTrade,
    strictFallbacks: true,
  })
}

export function buildChanceByMarket(markets: Market[], priceOverrides: Record<string, number> = {}) {
  function getPrice(market: Market) {
    const override = priceOverrides[market.condition_id]
    return normalizeMarketPrice(override ?? market.price) ?? 0
  }

  return markets.reduce<Record<string, number>>((acc, market) => {
    acc[market.condition_id] = getPrice(market) * 100
    return acc
  }, {})
}
