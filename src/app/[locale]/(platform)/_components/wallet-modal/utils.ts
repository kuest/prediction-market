import type { ChangeEventHandler, FormEventHandler } from 'react'

import type { LiFiWalletTokenItem } from '@/hooks/useLiFiWalletTokens'

export const MELD_PAYMENT_METHODS = [
  'apple_pay',
  'google_pay',
  'pix',
  'paypal',
  'neteller',
  'skrill',
  'binance',
  'coinbase',
] as const

export const TRANSFER_PAYMENT_METHODS = ['polygon', 'usdc'] as const
export const TEST_MODE_DISCORD_URL = 'https://discord.gg/kuest'

export function formatWalletModalAddress(address: string | null | undefined) {
  const normalized = address?.trim()
  if (!normalized) {
    return null
  }

  if (normalized.length <= 12) {
    return normalized
  }

  return `${normalized.slice(0, 7)}...${normalized.slice(-5)}`
}

export const WITHDRAW_TOKEN_OPTIONS = [
  { value: 'USDC', label: 'USDC', icon: '/images/withdraw/token/usdc.svg', enabled: true },
  { value: 'ARB', label: 'ARB', icon: '/images/withdraw/token/arb.svg', enabled: false },
  { value: 'BNB', label: 'BNB', icon: '/images/withdraw/token/bsc.svg', enabled: false },
  { value: 'BTCB', label: 'BTCB', icon: '/images/withdraw/token/btc.svg', enabled: false },
  { value: 'BUSD', label: 'BUSD', icon: '/images/withdraw/token/busd.svg', enabled: false },
  { value: 'CBBTC', label: 'CBBTC', icon: '/images/withdraw/token/cbbtc.svg', enabled: false },
  { value: 'DAI', label: 'DAI', icon: '/images/withdraw/token/dai.svg', enabled: false },
  { value: 'ETH', label: 'ETH', icon: '/images/withdraw/token/eth.svg', enabled: false },
  { value: 'POL', label: 'POL', icon: '/images/withdraw/token/matic.svg', enabled: false },
  { value: 'SOL', label: 'SOL', icon: '/images/withdraw/token/sol.svg', enabled: false },
  { value: 'USDe', label: 'USDe', icon: '/images/withdraw/token/usde.svg', enabled: false },
  { value: 'USDT', label: 'USDT', icon: '/images/withdraw/token/usdt.svg', enabled: false },
  { value: 'WBNB', label: 'WBNB', icon: '/images/withdraw/token/bsc.svg', enabled: false },
  { value: 'WETH', label: 'WETH', icon: '/images/withdraw/token/weth.svg', enabled: false },
] as const

export const WITHDRAW_CHAIN_OPTIONS = [
  { value: 'Ethereum', label: 'Ethereum', icon: '/images/withdraw/chain/ethereum.svg', enabled: false },
  { value: 'Solana', label: 'Solana', icon: '/images/withdraw/chain/solana.svg', enabled: false },
  { value: 'BSC', label: 'BSC', icon: '/images/withdraw/chain/bsc.svg', enabled: false },
  { value: 'Base', label: 'Base', icon: '/images/withdraw/chain/base.svg', enabled: false },
  { value: 'Polygon', label: 'Polygon', icon: '/images/withdraw/chain/polygon.svg', enabled: true },
  { value: 'Arbitrum', label: 'Arbitrum', icon: '/images/withdraw/chain/arbitrum.svg', enabled: false },
  { value: 'Optimism', label: 'Optimism', icon: '/images/withdraw/chain/optimism.svg', enabled: false },
] as const

export function getSelectedWalletTokenId(items: LiFiWalletTokenItem[], preferredSelectedTokenId: string) {
  if (!items.length) {
    return ''
  }

  if (preferredSelectedTokenId && items.some((item) => item.id === preferredSelectedTokenId && !item.disabled)) {
    return preferredSelectedTokenId
  }

  const firstEnabledItem = items.find((item) => !item.disabled)
  return firstEnabledItem?.id ?? ''
}

type WalletDepositView = 'fund' | 'receive' | 'wallets' | 'bridge' | 'amount' | 'confirm' | 'success'

export interface WalletDepositModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isMobile: boolean
  walletAddress?: string | null
  walletEoaAddress?: string | null
  siteName?: string
  canBuyMeld: boolean
  hasDeployedDepositWallet: boolean
  view: WalletDepositView
  onViewChange: (view: WalletDepositView) => void
  onBuy: () => void
  depositWalletBalance?: string | null
  isDepositWalletBalanceLoading?: boolean
  walletBalance?: string | null
  isBalanceLoading?: boolean
}

export interface WalletWithdrawModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isMobile: boolean
  siteName?: string
  sendTo: string
  onChangeSendTo: ChangeEventHandler<HTMLInputElement>
  sendAmount: string
  onChangeSendAmount: (value: string) => void
  isSending: boolean
  onSubmitSend: FormEventHandler<HTMLFormElement>
  connectedWalletAddress?: string | null
  onUseConnectedWallet?: () => void
  availableBalance?: number | null
  onMax?: () => void
  isBalanceLoading?: boolean
}
