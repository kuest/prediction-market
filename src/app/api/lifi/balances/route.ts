import type { TokenAmount, TokenExtended } from '@lifi/sdk'

import { actions, ChainType, getTokenBalancesByChain } from '@lifi/sdk'
import { isAddress } from 'viem'

import { POLYGON_USDC_TOKEN_ADDRESS, ZERO_ADDRESS } from '@/lib/contracts'
import { getLiFiEvmBalanceClient } from '@/lib/lifi'
import { isLiFiNativeToken } from '@/lib/lifi-token'
import { POLYGON_MAINNET_CHAIN_ID } from '@/lib/network'

const fallbackPolygonTokens: TokenExtended[] = [
  {
    address: ZERO_ADDRESS,
    chainId: POLYGON_MAINNET_CHAIN_ID,
    decimals: 18,
    name: 'POL',
    priceUSD: '0',
    symbol: 'POL',
  },
  {
    address: POLYGON_USDC_TOKEN_ADDRESS,
    chainId: POLYGON_MAINNET_CHAIN_ID,
    decimals: 6,
    name: 'USD Coin',
    priceUSD: '1',
    symbol: 'USDC',
  },
]

interface BalancesRequestBody {
  walletAddress: string
}

async function getLimitedPolygonTokens(lifi: ReturnType<typeof actions>) {
  const tokenResults = await Promise.allSettled([
    lifi.getToken(POLYGON_MAINNET_CHAIN_ID, ZERO_ADDRESS),
    lifi.getToken(POLYGON_MAINNET_CHAIN_ID, POLYGON_USDC_TOKEN_ADDRESS),
  ])
  const resolvedTokens = tokenResults.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  const nativeToken = resolvedTokens.find(isLiFiNativeToken)
  const usdcToken = resolvedTokens.find(
    (token) => token.address.toLowerCase() === POLYGON_USDC_TOKEN_ADDRESS.toLowerCase(),
  )

  return [nativeToken ?? fallbackPolygonTokens[0], usdcToken ?? fallbackPolygonTokens[1]]
}

function serializeTokenBalances(balances: Record<number, TokenAmount[]>) {
  return Object.fromEntries(
    Object.entries(balances).map(([chainId, tokens]) => [
      chainId,
      tokens.map(({ amount, blockNumber, ...token }) => ({
        ...token,
        ...(amount === undefined ? {} : { amount: amount.toString() }),
        ...(blockNumber === undefined ? {} : { blockNumber: blockNumber.toString() }),
      })),
    ]),
  )
}

export async function POST(request: Request) {
  let body: BalancesRequestBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const walletAddress = typeof body?.walletAddress === 'string' ? body.walletAddress.trim() : ''
  if (!walletAddress) {
    return Response.json({ error: 'walletAddress is required.' }, { status: 400 })
  }

  if (!isAddress(walletAddress, { strict: false })) {
    return Response.json({ error: 'walletAddress must be a valid EVM address.' }, { status: 400 })
  }

  try {
    const client = await getLiFiEvmBalanceClient()
    const lifi = actions(client)
    const [chains, tokens] = await Promise.all([
      lifi.getChains({ chainTypes: [ChainType.EVM] }),
      getLimitedPolygonTokens(lifi),
    ])
    const polygonChain = chains.find((chain) => chain.id === POLYGON_MAINNET_CHAIN_ID)

    if (!polygonChain) {
      throw new Error('Polygon chain metadata is not available from LI.FI.')
    }

    client.setChains([polygonChain])

    const balances = await getTokenBalancesByChain(client, walletAddress, {
      [POLYGON_MAINNET_CHAIN_ID]: tokens,
    })

    return Response.json({
      balances: serializeTokenBalances(balances),
      chains: [polygonChain],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch LI.FI balances.'
    return Response.json({ error: message }, { status: 500 })
  }
}
