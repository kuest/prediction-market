'use client'

import { ChainType, type SDKProvider } from '@lifi/sdk'
import { EthereumProvider as createEthereumProvider, type EthereumProviderOptions } from '@lifi/sdk-provider-ethereum'
import { EthereumContext, type Account, type WidgetProviderProps } from '@lifi/widget-provider'
import { useAppKitAccount } from '@reown/appkit/react'
import { type PropsWithChildren, useCallback, useMemo, useState } from 'react'
import { isAddress, type Address, type Client } from 'viem'
import { useAccount, useConfig, useConnectors } from 'wagmi'
import { connect, getBytecode, getConnectorClient, getTransactionCount, switchChain } from 'wagmi/actions'

export default function KuestLiFiEthereumProvider({ children }: PropsWithChildren<WidgetProviderProps>) {
  const wagmiConfig = useConfig()
  const account = useAccount()
  const { embeddedWalletInfo } = useAppKitAccount({ namespace: 'eip155' })
  const isEmbeddedWallet = Boolean(embeddedWalletInfo)
  const connectors = useConnectors()
  const [widgetDisconnectedAccount, setWidgetDisconnectedAccount] = useState<string | null>(null)
  const normalizedAccountAddress = account.address?.toLowerCase() ?? null
  const isWidgetAccountExplicitlyDisconnected =
    widgetDisconnectedAccount !== null &&
    (normalizedAccountAddress === null || normalizedAccountAddress === widgetDisconnectedAccount)
  const canExposeWagmiState = !isEmbeddedWallet && !isWidgetAccountExplicitlyDisconnected
  const isWidgetConnected = canExposeWagmiState && account.isConnected && Boolean(account.address)

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
        return await getBytecode(wagmiConfig, { chainId, address: address as Address })
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
        return await getTransactionCount(wagmiConfig, { chainId, address: address as Address })
      } catch {
        return undefined
      }
    },
    [wagmiConfig],
  )

  const installedWallets = useMemo(() => (activeConnector ? [activeConnector] : []), [activeConnector])
  const widgetAccount = useMemo<Account>(
    () => ({
      address: canExposeWagmiState ? account.address : undefined,
      addresses: canExposeWagmiState ? account.addresses : undefined,
      chainId: canExposeWagmiState ? account.chainId : undefined,
      chainType: ChainType.EVM,
      connector: canExposeWagmiState ? activeConnector : undefined,
      isConnected: isWidgetConnected,
      isConnecting: canExposeWagmiState ? account.isConnecting : false,
      isDisconnected: canExposeWagmiState ? account.isDisconnected : true,
      isReconnecting: canExposeWagmiState ? account.isReconnecting : false,
      status: canExposeWagmiState ? account.status : 'disconnected',
    }),
    [account, activeConnector, canExposeWagmiState, isWidgetConnected],
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

      // Reuse the site's active connection instead of reconnecting the wallet.
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
