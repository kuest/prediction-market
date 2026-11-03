import { describe, expect, it } from 'bun:test'

import type { DataApiPosition } from '@/lib/data-api/user'
import type { UserPosition } from '@/types'

import { mapDataApiPositionToUserPosition } from '@/lib/data-api/user'
import {
  resolvePositionCostValue,
  resolvePositionCurrentValue,
  resolvePositionRealizedPnl,
} from '@/lib/position-values'

const indexedBuy: DataApiPosition = {
  size: 16,
  totalBought: 16,
  avgPrice: 0.896168,
  initialValue: 14.338688,
  curPrice: 0.91,
  currentValue: 14.56,
  cashPnl: 0.221312,
  realizedPnl: 0,
}

describe('position USD values', () => {
  it('preserves the indexed fee-inclusive cost through the actual API mapper', () => {
    const position = mapDataApiPositionToUserPosition(indexedBuy, 'active')
    const cost = resolvePositionCostValue(position, 16, 0.896168)!
    const value = resolvePositionCurrentValue(position, 16, 0.896168, 0.96)
    expect(position.totalBought).toBe(16)
    expect(position.total_position_cost).toBe(14_338_688)
    expect(cost).toBe(14.338688)
    expect(value).toBeCloseTo(14.56, 6)
    expect(value - cost + resolvePositionRealizedPnl(position)).toBeCloseTo(0.221312, 6)
  })

  it.each([0, 0.89, 0.99, 1])('keeps an API mark of %s ahead of a stale event quote', (mark) => {
    const position = mapDataApiPositionToUserPosition(
      { ...indexedBuy, curPrice: mark, currentValue: 16 * mark },
      'active',
    )
    expect(resolvePositionCurrentValue(position, 16, 0.896168, 0.91)).toBeCloseTo(16 * mark, 6)
  })

  it('preserves an explicit zero API value when its price is unavailable', () => {
    const position = { currentValue: 0, total_position_value: 14_560_000 } as UserPosition
    expect(resolvePositionCurrentValue(position, 16, 0.896168, 0.99)).toBe(0)
  })

  it('preserves an explicit zero API valuation even when its price is nonzero', () => {
    const position = mapDataApiPositionToUserPosition({ ...indexedBuy, currentValue: 0, curPrice: 0.91 }, 'active')
    expect(resolvePositionCurrentValue(position, 16, 0.896168, 0.99)).toBe(0)
  })

  it('preserves a positive API valuation instead of recomputing it from a different mark', () => {
    const position = mapDataApiPositionToUserPosition({ ...indexedBuy, currentValue: 14.24, curPrice: 0.91 }, 'active')
    expect(resolvePositionCurrentValue(position, 16, 0.896168, 0.99)).toBe(14.24)
  })

  it('continues to the quote when the mapper synthesized a zero for a missing API valuation', () => {
    const position = mapDataApiPositionToUserPosition(
      { ...indexedBuy, currentValue: undefined, curPrice: undefined },
      'active',
    )
    expect(position.total_position_value).toBe(0)
    expect(resolvePositionCurrentValue(position, 16, 0.896168, 0.91)).toBe(14.56)
  })

  it('still accepts an explicit zero API price when currentValue is absent', () => {
    const position = mapDataApiPositionToUserPosition({ ...indexedBuy, currentValue: undefined, curPrice: 0 }, 'active')
    expect(resolvePositionCurrentValue(position, 16, 0.896168, 0.91)).toBe(0)
  })

  it('uses legacy micro-USD values without rounding them before the return calculation', () => {
    const position = { total_position_cost: 14_338_690, total_position_value: 14_560_000 } as UserPosition
    expect(resolvePositionCostValue(position, 16, 0.896168)).toBe(14.33869)
    expect(resolvePositionCurrentValue(position, 16, 0.896168)).toBe(14.56)
  })

  it('keeps a zero remaining cost instead of substituting total bought or average cost', () => {
    const position = { initialValue: 0, totalBought: 16, total_position_cost: 14_338_690 } as UserPosition
    expect(resolvePositionCostValue(position, 16, 0.896168)).toBe(0)
  })

  it('derives only the remaining quantity basis when explicit costs are missing', () => {
    const position = { totalBought: 160 } as UserPosition
    expect(resolvePositionCostValue(position, 8, 0.896168)).toBeCloseTo(7.169344, 6)
    expect(resolvePositionCostValue(position, 0, null)).toBeNull()
  })

  it('does not add unrealized cashPnl as realized profit', () => {
    expect(resolvePositionRealizedPnl({ cashPnl: 0.221312 } as UserPosition)).toBe(0)
    expect(resolvePositionRealizedPnl({ cashPnl: 0.221312, realizedPnl: 0 } as UserPosition)).toBe(0)
  })

  it.each([99, -99])(
    'does not rescale a valid realized return of %s USD based on a small remaining basis',
    (realizedPnl) => {
      expect(resolvePositionRealizedPnl({ initialValue: 0.01, realizedPnl } as UserPosition)).toBe(realizedPnl)
    },
  )

  it('adds realized profit from a partial exit exactly once to the remaining unrealized value', () => {
    const position = mapDataApiPositionToUserPosition(
      {
        ...indexedBuy,
        size: 8,
        initialValue: 7.169344,
        currentValue: 7.28,
        cashPnl: 0.110656,
        realizedPnl: 0.35,
      },
      'active',
    )
    const cost = resolvePositionCostValue(position, 8, 0.896168)!
    const value = resolvePositionCurrentValue(position, 8, 0.896168)
    const pnl = value - cost + resolvePositionRealizedPnl(position)
    expect(pnl).toBeCloseTo(0.460656, 6)
    expect((100 * pnl) / cost).toBeCloseTo(6.425357, 5)
  })
})
