import { NextResponse } from 'next/server'

import { getLiFiServerActions } from '@/lib/lifi'
import { getLiFiEvmTokenCatalog } from '@/lib/lifi-token-catalog'

interface TokensRequestBody {
  chains?: number[]
}

export async function POST(request: Request) {
  const lifi = await getLiFiServerActions()

  let body: TokensRequestBody = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  try {
    const { chainIds, tokens: evmTokens } = await getLiFiEvmTokenCatalog(lifi)
    const requestedChainIds = body.chains
    const selectedChainIds = requestedChainIds
      ? chainIds.filter((chainId) => requestedChainIds.includes(chainId))
      : chainIds
    const selectedTokens: typeof evmTokens = {}

    for (const chainId of selectedChainIds) {
      const chainTokens = evmTokens[chainId]
      if (chainTokens) {
        selectedTokens[chainId] = chainTokens
      }
    }

    const tokens = { tokens: selectedTokens }
    return NextResponse.json({ tokens })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch LI.FI tokens.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
