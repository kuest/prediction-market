import type { TokensExtendedResponse } from '@lifi/sdk'

import { ChainType } from '@lifi/sdk'

import type { getLiFiServerActions } from '@/lib/lifi'

import 'server-only'

type LiFiCatalogActions = Pick<Awaited<ReturnType<typeof getLiFiServerActions>>, 'getChains' | 'getTokens'>

export interface LiFiEvmTokenCatalog {
  chainIds: number[]
  tokens: TokensExtendedResponse['tokens']
}

const TOKEN_CATALOG_TTL_MS = 5 * 60 * 1000

let cachedCatalog: { expiresAt: number; value: LiFiEvmTokenCatalog } | null = null
let pendingCatalog: Promise<LiFiEvmTokenCatalog> | null = null

export async function getLiFiEvmTokenCatalog(lifi: LiFiCatalogActions): Promise<LiFiEvmTokenCatalog> {
  if (cachedCatalog && cachedCatalog.expiresAt > Date.now()) {
    return cachedCatalog.value
  }

  if (pendingCatalog) {
    return pendingCatalog
  }

  const request = (async () => {
    const chains = await lifi.getChains()
    const chainIds = chains.filter((chain) => chain.chainType === ChainType.EVM).map((chain) => chain.id)
    const { tokens } = await lifi.getTokens({ extended: true, chains: chainIds })

    return { chainIds, tokens }
  })()

  pendingCatalog = request

  try {
    const value = await request
    cachedCatalog = { expiresAt: Date.now() + TOKEN_CATALOG_TTL_MS, value }
    return value
  } finally {
    if (pendingCatalog === request) {
      pendingCatalog = null
    }
  }
}
