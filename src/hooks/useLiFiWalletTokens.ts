import type { ExtendedChain, WalletTokenExtended } from '@lifi/sdk'

import { useQuery } from '@tanstack/react-query'

import { formatNumber } from '@/lib/formatters'
import { getLiFiTokenUsdValue, isLiFiNativeToken, normalizeLiFiTokenAmount } from '@/lib/lifi-token'

const LIFI_WALLET_TOKENS_QUERY_KEY = 'lifi-wallet-tokens'

export const MIN_USD_BALANCE = 2

function buildChainMap(chains: ExtendedChain[]) {
  const chainMap = new Map<number, ExtendedChain>()
  for (const chain of chains) {
    chainMap.set(chain.id as number, chain)
  }
  return chainMap
}

function formatTokenAmount(token: WalletTokenExtended) {
  const normalizedAmount = normalizeLiFiTokenAmount(token)

  return formatNumber(normalizedAmount, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })
}

export interface LiFiWalletTokenItem {
  id: string
  chainId: number
  address: string
  decimals: number
  symbol: string
  network: string
  icon: string
  chainIcon?: string
  balance: string
  balanceRaw: number
  usd: string
  usdValue: number
  hasUsdValue: boolean
  disabled: boolean
}

interface UseLiFiWalletTokensOptions {
  enabled?: boolean
}

export function useLiFiWalletTokens(walletAddress?: string | null, options: UseLiFiWalletTokensOptions = {}) {
  const isEnabled = Boolean(options.enabled ?? true)
  const hasAddress = Boolean(walletAddress)

  const query = useQuery({
    queryKey: [LIFI_WALLET_TOKENS_QUERY_KEY, walletAddress],
    enabled: isEnabled && hasAddress,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: 'always',
    queryFn: async (): Promise<LiFiWalletTokenItem[]> => {
      if (!walletAddress) {
        return []
      }

      const balancesResult = await fetch('/api/lifi/balances', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ walletAddress }),
      })

      if (!balancesResult.ok) {
        throw new Error('Failed to load LI.FI wallet data.')
      }

      const balancesJson = await balancesResult.json()
      const balancesByChain = balancesJson.balances as Record<number, WalletTokenExtended[]>
      const chains = (balancesJson.chains ?? []) as ExtendedChain[]
      const chainMap = buildChainMap(chains)
      const items: LiFiWalletTokenItem[] = []

      for (const [chainIdKey, walletTokens] of Object.entries(balancesByChain)) {
        const chainId = Number(chainIdKey)
        const chain = chainMap.get(chainId)
        const networkName = chain?.name ?? `Chain ${chainId}`
        const networkIcon = chain?.logoURI

        for (const token of walletTokens) {
          const balanceRaw = normalizeLiFiTokenAmount(token)
          if (!Number.isFinite(balanceRaw) || balanceRaw <= 0) {
            continue
          }

          const usdValue = getLiFiTokenUsdValue(token)
          const hasUsdValue = usdValue !== null
          if (!hasUsdValue && !isLiFiNativeToken(token)) {
            continue
          }
          const normalizedUsdValue = usdValue ?? 0

          items.push({
            id: `${chainId}:${token.address}`,
            chainId,
            address: token.address,
            decimals: Number(token.decimals),
            symbol: token.symbol,
            network: networkName,
            icon: token.logoURI ?? '/images/deposit/transfer/usdc_dark.png',
            chainIcon: networkIcon,
            balance: formatTokenAmount(token),
            balanceRaw,
            usd: hasUsdValue
              ? formatNumber(normalizedUsdValue, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : '—',
            usdValue: normalizedUsdValue,
            hasUsdValue,
            disabled: hasUsdValue && normalizedUsdValue < MIN_USD_BALANCE,
          })
        }
      }

      items.sort((a, b) => b.usdValue - a.usdValue)

      return items
    },
  })

  return {
    items: query.data ?? [],
    isLoadingTokens: query.isLoading || (query.isFetching && query.data === undefined),
    isError: query.isError,
    refetchTokens: query.refetch,
  }
}
