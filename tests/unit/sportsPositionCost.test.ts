import { describe, expect, it } from 'bun:test'

import { resolvePositionCostValue } from '@/app/[locale]/(platform)/sports/_components/_sports-games-center/sports-games-center-utils'

describe('sports position cost', () => {
  it('does not treat lifetime shares bought as a cash cost', () => {
    const position = {
      totalBought: 10,
    }

    expect(resolvePositionCostValue(position as any, 20.4, 0.5)).toBe(10.2)
  })

  it('uses the explicit remaining basis including fees after a partial sale', () => {
    const position = { totalBought: 16, initialValue: 7.169344 }
    expect(resolvePositionCostValue(position as any, 8, 0.896168)).toBe(7.169344)
  })

  it('normalizes stored micro-unit position cost', () => {
    const position = {
      total_position_cost: 10_200_000,
    }

    expect(resolvePositionCostValue(position as any, 0, null)).toBe(10.2)
  })
})
