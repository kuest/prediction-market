import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { MarketTokenTarget } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'

import { usePublicRuntimeConfig } from '@/hooks/usePublicRuntimeConfig'
import { normalizeClobMarketPrice } from '@/lib/clob-price'

interface PriceApiResponse {
  [tokenId: string]: { BUY?: string; SELL?: string } | undefined
}

interface MidpointsApiResponse {
  [tokenId: string]: string | undefined
}

export interface MarketQuote {
  bid: number | null
  ask: number | null
  mid: number | null
}

export type MarketQuotesByMarket = Record<string, MarketQuote>

const PRICE_REFRESH_INTERVAL_MS = 60_000

function normalizePrice(value: string | number | undefined | null) {
  return normalizeClobMarketPrice(value)
}

export function resolveQuote(
  priceBySide: { BUY?: string; SELL?: string } | undefined,
  midpoint: number | null,
): MarketQuote {
  // CLOB /prices returns BUY as best ask and SELL as best bid for the token.
  const ask = normalizePrice(priceBySide?.BUY)
  const bid = normalizePrice(priceBySide?.SELL)
  const normalizedMidpoint = normalizePrice(midpoint)
  const mid =
    bid != null && ask != null ? (normalizedMidpoint ?? (bid + ask) / 2) : (normalizedMidpoint ?? ask ?? bid ?? null)

  return { bid, ask, mid }
}

async function parseMidpointsResponse(response: Response | null): Promise<MidpointsApiResponse> {
  if (!response?.ok) {
    return {}
  }

  try {
    const payload = (await response.json()) as unknown
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {}
    }

    return payload as MidpointsApiResponse
  } catch {
    return {}
  }
}

async function fetchQuotesByMarket(targets: MarketTokenTarget[], clobUrl: string): Promise<MarketQuotesByMarket> {
  const uniqueTokenIds = Array.from(new Set(targets.map((target) => target.tokenId).filter(Boolean)))

  if (!uniqueTokenIds.length) {
    return {}
  }
  if (!clobUrl) {
    return {}
  }

  const payload = uniqueTokenIds.map((tokenId) => ({ token_id: tokenId }))
  const requestInit = {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }
  const [pricesResponse, midpointsResponse] = await Promise.all([
    fetch(`${clobUrl}/prices`, requestInit),
    fetch(`${clobUrl}/midpoints`, requestInit).catch(() => null),
  ])

  if (!pricesResponse.ok) {
    const message = `Failed to fetch market quotes (${pricesResponse.status} ${pricesResponse.statusText}).`
    console.error(message)
    throw new Error(message)
  }

  const data = (await pricesResponse.json()) as PriceApiResponse
  const midpoints = await parseMidpointsResponse(midpointsResponse)
  const quotesByToken = new Map<string, MarketQuote>()

  uniqueTokenIds.forEach((tokenId) => {
    quotesByToken.set(tokenId, resolveQuote(data?.[tokenId], normalizePrice(midpoints?.[tokenId])))
  })

  return targets.reduce<MarketQuotesByMarket>((acc, target) => {
    const quote = quotesByToken.get(target.tokenId)
    if (quote) {
      acc[target.conditionId] = quote
    }
    return acc
  }, {})
}

interface UseEventMarketQuotesOptions {
  enabled?: boolean
  refetchIntervalMs?: number | false
}

export function useEventMarketQuotes(targets: MarketTokenTarget[], options: UseEventMarketQuotesOptions = {}) {
  const { clobUrl } = usePublicRuntimeConfig()
  const { enabled = true, refetchIntervalMs = PRICE_REFRESH_INTERVAL_MS } = options
  const tokenSignature = useMemo(
    () =>
      targets
        .map((target) => `${target.conditionId}:${target.tokenId}`)
        .sort()
        .join(','),
    [targets],
  )

  const { data } = useQuery({
    queryKey: ['event-market-quotes', clobUrl, tokenSignature],
    queryFn: () => fetchQuotesByMarket(targets, clobUrl),
    enabled: enabled && targets.length > 0 && Boolean(clobUrl),
    staleTime: 'static',
    gcTime: PRICE_REFRESH_INTERVAL_MS,
    refetchInterval: refetchIntervalMs,
    refetchIntervalInBackground: refetchIntervalMs !== false,
    placeholderData: keepPreviousData,
    retry: false,
  })

  return data ?? {}
}
