import { NextResponse } from 'next/server'

import { DEFAULT_ERROR_MESSAGE } from '@/lib/constants'
import { buildDataApiUrl } from '@/lib/data-api/client'
import { resolvePublicRuntimeEnv } from '@/lib/public-runtime-config.shared'
import { normalizeAddress } from '@/lib/wallet'

const MAX_ADDRESSES = 50
const UPSTREAM_CONCURRENCY = 6
const CACHE_TTL_MS = 60_000
const CACHE_MAX_ENTRIES = 5_000

type TimePeriod = 'today' | 'weekly' | 'monthly' | 'all'

interface UserPnlPoint {
  p?: number
}

interface CacheEntry {
  value: number
  expiresAt: number
}

interface InFlightEntry {
  controller: AbortController
  consumers: number
  promise: Promise<number | null>
}

const TIMEFRAME_PNL_CACHE = new Map<string, CacheEntry>()
const TIMEFRAME_PNL_IN_FLIGHT = new Map<string, InFlightEntry>()

function resolvePeriodConfig(period: TimePeriod) {
  switch (period) {
    case 'today':
      return { interval: '1d', fidelity: '1h', relative: true }
    case 'weekly':
      return { interval: '1w', fidelity: '3h', relative: true }
    case 'monthly':
      return { interval: '1m', fidelity: '18h', relative: true }
    case 'all':
      return { interval: 'all', fidelity: '12h', relative: false }
    default:
      return { interval: '1d', fidelity: '1h', relative: true }
  }
}

function normalizePeriod(value: unknown): TimePeriod | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'today' || normalized === 'weekly' || normalized === 'monthly' || normalized === 'all') {
    return normalized
  }

  return null
}

function normalizeAddresses(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const unique = new Set<string>()
  for (const item of value) {
    const normalized = normalizeAddress(typeof item === 'string' ? item : null)?.toLowerCase()
    if (!normalized) {
      continue
    }
    unique.add(normalized)
    if (unique.size >= MAX_ADDRESSES) {
      break
    }
  }

  return Array.from(unique)
}

function toCacheKey(period: TimePeriod, address: string) {
  return `${period}:${address}`
}

function trimCache() {
  while (TIMEFRAME_PNL_CACHE.size > CACHE_MAX_ENTRIES) {
    const oldest = TIMEFRAME_PNL_CACHE.keys().next().value
    if (!oldest) {
      break
    }
    TIMEFRAME_PNL_CACHE.delete(oldest)
  }
}

function getCachedValue(period: TimePeriod, address: string, now: number): number | null {
  const key = toCacheKey(period, address)
  const cached = TIMEFRAME_PNL_CACHE.get(key)
  if (!cached) {
    return null
  }

  if (cached.expiresAt <= now) {
    TIMEFRAME_PNL_CACHE.delete(key)
    return null
  }

  return cached.value
}

function setCachedValue(period: TimePeriod, address: string, value: number, now: number) {
  const key = toCacheKey(period, address)
  TIMEFRAME_PNL_CACHE.set(key, {
    value,
    expiresAt: now + CACHE_TTL_MS,
  })
  trimCache()
}

function parseUserPnlValue(payload: unknown, relative: boolean): number | null {
  if (!Array.isArray(payload) || payload.length === 0) {
    return null
  }

  const points = (payload as UserPnlPoint[])
    .map((point) => (typeof point.p === 'number' && Number.isFinite(point.p) ? point.p : null))
    .filter((value): value is number => value !== null)

  if (points.length === 0) {
    return null
  }

  const start = points[0]
  const end = points.at(-1)
  if (typeof start !== 'number' || typeof end !== 'number') {
    return null
  }
  return relative ? end - start : end
}

function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError')
}

function releaseInFlightConsumer(entry: InFlightEntry) {
  entry.consumers = Math.max(0, entry.consumers - 1)
  if (entry.consumers === 0) {
    entry.controller.abort()
  }
}

async function waitForInFlightEntry(key: string, entry: InFlightEntry, signal: AbortSignal): Promise<number | null> {
  if (signal.aborted) {
    if (entry.consumers === 0) {
      entry.controller.abort()
    }
    throw abortError()
  }

  entry.consumers += 1

  return await new Promise<number | null>((resolve, reject) => {
    let settled = false

    function cleanup() {
      if (settled) {
        return
      }
      settled = true
      signal.removeEventListener('abort', onAbort)
      releaseInFlightConsumer(entry)
    }

    function onAbort() {
      cleanup()
      reject(abortError())
    }

    signal.addEventListener('abort', onAbort, { once: true })
    entry.promise
      .then((value) => {
        cleanup()
        resolve(value)
      })
      .catch((error) => {
        cleanup()
        reject(error)
      })
  })
}

async function fetchUserTimeframePnl(period: TimePeriod, address: string, signal: AbortSignal): Promise<number | null> {
  const { dataUrl } = resolvePublicRuntimeEnv(process.env)
  if (!dataUrl) {
    return null
  }

  const now = Date.now()
  const cached = getCachedValue(period, address, now)
  if (typeof cached === 'number' && Number.isFinite(cached)) {
    return cached
  }

  const key = toCacheKey(period, address)
  const inFlight = TIMEFRAME_PNL_IN_FLIGHT.get(key)
  if (inFlight && !inFlight.controller.signal.aborted) {
    return await waitForInFlightEntry(key, inFlight, signal)
  }

  if (inFlight?.controller.signal.aborted) {
    TIMEFRAME_PNL_IN_FLIGHT.delete(key)
  }

  const controller = new AbortController()
  const entry: InFlightEntry = {
    controller,
    consumers: 0,
    promise: Promise.resolve(null),
  }

  entry.promise = (async () => {
    const { interval, fidelity, relative } = resolvePeriodConfig(period)
    const params = new URLSearchParams({
      user_address: address,
      interval,
      fidelity,
    })

    const response = await fetch(buildDataApiUrl('/user-pnl', params, dataUrl), {
      signal: controller.signal,
      cache: 'no-store',
    })

    if (!response.ok) {
      return null
    }

    const payload = await response.json()
    const value = parseUserPnlValue(payload, relative)
    if (typeof value === 'number' && Number.isFinite(value)) {
      setCachedValue(period, address, value, Date.now())
      return value
    }

    return null
  })().finally(() => {
    if (TIMEFRAME_PNL_IN_FLIGHT.get(key) === entry) {
      TIMEFRAME_PNL_IN_FLIGHT.delete(key)
    }
  })

  TIMEFRAME_PNL_IN_FLIGHT.set(key, entry)
  return await waitForInFlightEntry(key, entry, signal)
}

async function fetchBatchPnlValues(
  period: TimePeriod,
  addresses: string[],
  signal: AbortSignal,
): Promise<Record<string, number>> {
  const values: Record<string, number> = {}
  if (addresses.length === 0) {
    return values
  }

  const queue = [...addresses]
  const workers = Array.from({ length: Math.min(UPSTREAM_CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      if (signal.aborted) {
        return
      }

      const nextAddress = queue.shift()
      if (!nextAddress) {
        return
      }

      const value = await fetchUserTimeframePnl(period, nextAddress, signal).catch(() => null)
      if (typeof value === 'number' && Number.isFinite(value)) {
        values[nextAddress] = value
      }
    }
  })

  await Promise.all(workers)
  return values
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { period?: unknown; addresses?: unknown } | null
    const period = normalizePeriod(body?.period)
    if (!period) {
      return NextResponse.json({ error: 'Invalid period.' }, { status: 400 })
    }

    const addresses = normalizeAddresses(body?.addresses)
    if (addresses.length === 0) {
      return NextResponse.json({ values: {} })
    }

    const values = await fetchBatchPnlValues(period, addresses, request.signal)
    return NextResponse.json({ values })
  } catch (error) {
    console.error('Failed to load leaderboard timeframe pnl:', error)
    return NextResponse.json({ error: DEFAULT_ERROR_MESSAGE }, { status: 500 })
  }
}
