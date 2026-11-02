import type { ActivityOrder, UserPosition } from '@/types'

import { MICRO_UNIT } from '@/lib/constants'
import { buildDataApiUrl } from '@/lib/data-api/client'

interface DataApiRequestParams {
  pageParam: number
  userAddress: string
  signal?: AbortSignal
}

export interface DataApiActivity {
  id?: string
  event_id?: string
  proxyWallet?: string
  timestamp?: number
  conditionId?: string
  type?: string
  size?: number
  usdcSize?: number
  transactionHash?: string
  price?: number
  asset?: string
  side?: string
  outcomeIndex?: number
  title?: string
  slug?: string
  icon?: string
  eventSlug?: string
  outcome?: string | null
  name?: string
  pseudonym?: string
  profileImage?: string
  profileImageOptimized?: string
  tags?: string[]
}

export interface DataApiPosition {
  proxyWallet?: string
  asset?: string
  conditionId?: string
  size?: number
  avgPrice?: number
  initialValue?: number
  currentValue?: number
  cashPnl?: number
  totalBought?: number
  realizedPnl?: number
  percentPnl?: number
  percentRealizedPnl?: number
  curPrice?: number
  redeemable?: boolean
  mergeable?: boolean
  title?: string
  slug?: string
  icon?: string
  eventSlug?: string
  outcome?: string
  outcomeIndex?: number
  oppositeOutcome?: string
  oppositeAsset?: string
  timestamp?: number
  orderCount?: number
  negativeRisk?: boolean
  negative_risk?: boolean
}

export interface DataApiOtherBalance {
  slug?: string
  user?: string
  size?: number
}

function normalizeValue(value: number | undefined | null): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  const numeric = Number(value)
  if (numeric > MICRO_UNIT) {
    return numeric / MICRO_UNIT
  }

  return numeric
}

function normalizeTransactionHash(value: string | undefined) {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) {
    return undefined
  }
  return normalized.startsWith('\\x') ? `0x${normalized.slice(2)}` : normalized
}

function normalizeShares(value?: number | null): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  const numeric = Number(value)
  const abs = Math.abs(numeric)
  if (abs > MICRO_UNIT) {
    return numeric / MICRO_UNIT
  }

  return numeric
}

function normalizeUsd(value?: number | null): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  const numeric = Number(value)
  const abs = Math.abs(numeric)
  if (abs > MICRO_UNIT) {
    return numeric / MICRO_UNIT
  }

  return numeric
}

function sanitizePrice(value?: number | null): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  let numeric = Number(value)
  while (numeric > 10) {
    numeric /= 100
  }
  return numeric
}

function resolveActivityEventId(activity: DataApiActivity) {
  return activity.id?.trim() || activity.event_id?.trim() || undefined
}

function buildActivityId(activity: DataApiActivity, slugFallback: string, eventId: string | undefined): string {
  if (eventId) {
    const address = activity.proxyWallet?.trim().toLowerCase()
    return address ? `${eventId}:${address}` : eventId
  }

  type BaseSource = 'transactionHash' | 'conditionId' | 'asset' | 'slug' | 'fallback'

  let baseSource: BaseSource = 'fallback'
  let base = activity.transactionHash
  if (base) {
    baseSource = 'transactionHash'
  } else if (activity.conditionId) {
    base = activity.conditionId
    baseSource = 'conditionId'
  } else if (activity.asset) {
    base = activity.asset
    baseSource = 'asset'
  } else if (slugFallback) {
    base = slugFallback
    baseSource = 'slug'
  } else {
    base = 'activity'
  }

  const parts = [base]
  function append(value?: string | number | null, source?: BaseSource) {
    if (source && source === baseSource) {
      return
    }
    if (value === null || value === undefined) {
      return
    }
    const text = String(value).trim()
    if (!text) {
      return
    }
    parts.push(text)
  }

  append(activity.conditionId, 'conditionId')
  append(activity.asset, 'asset')
  append(activity.outcomeIndex ?? activity.outcome)
  append(activity.side)
  append(activity.price)
  append(activity.size)
  append(activity.timestamp)

  return parts.join(':')
}

function nonNegativeUnitAmount(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function resolveActivityAmounts(activity: DataApiActivity, normalizedType: string | undefined) {
  const isSplit = normalizedType === 'split'
  if (isSplit || normalizedType === 'merge' || normalizedType === 'merged') {
    // The API reports full sets and collateral in units. Each set is backed by
    // one USDC, regardless of outcome prices or the magnitude of the amount.
    const collateral = nonNegativeUnitAmount(activity.usdcSize)
    const baseSize = nonNegativeUnitAmount(activity.size) ?? collateral ?? 0
    return {
      baseSize,
      // ActivityOrder counts both minted outcomes for splits; history displays
      // half this amount. Merges retain the number of full sets burned.
      size: isSplit ? baseSize * 2 : baseSize,
      price: isSplit ? 0.5 : 1,
      totalUsd: collateral ?? baseSize,
    }
  }

  const normalizedUsd = normalizeUsd(activity.usdcSize)
  let price = sanitizePrice(normalizeValue(activity.price))
  if (price < 0) {
    price = 0
  }

  let baseSize = normalizeShares(activity.size)

  const canDeriveFromUsd = normalizedUsd > 0 && price > 0
  if (canDeriveFromUsd && (baseSize <= 0 || baseSize > 1_000)) {
    baseSize = normalizedUsd / price
  }

  const derivedTotal = baseSize > 0 && price > 0 ? baseSize * price : 0
  let totalUsd = normalizedUsd > 0 ? normalizedUsd : 0
  if (derivedTotal > 0 && (totalUsd === 0 || derivedTotal < totalUsd * 10)) {
    totalUsd = derivedTotal
  } else if (totalUsd === 0) {
    totalUsd = derivedTotal
  }
  return { baseSize, size: baseSize, price, totalUsd }
}

export function mapDataApiActivityToActivityOrder(activity: DataApiActivity): ActivityOrder {
  const slug = activity.slug || activity.conditionId || 'unknown-market'
  const eventSlug = activity.eventSlug || slug
  const timestampMs = typeof activity.timestamp === 'number' ? activity.timestamp * 1000 : Date.now()
  const normalizedType = activity.type?.toLowerCase()
  const isSplit = normalizedType === 'split'
  const isRedeem = normalizedType === 'redeem' || normalizedType === 'redeemed' || normalizedType === 'redemption'
  const { baseSize, size, price, totalUsd } = resolveActivityAmounts(activity, normalizedType)
  const isZeroRedeem = isRedeem && baseSize <= 0 && totalUsd <= 0
  const outcomeText = isSplit ? 'Yes / No' : isZeroRedeem ? 'Outcome' : activity.outcome || 'Outcome'
  const outcomeIndex = isSplit || isZeroRedeem ? undefined : (activity.outcomeIndex ?? 0)
  const address = activity.proxyWallet || ''
  const displayName = activity.pseudonym || activity.name || address || 'Trader'
  const avatarUrl = activity.profileImageOptimized || activity.profileImage || ''
  const txHash = normalizeTransactionHash(activity.transactionHash)
  const eventId = resolveActivityEventId(activity)

  return {
    id: buildActivityId(activity, slug, eventId),
    event_id: eventId,
    type: isZeroRedeem ? 'loss' : normalizedType,
    user: {
      id: address || 'user',
      username: displayName,
      address,
      image: avatarUrl,
    },
    side: activity.side?.toLowerCase() === 'sell' ? 'sell' : 'buy',
    amount: Math.round(size * MICRO_UNIT).toString(),
    price: price.toString(),
    outcome: {
      index: outcomeIndex ?? 0,
      text: outcomeText,
    },
    market: {
      condition_id: activity.conditionId,
      title: activity.title || 'Untitled market',
      slug,
      icon_url: activity.icon || '',
      event: {
        slug: eventSlug,
        show_market_icons: Boolean(activity.icon),
      },
    },
    total_value: Math.round(totalUsd * MICRO_UNIT),
    created_at: new Date(timestampMs).toISOString(),
    status: 'completed',
    tx_hash: txHash,
  }
}

export async function fetchUserActivityData({
  pageParam,
  userAddress,
  signal,
  conditionId,
}: DataApiRequestParams & { conditionId?: string }): Promise<DataApiActivity[]> {
  const params = new URLSearchParams({
    limit: '50',
    offset: pageParam.toString(),
    user: userAddress,
  })

  if (conditionId) {
    params.set('marketId', conditionId)
    params.set('conditionId', conditionId)
  }

  const response = await fetch(buildDataApiUrl('/activity', params), { signal })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    const errorMessage = errorBody?.error || 'Server error occurred. Please try again later.'
    throw new Error(errorMessage)
  }

  const result = await response.json()
  if (!Array.isArray(result)) {
    throw new TypeError('Unexpected response from data service.')
  }

  return result as DataApiActivity[]
}

export async function fetchUserOtherBalance({
  eventSlug,
  userAddress,
  signal,
}: {
  eventSlug: string
  userAddress: string
  signal?: AbortSignal
}): Promise<DataApiOtherBalance[]> {
  const slug = eventSlug.trim()
  if (!slug) {
    return []
  }

  const normalizedUserAddress = userAddress.toLowerCase()
  const params = new URLSearchParams({
    slug,
    user: normalizedUserAddress,
  })

  const response = await fetch(buildDataApiUrl('/other', params), { signal })
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    const errorMessage = errorBody?.error || 'Server error occurred. Please try again later.'
    throw new Error(errorMessage)
  }

  const result = await response.json()
  if (!Array.isArray(result)) {
    throw new TypeError('Unexpected response from data service.')
  }

  return result.map((entry: DataApiOtherBalance) => ({
    ...entry,
    size: normalizeShares(entry.size),
  }))
}

export function mapDataApiPositionToUserPosition(position: DataApiPosition, status: 'active' | 'closed'): UserPosition {
  const slug = position.slug || position.conditionId || 'unknown-market'
  const eventSlug = position.eventSlug || slug
  const timestampMs = typeof position.timestamp === 'number' ? position.timestamp * 1000 : Date.now()

  const size = Number.isFinite(position.size) ? Number(position.size) : undefined
  const avgPrice = Number.isFinite(position.avgPrice) ? Number(position.avgPrice) : 0
  const currentValue = Number.isFinite(position.currentValue) ? Number(position.currentValue) : 0
  const realizedValue = Number.isFinite(position.realizedPnl) ? Number(position.realizedPnl) : currentValue
  const normalizedValue = status === 'closed' ? realizedValue : currentValue
  const derivedCostFromCash = Number.isFinite(position.cashPnl) ? normalizedValue - Number(position.cashPnl) : undefined
  const baseCost = Number.isFinite(position.initialValue)
    ? Number(position.initialValue)
    : Number.isFinite(derivedCostFromCash)
      ? Number(derivedCostFromCash)
      : Number.isFinite(position.totalBought)
        ? Number(position.totalBought) * avgPrice
        : undefined
  const fallbackCost = size != null ? size * avgPrice : normalizedValue
  const normalizedCost = Math.max(0, Number.isFinite(baseCost) && baseCost != null ? Number(baseCost) : fallbackCost)
  const pnlValueRaw = Number.isFinite(position.cashPnl) ? Number(position.cashPnl) : normalizedValue - normalizedCost
  const hasPercentPnl = Number.isFinite(position.percentPnl)
  const percentPnlRaw = hasPercentPnl
    ? Number(position.percentPnl)
    : normalizedCost > 0
      ? (pnlValueRaw / normalizedCost) * 100
      : 0
  const normalizedPercent = Number.isFinite(percentPnlRaw) ? percentPnlRaw : 0

  const orderCount =
    typeof position.orderCount === 'number'
      ? Math.max(0, Math.round(position.orderCount))
      : typeof position.size === 'number' && position.size > 0
        ? 1
        : 0
  const outcomeIndex = typeof position.outcomeIndex === 'number' ? position.outcomeIndex : undefined
  const outcomeText = position.outcome || (outcomeIndex != null ? (outcomeIndex === 0 ? 'Yes' : 'No') : undefined)
  const oppositeOutcomeText = position.oppositeOutcome

  return {
    market: {
      condition_id: position.conditionId || slug,
      title: position.title || 'Untitled market',
      slug,
      icon_url: position.icon || '',
      is_active: status === 'active',
      is_resolved: status === 'closed',
      event: {
        slug: eventSlug,
      },
    },
    outcome_index: outcomeIndex,
    outcome_text: outcomeText,
    avgPrice: Number.isFinite(position.avgPrice) ? Number(position.avgPrice) : undefined,
    curPrice: Number.isFinite(position.curPrice) ? Number(position.curPrice) : undefined,
    currentValue: Number.isFinite(position.currentValue) ? Number(position.currentValue) : undefined,
    totalBought: Number.isFinite(position.totalBought) ? Number(position.totalBought) : undefined,
    initialValue: Number.isFinite(position.initialValue) ? Number(position.initialValue) : undefined,
    average_position: Math.round(avgPrice * MICRO_UNIT),
    total_position_value: Math.round(normalizedValue * MICRO_UNIT),
    total_position_cost: Math.round(normalizedCost * MICRO_UNIT),
    total_shares: size,
    profit_loss_value: Math.round(pnlValueRaw * MICRO_UNIT),
    profit_loss_percent: normalizedPercent,
    realizedPnl: Number.isFinite(position.realizedPnl) ? Number(position.realizedPnl) : undefined,
    cashPnl: Number.isFinite(position.cashPnl) ? Number(position.cashPnl) : undefined,
    percentPnl: Number.isFinite(position.percentPnl) ? Number(position.percentPnl) : undefined,
    percentRealizedPnl: Number.isFinite(position.percentRealizedPnl) ? Number(position.percentRealizedPnl) : undefined,
    redeemable: Boolean(position.redeemable),
    opposite_outcome_text: oppositeOutcomeText,
    order_count: orderCount,
    last_activity_at: new Date(timestampMs).toISOString(),
  }
}

export async function fetchUserPositionsForMarket({
  pageParam,
  userAddress,
  status,
  conditionId,
  signal,
}: DataApiRequestParams & {
  status: 'active' | 'closed'
  conditionId?: string
}): Promise<UserPosition[]> {
  const endpoint = status === 'closed' ? '/closed-positions' : '/positions'
  const normalizedUserAddress = userAddress.toLowerCase()
  const params = new URLSearchParams({
    user: normalizedUserAddress,
    limit: '50',
    offset: pageParam.toString(),
    sortDirection: 'DESC',
    sizeThreshold: '0.01',
  })

  if (status === 'closed') {
    params.set('sortBy', 'TIMESTAMP')
  }
  if (conditionId) {
    params.set('market', conditionId)
  }

  const response = await fetch(buildDataApiUrl(endpoint, params), { signal })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    const errorMessage = errorBody?.error || 'Server error occurred. Please try again later.'
    throw new Error(errorMessage)
  }

  const result = await response.json()
  if (!Array.isArray(result)) {
    throw new TypeError('Unexpected response from data service.')
  }

  return (result as DataApiPosition[]).map((item) => mapDataApiPositionToUserPosition(item, status))
}
