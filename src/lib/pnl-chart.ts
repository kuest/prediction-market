export interface PnlPoint {
  date: Date
  value: number
}

/** Points are sorted by time. A midpoint belongs to the later observation. */
export function findNearestPnlPointByTime<T extends PnlPoint>(points: T[], targetTime: number): T | null {
  if (!points.length || !Number.isFinite(targetTime)) {
    return null
  }

  let low = 0
  let high = points.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (points[middle].date.getTime() <= targetTime) {
      low = middle + 1
    } else {
      high = middle
    }
  }

  const before = points[low - 1]
  let afterIndex = low
  while (afterIndex + 1 < points.length && points[afterIndex + 1].date.getTime() === points[low]?.date.getTime()) {
    afterIndex += 1
  }
  const after = points[afterIndex]
  if (!before) {
    return after
  }
  if (!after) {
    return before
  }
  return targetTime - before.date.getTime() < after.date.getTime() - targetTime ? before : after
}

/** Only observed changes through the selected sample contribute to the breakdown. */
export function calculatePnlGainLossThroughTime(points: PnlPoint[], targetTime: number, baseline: number) {
  let gain = 0
  let loss = 0
  let previousValue = baseline

  for (const point of points) {
    if (point.date.getTime() > targetTime) {
      break
    }
    const delta = point.value - previousValue
    if (delta >= 0) {
      gain += delta
    } else {
      loss -= delta
    }
    previousValue = point.value
  }

  return [gain, loss] as const
}
