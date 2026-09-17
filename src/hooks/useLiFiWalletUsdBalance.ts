import type { WalletTokenExtended } from '@lifi/sdk'

import { useQuery } from '@tanstack/react-query'
import { formatUnits } from 'viem'

import { formatNumber } from '@/lib/formatters'

const LIFI_WALLET_USD_BALANCE_QUERY_KEY = 'lifi-wallet-usd-balance'

function normalizeAmount(token: WalletTokenExtended) {
  try {
    const decimals = Number(token.decimals)
    if (!Number.isFinite(decimals)) {
      return 0
    }
    const amount = BigInt(token.amount)
    return Number(formatUnits(amount, decimals))
  } catch {
    return 0
  }
}

function toUsdValue(token: WalletTokenExtended) {
  const priceUsd = Number(token.priceUSD ?? 0)

  if (!Number.isFinite(priceUsd)) {
    return 0
  }

  const normalizedAmount = normalizeAmount(token)
  return normalizedAmount * priceUsd
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
    queryFn: async () => {
      if (!walletAddress) {
        return 0
      }

      try {
        const balancesResult = await fetch('/api/lifi/balances', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ walletAddress }),
        })

        if (!balancesResult.ok) {
          return 0
        }

        const balancesJson = await balancesResult.json()
        const balancesByChain = balancesJson.balances as Record<number, WalletTokenExtended[]>

        let totalUsd = 0

        for (const walletTokens of Object.values(balancesByChain)) {
          for (const token of walletTokens) {
            totalUsd += toUsdValue(token)
          }
        }

        if (!Number.isFinite(totalUsd)) {
          return 0
        }

        return totalUsd
      } catch {
        return 0
      }
    },
  })

  const usdBalance = typeof query.data === 'number' && Number.isFinite(query.data) ? query.data : 0
  const formattedUsdBalance = formatNumber(usdBalance, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const isLoadingUsdBalance = query.isLoading || (query.isFetching && query.data === undefined)

  return {
    usdBalance,
    formattedUsdBalance,
    isLoadingUsdBalance,
    refetchUsdBalance: query.refetch,
  }
}
