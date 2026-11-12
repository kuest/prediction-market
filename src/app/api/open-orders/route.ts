import { inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import type { OpenOrderOutcomeMeta } from '@/lib/clob-open-orders'
import type { ClobOrderType, UserOpenOrder } from '@/types'

import { mapClobOpenOrder, normalizeClobId, normalizeClobOpenOrdersResponse } from '@/lib/clob-open-orders'
import { DEFAULT_ERROR_MESSAGE } from '@/lib/constants'
import { UserRepository } from '@/lib/db/queries/user'
import { runQuery } from '@/lib/db/utils/run-query'
import { db } from '@/lib/drizzle'
import { buildClobHmacSignature } from '@/lib/hmac'
import { resolvePublicRuntimeEnv } from '@/lib/public-runtime-config.shared'
import { getPublicAssetUrl } from '@/lib/storage'
import { TRADING_AUTH_REQUIRED_ERROR } from '@/lib/trading-auth/errors'
import { getUserTradingAuthSecrets } from '@/lib/trading-auth/server'

interface ClobOpenOrder {
  id: string
  status: string
  market: string
  original_size: string
  outcome?: string
  maker_address: string
  owner?: string
  order_type?: ClobOrderType
  price?: string
  side: 'BUY' | 'SELL'
  size_matched: string
  asset_id: string
  expiration?: string
  created_at: string
}

export async function GET(request: Request) {
  try {
    const user = await UserRepository.getCurrentUser({ minimal: true })
    if (!user) {
      return NextResponse.json({ data: [], next_cursor: '' })
    }

    const { clobUrl } = resolvePublicRuntimeEnv(process.env)

    const tradingAuth = await getUserTradingAuthSecrets(user.id)
    if (!tradingAuth?.clob) {
      return NextResponse.json({ error: TRADING_AUTH_REQUIRED_ERROR }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const idFilter = searchParams.get('id')?.trim() || undefined
    let marketFilter = searchParams.get('market')?.trim() || undefined
    const rawAssetIdFilter = searchParams.get('asset_id')?.trim() || undefined
    const assetIdFilter = rawAssetIdFilter?.split(':')[0]?.trim()
    if (rawAssetIdFilter && !assetIdFilter) {
      return NextResponse.json({ error: 'An asset filter must include a token ID.' }, { status: 400 })
    }
    const nextCursor = searchParams.get('next_cursor')?.trim() || undefined

    if (assetIdFilter && !marketFilter) {
      const outcome = await db.query.outcomes.findFirst({
        where: { token_id: assetIdFilter },
        columns: { condition_id: true },
      })
      if (!outcome?.condition_id) {
        return NextResponse.json({ error: 'A market is required for this asset filter.' }, { status: 400 })
      }
      marketFilter = outcome.condition_id
    }

    const { data: clobOrders, next_cursor } = await fetchClobOpenOrders({
      clobUrl,
      auth: tradingAuth.clob,
      userAddress: user.address,
      id: idFilter,
      market: marketFilter,
      assetId: assetIdFilter,
      nextCursor,
    })

    const conditionIds = Array.from(new Set(clobOrders.map((order) => normalizeClobId(order.market)).filter(Boolean)))

    const { data: marketMetadata, error: marketError } = await fetchMarketMetadata(conditionIds)
    if (marketError) {
      console.error('Failed to fetch market metadata', marketError)
    }

    const { marketMap, outcomeMap } = buildMarketLookups(marketMetadata ?? [])

    const normalizedOrders = clobOrders
      .map((order) => mapClobOpenOrder(order, marketMap, outcomeMap))
      .filter((order): order is UserOpenOrder => Boolean(order))
    return NextResponse.json({ data: normalizedOrders, next_cursor })
  } catch (error) {
    console.error('API Error:', error)
    return NextResponse.json({ error: DEFAULT_ERROR_MESSAGE }, { status: 500 })
  }
}

async function fetchClobOpenOrders({
  clobUrl,
  auth,
  userAddress,
  id,
  market,
  assetId,
  nextCursor,
}: {
  clobUrl: string
  auth: { key: string; secret: string; passphrase: string }
  userAddress: string
  id?: string
  market?: string
  assetId?: string
  nextCursor?: string
}): Promise<{ data: ClobOpenOrder[]; next_cursor: string }> {
  const params = new URLSearchParams()
  if (id) {
    params.set('id', id)
  }
  if (market) {
    params.set('market', market)
  }
  if (assetId) {
    params.set('asset_id', assetId)
  }
  if (nextCursor) {
    params.set('next_cursor', nextCursor)
  }
  const path = '/data/orders'
  const pathWithQuery = params.toString() ? `${path}?${params.toString()}` : path
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = buildClobHmacSignature(auth.secret, timestamp, 'GET', path)

  const response = await fetch(`${clobUrl}${pathWithQuery}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      KUEST_ADDRESS: userAddress,
      KUEST_API_KEY: auth.key,
      KUEST_PASSPHRASE: auth.passphrase,
      KUEST_TIMESTAMP: timestamp.toString(),
      KUEST_SIGNATURE: signature,
    },
    signal: AbortSignal.timeout(8_000),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message = typeof payload?.error === 'string' ? payload.error : undefined
    throw new Error(message || `Failed to fetch open orders (status ${response.status})`)
  }

  const result = await response.json().catch(() => null)
  return normalizeClobOpenOrdersResponse(result)
}

async function fetchMarketMetadata(conditionIds: string[]) {
  if (!conditionIds.length) {
    return { data: [], error: null }
  }

  return runQuery(async () => {
    const rows = await db.query.markets.findMany({
      where: { RAW: (table) => inArray(table.condition_id, conditionIds) },
      columns: {
        condition_id: true,
        title: true,
        slug: true,
        icon_url: true,
        is_active: true,
        is_resolved: true,
      },
      with: {
        event: {
          columns: {
            slug: true,
            title: true,
            icon_url: true,
          },
        },
        condition: {
          columns: { id: true },
          with: {
            outcomes: {
              columns: {
                token_id: true,
                outcome_text: true,
                outcome_index: true,
              },
            },
          },
        },
      },
    })

    const data = rows.map((row) => ({
      condition_id: row.condition_id,
      title: row.title,
      slug: row.slug,
      icon_url: getPublicAssetUrl(row.icon_url || row.event?.icon_url || ''),
      event_slug: row.event?.slug || '',
      event_title: row.event?.title || '',
      is_active: Boolean(row.is_active),
      is_resolved: Boolean(row.is_resolved),
      outcomes: (row.condition?.outcomes || []).map((outcome) => ({
        token_id: outcome.token_id,
        outcome_text: outcome.outcome_text || '',
        outcome_index: Number(outcome.outcome_index || 0),
      })),
    }))

    return { data, error: null }
  })
}

function buildMarketLookups(
  marketsList: Array<{
    condition_id: string
    title: string
    slug: string
    icon_url?: string
    event_slug?: string
    event_title?: string
    is_active: boolean
    is_resolved: boolean
    outcomes: Array<{
      token_id: string
      outcome_text: string
      outcome_index: number
    }>
  }>,
) {
  const marketMap = new Map<
    string,
    UserOpenOrder['market'] & {
      icon_url?: string
      event_slug?: string
      event_title?: string
    }
  >()
  const outcomeMap = new Map<string, OpenOrderOutcomeMeta>()

  for (const market of marketsList) {
    const normalizedCondition = normalizeClobId(market.condition_id)
    marketMap.set(normalizedCondition, {
      condition_id: market.condition_id,
      title: market.title,
      slug: market.slug,
      is_active: market.is_active,
      is_resolved: market.is_resolved,
      icon_url: market.icon_url || undefined,
      event_slug: market.event_slug || undefined,
      event_title: market.event_title || undefined,
    })

    for (const outcome of market.outcomes) {
      const normalizedToken = normalizeClobId(outcome.token_id)
      if (normalizedToken) {
        outcomeMap.set(normalizedToken, {
          index: outcome.outcome_index,
          text: outcome.outcome_text || '',
        })
      }
    }
  }

  return { marketMap, outcomeMap }
}
