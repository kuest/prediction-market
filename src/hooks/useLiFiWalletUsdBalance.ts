import type { TokensExtendedResponse, WalletTokenExtended } from '@lifi/sdk'

import { useQuery } from '@tanstack/react-query'
import { formatUnits } from 'viem'

import { formatNumber } from '@/lib/formatters'

const LIFI_WALLET_USD_BALANCE_QUERY_KEY = 'lifi-wallet-usd-balance'
const LIFI_WALLET_USD_BALANCE_TOKENS_QUERY_KEY = 'lifi-wallet-usd-balance-tokens'

function buildAcceptedTokenMap(tokensResponse: TokensExtendedResponse) {
  const acceptedByChain = new Map<number, Set<string>>()

  for (const [chainIdKey, tokens] of Object.entries(tokensResponse.tokens)) {
    const chainId = Number(chainIdKey)
    const accepted = new Set<string>()

    for (const token of tokens) {
      accepted.add(token.address.toLowerCase())
    }

    acceptedByChain.set(chainId, accepted)
  }

  return acceptedByChain
}

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

  const acceptedTokensQuery = useQuery({
    queryKey: [LIFI_WALLET_USD_BALANCE_TOKENS_QUERY_KEY],
    enabled: isEnabled && hasAddress,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: 'always',
    queryFn: async () => {
      const tokensResult = await fetch('/api/lifi/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (!tokensResult.ok) {
        return new Map<number, Set<string>>()
      }

      const tokensJson = await tokensResult.json()
      return buildAcceptedTokenMap(tokensJson.tokens as TokensExtendedResponse)
    },
  })

  const query = useQuery({
    queryKey: [LIFI_WALLET_USD_BALANCE_QUERY_KEY, walletAddress],
    enabled: isEnabled && hasAddress && Boolean(acceptedTokensQuery.data),
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
        const acceptedByChain = acceptedTokensQuery.data ?? new Map<number, Set<string>>()

        let totalUsd = 0

        for (const [chainIdKey, walletTokens] of Object.entries(balancesByChain)) {
          const chainId = Number(chainIdKey)
          const acceptedTokens = acceptedByChain.get(chainId)

          if (!acceptedTokens) {
            continue
          }

          for (const token of walletTokens) {
            if (!acceptedTokens.has(token.address.toLowerCase())) {
              continue
            }

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
  const isLoadingUsdBalance =
    acceptedTokensQuery.isLoading ||
    query.isLoading ||
    ((acceptedTokensQuery.isFetching || query.isFetching) && query.data === undefined)

  return {
    usdBalance,
    formattedUsdBalance,
    isLoadingUsdBalance,
    refetchUsdBalance: query.refetch,
  }
}
