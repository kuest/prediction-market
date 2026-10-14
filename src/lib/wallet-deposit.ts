import type { LiFiWalletTokenItem } from '@/hooks/useLiFiWalletTokens'

import { COLLATERAL_TOKEN_ADDRESS } from '@/lib/contracts'
import { DEFAULT_CHAIN_ID } from '@/lib/network'

export function isDirectUsdcDeposit(token?: LiFiWalletTokenItem | null) {
  return Boolean(
    token &&
    token.chainId === DEFAULT_CHAIN_ID &&
    token.address.toLowerCase() === COLLATERAL_TOKEN_ADDRESS.toLowerCase(),
  )
}
