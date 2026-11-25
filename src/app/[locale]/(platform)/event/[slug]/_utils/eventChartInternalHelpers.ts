import type { ActivityOrder, Event, Market } from '@/types'
import type { DataPoint } from '@/types/PredictionChartTypes'

import { OUTCOME_INDEX } from '@/lib/constants'
import { fetchUserActivityData, mapDataApiActivityToActivityOrder } from '@/lib/data-api/user'
import { formatSharePriceLabel } from '@/lib/formatters'
import { resolveMarketAssetUrl } from '@/lib/image/asset-reference'

export interface TradeFlowLabelItem {
  id: string
  label: string
  outcome: 'yes' | 'no'
  createdAt: number
}

const tradeFlowMaxItems = 6
const tradeFlowTtlMs = 8000
export const tradeFlowCleanupIntervalMs = 500
const CHART_MARKER_ACTIVITY_PAGE_SIZE = 50
const CHART_MARKER_MAX_PAGES_PER_MARKET = 10
export const EVENT_PLOT_CLIP_RIGHT_PADDING = 18
const TWEET_COUNT_METADATA_KEYS = [
  'tweet_count',
  'tweetCount',
  'tweets_count',
  'tweetsCount',
  'mention_count',
  'mentionCount',
  'mentions_count',
  'mentionsCount',
] as const
export const tradeFlowTextStrokeStyle = {
  textShadow: `
    1px 0 0 var(--background),
    -1px 0 0 var(--background),
    0 1px 0 var(--background),
    0 -1px 0 var(--background),
    1px 1px 0 var(--background),
    -1px -1px 0 var(--background),
    1px -1px 0 var(--background),
    -1px 1px 0 var(--background)
  `,
} as const

export async function fetchUserTradeActivityForConditionIds(params: {
  userAddress: string
  conditionIds: string[]
  signal?: AbortSignal
}) {
  const { userAddress, conditionIds, signal } = params
  if (!userAddress || conditionIds.length === 0) {
    return [] as ActivityOrder[]
  }

  const collected: ActivityOrder[] = []

  for (const conditionId of conditionIds) {
    let offset = 0

    for (let page = 0; page < CHART_MARKER_MAX_PAGES_PER_MARKET; page += 1) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }

      const response = await fetchUserActivityData({
        pageParam: offset,
        userAddress,
        conditionId,
        signal,
      })
      const mapped = response.map(mapDataApiActivityToActivityOrder)
      const trades = mapped.filter(
        (activity) => activity.type === 'trade' && activity.market.condition_id === conditionId,
      )

      collected.push(...trades)

      if (response.length < CHART_MARKER_ACTIVITY_PAGE_SIZE) {
        break
      }

      offset += response.length
    }
  }

  const deduped = new Map<string, ActivityOrder>()
  collected.forEach((activity) => {
    const existing = deduped.get(activity.id)
    if (!existing) {
      deduped.set(activity.id, activity)
      return
    }

    if (new Date(activity.created_at).getTime() > new Date(existing.created_at).getTime()) {
      deduped.set(activity.id, activity)
    }
  })

  return Array.from(deduped.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
}

export function getOutcomeTokenIds(market: Market | null) {
  if (!market) {
    return null
  }
  const yesOutcome = market.outcomes.find((outcome) => outcome.outcome_index === OUTCOME_INDEX.YES)
  const noOutcome = market.outcomes.find((outcome) => outcome.outcome_index === OUTCOME_INDEX.NO)

  if (!yesOutcome?.token_id || !noOutcome?.token_id) {
    return null
  }

  return {
    yesTokenId: String(yesOutcome.token_id),
    noTokenId: String(noOutcome.token_id),
  }
}

export function buildTradeFlowLabel(price: number, size: number) {
  const notional = price * size
  if (!Number.isFinite(notional) || notional <= 0) {
    return null
  }
  return formatSharePriceLabel(notional / 100, { fallback: '0¢', currencyDigits: 0 })
}

export function resolveOutcomeIconUrl(iconUrl?: string | null) {
  return resolveMarketAssetUrl(iconUrl) ?? ''
}

export function pruneTradeFlowItems(items: TradeFlowLabelItem[], now: number) {
  return items.filter((item) => now - item.createdAt <= tradeFlowTtlMs)
}

export function trimTradeFlowItems(items: TradeFlowLabelItem[]) {
  return items.slice(-tradeFlowMaxItems)
}

export function resolveSelectedMarketIds(
  customSelectedMarketIds: string[] | null,
  allMarketIds: string[],
  defaultMarketIds: string[],
) {
  const allMarketIdSet = new Set(allMarketIds)
  const filteredCustomIds = customSelectedMarketIds?.filter((id) => allMarketIdSet.has(id)) ?? []

  return filteredCustomIds.length > 0 ? filteredCustomIds : defaultMarketIds
}

export function parseTimestampToMs(value: string | null | undefined): number | null {
  if (!value) {
    return null
  }

  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseCountValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 0 ? value : null
  }

  if (typeof value === 'string') {
    const normalized = value.replaceAll(',', '').trim()
    if (!normalized) {
      return null
    }

    const parsed = Number(normalized)
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed
    }
  }

  return null
}

function resolveTweetCountFromRecord(record: Record<string, unknown> | null | undefined): number | null {
  if (!record) {
    return null
  }

  for (const key of TWEET_COUNT_METADATA_KEYS) {
    const parsed = parseCountValue(record[key])
    if (parsed != null) {
      return parsed
    }
  }

  return null
}

export function resolveTweetCount(event: Event): number | null {
  const fromEvent = resolveTweetCountFromRecord(event as unknown as Record<string, unknown>)
  if (fromEvent != null) {
    return fromEvent
  }

  for (const market of event.markets) {
    if (!market.metadata || typeof market.metadata !== 'object') {
      continue
    }

    const fromMarket = resolveTweetCountFromRecord(market.metadata as Record<string, unknown>)
    if (fromMarket != null) {
      return fromMarket
    }
  }

  return null
}

export function resolveTweetCountdownTargetMs(event: Event): number | null {
  const eventEndMs = parseTimestampToMs(event.end_date)
  if (eventEndMs != null) {
    return eventEndMs
  }

  const marketEndTimes = event.markets
    .map((market) => parseTimestampToMs(market.end_time ?? null))
    .filter((timestamp): timestamp is number => timestamp != null)

  if (marketEndTimes.length === 0) {
    return null
  }

  return Math.min(...marketEndTimes)
}

export function buildCombinedOutcomeHistory(
  yesHistory: DataPoint[],
  noHistory: DataPoint[],
  conditionId: string,
  yesKey: string,
  noKey: string,
) {
  if (!conditionId) {
    return { points: [], latestSnapshot: {} as Record<string, number> }
  }

  const yesByTimestamp = new Map<number, number>()
  const noByTimestamp = new Map<number, number>()

  yesHistory.forEach((point) => {
    const value = point[conditionId]
    if (typeof value === 'number' && Number.isFinite(value)) {
      yesByTimestamp.set(point.date.getTime(), value)
    }
  })

  noHistory.forEach((point) => {
    const value = point[conditionId]
    if (typeof value === 'number' && Number.isFinite(value)) {
      noByTimestamp.set(point.date.getTime(), value)
    }
  })

  const timestamps = Array.from(new Set([...yesByTimestamp.keys(), ...noByTimestamp.keys()])).sort((a, b) => a - b)

  let lastYes: number | null = null
  let lastNo: number | null = null
  const points: DataPoint[] = []

  timestamps.forEach((timestamp) => {
    const yesValue = yesByTimestamp.get(timestamp)
    const noValue = noByTimestamp.get(timestamp)
    if (typeof yesValue === 'number') {
      lastYes = yesValue
    }
    if (typeof noValue === 'number') {
      lastNo = noValue
    }
    if (lastYes === null && lastNo === null) {
      return
    }
    const point: DataPoint = { date: new Date(timestamp) }
    if (lastYes !== null) {
      point[yesKey] = lastYes
    }
    if (lastNo !== null) {
      point[noKey] = lastNo
    }
    points.push(point)
  })

  const latestSnapshot: Record<string, number> = {}
  const latestPoint = points.at(-1)
  if (latestPoint) {
    const yesValue = latestPoint[yesKey]
    const noValue = latestPoint[noKey]
    if (typeof yesValue === 'number' && Number.isFinite(yesValue)) {
      latestSnapshot[yesKey] = yesValue
    }
    if (typeof noValue === 'number' && Number.isFinite(noValue)) {
      latestSnapshot[noKey] = noValue
    }
  }

  return { points, latestSnapshot }
}
