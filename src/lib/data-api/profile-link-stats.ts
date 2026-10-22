import { buildDataApiUrl, normalizeDataApiAddress } from '@/lib/data-api/client'
import { normalizeAddress } from '@/lib/wallet'

export interface ProfileLinkStats {
  profitLoss: number
  volume: string | null
  positionsValue: number
}

const CACHE_TTL_MS = 2_000
const CACHE_MAX_ENTRIES = 200

interface ProfileLinkStatsRequestOptions {
  dataApiUrl: string
  signal?: AbortSignal
}

interface CacheEntry {
  value?: ProfileLinkStats | null
  promise?: Promise<ProfileLinkStats | null>
  expiresAt?: number
}

const statsCache = new Map<string, CacheEntry>()

function pruneCache(now: number) {
  for (const [key, entry] of statsCache.entries()) {
    if (!entry.promise && entry.expiresAt !== undefined && entry.expiresAt <= now) {
      statsCache.delete(key)
    }
  }

  while (statsCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = statsCache.keys().next().value
    if (!oldestKey) {
      break
    }
    statsCache.delete(oldestKey)
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function parsePortfolioValue(body: unknown): number {
  if (!body) {
    return 0
  }

  if (Array.isArray(body)) {
    return toNumber(body[0]?.value ?? body[0]) ?? 0
  }

  if (typeof body === 'object' && body !== null && 'value' in body) {
    return toNumber((body as { value?: unknown }).value) ?? 0
  }

  return toNumber(body) ?? 0
}

function parseVolume(body: unknown): string | null {
  if (!body) {
    return null
  }

  if (typeof body === 'object') {
    const candidate = body as {
      volume?: unknown
      total_volume?: unknown
      totalVolume?: unknown
      tradedVolume?: unknown
    }
    const resolved = candidate.volume ?? candidate.total_volume ?? candidate.totalVolume ?? candidate.tradedVolume
    return parseVolumeValue(resolved)
  }

  return parseVolumeValue(body)
}

function parseVolumeValue(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toString() : null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }

  return null
}

function parseUserPnl(body: unknown): number | null {
  if (!Array.isArray(body)) {
    return null
  }

  const points = body
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return null
      }

      const point = entry as { p?: unknown; t?: unknown }
      const value = toNumber(point.p)
      if (value == null) {
        return null
      }

      return {
        index,
        timestamp: toNumber(point.t),
        value,
      }
    })
    .filter((point): point is { index: number; timestamp: number | null; value: number } => point !== null)

  if (points.length === 0) {
    return null
  }

  if (points.every((point) => point.timestamp !== null)) {
    points.sort((first, second) => (first.timestamp ?? 0) - (second.timestamp ?? 0) || first.index - second.index)
  }

  return points.at(-1)?.value ?? null
}

function resolveCacheKey(dataApiUrl: string, address: string) {
  return `${dataApiUrl.replace(/\/+$/, '')}:${address}`
}

function hasConfiguredStatsServices(options: ProfileLinkStatsRequestOptions) {
  return Boolean(options.dataApiUrl.trim())
}

function buildStatsUrls(dataApiUrl: string, normalizedAddress: string) {
  const userParams = new URLSearchParams({ user: normalizedAddress })

  return {
    valueUrl: buildDataApiUrl('/value', userParams, dataApiUrl),
    volumeUrl: buildDataApiUrl('/volume', userParams, dataApiUrl),
    pnlUrl: buildDataApiUrl(
      '/user-pnl',
      new URLSearchParams({
        user_address: normalizedAddress,
        interval: 'all',
        fidelity: '12h',
      }),
      dataApiUrl,
    ),
  }
}

async function loadProfileLinkStats(
  normalizedAddress: string,
  options: ProfileLinkStatsRequestOptions,
): Promise<ProfileLinkStats | null> {
  const { valueUrl, volumeUrl, pnlUrl } = buildStatsUrls(options.dataApiUrl, normalizedAddress)

  try {
    const [valueResult, volumeResult, pnlResult] = await Promise.allSettled([
      fetchJson(valueUrl, options.signal),
      fetchJson(volumeUrl, options.signal),
      fetchJson(pnlUrl, options.signal),
    ])

    const volume = volumeResult.status === 'fulfilled' ? parseVolume(volumeResult.value) : null
    const positionsValue = valueResult.status === 'fulfilled' ? parsePortfolioValue(valueResult.value) : 0
    const profitLoss = pnlResult.status === 'fulfilled' ? parseUserPnl(pnlResult.value) : null

    return {
      profitLoss: profitLoss ?? 0,
      volume,
      positionsValue,
    }
  } catch (error) {
    if ((error as { name?: string })?.name !== 'AbortError') {
      console.error('Failed to fetch profile link stats', error)
    }
    return null
  }
}

async function fetchJson(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal })

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }

  return await response.json()
}

export async function fetchProfileLinkStats(
  userAddress?: string | null,
  options?: ProfileLinkStatsRequestOptions,
): Promise<ProfileLinkStats | null> {
  const address = normalizeAddress(userAddress)
  if (!address || !options || !hasConfiguredStatsServices(options)) {
    return null
  }

  const normalizedAddress = normalizeDataApiAddress(address)
  const cacheKey = resolveCacheKey(options.dataApiUrl, normalizedAddress)
  const now = Date.now()
  pruneCache(now)
  const cached = statsCache.get(cacheKey)
  if (cached) {
    if (cached.promise) {
      return await cached.promise
    }
    if (cached.expiresAt === undefined || cached.expiresAt <= now) {
      statsCache.delete(cacheKey)
    } else if ('value' in cached) {
      return cached.value ?? null
    }
  }

  const request = loadProfileLinkStats(normalizedAddress, options)
  const pendingEntry: CacheEntry = { promise: request }

  statsCache.set(cacheKey, pendingEntry)
  try {
    const result = await request
    if (statsCache.get(cacheKey) === pendingEntry) {
      if (options.signal?.aborted) {
        statsCache.delete(cacheKey)
      } else {
        statsCache.set(cacheKey, { value: result, expiresAt: Date.now() + CACHE_TTL_MS })
      }
    }
    return options.signal?.aborted ? null : result
  } catch (error) {
    if (statsCache.get(cacheKey) === pendingEntry) {
      statsCache.delete(cacheKey)
    }
    throw error
  }
}
