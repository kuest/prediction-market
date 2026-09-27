import type { ChainId, ExtendedChain, TokensExtendedResponse, WalletTokenExtended } from '@lifi/sdk'

import { useQuery } from '@tanstack/react-query'
import { formatUnits } from 'viem'

import { formatNumber } from '@/lib/formatters'

const LIFI_WALLET_TOKENS_QUERY_KEY = 'lifi-wallet-tokens'

export const MIN_USD_BALANCE = 2

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

function buildChainMap(chains: ExtendedChain[]) {
  const chainMap = new Map<number, ExtendedChain>()
  for (const chain of chains) {
    chainMap.set(chain.id as number, chain)
  }
  return chainMap
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

function formatTokenAmount(token: WalletTokenExtended) {
  const normalizedAmount = normalizeAmount(token)

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

      const [tokensResult, balancesResult, chainsResult] = await Promise.all([
        fetch('/api/lifi/tokens', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        }),
        fetch('/api/lifi/balances', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ walletAddress }),
        }),
        fetch('/api/lifi/chains'),
      ])

      if (!tokensResult.ok || !balancesResult.ok || !chainsResult.ok) {
        throw new Error('Failed to load LI.FI wallet data.')
      }

      const tokensJson = await tokensResult.json()
      const balancesJson = await balancesResult.json()
      const chainsJson = await chainsResult.json()
      const tokensResponse = tokensJson.tokens as TokensExtendedResponse
      const balancesByChain = balancesJson.balances as Record<number, WalletTokenExtended[]>
      const chains = chainsJson.chains as ExtendedChain[]

      const acceptedByChain = buildAcceptedTokenMap(tokensResponse)
      const chainMap = buildChainMap(chains)
      const items: LiFiWalletTokenItem[] = []

      for (const [chainIdKey, walletTokens] of Object.entries(balancesByChain)) {
        const chainId = Number(chainIdKey) as ChainId
        const acceptedTokens = acceptedByChain.get(chainId)

        if (!acceptedTokens) {
          continue
        }

        const chain = chainMap.get(chainId)
        const networkName = chain?.name ?? `Chain ${chainId}`
        const networkIcon = chain?.logoURI

        for (const token of walletTokens) {
          if (!acceptedTokens.has(token.address.toLowerCase())) {
            continue
          }

          const usdValue = toUsdValue(token)
          if (!Number.isFinite(usdValue) || usdValue <= 0) {
            continue
          }

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
            balanceRaw: normalizeAmount(token),
            usd: formatNumber(usdValue, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            usdValue,
            disabled: usdValue < MIN_USD_BALANCE,
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
