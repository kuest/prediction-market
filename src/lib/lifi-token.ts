import type { WalletTokenExtended } from '@lifi/sdk'

import { formatUnits } from 'viem'

import { ZERO_ADDRESS } from '@/lib/contracts'

const LIFI_NATIVE_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

export function isLiFiNativeToken(token: Pick<WalletTokenExtended, 'address'>) {
  const address = token.address.toLowerCase()
  return address === ZERO_ADDRESS.toLowerCase() || address === LIFI_NATIVE_TOKEN_ADDRESS
}

export function normalizeLiFiTokenAmount(token: Pick<WalletTokenExtended, 'amount' | 'decimals'>) {
  try {
    const decimals = Number(token.decimals)
    if (!Number.isFinite(decimals)) {
      return 0
    }

    return Number(formatUnits(BigInt(token.amount), decimals))
  } catch {
    return 0
  }
}

export function getLiFiTokenUsdValue(token: WalletTokenExtended) {
  const priceUsd = Number(token.priceUSD ?? 0)

  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    return null
  }

  const usdValue = normalizeLiFiTokenAmount(token) * priceUsd
  return Number.isFinite(usdValue) && usdValue > 0 ? usdValue : null
}
