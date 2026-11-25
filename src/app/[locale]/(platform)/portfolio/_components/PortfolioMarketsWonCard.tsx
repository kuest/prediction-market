import { inArray } from 'drizzle-orm'

import type { DataApiPosition } from '@/lib/data-api/user'

import { MICRO_UNIT, OUTCOME_INDEX } from '@/lib/constants'
import { getDataApiUrl } from '@/lib/data-api/client'
import { db } from '@/lib/drizzle'
import { resolveMarketAssetUrl } from '@/lib/image/asset-reference'
import { resolveNegRiskAdapterAddressFromMetadata } from '@/lib/neg-risk-adapter'
import { getPublicAssetUrl } from '@/lib/storage'
import { normalizeAddress } from '@/lib/wallet'

import type { PortfolioClaimMarket, PortfolioMarketsWonData } from './PortfolioMarketsWonCardClient'

import PortfolioMarketsWonCardClient from './PortfolioMarketsWonCardClient'

const DEFAULT_INDEX_SETS = [1, 2]

interface PortfolioMarketsWonCardProps {
  depositWalletAddress?: string | null
}

interface MarketMetadata {
  title?: string
  slug?: string
  eventSlug?: string
  iconUrl?: string
  negRisk?: boolean
  negRiskAdapterAddress?: `0x${string}`
}

interface MarketAggregate {
  conditionId: string
  title: string
  eventSlug?: string
  imageUrl?: string
  shares: number
  invested: number
  proceeds: number
  latestTimestamp: number
  outcomeIndices: Set<number>
  outcomeLabels: Set<string>
  isNegRisk: boolean
  negRiskAdapterAddress?: `0x${string}`
  yesShares: number
  noShares: number
}

function pickString(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue
    }
    const trimmed = value.trim()
    if (trimmed) {
      return trimmed
    }
  }
  return undefined
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function resolveDataApiIcon(icon?: string | null): string | undefined {
  return resolveMarketAssetUrl(icon) ?? undefined
}

function normalizeValueByPrice(value: number, size: number): number {
  if (!(value > 0) || !(size > 0)) {
    return value
  }
  const impliedPrice = value / size
  if (impliedPrice <= 2) {
    return value
  }
  const scaled = value / MICRO_UNIT
  const scaledImplied = scaled / size
  if (scaledImplied <= 2) {
    return scaled
  }
  return value
}

function resolveInvested(position: DataApiPosition, size: number): number {
  const avgPrice = toNumber(position.avgPrice)
  const totalBought = normalizeValueByPrice(toNumber(position.totalBought), size)
  const initialValue = normalizeValueByPrice(toNumber(position.initialValue), size)

  if (totalBought > 0) {
    return totalBought
  }
  if (initialValue > 0) {
    return initialValue
  }
  if (size > 0 && avgPrice > 0) {
    return size * avgPrice
  }
  return 0
}

function resolveProceeds(position: DataApiPosition, size: number): number {
  const currentValue = normalizeValueByPrice(toNumber(position.currentValue), size)

  if (currentValue > 0) {
    return currentValue
  }
  return size > 0 ? size : 0
}

async function fetchDataApiPositions(address: string): Promise<DataApiPosition[]> {
  const dataApiUrl = getDataApiUrl()
  if (!dataApiUrl) {
    return []
  }

  const limit = 500
  let offset = 0
  const results: DataApiPosition[] = []

  while (true) {
    const params = new URLSearchParams({
      user: address,
      limit: limit.toString(),
      offset: offset.toString(),
      sizeThreshold: '0.01',
      redeemable: 'true',
    })

    let response: Response
    try {
      response = await fetch(`${dataApiUrl}/positions?${params.toString()}`)
    } catch {
      break
    }
    if (!response.ok) {
      break
    }

    const page = await response.json().catch(() => null)
    if (!Array.isArray(page)) {
      break
    }

    results.push(...page)

    if (page.length < limit) {
      break
    }

    offset += page.length
  }

  return results
}

async function fetchMarketMetadata(conditionIds: string[]): Promise<Map<string, MarketMetadata>> {
  if (!conditionIds.length) {
    return new Map()
  }

  const rows = await db.query.markets.findMany({
    where: { RAW: (table) => inArray(table.condition_id, conditionIds) },
    columns: {
      condition_id: true,
      title: true,
      slug: true,
      icon_url: true,
      neg_risk: true,
      metadata: true,
    },
    with: {
      event: {
        columns: {
          slug: true,
          icon_url: true,
        },
      },
      condition: {
        columns: {
          oracle: true,
        },
      },
    },
  })

  const metadata = new Map<string, MarketMetadata>()

  for (const row of rows) {
    const iconUrl = row.icon_url
      ? getPublicAssetUrl(row.icon_url)
      : row.event?.icon_url
        ? getPublicAssetUrl(row.event.icon_url)
        : undefined

    metadata.set(row.condition_id, {
      title: pickString(row.title ?? undefined),
      slug: pickString(row.slug ?? undefined),
      eventSlug: pickString(row.event?.slug ?? undefined),
      iconUrl,
      negRisk: Boolean(row.neg_risk),
      negRiskAdapterAddress: resolveNegRiskAdapterAddressFromMetadata(row.metadata, row.condition?.oracle) ?? undefined,
    })
  }

  return metadata
}

function buildClaimData(positions: DataApiPosition[], metadata: Map<string, MarketMetadata>): PortfolioMarketsWonData {
  const aggregates = new Map<string, MarketAggregate>()

  for (const position of positions) {
    if (!position.redeemable) {
      continue
    }

    const conditionId = pickString(position.conditionId)
    if (!conditionId) {
      continue
    }

    const size = Math.max(0, toNumber(position.size))
    if (size <= 0) {
      continue
    }

    const meta = metadata.get(conditionId)
    const title = pickString(meta?.title, position.title) ?? 'Untitled market'
    const eventSlug = pickString(meta?.eventSlug, position.eventSlug, position.slug, meta?.slug)
    const imageUrl = meta?.iconUrl ?? resolveDataApiIcon(position.icon)
    const invested = resolveInvested(position, size)
    const proceeds = resolveProceeds(position, size)
    const timestamp = toNumber(position.timestamp)
    const outcomeIndex = typeof position.outcomeIndex === 'number' ? position.outcomeIndex : undefined
    const outcomeLabel = pickString(position.outcome)

    const aggregate = aggregates.get(conditionId) ?? {
      conditionId,
      title,
      eventSlug,
      imageUrl,
      shares: 0,
      invested: 0,
      proceeds: 0,
      latestTimestamp: 0,
      outcomeIndices: new Set<number>(),
      outcomeLabels: new Set<string>(),
      isNegRisk: Boolean(meta?.negRisk || position.mergeable),
      negRiskAdapterAddress: meta?.negRiskAdapterAddress,
      yesShares: 0,
      noShares: 0,
    }

    aggregate.title = pickString(aggregate.title, title) ?? 'Untitled market'
    aggregate.eventSlug = pickString(aggregate.eventSlug, eventSlug)
    aggregate.imageUrl = aggregate.imageUrl ?? imageUrl
    aggregate.shares += size
    aggregate.invested += invested
    aggregate.proceeds += proceeds
    aggregate.latestTimestamp = Math.max(aggregate.latestTimestamp, timestamp)
    aggregate.isNegRisk = aggregate.isNegRisk || Boolean(meta?.negRisk || position.mergeable)
    aggregate.negRiskAdapterAddress = aggregate.negRiskAdapterAddress ?? meta?.negRiskAdapterAddress

    if (typeof outcomeIndex === 'number') {
      aggregate.outcomeIndices.add(outcomeIndex)
      if (outcomeIndex === OUTCOME_INDEX.YES) {
        aggregate.yesShares += size
      } else if (outcomeIndex === OUTCOME_INDEX.NO) {
        aggregate.noShares += size
      }
    }
    if (outcomeLabel) {
      aggregate.outcomeLabels.add(outcomeLabel)
    }

    aggregates.set(conditionId, aggregate)
  }

  const claimMarkets: PortfolioClaimMarket[] = Array.from(aggregates.values()).map((aggregate) => {
    const outcomeIndices = Array.from(aggregate.outcomeIndices)
    const outcomeLabels = Array.from(aggregate.outcomeLabels)
    const outcomeIndex = outcomeIndices.length === 1 ? outcomeIndices[0] : undefined
    const outcome = outcomeLabels.length > 0 ? outcomeLabels.join(' / ') : undefined
    const indexSets = outcomeIndices.length ? outcomeIndices.map((index) => 2 ** index) : DEFAULT_INDEX_SETS

    const invested = aggregate.invested
    const proceeds = aggregate.proceeds
    const returnPercent = invested > 0 ? ((proceeds - invested) / invested) * 100 : 0

    return {
      conditionId: aggregate.conditionId,
      title: aggregate.title,
      eventSlug: aggregate.eventSlug,
      imageUrl: aggregate.imageUrl,
      shares: aggregate.shares,
      invested,
      proceeds,
      returnPercent,
      timestamp: aggregate.latestTimestamp || undefined,
      outcomeIndex,
      outcome,
      indexSets,
      isNegRisk: aggregate.isNegRisk,
      negRiskAdapterAddress: aggregate.negRiskAdapterAddress,
      yesShares: aggregate.yesShares,
      noShares: aggregate.noShares,
    }
  })

  claimMarkets.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))

  const totalInvested = claimMarkets.reduce((sum, market) => sum + (market.invested || 0), 0)
  const totalProceeds = claimMarkets.reduce((sum, market) => sum + (market.proceeds || 0), 0)
  const totalReturnPercent = totalInvested > 0 ? ((totalProceeds - totalInvested) / totalInvested) * 100 : 0

  return {
    summary: {
      marketsWon: claimMarkets.length,
      totalProceeds,
      totalInvested,
      totalReturnPercent,
      latestMarket: claimMarkets[0],
    },
    markets: claimMarkets,
  }
}

export default async function PortfolioMarketsWonCard({ depositWalletAddress }: PortfolioMarketsWonCardProps) {
  const normalized = normalizeAddress(depositWalletAddress) ?? null
  if (!normalized) {
    return null
  }

  const positions = await fetchDataApiPositions(normalized)
  if (!positions.length) {
    return null
  }

  const redeemablePositions = positions.filter((position) => position.redeemable && toNumber(position.size) > 0)
  if (!redeemablePositions.length) {
    return null
  }

  const conditionIds = Array.from(
    new Set(
      redeemablePositions
        .map((position) => pickString(position.conditionId))
        .filter((value): value is string => Boolean(value)),
    ),
  )

  const metadata = await fetchMarketMetadata(conditionIds)
  const data = buildClaimData(redeemablePositions, metadata)

  if (!data.markets.length) {
    return null
  }

  return <PortfolioMarketsWonCardClient data={data} />
}
