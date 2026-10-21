import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { MarketTokenTarget } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'
import type { LastTradePriceEntry } from '@/app/[locale]/(platform)/event/[slug]/_types/EventOrderBookTypes'

import { usePublicRuntimeConfig } from '@/hooks/usePublicRuntimeConfig'
import { normalizeClobMarketPrice } from '@/lib/clob-price'

const LAST_TRADE_REFRESH_INTERVAL_MS = 60_000

function normalizePrice(value: string | undefined) {
  return normalizeClobMarketPrice(value)
}

async function fetchLastTradesByMarket(targets: MarketTokenTarget[], clobUrl: string) {
  const uniqueTokenIds = Array.from(new Set(targets.map((target) => target.tokenId).filter(Boolean)))

  if (!uniqueTokenIds.length) {
    return {}
  }

  if (!clobUrl) {
    throw new Error('CLOB URL is not configured.')
  }

  const response = await fetch(`${clobUrl}/last-trades-prices`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(uniqueTokenIds.map((tokenId) => ({ token_id: tokenId }))),
  })

  if (!response.ok) {
    const message = `Failed to fetch last trades (${response.status} ${response.statusText}).`
    console.error(message)
    throw new Error(message)
  }

  const payload = (await response.json()) as LastTradePriceEntry[]
  const lastTradesByToken = new Map<string, number>()

  payload.forEach((entry) => {
    const normalized = normalizePrice(entry?.price)
    if (normalized != null && entry?.token_id) {
      lastTradesByToken.set(entry.token_id, normalized)
    }
  })

  return targets.reduce<Record<string, number>>((acc, target) => {
    const lastTrade = lastTradesByToken.get(target.tokenId)
    if (lastTrade != null) {
      acc[target.conditionId] = lastTrade
    }
    return acc
  }, {})
}

export function useEventLastTrades(
  targets: MarketTokenTarget[],
  refetchIntervalMs: number | false = LAST_TRADE_REFRESH_INTERVAL_MS,
) {
  const { clobUrl } = usePublicRuntimeConfig()
  const tokenSignature = useMemo(
    () =>
      targets
        .map((target) => `${target.conditionId}:${target.tokenId}`)
        .sort()
        .join(','),
    [targets],
  )

  const { data } = useQuery({
    queryKey: ['event-last-trades', clobUrl, tokenSignature],
    queryFn: () => fetchLastTradesByMarket(targets, clobUrl),
    enabled: targets.length > 0 && Boolean(clobUrl),
    staleTime: 'static',
    gcTime: LAST_TRADE_REFRESH_INTERVAL_MS,
    refetchInterval: refetchIntervalMs,
    refetchIntervalInBackground: refetchIntervalMs !== false,
    placeholderData: keepPreviousData,
  })

  return data ?? {}
}
