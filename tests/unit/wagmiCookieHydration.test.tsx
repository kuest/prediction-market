import type { CreateConnectorFn } from '@wagmi/core'

import { render, screen, waitFor } from '@testing-library/react'
import { cookieStorage, createConfig, createConnector, createStorage, getAccount, serialize } from '@wagmi/core'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { http } from 'viem'
import { polygon, polygonAmoy } from 'viem/chains'
import { useAccount, WagmiProvider } from 'wagmi'

import { WAGMI_STATE_COOKIE_NAME, WAGMI_STORAGE_KEY } from '@/lib/wagmi-storage'

const walletAddress = '0x0000000000000000000000000000000000000001'

function WalletStatus() {
  const account = useAccount()
  return <span>{account.address ?? 'Disconnected'}</span>
}

function createWalletConfig(authorized = true) {
  const connect = mock(async () => ({ accounts: [walletAddress] as const, chainId: polygon.id }))
  const wallet = createConnector(() => ({
    id: 'test-wallet',
    name: 'Test Wallet',
    type: 'test',
    connect: connect as CreateConnectorFn['connect'],
    async disconnect() {},
    async getAccounts() {
      return [walletAddress] as const
    },
    async getChainId() {
      return polygon.id
    },
    async getProvider() {
      return {}
    },
    async isAuthorized() {
      return authorized
    },
    onAccountsChanged() {},
    onChainChanged() {},
    onDisconnect() {},
  }))

  const config = createConfig({
    chains: [polygonAmoy, polygon],
    connectors: [wallet],
    multiInjectedProviderDiscovery: false,
    ssr: true,
    storage: createStorage({ key: WAGMI_STORAGE_KEY, storage: cookieStorage }),
    transports: {
      [polygonAmoy.id]: http('https://rpc.invalid'),
      [polygon.id]: http('https://rpc.invalid'),
    },
  })

  return { config, connect }
}

function persistWalletCookie(config: ReturnType<typeof createWalletConfig>['config']) {
  const connector = {
    id: 'test-wallet',
    name: 'Test Wallet',
    type: 'test',
    uid: 'previous-wallet-session',
  }
  const state = {
    chainId: polygon.id,
    connections: new Map([[connector.uid, { accounts: [walletAddress], chainId: polygon.id, connector }]]),
    current: connector.uid,
  }
  const value = serialize({ state, version: config._internal.store.persist.getOptions().version })
  document.cookie = `${WAGMI_STATE_COOKIE_NAME}=${value}; path=/`
}

afterEach(() => {
  document.cookie = `${WAGMI_STATE_COOKIE_NAME}=; max-age=0; path=/`
  document.cookie = `${WAGMI_STORAGE_KEY}.recentConnectorId=; max-age=0; path=/`
})

describe('wallet cookie hydration without server cookie reads', () => {
  it('renders public content on the server and reconnects the saved wallet after mount', async () => {
    const { config, connect } = createWalletConfig()
    persistWalletCookie(config)

    const content = (
      <WagmiProvider config={config}>
        <WalletStatus />
        <main>Public markets</main>
      </WagmiProvider>
    )
    const html = renderToString(content)

    expect(html).toContain('Public markets')
    expect(html).toContain('Disconnected')
    expect(html).not.toContain(walletAddress)
    expect(getAccount(config).address).toBeUndefined()

    render(content)

    await waitFor(() => {
      expect(getAccount(config).status).toBe('connected')
      expect(getAccount(config).address).toBe(walletAddress)
      expect(getAccount(config).chainId).toBe(polygon.id)
    })
    expect(connect).toHaveBeenCalledOnce()
    expect(screen.getByText('Public markets')).toBeInTheDocument()
    expect(screen.getByText(walletAddress)).toBeInTheDocument()
  })

  it('does not expose a saved wallet when its connector is no longer authorized', async () => {
    const { config, connect } = createWalletConfig(false)
    persistWalletCookie(config)

    render(
      <WagmiProvider config={config}>
        <WalletStatus />
        <main>Public markets</main>
      </WagmiProvider>,
    )

    await waitFor(() => {
      expect(config._internal.store.persist.hasHydrated()).toBe(true)
      expect(getAccount(config).status).toBe('disconnected')
    })
    expect(connect).not.toHaveBeenCalled()
    expect(getAccount(config).address).toBeUndefined()
    expect(screen.getByText('Public markets')).toBeInTheDocument()
  })
})
