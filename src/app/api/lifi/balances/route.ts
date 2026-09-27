import { NextResponse } from 'next/server'

import { getLiFiServerActions } from '@/lib/lifi'
import { getLiFiEvmTokenCatalog } from '@/lib/lifi-token-catalog'

interface BalancesRequestBody {
  walletAddress: string
}

export async function POST(request: Request) {
  const lifi = await getLiFiServerActions()

  let body: BalancesRequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!body.walletAddress) {
    return NextResponse.json({ error: 'walletAddress is required.' }, { status: 400 })
  }

  try {
    const { tokens } = await getLiFiEvmTokenCatalog(lifi)
    const balances = await lifi.getTokenBalancesByChain(body.walletAddress, tokens)
    const serializedBalances = Object.fromEntries(
      Object.entries(balances).map(([chainId, chainTokens]) => [
        chainId,
        chainTokens.flatMap(({ amount, blockNumber, ...token }) => {
          if (amount === undefined || amount <= 0n) {
            return []
          }

          return [
            {
              ...token,
              amount: amount.toString(),
              ...(blockNumber === undefined ? {} : { blockNumber: blockNumber.toString() }),
            },
          ]
        }),
      ]),
    )

    return NextResponse.json({ balances: serializedBalances })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch LI.FI balances.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
