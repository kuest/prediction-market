import type { TimeRange } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'
import type { HomeSportsMoneylineButton } from '@/lib/sports-home-card'
import type { Event } from '@/types'

import { buildHomeSportsMoneylineModel } from '@/lib/sports-home-card'

const CHART_COLOR_VARIABLES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)']
const MAX_SERIES = 4
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000
const CHART_RANGE_WINDOW_MS: Record<Exclude<TimeRange, 'ALL'>, number> = {
  '1H': 60 * 60 * 1000,
  '6H': 6 * 60 * 60 * 1000,
  '1D': 24 * 60 * 60 * 1000,
  '1W': 7 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
}

export function getMaxSeriesCount() {
  return MAX_SERIES
}

export function shouldHideEventChart(
  event: Event,
  {
    forceVisible = false,
    isSingleMarket = event.total_markets_count === 1,
    sportsMoneylineMarketIds,
    maxSeriesCount = getMaxSeriesCount(),
  }: {
    forceVisible?: boolean
    isSingleMarket?: boolean
    sportsMoneylineMarketIds?: string[]
    maxSeriesCount?: number
  } = {},
) {
  if (forceVisible || isSingleMarket || event.enable_neg_risk || event.neg_risk) {
    return false
  }

  const moneylineMarketIds = sportsMoneylineMarketIds ?? getSportsMoneylineMarketIds(event)
  return moneylineMarketIds.slice(0, maxSeriesCount).length <= 1
}

interface FeaturedChartEventLike {
  markets: Array<{
    condition_id: string
    is_resolved: boolean
    condition?: { resolved: boolean } | null
  }>
}

export function getFeaturedChartEvent<T extends FeaturedChartEventLike>(event: T, isSingleMarket: boolean): T {
  if (isSingleMarket) {
    return event
  }

  const unresolvedMarkets = event.markets.filter((market) => !market.is_resolved && !market.condition?.resolved)
  if (unresolvedMarkets.length === 0 || unresolvedMarkets.length === event.markets.length) {
    return event
  }

  return { ...event, markets: unresolvedMarkets } as T
}

export function buildMarketSignature(event: Event) {
  return event.markets
    .map((market) => {
      const outcomeSignature = market.outcomes.map((outcome) => `${outcome.token_id}:${outcome.updated_at}`).join(',')
      return `${market.condition_id}:${market.updated_at}:${outcomeSignature}`
    })
    .join('|')
}

export function resolveEventHistoryEndAt(event: Event) {
  const resolvedAt = event.resolved_at ?? null
  if (resolvedAt) {
    const resolvedMs = new Date(resolvedAt).getTime()
    if (Number.isFinite(resolvedMs)) {
      return resolvedAt
    }
  }

  if (event.status === 'resolved' || event.status === 'archived') {
    const endDate = event.end_date ?? null
    if (!endDate) {
      return null
    }

    const endDateMs = new Date(endDate).getTime()
    return Number.isFinite(endDateMs) ? endDate : null
  }

  return null
}

export function buildHistoryWithLatestPointOverride(
  normalizedHistory: Array<Record<string, number | Date> & { date: Date }>,
  valueByKey: Record<string, number>,
  endMs: number | null,
  startMs: number | null = null,
): Array<Record<string, number | Date> & { date: Date }> {
  const fallbackTimestamp = normalizedHistory.at(-1)?.date.getTime()
  if (!Number.isFinite(endMs) && !Number.isFinite(fallbackTimestamp)) {
    return normalizedHistory
  }

  const nextTimestamp = Number.isFinite(endMs) ? (endMs as number) : (fallbackTimestamp as number)
  const nextDate = new Date(nextTimestamp)
  const sanitizedEntries = Object.entries(valueByKey)
    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
    .map(([key, value]) => [key, Math.max(0, Math.min(100, value))] as const)

  if (normalizedHistory.length === 0) {
    if (!sanitizedEntries.length) {
      return normalizedHistory
    }

    if (Number.isFinite(startMs) && (startMs as number) < nextTimestamp) {
      return [
        Object.fromEntries([['date', new Date(startMs as number)], ...sanitizedEntries]) as Record<
          string,
          number | Date
        > & { date: Date },
        Object.fromEntries([['date', nextDate], ...sanitizedEntries]) as Record<string, number | Date> & { date: Date },
      ]
    }

    return [
      Object.fromEntries([['date', nextDate], ...sanitizedEntries]) as Record<string, number | Date> & { date: Date },
    ]
  }

  const lastPoint = normalizedHistory.at(-1)
  if (!lastPoint) {
    return normalizedHistory
  }

  const lastTimestamp = lastPoint.date.getTime()
  const latestValues = {
    ...lastPoint,
    ...Object.fromEntries(sanitizedEntries),
  }

  if (Number.isFinite(lastTimestamp) && nextTimestamp > lastTimestamp) {
    return [
      ...normalizedHistory,
      {
        ...latestValues,
        date: nextDate,
      },
    ]
  }

  const hasChangedLatestValues = sanitizedEntries.some(([key, value]) => {
    const lastValue = lastPoint[key]
    return typeof lastValue !== 'number' || !Number.isFinite(lastValue) || Math.abs(lastValue - value) >= 0.0001
  })

  if (!hasChangedLatestValues) {
    return normalizedHistory
  }

  return [
    ...normalizedHistory.slice(0, -1),
    {
      ...latestValues,
      date: lastPoint.date,
    },
  ]
}

export function resolveChartRangeStartMs(range: TimeRange, eventCreatedAt: string, endMs: number | null) {
  const createdMs = Date.parse(eventCreatedAt)
  if (!Number.isFinite(createdMs)) {
    return null
  }

  if (range === 'ALL' || !Number.isFinite(endMs)) {
    return createdMs
  }

  return Math.max(createdMs, (endMs as number) - CHART_RANGE_WINDOW_MS[range])
}

export function computeChanceChanges(
  points: Array<Record<string, number | Date> & { date: Date }>,
  currentOverrides: Record<string, number> = {},
) {
  if (!points.length) {
    return {}
  }

  const latestPoint = points.at(-1)
  if (!latestPoint) {
    return {}
  }
  const targetTime = latestPoint.date.getTime() - TWELVE_HOURS_MS
  let baselinePoint = points[0]

  for (let index = points.length - 1; index >= 0; index -= 1) {
    const currentPoint = points[index]
    if (currentPoint.date.getTime() <= targetTime) {
      baselinePoint = currentPoint
      break
    }
  }

  const changes: Record<string, number> = {}

  Object.entries(latestPoint).forEach(([key, value]) => {
    if (key === 'date') {
      return
    }

    const overrideValue = currentOverrides[key]
    const resolvedCurrent = typeof overrideValue === 'number' && Number.isFinite(overrideValue) ? overrideValue : value
    if (typeof resolvedCurrent !== 'number' || !Number.isFinite(resolvedCurrent)) {
      return
    }

    const baselineValue = baselinePoint[key]
    const numericBaseline =
      typeof baselineValue === 'number' && Number.isFinite(baselineValue) ? baselineValue : resolvedCurrent

    changes[key] = resolvedCurrent - numericBaseline
  })

  return changes
}

export function filterChartDataForSeries(
  points: Array<Record<string, number | Date> & { date: Date }>,
  seriesKeys: string[],
) {
  if (!points.length || !seriesKeys.length) {
    return []
  }

  return points.map((point) => {
    const filtered: Record<string, number | Date> & { date: Date } = { date: point.date }
    seriesKeys.forEach((key) => {
      if (typeof point[key] === 'number') {
        filtered[key] = point[key]
      }
    })
    return filtered
  })
}

export function getTopMarketIds(chances: Record<string, number>, limit: number) {
  return Object.entries(chances)
    .filter(([, value]) => Number.isFinite(value))
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([key]) => key)
}

export function getSportsMoneylineMarketIds(event: Event) {
  const model = buildHomeSportsMoneylineModel(event)
  if (!model) {
    return []
  }

  const orderedButtons = [model.team1Button, model.drawButton, model.team2Button].filter(
    (button): button is HomeSportsMoneylineButton => Boolean(button),
  )
  const marketIds: string[] = []
  const seenMarketIds = new Set<string>()

  for (const button of orderedButtons) {
    if (seenMarketIds.has(button.conditionId)) {
      continue
    }

    seenMarketIds.add(button.conditionId)
    marketIds.push(button.conditionId)
  }

  return marketIds
}

function isDefaultMarketLabel(label?: string | null) {
  if (!label) {
    return true
  }
  return /^(?:outcome|token)\s*\d+$/i.test(label.trim())
}

export function getMarketSeriesLabel(market: Event['markets'][number]) {
  const metadata = (market.metadata ?? {}) as Record<string, unknown>
  const metadataShortTitle = typeof metadata.short_title === 'string' ? metadata.short_title.trim() : ''
  const shortTitle = market.short_title?.trim()
  const outcomeLabel = market.outcomes?.[0]?.outcome_text?.trim()

  if (metadataShortTitle && !isDefaultMarketLabel(metadataShortTitle)) {
    return metadataShortTitle
  }

  if (shortTitle && !isDefaultMarketLabel(shortTitle)) {
    return shortTitle
  }

  if (outcomeLabel) {
    return outcomeLabel
  }

  return market.title
}

export function getOutcomeLabelForMarket(market: Event['markets'][number] | undefined, outcomeIndex: number) {
  const outcome = market?.outcomes.find((item) => item.outcome_index === outcomeIndex)
  const label = outcome?.outcome_text?.trim()

  if (label) {
    return label
  }

  return outcomeIndex === 0 ? 'Yes' : 'No'
}

export function buildChartSeries(event: Event, marketIds: string[]) {
  return marketIds
    .map((conditionId, index) => {
      const market = event.markets.find((current) => current.condition_id === conditionId)
      if (!market) {
        return null
      }
      return {
        key: conditionId,
        name: getMarketSeriesLabel(market),
        color: CHART_COLOR_VARIABLES[index % CHART_COLOR_VARIABLES.length],
      }
    })
    .filter((entry): entry is { key: string; name: string; color: string } => entry !== null)
}
