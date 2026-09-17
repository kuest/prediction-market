import { NextResponse } from 'next/server'
import { parseUnits } from 'viem'

import { sanitizeNumericInput } from '@/lib/amount-input'
import { POLYGON_USDC_TOKEN_ADDRESS } from '@/lib/contracts'
import { getLiFiServerActions } from '@/lib/lifi'
import { POLYGON_MAINNET_CHAIN_ID } from '@/lib/network'

interface QuoteRequestBody {
  fromChainId: number
  fromTokenAddress: string
  fromTokenDecimals: number
  fromAddress: string
  toAddress: string
  amount: string
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
    const quote = await lifi.getQuote({
      fromChain: body.fromChainId,
      toChain: POLYGON_MAINNET_CHAIN_ID,
      fromToken: body.fromTokenAddress,
      toToken: POLYGON_USDC_TOKEN_ADDRESS,
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
