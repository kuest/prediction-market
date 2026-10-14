import { describe, expect, it, mock } from 'bun:test'

import type { LiFiWalletTokenItem } from '@/hooks/useLiFiWalletTokens'

void mock.module('@/lib/network', () => ({ DEFAULT_CHAIN_ID: 137, IS_TEST_MODE: false }))

const { isDirectUsdcDeposit } = await import('@/lib/wallet-deposit')
const usdc = {
  chainId: 137,
  address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
} as LiFiWalletTokenItem

describe('wallet deposit routing on Polygon mainnet', () => {
  it('uses a direct transfer for native USDC regardless of address casing', () => {
    expect(isDirectUsdcDeposit(usdc)).toBe(true)
    expect(isDirectUsdcDeposit({ ...usdc, address: usdc.address.toLowerCase() })).toBe(true)
  })

  it('keeps swaps for bridged USDC and other tokens', () => {
    expect(isDirectUsdcDeposit({ ...usdc, address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' })).toBe(false)
  })

  it('does not directly transfer USDC from another network', () => {
    expect(isDirectUsdcDeposit({ ...usdc, chainId: 1 })).toBe(false)
    expect(isDirectUsdcDeposit(null)).toBe(false)
  })
})
