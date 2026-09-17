import { describe, expect, it } from 'bun:test'

import { getLiFiTokenUsdValue, isLiFiNativeToken, normalizeLiFiTokenAmount } from '@/lib/lifi-token'

const nativeToken = {
  address: '0x0000000000000000000000000000000000000000',
  amount: '1500000000000000000',
  chainId: 137,
  decimals: 18,
  name: 'POL',
  priceUSD: '0',
  symbol: 'POL',
}

describe('LI.FI token helpers', () => {
  it('recognizes native tokens and preserves their balance without a USD valuation', () => {
    expect(isLiFiNativeToken(nativeToken)).toBe(true)
    expect(normalizeLiFiTokenAmount(nativeToken)).toBe(1.5)
    expect(getLiFiTokenUsdValue(nativeToken)).toBeNull()
  })

  it('calculates a USD valuation for priced tokens', () => {
    expect(
      getLiFiTokenUsdValue({
        ...nativeToken,
        address: '0x1111111111111111111111111111111111111111',
        amount: '2500000',
        decimals: 6,
        priceUSD: '1',
        symbol: 'USDC',
      }),
    ).toBe(2.5)
  })
})
