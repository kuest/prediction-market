import { NextResponse } from 'next/server'

import { normalizePolymarketTickSize } from '@/lib/polymarket-market'

const CONDITION_ID_PATTERN = /^(?:0x[a-fA-F0-9]{64}|0x(?:01|02)[a-fA-F0-9]{60})$/
const POLYMARKET_REQUEST_TIMEOUT_MS = 8_000

export async function GET(request: Request) {
  const conditionId = new URL(request.url).searchParams.get('conditionId')?.trim() ?? ''
  if (!CONDITION_ID_PATTERN.test(conditionId)) {
    return NextResponse.json({ error: 'Invalid condition ID.' }, { status: 400 })
  }

  try {
    const response = await fetch(`https://clob.polymarket.com/clob-markets/${conditionId}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(POLYMARKET_REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      return NextResponse.json({ error: 'Polymarket market info unavailable.' }, { status: 502 })
    }

    const data = (await response.json()) as {
      fd?: { e?: unknown; r?: unknown }
      mos?: unknown
      mts?: unknown
    }
    const feeRate = Number(data.fd?.r)
    const feeExponent = Number(data.fd?.e)
    const minimumOrderSize = Number(data.mos)

    return NextResponse.json({
      feeRate: Number.isFinite(feeRate) && feeRate > 0 ? feeRate : 0,
      feeExponent: Number.isFinite(feeExponent) && feeExponent >= 0 ? feeExponent : 0,
      minimumOrderSize: Number.isFinite(minimumOrderSize) && minimumOrderSize > 0 ? minimumOrderSize : 0,
      minimumTickSize: normalizePolymarketTickSize(data.mts) ?? '0.01',
    })
  } catch {
    return NextResponse.json({ error: 'Polymarket market info unavailable.' }, { status: 502 })
  }
}
