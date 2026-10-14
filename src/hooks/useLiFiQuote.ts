import { useQuery } from '@tanstack/react-query'
import { parseUnits } from 'viem'

import type { LiFiWalletTokenItem } from '@/hooks/useLiFiWalletTokens'

import { formatNumber } from '@/lib/formatters'
import { sanitizeLiFiAmount } from '@/lib/lifi-amount'

const LIFI_QUOTE_QUERY_KEY = 'lifi-quote'

interface UseLiFiQuoteParams {
  fromToken?: LiFiWalletTokenItem | null
  amountValue: string
  fromAddress?: string | null
  toAddress?: string | null
  refreshIndex?: number
  enabled?: boolean
}

export function useLiFiQuote({
  fromToken,
  amountValue,
  fromAddress,
  toAddress,
  refreshIndex = 0,
  enabled = true,
}: UseLiFiQuoteParams) {
  const tokenDecimals = fromToken?.decimals ?? 18
  const sanitizedAmount = sanitizeLiFiAmount(amountValue, tokenDecimals)
  const hasAddresses = Boolean(fromAddress && toAddress && fromToken)
  const hasValidAmount = (() => {
    if (!fromToken || !sanitizedAmount) {
      return false
    }
    try {
      return parseUnits(sanitizedAmount, fromToken.decimals) > 0n
    } catch {
      return false
    }
  })()
  const canQuote = enabled && hasAddresses && hasValidAmount

  const query = useQuery({
    queryKey: [LIFI_QUOTE_QUERY_KEY, fromToken?.id, amountValue, fromAddress, toAddress, refreshIndex],
    enabled: canQuote,
    staleTime: 15_000,
    retry: false,
    queryFn: async () => {
      if (!fromAddress || !toAddress || !fromToken) {
        return null
      }

      const response = await fetch('/api/lifi/quote', {
        signal: AbortSignal.timeout(30_000),
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          fromChainId: fromToken.chainId,
          fromTokenAddress: fromToken.address,
          fromTokenDecimals: fromToken.decimals,
          fromAddress,
          toAddress,
          amount: sanitizedAmount,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to fetch LI.FI quote.')
      }

      const data = await response.json()
      const quote = data?.quote
      const rawAmount = quote?.estimate?.toAmount
      const toTokenDecimals = Number(quote?.action?.toToken?.decimals ?? 6)
      const toAmountRaw = Number(rawAmount)
      const toAmount = toAmountRaw / 10 ** toTokenDecimals
      if (
        typeof rawAmount !== 'string' ||
        !/^\d+$/.test(rawAmount) ||
        !Number.isInteger(toTokenDecimals) ||
        toTokenDecimals < 0 ||
        toTokenDecimals > 255 ||
        !Number.isFinite(toAmount) ||
        toAmount <= 0
      ) {
        throw new Error('Invalid LI.FI quote response.')
      }

      const toAmountDisplay = formatNumber(toAmount, { minimumFractionDigits: 2, maximumFractionDigits: 6 })

      const gasUsd =
        quote?.estimate?.gasCosts?.reduce((sum: number, gas: { amountUSD?: string }) => {
          const usd = Number.parseFloat(gas.amountUSD ?? '0')
          return Number.isFinite(usd) ? sum + usd : sum
        }, 0) ?? 0
      const gasUsdDisplay = Number.isFinite(gasUsd)
        ? formatNumber(gasUsd, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : null

      return {
        toAmountDisplay,
        gasUsdDisplay,
      }
    },
  })

  return {
    quote: query.data,
    isLoadingQuote: query.isLoading || (query.isFetching && query.data === undefined),
    isQuoteError: query.isError,
    refetchQuote: query.refetch,
  }
}
