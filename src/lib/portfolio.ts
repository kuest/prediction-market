import { buildDataApiUrl, getDataApiUrl } from '@/lib/data-api/client'
import { normalizeAddress } from '@/lib/wallet'

export interface PortfolioSnapshot {
  positionsValue: number
  profitLoss: number
  predictions: number
  biggestWin: number
}

const defaultSnapshot: PortfolioSnapshot = {
  positionsValue: 0,
  profitLoss: 0,
  predictions: 0,
  biggestWin: 0,
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

function parsePortfolioValue(body: any): number {
  if (!body) {
    return 0
  }

  if (Array.isArray(body)) {
    return toNumber(body[0]?.value ?? body[0])
  }

  if (typeof body === 'object' && 'value' in body) {
    return toNumber((body as { value: unknown }).value)
  }

  return toNumber(body)
}

function parseTradedCount(body: any): number {
  if (!body) {
    return 0
  }

  if (typeof body === 'object' && 'traded' in body) {
    return toNumber((body as { traded: unknown }).traded)
  }

  return toNumber(body)
}

function parsePnlChange(body: unknown): number {
  if (!Array.isArray(body)) {
    return 0
  }

  function parseFiniteValue(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null
    }

    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) {
        return null
      }
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? parsed : null
    }

    return null
  }

  const points = body
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null
      }

      const point = entry as { t?: unknown; p?: unknown }
      const timestamp = parseFiniteValue(point.t)
      const value = parseFiniteValue(point.p)
      return timestamp === null || value === null ? null : { t: timestamp, p: value }
    })
    .filter((point): point is { t: number; p: number } => point !== null)
    .sort((a, b) => a.t - b.t)
  if (points.length < 2) {
    return 0
  }
  return points[points.length - 1].p - points[0].p
}

async function fetchJson(url: string) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }

  return await response.json()
}

async function fetchBiggestClosedPosition(dataApiUrl: string, address: string) {
  const params = new URLSearchParams({
    user: address,
    limit: '1',
    offset: '0',
    sortBy: 'REALIZEDPNL',
    sortDirection: 'DESC',
  })
  const positions = await fetchJson(`${dataApiUrl}/closed-positions?${params.toString()}`)
  return Array.isArray(positions) ? positions[0] : undefined
}

export async function fetchPortfolioSnapshot(userAddress?: string | null): Promise<PortfolioSnapshot> {
  if (!userAddress) {
    return defaultSnapshot
  }

  const address = normalizeAddress(userAddress)
  if (!address) {
    return defaultSnapshot
  }

  try {
    const dataApiUrl = getDataApiUrl()
    const valueUrl = `${dataApiUrl}/value?user=${encodeURIComponent(address)}`
    const tradedUrl = `${dataApiUrl}/traded?user=${encodeURIComponent(address)}`
    const pnlUrl = buildDataApiUrl(
      '/user-pnl',
      new URLSearchParams({
        user_address: address,
        interval: '1d',
        fidelity: '1h',
      }),
      dataApiUrl,
    )

    const [valueResult, biggestClosedPositionResult, tradedResult, pnlResult] = await Promise.allSettled([
      fetchJson(valueUrl),
      fetchBiggestClosedPosition(dataApiUrl, address),
      fetchJson(tradedUrl),
      fetchJson(pnlUrl),
    ])

    const positionsValue = valueResult.status === 'fulfilled' ? parsePortfolioValue(valueResult.value) : 0

    const tradedCount = tradedResult.status === 'fulfilled' ? parseTradedCount(tradedResult.value) : 0

    const predictions = tradedResult.status === 'fulfilled' ? tradedCount : 0
    const profitLoss = pnlResult.status === 'fulfilled' ? parsePnlChange(pnlResult.value) : 0
    const biggestWin =
      biggestClosedPositionResult.status === 'fulfilled'
        ? Math.max(
            0,
            toNumber((biggestClosedPositionResult.value as { realizedPnl?: unknown } | undefined)?.realizedPnl),
          )
        : 0

    return {
      positionsValue,
      profitLoss,
      predictions,
      biggestWin,
    }
  } catch (error) {
    console.error('Failed to fetch portfolio snapshot', error)
    return defaultSnapshot
  }
}
