'use client'

import { ChainId, ChainType, type SDKProvider } from '@lifi/sdk'
import { EthereumProvider as createEthereumProvider, type EthereumProviderOptions } from '@lifi/sdk-provider-ethereum'
import { TronProvider as createTronProvider } from '@lifi/sdk-provider-tron'
import { LiFiWidget, WidgetSkeleton, type WidgetConfig } from '@lifi/widget'
import {
  EthereumContext,
  TronContext,
  type Account,
  type WidgetProviderContext,
  type WidgetProviderProps,
} from '@lifi/widget-provider'
import { BitcoinProvider } from '@lifi/widget-provider-bitcoin'
import { SolanaProvider } from '@lifi/widget-provider-solana'
import { useAppKitAccount } from '@reown/appkit/react'
import { WalletReadyState } from '@tronweb3/tronwallet-abstract-adapter'
import { MetaMaskAdapter } from '@tronweb3/tronwallet-adapter-metamask-tron'
import { useExtracted } from 'next-intl'
import { useTheme } from 'next-themes'
import { type PropsWithChildren, useCallback, useEffect, useMemo, useState } from 'react'
import { isAddress, type Address, type Client } from 'viem'
import { useAccount, useConfig, useConnectors } from 'wagmi'
import { connect, getBytecode, getConnectorClient, getTransactionCount, switchChain } from 'wagmi/actions'

import { useHasHydrated } from '@/hooks/useHasHydrated'
import { POLYGON_USDC_TOKEN_ADDRESS } from '@/lib/contracts'
import { POLYGON_MAINNET_CHAIN_ID } from '@/lib/network'
import { supportedEvmChainIds } from '@/lib/supported-networks'

const TRON_CHAIN_ID = Number(ChainId.TRN)
const LIFI_FROM_CHAIN_IDS: number[] = [
  ...new Set([...supportedEvmChainIds, Number(ChainId.BTC), Number(ChainId.SOL), TRON_CHAIN_ID]),
]

type TronWalletSnapshot = {
  address: string | null
  connected: boolean
  connecting: boolean
  readyState: WalletReadyState
}

function KuestTronProvider({ children }: PropsWithChildren) {
  const adapter = useMemo(() => (typeof window === 'undefined' ? null : new MetaMaskAdapter()), [])
  const readSnapshot = useCallback<() => TronWalletSnapshot>(
    () => ({
      address: adapter?.address ?? null,
      connected: adapter?.connected ?? false,
      connecting: adapter?.connecting ?? false,
      readyState: adapter?.readyState ?? WalletReadyState.NotFound,
    }),
    [adapter],
  )
  const [snapshot, setSnapshot] = useState<TronWalletSnapshot>(readSnapshot)
  const syncSnapshot = useCallback(() => setSnapshot(readSnapshot()), [readSnapshot])

  useEffect(() => {
    if (!adapter) {
      return
    }

    const events = [
      'readyStateChanged',
      'stateChanged',
      'connect',
      'disconnect',
      'accountsChanged',
      'chainChanged',
    ] as const
    events.forEach((event) => adapter.on(event, syncSnapshot))

    return () => {
      events.forEach((event) => adapter.off(event, syncSnapshot))
    }
  }, [adapter, syncSnapshot])

  const { address: tronAddress, connected, connecting, readyState } = snapshot
  const sdkProvider = useMemo<SDKProvider>(
    () =>
      createTronProvider({
        getWallet: async () => {
          if (!adapter) {
            throw new Error('No Tron wallet connected')
          }
          return adapter
        },
      }) as unknown as SDKProvider,
    [adapter],
  )
  const address = tronAddress && sdkProvider.isAddress(tronAddress) ? tronAddress : undefined
  const connector = useMemo(() => (adapter ? { name: adapter.name, icon: adapter.icon } : undefined), [adapter])
  const account = useMemo<Account>(
    () => ({
      address,
      chainId: address ? TRON_CHAIN_ID : undefined,
      chainType: ChainType.TVM,
      connector,
      isConnected: Boolean(address && connected),
      isConnecting: connecting,
      isDisconnected: !address || !connected,
      isReconnecting: false,
      status: connecting ? 'connecting' : address && connected ? 'connected' : 'disconnected',
    }),
    [address, connected, connecting, connector],
  )
  const installedWallets = useMemo(
    () => (adapter && readyState === WalletReadyState.Found ? [{ name: adapter.name, icon: adapter.icon }] : []),
    [adapter, readyState],
  )
  const handleConnect = useCallback(
    async (walletName: string, onSuccess?: (address: string, chainId: number) => void) => {
      if (!adapter || adapter.name !== walletName) {
        throw new Error(`Wallet ${walletName} is not available`)
      }

      await adapter.connect()
      syncSnapshot()
      const connectedAddress = adapter.address
      if (connectedAddress) {
        onSuccess?.(connectedAddress, TRON_CHAIN_ID)
      }
    },
    [adapter, syncSnapshot],
  )
  const handleDisconnect = useCallback(async () => {
    await adapter?.disconnect()
    syncSnapshot()
  }, [adapter, syncSnapshot])
  const contextValue = useMemo<WidgetProviderContext>(
    () => ({
      isEnabled: true,
      isExternalContext: false,
      isConnected: Boolean(address && connected),
      account,
      sdkProvider,
      installedWallets,
      connect: handleConnect,
      disconnect: handleDisconnect,
    }),
    [account, address, connected, handleConnect, handleDisconnect, installedWallets, sdkProvider],
  )

  return <TronContext value={contextValue}>{children}</TronContext>
}

function KuestEthereumProvider({ children }: PropsWithChildren<WidgetProviderProps>) {
  const wagmiConfig = useConfig()
  const account = useAccount()
  const { embeddedWalletInfo } = useAppKitAccount({ namespace: 'eip155' })
  const isEmbeddedWallet = Boolean(embeddedWalletInfo)
  const connectors = useConnectors()
  const [widgetDisconnectedAccount, setWidgetDisconnectedAccount] = useState<string | null>(null)
  const normalizedAccountAddress = account.address?.toLowerCase() ?? null
  const isWidgetConnected =
    !isEmbeddedWallet &&
    account.isConnected &&
    Boolean(account.address) &&
    widgetDisconnectedAccount !== normalizedAccountAddress

  const getWalletClient = useCallback(
    async () => (await getConnectorClient(wagmiConfig, { assertChainId: false })) as unknown as Client,
    [wagmiConfig],
  )
  const switchChainForLiFi = useCallback(
    async (chainId: number) => {
      const switchedChain = await switchChain(wagmiConfig, { chainId })
      return (await getConnectorClient(wagmiConfig, {
        chainId: switchedChain.id,
        assertChainId: false,
      })) as unknown as Client
    },
    [wagmiConfig],
  )
  const sdkProvider = useMemo<SDKProvider>(
    () =>
      createEthereumProvider({
        getWalletClient: getWalletClient as unknown as NonNullable<EthereumProviderOptions['getWalletClient']>,
        switchChain: switchChainForLiFi as unknown as NonNullable<EthereumProviderOptions['switchChain']>,
      }) as unknown as SDKProvider,
    [getWalletClient, switchChainForLiFi],
  )

  const getBytecodeForAddress = useCallback(
    async (chainId: number, address: string) => {
      if (!isAddress(address)) {
        return undefined
      }

      try {
        return await getBytecode(wagmiConfig, {
          chainId,
          address: address as Address,
        })
      } catch {
        return undefined
      }
    },
    [wagmiConfig],
  )
  const getTransactionCountForAddress = useCallback(
    async (chainId: number, address: string) => {
      if (!isAddress(address)) {
        return undefined
      }

      try {
        return await getTransactionCount(wagmiConfig, {
          chainId,
          address: address as Address,
        })
      } catch {
        return undefined
      }
    },
    [wagmiConfig],
  )

  const activeConnector = useMemo(
    () =>
      !isEmbeddedWallet && account.connector
        ? {
            id: account.connector.id,
            uid: account.connector.uid,
            name: account.connector.name,
            displayName: account.connector.name,
            icon: account.connector.icon,
          }
        : undefined,
    [account.connector, isEmbeddedWallet],
  )
  const installedWallets = useMemo(() => (activeConnector ? [activeConnector] : []), [activeConnector])
  const widgetAccount = useMemo<Account>(
    () => ({
      address: isWidgetConnected ? account.address : undefined,
      addresses: isWidgetConnected ? account.addresses : undefined,
      chainId: isWidgetConnected ? account.chainId : undefined,
      chainType: ChainType.EVM,
      connector: isWidgetConnected ? activeConnector : undefined,
      isConnected: isWidgetConnected,
      isConnecting: isWidgetConnected ? account.isConnecting : false,
      isDisconnected: !isWidgetConnected,
      isReconnecting: isWidgetConnected && account.isReconnecting,
      status: isWidgetConnected ? account.status : 'disconnected',
    }),
    [account, activeConnector, isWidgetConnected],
  )

  const handleConnect = useCallback(
    async (connectorIdOrName: string, onSuccess?: (address: string, chainId: number) => void) => {
      if (isEmbeddedWallet) {
        throw new Error('Embedded wallets are not supported by the LI.FI widget')
      }

      const connector = connectors.find(
        (candidate) => candidate.id === connectorIdOrName || candidate.name === connectorIdOrName,
      )
      if (!connector) {
        throw new Error(`Wallet ${connectorIdOrName} is not available`)
      }
      const isActiveConnector = activeConnector
        ? activeConnector.id
          ? connector.id === activeConnector.id
          : connector.name === activeConnector.name
        : false
      if (!isActiveConnector) {
        throw new Error('Connect the wallet already connected to the site')
      }

      if (account.isConnected && account.address && account.chainId !== undefined) {
        setWidgetDisconnectedAccount(null)
        onSuccess?.(account.address, account.chainId)
        return
      }

      const result = await connect(wagmiConfig, { connector })
      const address = result.accounts[0]
      if (address) {
        setWidgetDisconnectedAccount(null)
        onSuccess?.(address, result.chainId)
      }
    },
    [account, activeConnector, connectors, isEmbeddedWallet, wagmiConfig],
  )
  const handleDisconnect = useCallback(async () => {
    setWidgetDisconnectedAccount(normalizedAccountAddress)
  }, [normalizedAccountAddress])

  const contextValue = useMemo(
    () => ({
      isEnabled: !isEmbeddedWallet,
      isExternalContext: true,
      isConnected: isWidgetConnected,
      account: widgetAccount,
      sdkProvider,
      installedWallets,
      connect: handleConnect,
      disconnect: handleDisconnect,
      getBytecode: getBytecodeForAddress,
      getTransactionCount: getTransactionCountForAddress,
    }),
    [
      getBytecodeForAddress,
      getTransactionCountForAddress,
      handleConnect,
      handleDisconnect,
      isEmbeddedWallet,
      isWidgetConnected,
      installedWallets,
      sdkProvider,
      widgetAccount,
    ],
  )

  return <EthereumContext value={contextValue}>{children}</EthereumContext>
}

export default function WalletLiFiBridge({
  destinationAddress,
  siteName,
  isMobile,
  initialFromChain,
  initialFromToken,
}: {
  destinationAddress: string
  siteName: string
  isMobile: boolean
  initialFromChain?: number
  initialFromToken?: string
}) {
  const t = useExtracted()
  const hasHydrated = useHasHydrated()
  const { resolvedTheme } = useTheme()
  const providers = useMemo(() => [KuestEthereumProvider, BitcoinProvider(), SolanaProvider(), KuestTronProvider], [])
  const config = useMemo<WidgetConfig>(
    () => ({
      integrator: 'kuest',
      variant: isMobile ? 'compact' : 'wide',
      mode: 'split',
      modeOptions: { split: 'bridge' },
      appearance: resolvedTheme === 'light' ? 'light' : 'dark',
      fromChain: initialFromChain,
      fromToken: initialFromToken,
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
        from: { allow: LIFI_FROM_CHAIN_IDS },
        to: { allow: [POLYGON_MAINNET_CHAIN_ID] },
      },
      disabledUI: {
        toAddress: true,
        toToken: true,
      },
      hiddenUI: {
        reverseTokensButton: true,
      },
      theme: {
        container: {
          borderRadius: '12px',
          minHeight: isMobile ? '580px' : '640px',
        },
      },
    }),
    [destinationAddress, initialFromChain, initialFromToken, isMobile, providers, resolvedTheme, siteName],
  )

  return (
    <div className="space-y-3">
      <div className="space-y-1 text-center text-xs text-muted-foreground">
        <p>{t('Select the wallet and network holding your funds.')}</p>
        <p>{t('Funds will arrive in your Polygon deposit wallet.')}</p>
      </div>
      <div className="w-full overflow-hidden rounded-xl">
        {hasHydrated ? <LiFiWidget integrator="kuest" config={config} /> : <WidgetSkeleton config={config} />}
      </div>
    </div>
  )
}
