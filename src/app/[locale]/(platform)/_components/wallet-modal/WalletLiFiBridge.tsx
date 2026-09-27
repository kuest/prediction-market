'use client'

import { LiFiWidget, ChainId, ChainType, type WidgetConfig } from '@lifi/widget'
import { BitcoinProvider } from '@lifi/widget-provider-bitcoin'
import { SolanaProvider } from '@lifi/widget-provider-solana'
import { TronProvider } from '@lifi/widget-provider-tron'
import { useTheme } from 'next-themes'
import { useMemo } from 'react'

import { usePublicRuntimeConfig } from '@/hooks/usePublicRuntimeConfig'
import { POLYGON_USDC_TOKEN_ADDRESS } from '@/lib/contracts'
import { POLYGON_MAINNET_CHAIN_ID } from '@/lib/network'
import { supportedEvmChainIds } from '@/lib/supported-networks'

import KuestLiFiEthereumProvider from './KuestLiFiEthereumProvider'

export default function WalletLiFiBridge({
  open,
  onClose,
  destinationAddress,
  siteName,
}: {
  open: boolean
  onClose: () => void
  destinationAddress: string
  siteName: string
}) {
  const { resolvedTheme } = useTheme()
  const { lifiIntegrator } = usePublicRuntimeConfig()
  const providers = useMemo(() => [KuestLiFiEthereumProvider, BitcoinProvider(), SolanaProvider(), TronProvider()], [])
  const config = useMemo<WidgetConfig>(
    () => ({
      integrator: lifiIntegrator,
      variant: 'drawer',
      mode: 'split',
      modeOptions: { split: 'bridge' },
      appearance: resolvedTheme === 'light' ? 'light' : 'dark',
      toChain: POLYGON_MAINNET_CHAIN_ID,
      toToken: POLYGON_USDC_TOKEN_ADDRESS,
      toAddress: {
        name: `${siteName} Deposit Wallet`,
        address: destinationAddress,
        chainType: ChainType.EVM,
      },
      providers,
      walletConfig: {
        usePartialWalletManagement: true,
      },
      chains: {
        from: { allow: [...supportedEvmChainIds, ChainId.BTC, ChainId.SOL, ChainId.TRN] },
        to: { allow: [POLYGON_MAINNET_CHAIN_ID] },
      },
      disabledUI: {
        toAddress: true,
        toToken: true,
      },
      hiddenUI: {
        reverseTokensButton: true,
      },
    }),
    [destinationAddress, lifiIntegrator, providers, resolvedTheme, siteName],
  )

  return <LiFiWidget integrator={lifiIntegrator} config={config} open={open} onClose={onClose} />
}
