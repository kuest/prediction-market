import type { WalletTokenExtended } from '@lifi/sdk'

import { useQuery } from '@tanstack/react-query'

import { formatNumber } from '@/lib/formatters'
import { getLiFiTokenUsdValue, isLiFiNativeToken, normalizeLiFiTokenAmount } from '@/lib/lifi-token'

const LIFI_WALLET_USD_BALANCE_QUERY_KEY = 'lifi-wallet-usd-balance'

interface LiFiWalletUsdBalance {
  value: number
  hasUnknownValue: boolean
}

interface UseLiFiWalletUsdBalanceOptions {
  enabled?: boolean
}

export function useLiFiWalletUsdBalance(walletAddress?: string | null, options: UseLiFiWalletUsdBalanceOptions = {}) {
  const isEnabled = Boolean(options.enabled ?? true)
  const hasAddress = Boolean(walletAddress)

  const query = useQuery({
    queryKey: [LIFI_WALLET_USD_BALANCE_QUERY_KEY, walletAddress],
    enabled: isEnabled && hasAddress,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: 'always',
    queryFn: async (): Promise<LiFiWalletUsdBalance> => {
      if (!walletAddress) {
        return { value: 0, hasUnknownValue: false }
      }

      try {
        const balancesResult = await fetch('/api/lifi/balances', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ walletAddress }),
        })

        if (!balancesResult.ok) {
          return { value: 0, hasUnknownValue: false }
        }

        const balancesJson = await balancesResult.json()
        const balancesByChain = balancesJson.balances as Record<number, WalletTokenExtended[]>

        let totalUsd = 0
        let hasUnknownValue = false

        for (const walletTokens of Object.values(balancesByChain)) {
          for (const token of walletTokens) {
            const usdValue = getLiFiTokenUsdValue(token)
            if (usdValue !== null) {
              totalUsd += usdValue
              continue
            }

            if (isLiFiNativeToken(token) && normalizeLiFiTokenAmount(token) > 0) {
              hasUnknownValue = true
            }
          }
        }

        if (!Number.isFinite(totalUsd)) {
          return { value: 0, hasUnknownValue: false }
        }

        return { value: totalUsd, hasUnknownValue }
      } catch {
        return { value: 0, hasUnknownValue: false }
      }
    },
  })

  const usdBalance = query.data?.hasUnknownValue
    ? null
    : query.data && Number.isFinite(query.data.value)
      ? query.data.value
      : 0
  const formattedUsdBalance = query.data?.hasUnknownValue
    ? '—'
    : formatNumber(usdBalance, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const isLoadingUsdBalance = query.isLoading || (query.isFetching && query.data === undefined)

  return {
    usdBalance,
    formattedUsdBalance,
    isLoadingUsdBalance,
    refetchUsdBalance: query.refetch,
  }
}
