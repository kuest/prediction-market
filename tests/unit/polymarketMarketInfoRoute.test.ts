import { afterEach, describe, expect, it, mock } from 'bun:test'

import { GET } from '@/app/api/arbitrage/market-info/route'

import { stubGlobal, unstubAllGlobals } from '../bun-test-helpers'

afterEach(() => {
  unstubAllGlobals()
})

describe('Polymarket market info route', () => {
  it('loads CLOB market info for a canonical PolyV2 bytes31 condition ID', async () => {
    const conditionId = `0x01${'ab'.repeat(30)}`
    const fetchMock = mock().mockResolvedValue(
      new Response(JSON.stringify({ fd: { r: 0.07, e: 1 }, mos: 5, mts: 0.01 }), { status: 200 }),
    )
    stubGlobal('fetch', fetchMock)

    const response = await GET(
      new Request(`https://kuest.example/api/arbitrage/market-info?conditionId=${conditionId}`),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      feeRate: 0.07,
      feeExponent: 1,
      minimumOrderSize: 5,
      minimumTickSize: '0.01',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      `https://clob.polymarket.com/clob-markets/${conditionId}`,
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    )
  })

  it('rejects IDs for modules without a supported market info/order path', async () => {
    const fetchMock = mock()
    stubGlobal('fetch', fetchMock)

    const response = await GET(
      new Request(`https://kuest.example/api/arbitrage/market-info?conditionId=0x03${'ab'.repeat(30)}`),
    )

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
