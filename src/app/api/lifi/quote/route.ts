import type { TokenExtended } from '@lifi/sdk'

import { NextResponse } from 'next/server'
import { parseUnits } from 'viem'

import { sanitizeNumericInput } from '@/lib/amount-input'
import { COLLATERAL_TOKEN_ADDRESS } from '@/lib/contracts'
import { getLiFiServerActions } from '@/lib/lifi'

interface QuoteRequestBody {
  fromChainId: number
  fromTokenAddress: string
  fromTokenDecimals: number
  fromAddress: string
  toAddress: string
  amount: string
}

function findUsdcToken(stepChainTokens: TokenExtended[]) {
  return (
    stepChainTokens.find((token) => token.address.toLowerCase() === COLLATERAL_TOKEN_ADDRESS.toLowerCase()) ??
    stepChainTokens.find((token) => token.symbol.toUpperCase() === 'USDC')
  )
}

export async function POST(request: Request) {
  const lifi = await getLiFiServerActions()

  let body: QuoteRequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!body.amount) {
    return NextResponse.json({ error: 'Amount is required.' }, { status: 400 })
  }

  const sanitizedAmount = sanitizeNumericInput(body.amount)
  if (!sanitizedAmount) {
    return NextResponse.json({ error: 'Amount is required.' }, { status: 400 })
  }

  let fromAmount: string
  try {
    const fromAmountBigInt = parseUnits(sanitizedAmount, body.fromTokenDecimals)
    if (fromAmountBigInt <= 0n) {
      return NextResponse.json({ error: 'Amount must be greater than zero.' }, { status: 400 })
    }
    fromAmount = fromAmountBigInt.toString()
  } catch {
    return NextResponse.json({ error: 'Invalid amount.' }, { status: 400 })
  }

  try {
    const tokensResponse = await lifi.getTokens({
      extended: true,
      chains: [body.fromChainId],
    })

    const chainTokens = tokensResponse.tokens[body.fromChainId] ?? []
    const usdcToken = findUsdcToken(chainTokens)

    if (!usdcToken) {
      return NextResponse.json({ error: 'USDC token not available on this chain.' }, { status: 400 })
    }

    const quote = await lifi.getQuote({
      fromChain: body.fromChainId,
      toChain: body.fromChainId,
      fromToken: body.fromTokenAddress,
      toToken: usdcToken.address,
      fromAddress: body.fromAddress,
      toAddress: body.toAddress,
      fromAmount,
    })

    return NextResponse.json({ quote })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch LI.FI quote.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
