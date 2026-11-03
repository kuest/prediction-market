import type { UserPosition } from '@/types'

import { MICRO_UNIT } from '@/lib/constants'

function finiteNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null
  }
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function nonNegativeNumber(value: unknown) {
  const numeric = finiteNumber(value)
  return numeric != null && numeric >= 0 ? numeric : null
}

export function resolvePositionCostValue(position: UserPosition, shares: number, avgPrice: number | null) {
  // initialValue is the remaining USD basis, including fill fees. totalBought
  // is lifetime shares bought; it is not cash or the remaining share quantity.
  const explicitCost = nonNegativeNumber(position.initialValue)
  if (explicitCost != null) {
    return explicitCost
  }
  const storedCost = nonNegativeNumber(position.total_position_cost)
  if (storedCost != null) {
    return storedCost / MICRO_UNIT
  }
  return shares > 0 && avgPrice != null && Number.isFinite(avgPrice) && avgPrice >= 0 ? shares * avgPrice : null
}

export function resolvePositionCurrentValue(
  position: UserPosition,
  shares: number,
  avgPrice: number | null,
  marketPrice: number | null = null,
) {
  // An explicit API valuation is authoritative, including a zero payout.
  // Only derive from the API mark when that valuation is absent.
  const apiValue = nonNegativeNumber(position.currentValue)
  if (apiValue != null) {
    return apiValue
  }
  const apiPrice = nonNegativeNumber(position.curPrice)
  if (shares > 0 && apiPrice != null && apiPrice <= 1) {
    return shares * apiPrice
  }
  const storedValue = nonNegativeNumber(position.total_position_value)
  // The API mapper synthesizes a stored zero when currentValue is missing.
  // That placeholder must not prevent a quote fallback. Explicit API zero
  // values and prices were already handled above.
  if (storedValue != null && storedValue > 0) {
    return storedValue / MICRO_UNIT
  }
  // Legacy rows without an API valuation retain their existing quote/cost
  // fallback. Neither fallback replaces an explicit API value, including zero.
  if (shares > 0 && marketPrice != null && Number.isFinite(marketPrice) && marketPrice >= 0 && marketPrice <= 1) {
    return shares * marketPrice
  }
  return shares > 0 && avgPrice != null && Number.isFinite(avgPrice) && avgPrice >= 0 ? shares * avgPrice : 0
}

export function resolvePositionRealizedPnl(position: UserPosition) {
  // Both API fields are already USD. cashPnl is unrealized (value - basis),
  // so adding it as realized profit would count the open-position return twice.
  return finiteNumber(position.realizedPnl) ?? 0
}
