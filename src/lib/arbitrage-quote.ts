import type { NormalizedBookLevel } from '@/lib/order-panel-utils'
import type { PolymarketTickSize } from '@/lib/polymarket-market'
import type { DynamicFeeSchedule } from '@/lib/trading-fees'

import { calculateGrossedKuestUnitFee } from '@/lib/trading-fees'

interface ArbitrageSegment {
  shares: number
  kuestPrice: number
  polymarketPrice: number
  kuestUnitCost: number
  polymarketUnitCost: number
}

export interface ArbitrageQuote {
  kuestOutcome: 'YES' | 'NO'
  polymarketOutcome: 'YES' | 'NO'
  kuestTokenId: string
  polymarketTokenId: string
  edge: number
  shares: number
  kuestCost: number
  polymarketCost: number
  totalCost: number
  payout: number
  profit: number
  segments: ArbitrageSegment[]
  kuestOrder?: {
    price: number
    shares: number
    amount: number
  }
  polymarketOrder?: {
    price: number
    shares: number
    amount: number
    tickSize: PolymarketTickSize
  }
}

const ARBITRAGE_SHARE_DECIMALS = 2
const ARBITRAGE_SHARE_SCALE = 10 ** ARBITRAGE_SHARE_DECIMALS
const KUEST_ORDER_AMOUNT_SCALE = 1_000_000

function normalizeExecutableShares(shares: number) {
  if (!Number.isFinite(shares) || shares <= 0) {
    return 0
  }

  return Math.floor((shares + Number.EPSILON) * ARBITRAGE_SHARE_SCALE) / ARBITRAGE_SHARE_SCALE
}

function alignPriceUpToTick(price: number, tickSize: PolymarketTickSize) {
  const tick = Number(tickSize)
  const decimalPlaces = tickSize.split('.')[1]?.length ?? 0
  const tickCount = Math.ceil((price - Number.EPSILON) / tick)
  return Number((tickCount * tick).toFixed(decimalPlaces))
}

function trimArbitrageQuote(quote: ArbitrageQuote, targetShares: number): ArbitrageQuote {
  let remainingShares = targetShares
  const segments: ArbitrageSegment[] = []

  for (const segment of quote.segments) {
    const shares = Math.min(segment.shares, remainingShares)
    if (!(shares > 0)) {
      break
    }
    segments.push({ ...segment, shares })
    remainingShares -= shares
  }

  const shares = segments.reduce((sum, segment) => sum + segment.shares, 0)
  const kuestCost = segments.reduce((sum, segment) => sum + segment.shares * segment.kuestUnitCost, 0)
  const polymarketCost = segments.reduce((sum, segment) => sum + segment.shares * segment.polymarketUnitCost, 0)
  const totalCost = kuestCost + polymarketCost

  return {
    ...quote,
    segments,
    shares,
    kuestCost,
    polymarketCost,
    totalCost,
    payout: shares,
    profit: shares - totalCost,
    edge: shares > 0 ? (shares - totalCost) / shares : 0,
    kuestOrder: undefined,
    polymarketOrder: undefined,
  }
}

export function calculatePolymarketUnitCost(price: number, feeRate = 0, feeExponent = 0) {
  // Arbitrage submits a market FOK order. It is therefore the
  // taker, and Polymarket applies this market fee curve when the order matches.
  return price + Math.max(0, feeRate) * (price * (1 - price)) ** Math.max(0, feeExponent)
}

function buildDirectionQuote({
  kuestOutcome,
  polymarketOutcome,
  kuestTokenId,
  polymarketTokenId,
  kuestAsks,
  polymarketAsks,
  kuestBalance,
  polymarketBalance,
  kuestFeeSchedule,
  operatorShareBps = 0,
  polymarketFeeRate = 0,
  polymarketFeeExponent = 0,
}: {
  kuestOutcome: 'YES' | 'NO'
  polymarketOutcome: 'YES' | 'NO'
  kuestTokenId: string
  polymarketTokenId: string
  kuestAsks: NormalizedBookLevel[]
  polymarketAsks: NormalizedBookLevel[]
  kuestBalance: number
  polymarketBalance: number
  kuestFeeSchedule?: DynamicFeeSchedule | null
  operatorShareBps?: number
  polymarketFeeRate?: number
  polymarketFeeExponent?: number
}): ArbitrageQuote | null {
  let kuestIndex = 0
  let polymarketIndex = 0
  let kuestLevelRemaining = kuestAsks[0]?.size ?? 0
  let polymarketLevelRemaining = polymarketAsks[0]?.size ?? 0
  let remainingKuestCash = Math.max(0, kuestBalance)
  let remainingPolymarketCash = Math.max(0, polymarketBalance)
  const segments: ArbitrageSegment[] = []

  while (kuestIndex < kuestAsks.length && polymarketIndex < polymarketAsks.length) {
    const kuestLevel = kuestAsks[kuestIndex]
    const polymarketLevel = polymarketAsks[polymarketIndex]
    const kuestUnitCost = kuestLevel
      ? kuestLevel.priceDollars +
        calculateGrossedKuestUnitFee(kuestLevel.priceDollars, kuestFeeSchedule, operatorShareBps)
      : 0
    const polymarketUnitCost = polymarketLevel
      ? calculatePolymarketUnitCost(polymarketLevel.priceDollars, polymarketFeeRate, polymarketFeeExponent)
      : 0
    if (!kuestLevel || !polymarketLevel || kuestUnitCost + polymarketUnitCost >= 1) {
      break
    }

    const shares = Math.min(
      kuestLevelRemaining,
      polymarketLevelRemaining,
      kuestUnitCost > 0 ? remainingKuestCash / kuestUnitCost : 0,
      polymarketUnitCost > 0 ? remainingPolymarketCash / polymarketUnitCost : 0,
    )
    if (!(shares > 0)) {
      break
    }

    segments.push({
      shares,
      kuestPrice: kuestLevel.priceDollars,
      polymarketPrice: polymarketLevel.priceDollars,
      kuestUnitCost,
      polymarketUnitCost,
    })
    remainingKuestCash -= shares * kuestUnitCost
    remainingPolymarketCash -= shares * polymarketUnitCost
    kuestLevelRemaining -= shares
    polymarketLevelRemaining -= shares

    if (kuestLevelRemaining <= 1e-8) {
      kuestIndex += 1
      kuestLevelRemaining = kuestAsks[kuestIndex]?.size ?? 0
    }
    if (polymarketLevelRemaining <= 1e-8) {
      polymarketIndex += 1
      polymarketLevelRemaining = polymarketAsks[polymarketIndex]?.size ?? 0
    }
  }

  if (segments.length === 0) {
    return null
  }

  const shares = segments.reduce((sum, segment) => sum + segment.shares, 0)
  const kuestCost = segments.reduce((sum, segment) => sum + segment.shares * segment.kuestUnitCost, 0)
  const polymarketCost = segments.reduce((sum, segment) => sum + segment.shares * segment.polymarketUnitCost, 0)
  const totalCost = kuestCost + polymarketCost

  const quote: ArbitrageQuote = {
    kuestOutcome,
    polymarketOutcome,
    kuestTokenId,
    polymarketTokenId,
    edge: shares > 0 ? (shares - totalCost) / shares : 0,
    shares,
    kuestCost,
    polymarketCost,
    totalCost,
    payout: shares,
    profit: shares - totalCost,
    segments,
  }
  return quote
}

export function selectBestArbitrageQuote(directions: Parameters<typeof buildDirectionQuote>[0][]) {
  return (
    directions
      .map(buildDirectionQuote)
      .filter((quote): quote is ArbitrageQuote => quote !== null)
      .sort((a, b) => b.profit - a.profit)[0] ?? null
  )
}

export function scaleArbitrageQuote(quote: ArbitrageQuote, percent: number): ArbitrageQuote {
  const targetShares = normalizeExecutableShares((quote.shares * Math.min(100, Math.max(0, percent))) / 100)
  return trimArbitrageQuote(quote, targetShares)
}

function floorAmount(value: number, scale: number) {
  return Math.floor(value * scale + 1e-7) / scale
}

function simulateBudget(segments: ArbitrageSegment[], venue: 'kuest' | 'polymarket', budget: number) {
  let remaining = budget
  let shares = 0
  let cost = 0
  let price = 0
  for (const segment of segments) {
    if (remaining < 1e-9) {
      break
    }
    const unitPrice = venue === 'kuest' ? segment.kuestPrice : segment.polymarketPrice
    const unitCost = venue === 'kuest' ? segment.kuestUnitCost : segment.polymarketUnitCost
    const filled = Math.min(segment.shares, Math.max(0, remaining) / unitPrice)
    if (!(filled > 0)) {
      break
    }
    shares += filled
    cost += filled * unitCost
    remaining = Math.max(0, remaining - filled * unitPrice)
    price = unitPrice
  }
  return { shares, cost, price }
}

/** Requote the actual BUY budgets, including the SDK's whole-cent rounding. */
export function constrainArbitrageQuoteForPolymarketFok(
  quote: ArbitrageQuote,
  polymarketBalance = Number.POSITIVE_INFINITY,
  tickSize: PolymarketTickSize = '0.01',
): ArbitrageQuote | null {
  if (!quote.segments.length || !(quote.shares > 0)) {
    return null
  }

  let affordableShares = 0
  let cash = Math.max(0, polymarketBalance)
  for (const segment of quote.segments) {
    const shares = Math.min(segment.shares, cash / segment.polymarketUnitCost)
    if (!(shares > 0)) {
      break
    }
    affordableShares += shares
    cash = Math.max(0, cash - shares * segment.polymarketUnitCost)
  }
  const affordable = trimArbitrageQuote(quote, affordableShares)
  const polymarketAmount = floorAmount(
    affordable.segments.reduce((sum, segment) => sum + segment.shares * segment.polymarketPrice, 0),
    100,
  )
  if (!(polymarketAmount > 0)) {
    return null
  }
  const polymarketFill = simulateBudget(affordable.segments, 'polymarket', polymarketAmount)
  const paired = trimArbitrageQuote(affordable, polymarketFill.shares)
  const kuestAmount = floorAmount(
    paired.segments.reduce((sum, segment) => sum + segment.shares * segment.kuestPrice, 0),
    KUEST_ORDER_AMOUNT_SCALE,
  )
  const kuestFill = simulateBudget(paired.segments, 'kuest', kuestAmount)
  const shares = Math.min(kuestFill.shares, polymarketFill.shares)
  const totalCost = kuestFill.cost + polymarketFill.cost
  const price = alignPriceUpToTick(polymarketFill.price, tickSize)
  if (!(shares > 0) || !(kuestAmount > 0) || !(price > 0) || price >= 1 || shares <= totalCost) {
    return null
  }
  return {
    ...trimArbitrageQuote(paired, shares),
    shares,
    kuestCost: kuestFill.cost,
    polymarketCost: polymarketFill.cost,
    totalCost,
    payout: shares,
    profit: shares - totalCost,
    edge: (shares - totalCost) / shares,
    kuestOrder: { price: kuestFill.price, shares: kuestFill.shares, amount: kuestAmount },
    polymarketOrder: { price, shares: polymarketFill.shares, amount: polymarketAmount, tickSize },
  }
}

export function findMinimumExecutableArbitrageQuote(
  quote: ArbitrageQuote,
  {
    minimumShares,
    minimumKuestAmount,
    minimumPolymarketAmount,
    polymarketTickSize = '0.01',
  }: {
    minimumShares: number
    minimumKuestAmount: number
    minimumPolymarketAmount: number
    polymarketTickSize?: PolymarketTickSize
  },
): ArbitrageQuote | null {
  function meetsMinimum(candidate: ArbitrageQuote | null) {
    if (!candidate?.polymarketOrder || candidate.shares < minimumShares) {
      return false
    }

    const kuestPrincipal = candidate.kuestOrder?.amount ?? 0
    return kuestPrincipal >= minimumKuestAmount && candidate.polymarketOrder.amount >= minimumPolymarketAmount
  }

  const maximumQuote = constrainArbitrageQuoteForPolymarketFok(quote, Number.POSITIVE_INFINITY, polymarketTickSize)
  if (!meetsMinimum(maximumQuote)) {
    return null
  }

  let lowShares = 0
  let highShares = quote.shares
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const middleShares = (lowShares + highShares) / 2
    const candidate = constrainArbitrageQuoteForPolymarketFok(
      trimArbitrageQuote(quote, middleShares),
      Number.POSITIVE_INFINITY,
      polymarketTickSize,
    )
    if (meetsMinimum(candidate)) {
      highShares = middleShares
    } else {
      lowShares = middleShares
    }
  }

  const firstShareHundredth = Math.max(1, Math.floor(lowShares * 100) - 1)
  const lastShareHundredth = Math.min(Math.ceil(quote.shares * 100), Math.ceil(highShares * 100) + 100)
  for (let shareHundredths = firstShareHundredth; shareHundredths <= lastShareHundredth; shareHundredths += 1) {
    const candidate = constrainArbitrageQuoteForPolymarketFok(
      trimArbitrageQuote(quote, shareHundredths / 100),
      Number.POSITIVE_INFINITY,
      polymarketTickSize,
    )
    if (meetsMinimum(candidate)) {
      return candidate
    }
  }

  return maximumQuote
}
