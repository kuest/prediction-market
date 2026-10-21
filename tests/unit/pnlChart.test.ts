import { describe, expect, it } from 'bun:test'

import { calculatePnlGainLossThroughTime, findNearestPnlPointByTime } from '@/lib/pnl-chart'

const points = [
  { date: new Date(0), value: 0 },
  { date: new Date(10_000), value: 0.8 },
  { date: new Date(30_000), value: 0.3 },
]

describe('P&L chart hover', () => {
  it('selects observed values by temporal midpoint, including irregular intervals', () => {
    expect(findNearestPnlPointByTime(points, -1)).toBe(points[0])
    expect(findNearestPnlPointByTime(points, 4_999)).toBe(points[0])
    expect(findNearestPnlPointByTime(points, 5_000)).toBe(points[1])
    expect(findNearestPnlPointByTime(points, 19_999)).toBe(points[1])
    expect(findNearestPnlPointByTime(points, 20_000)).toBe(points[2])
    expect(findNearestPnlPointByTime(points, 40_000)).toBe(points[2])
  })

  it('uses the latest observation for identical timestamps', () => {
    const repeated = [points[0], { date: new Date(10_000), value: 0.4 }, points[1], points[2]]
    expect(findNearestPnlPointByTime(repeated, 10_000)).toBe(points[1])
    expect(findNearestPnlPointByTime(repeated, 8_000)).toBe(points[1])
    expect(findNearestPnlPointByTime([], 0)).toBeNull()
  })

  it('calculates gain and loss only through observed samples', () => {
    const first = findNearestPnlPointByTime(points, 4_999)
    const second = findNearestPnlPointByTime(points, 5_000)
    const third = findNearestPnlPointByTime(points, 20_000)

    expect(calculatePnlGainLossThroughTime(points, first!.date.getTime(), 0)).toEqual([0, 0])
    expect(calculatePnlGainLossThroughTime(points, second!.date.getTime(), 0)).toEqual([0.8, 0])
    expect(calculatePnlGainLossThroughTime(points, third!.date.getTime(), 0)).toEqual([0.8, 0.5])
    expect(calculatePnlGainLossThroughTime(points, -1, 0)).toEqual([0, 0])
    expect(calculatePnlGainLossThroughTime(points, 10_000, 0.25)).toEqual([0.8, 0.25])
  })
})
