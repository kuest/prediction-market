import { resolveClobUrl } from '@/lib/clob'
import { resolvePublicRuntimeEnv } from '@/lib/public-runtime-config.shared'

export interface OutcomePrices {
  buy?: number
  sell?: number
}

type PriceApiResponse = Record<string, { BUY?: string; SELL?: string } | undefined>
interface FetchPriceBatchResult {
  data: PriceApiResponse | null
  stopFetching: boolean
  retryIndividually: boolean
}

const MAX_PRICE_BATCH = 500

export const EVENT_PRICES_TIMEOUT_MS = 2_000

export function isPrerenderAbortError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const record = error as { digest?: string; name?: string; code?: string; message?: string }

  if (record.digest === 'HANGING_PROMISE_REJECTION') {
    return true
  }

  if (record.name === 'AbortError' || record.code === 'UND_ERR_ABORTED') {
    return true
  }

  if (typeof record.message === 'string' && record.message.includes('fetch() rejects when the prerender is complete')) {
    return true
  }

  return false
}

async function fetchPriceBatch(endpoint: string, tokenIds: string[]): Promise<FetchPriceBatchResult> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(EVENT_PRICES_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(
        tokenIds.map((tokenId) => ({
          token_id: tokenId,
        })),
      ),
    })

    if (!response.ok) {
      return {
        data: null,
        // HTTP 408 skips this batch; HTTP 400 can recover through individual requests.
        stopFetching: response.status !== 400 && response.status !== 408,
        retryIndividually: response.status === 400,
      }
    }

    return { data: (await response.json()) as PriceApiResponse, stopFetching: false, retryIndividually: true }
  } catch (error) {
    const aborted = isPrerenderAbortError(error)
    if (!aborted && !(error instanceof Error && error.name === 'TimeoutError')) {
      console.error('Failed to fetch outcome prices batch from CLOB.', error)
    }
    // Continue with later batches after transport failures, but respect prerender cancellation.
    return { data: null, stopFetching: aborted, retryIndividually: false }
  }
}

function applyPriceBatch(
  data: PriceApiResponse | null,
  priceMap: Map<string, OutcomePrices>,
  missingTokenIds: Set<string>,
) {
  if (!data) {
    return
  }

  for (const [tokenId, priceBySide] of Object.entries(data ?? {})) {
    if (!priceBySide) {
      continue
    }

    const parsedBestAsk = priceBySide.BUY != null ? Number(priceBySide.BUY) : undefined
    const parsedBestBid = priceBySide.SELL != null ? Number(priceBySide.SELL) : undefined
    const normalizedBestAsk = parsedBestAsk != null && Number.isFinite(parsedBestAsk) ? parsedBestAsk : undefined
    const normalizedBestBid = parsedBestBid != null && Number.isFinite(parsedBestBid) ? parsedBestBid : undefined

    if (normalizedBestAsk == null && normalizedBestBid == null) {
      continue
    }

    priceMap.set(tokenId, {
      buy: normalizedBestAsk ?? normalizedBestBid,
      sell: normalizedBestBid ?? normalizedBestAsk,
    })
    missingTokenIds.delete(tokenId)
  }
}

export async function fetchOutcomePrices(tokenIds: string[]): Promise<Map<string, OutcomePrices>> {
  const uniqueTokenIds = Array.from(new Set(tokenIds.filter(Boolean)))

  if (uniqueTokenIds.length === 0) {
    return new Map()
  }

  const endpoint = `${resolveClobUrl(resolvePublicRuntimeEnv(process.env).clobUrl)}/prices`
  const priceMap = new Map<string, OutcomePrices>()
  const missingTokenIds = new Set(uniqueTokenIds)

  for (let i = 0; i < uniqueTokenIds.length; i += MAX_PRICE_BATCH) {
    const batch = uniqueTokenIds.slice(i, i + MAX_PRICE_BATCH)
    const batchResult = await fetchPriceBatch(endpoint, batch)
    if (batchResult.stopFetching) {
      break
    }

    if (!batchResult.data && !batchResult.retryIndividually) {
      continue
    }

    if (batchResult.data) {
      applyPriceBatch(batchResult.data, priceMap, missingTokenIds)
    }

    const batchMissingTokenIds = batch.filter((tokenId) => missingTokenIds.has(tokenId))
    if (batchMissingTokenIds.length === 0) {
      continue
    }

    const tokenResults = await Promise.allSettled(
      batchMissingTokenIds.map((tokenId) => fetchPriceBatch(endpoint, [tokenId])),
    )

    let shouldStopFetching = false
    for (const result of tokenResults) {
      if (result.status === 'fulfilled') {
        if (result.value.stopFetching) {
          shouldStopFetching = true
        }
        applyPriceBatch(result.value.data, priceMap, missingTokenIds)
      }
    }

    if (shouldStopFetching) {
      break
    }
  }

  return priceMap
}
