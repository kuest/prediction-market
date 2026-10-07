import { SIWXUtil } from '@reown/appkit-controllers'
import * as actualAppKitControllers from '@reown/appkit-controllers'
import * as actualAppKitSiwe from '@reown/appkit-siwe'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'

import { hoisted, spyOn, stubGlobal, unstubAllGlobals } from '../bun-test-helpers'

function ReadyConsumer({ ctx, onValue }: { ctx: React.Context<any>; onValue?: (value: any) => void }) {
  const value = React.use(ctx)
  onValue?.(value)
  return React.createElement('div', { 'data-testid': 'ready' }, value.isReady ? 'yes' : 'no')
}

const mocks = hoisted(() => ({
  chainControllerGetActiveCaipAddress: mock(),
  createAppKit: mock(),
  createSIWEConfig: mock(),
  setThemeMode: mock(),
  siweClientSignIn: mock(),
  siwxRequestSignMessage: mock(),
  useAppKitAccount: mock(),
  useSignMessage: mock(),
  WagmiProvider: mock(({ children }: any) => children),
}))

let providerImportId = 0

async function importAppKitProvider() {
  return (await import(`@/providers/AppKitProvider?test=${++providerImportId}`)).default
}

void mock.module('@reown/appkit/react', () => ({
  __esModule: true,
  createAppKit: mocks.createAppKit,
  useAppKitAccount: mocks.useAppKitAccount,
  useAppKitTheme: () => ({ setThemeMode: mocks.setThemeMode }),
}))

void mock.module('@reown/appkit-controllers', () => {
  return {
    ...actualAppKitControllers,
    ChainController: {
      ...actualAppKitControllers.ChainController,
      getActiveCaipAddress: mocks.chainControllerGetActiveCaipAddress,
    },
    SIWXUtil: {
      ...actualAppKitControllers.SIWXUtil,
      requestSignMessage: mocks.siwxRequestSignMessage,
    },
  }
})

void mock.module('@reown/appkit-siwe', () => {
  return {
    ...actualAppKitSiwe,
    createSIWEConfig: mocks.createSIWEConfig,
  }
})

void mock.module('@/lib/appkit', () => ({
  __esModule: true,
  createAppKitWagmiAdapter: mock(() => ({ wagmiConfig: {} })),
  defaultNetwork: { id: 1 },
  networks: [{ id: 1 }],
}))

void mock.module('@/hooks/usePublicRuntimeConfig', () => ({
  usePublicRuntimeConfig: () => ({
    reownAppKitProjectId: 'test-project',
    siteUrl: 'https://markets.test',
  }),
}))

void mock.module('wagmi', () => ({
  WagmiProvider: mocks.WagmiProvider,
  useConnections: () => [],
  useSignMessage: mocks.useSignMessage,
}))

void mock.module('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
}))

void mock.module('next-intl', () => ({
  useExtracted: () => (value: string) => value,
}))

void mock.module('next/navigation', () => ({
  redirect: mock(),
}))

void mock.module('next/dynamic', () => ({
  __esModule: true,
  default: (loader: () => Promise<{ default: React.ComponentType<any> }>) => {
    const LazyComponent = React.lazy(loader)
    return function MockDynamicComponent(props: Record<string, unknown>) {
      return React.createElement(React.Suspense, { fallback: null }, React.createElement(LazyComponent, props))
    }
  },
}))

void mock.module('@/lib/auth-client', () => ({
  authClient: {
    getSession: mock().mockResolvedValue({ data: { user: null } }),
    signOut: mock(),
    siwe: {
      nonce: mock(),
      verify: mock().mockResolvedValue({ data: { success: true } }),
    },
  },
}))

describe('appKitProvider SSR guard', () => {
  beforeEach(() => {
    unstubAllGlobals()
    mocks.chainControllerGetActiveCaipAddress.mockReset()
    mocks.chainControllerGetActiveCaipAddress.mockReturnValue('eip155:1:0x123')
    mocks.createAppKit.mockReset()
    mocks.createSIWEConfig.mockReset()
    mocks.createSIWEConfig.mockImplementation((config) => ({ ...config, signIn: mocks.siweClientSignIn }))
    mocks.setThemeMode.mockReset()
    mocks.siweClientSignIn.mockReset()
    mocks.siweClientSignIn.mockImplementation(() =>
      SIWXUtil.requestSignMessage().then(() => ({ address: '0x123', chainId: 1 })),
    )
    mocks.siwxRequestSignMessage.mockReset()
    mocks.siwxRequestSignMessage.mockResolvedValue(undefined)
    mocks.useAppKitAccount.mockReset()
    mocks.useAppKitAccount.mockReturnValue({
      address: undefined,
      embeddedWalletInfo: undefined,
      isConnected: false,
    })
    mocks.WagmiProvider.mockClear()
  })

  afterEach(() => {
    unstubAllGlobals()
  })

  it('initializes AppKit in the browser and synchronizes theme', async () => {
    const appKitInstance = {
      open: mock(),
      close: mock(),
    }
    mocks.createAppKit.mockReturnValueOnce(appKitInstance)

    const { AppKitContext } = await import('@/hooks/useAppKit')
    const AppKitProvider = await importAppKitProvider()

    let latestValue: any = null
    function handleValue(value: any) {
      latestValue = value
    }

    const view = render(
      React.createElement(
        AppKitProvider,
        null,
        React.createElement(ReadyConsumer, { ctx: AppKitContext, onValue: handleValue }),
      ),
    )

    await waitFor(() => {
      expect(mocks.createAppKit).toHaveBeenCalledTimes(1)
      expect(mocks.createAppKit).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultNetwork: { id: 1 },
          networks: [{ id: 1 }],
        }),
      )
      expect(mocks.createSIWEConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          signOutOnAccountChange: false,
          signOutOnNetworkChange: false,
        }),
      )
      expect(mocks.setThemeMode).toHaveBeenCalledWith('dark')
      expect(mocks.WagmiProvider.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          config: {},
        }),
      )
      expect(screen.getByTestId('ready')).toHaveTextContent('yes')
      expect(latestValue?.isReady).toBe(true)
    })

    await act(async () => {
      await latestValue.open()
    })

    await waitFor(() => {
      expect(appKitInstance.open).toHaveBeenCalled()
    })

    await act(async () => {
      await latestValue.close()
    })
    expect(appKitInstance.close).toHaveBeenCalled()

    view.rerender(
      React.createElement(
        AppKitProvider,
        null,
        React.createElement(ReadyConsumer, { ctx: AppKitContext, onValue: handleValue }),
      ),
    )

    expect(mocks.createAppKit).toHaveBeenCalledTimes(1)
  })

  it('keeps defaults when AppKit initialization fails', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mocks.createAppKit.mockImplementationOnce(() => {
        throw new Error('boom')
      })

      const { AppKitContext } = await import('@/hooks/useAppKit')
      const AppKitProvider = await importAppKitProvider()
      let latestValue: any = null
      function handleValue(value: any) {
        latestValue = value
      }

      render(
        React.createElement(
          AppKitProvider,
          null,
          React.createElement(ReadyConsumer, { ctx: AppKitContext, onValue: handleValue }),
        ),
      )

      await act(async () => {
        await latestValue.open()
      })

      await waitFor(() => {
        expect(mocks.createAppKit).toHaveBeenCalled()
        expect(warnSpy).toHaveBeenCalled()
        expect(screen.getByTestId('ready')).toHaveTextContent('no')
      })
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('automatically starts SIWE after an external wallet connects', async () => {
    mocks.createAppKit.mockReturnValueOnce({
      open: mock(),
      close: mock(),
    })
    mocks.useAppKitAccount.mockReturnValue({
      address: '0x123',
      embeddedWalletInfo: undefined,
      isConnected: true,
    })

    const { AppKitContext } = await import('@/hooks/useAppKit')
    const AppKitProvider = await importAppKitProvider()

    render(React.createElement(AppKitProvider, null, React.createElement(ReadyConsumer, { ctx: AppKitContext })))

    await waitFor(
      () => {
        expect(mocks.siwxRequestSignMessage).toHaveBeenCalledTimes(1)
      },
      { timeout: 2000 },
    )
  })

  it('deduplicates the complete SIWE sign-in orchestration', async () => {
    let releaseSignIn: (() => void) | undefined
    mocks.siwxRequestSignMessage.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseSignIn = resolve
        }),
    )
    mocks.createAppKit.mockReturnValueOnce({
      open: mock(),
      close: mock(),
    })
    mocks.useAppKitAccount.mockReturnValue({
      address: '0x123',
      embeddedWalletInfo: undefined,
      isConnected: true,
    })

    const { AppKitContext } = await import('@/hooks/useAppKit')
    const AppKitProvider = await importAppKitProvider()

    const view = render(
      React.createElement(AppKitProvider, null, React.createElement(ReadyConsumer, { ctx: AppKitContext })),
    )

    await waitFor(
      () => {
        expect(mocks.siwxRequestSignMessage).toHaveBeenCalledTimes(1)
        expect(mocks.siweClientSignIn).toHaveBeenCalledTimes(1)
      },
      { timeout: 2000 },
    )

    const siweClient = mocks.createSIWEConfig.mock.results[0]?.value as { signIn: () => Promise<unknown> }
    const manualSignIn = siweClient.signIn()
    expect(mocks.siweClientSignIn).toHaveBeenCalledTimes(1)
    expect(mocks.siwxRequestSignMessage).toHaveBeenCalledTimes(1)

    releaseSignIn?.()
    await manualSignIn
    view.unmount()
  })

  it('does not share a pending SIWE sign-in between different accounts', async () => {
    const pendingSignatures: Array<() => void> = []
    mocks.siwxRequestSignMessage.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          pendingSignatures.push(resolve)
        }),
    )
    mocks.createAppKit.mockReturnValueOnce({
      open: mock(),
      close: mock(),
    })
    mocks.useAppKitAccount.mockReturnValue({
      address: '0x123',
      embeddedWalletInfo: undefined,
      isConnected: true,
    })

    const { AppKitContext } = await import('@/hooks/useAppKit')
    const AppKitProvider = await importAppKitProvider()

    const view = render(
      React.createElement(AppKitProvider, null, React.createElement(ReadyConsumer, { ctx: AppKitContext })),
    )

    await waitFor(
      () => {
        expect(mocks.siwxRequestSignMessage).toHaveBeenCalledTimes(1)
      },
      { timeout: 2000 },
    )

    mocks.chainControllerGetActiveCaipAddress.mockReturnValue('eip155:1:0x456')
    mocks.useAppKitAccount.mockReturnValue({
      address: '0x456',
      embeddedWalletInfo: undefined,
      isConnected: true,
    })
    view.rerender(React.createElement(AppKitProvider, null, React.createElement(ReadyConsumer, { ctx: AppKitContext })))

    await waitFor(
      () => {
        expect(mocks.siwxRequestSignMessage).toHaveBeenCalledTimes(2)
        expect(mocks.siweClientSignIn).toHaveBeenCalledTimes(2)
      },
      { timeout: 2000 },
    )
    expect(pendingSignatures).toHaveLength(2)
    pendingSignatures.forEach((release) => release())
    view.unmount()
  })

  it('retries automatic SIWE when the previous attempt is cancelled', async () => {
    mocks.createAppKit.mockReturnValueOnce({
      open: mock(),
      close: mock(),
    })
    mocks.useAppKitAccount.mockReturnValue({
      address: '0x123',
      embeddedWalletInfo: undefined,
      isConnected: true,
    })

    const { AppKitContext } = await import('@/hooks/useAppKit')
    const AppKitProvider = await importAppKitProvider()

    const view = render(
      React.createElement(AppKitProvider, null, React.createElement(ReadyConsumer, { ctx: AppKitContext })),
    )

    await new Promise((resolve) => setTimeout(resolve, 25))
    view.rerender(React.createElement(AppKitProvider, null, React.createElement(ReadyConsumer, { ctx: AppKitContext })))

    await waitFor(
      () => {
        expect(mocks.siwxRequestSignMessage).toHaveBeenCalledTimes(1)
      },
      { timeout: 2000 },
    )
    view.unmount()
  })

  it('does not automatically start SIWE when the current region is blocked', async () => {
    const fetchMock = mock().mockResolvedValue({
      ok: true,
      json: async () => ({ blocked: true }),
    })
    stubGlobal('fetch', fetchMock)
    mocks.createAppKit.mockReturnValueOnce({
      open: mock(),
      close: mock(),
    })
    mocks.useAppKitAccount.mockReturnValue({
      address: '0x123',
      embeddedWalletInfo: undefined,
      isConnected: true,
    })

    const { AppKitContext } = await import('@/hooks/useAppKit')
    const AppKitProvider = await importAppKitProvider()

    render(React.createElement(AppKitProvider, null, React.createElement(ReadyConsumer, { ctx: AppKitContext })))

    await waitFor(
      () => {
        expect(fetchMock).toHaveBeenCalledWith('/api/geoblock-status', {
          cache: 'no-store',
          headers: { accept: 'application/json' },
        })
      },
      { timeout: 2000 },
    )
    expect(mocks.siwxRequestSignMessage).not.toHaveBeenCalled()
  })

  it('shares the in-flight SIWE request with the manual Sign action', async () => {
    let releaseSignIn: (() => void) | undefined
    mocks.siwxRequestSignMessage.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseSignIn = resolve
        }),
    )
    mocks.createAppKit.mockImplementationOnce(() => {
      return {
        open: mock(),
        close: mock(),
      }
    })
    mocks.useAppKitAccount.mockReturnValue({
      address: '0x123',
      embeddedWalletInfo: undefined,
      isConnected: true,
    })

    const { AppKitContext } = await import('@/hooks/useAppKit')
    const AppKitProvider = await importAppKitProvider()

    const view = render(
      React.createElement(AppKitProvider, null, React.createElement(ReadyConsumer, { ctx: AppKitContext })),
    )

    await waitFor(
      () => {
        expect(mocks.siwxRequestSignMessage).toHaveBeenCalledTimes(1)
      },
      { timeout: 2000 },
    )

    const manualSignIn = SIWXUtil.requestSignMessage()
    expect(mocks.siwxRequestSignMessage).toHaveBeenCalledTimes(1)
    releaseSignIn?.()
    await manualSignIn
    view.unmount()
  })
})
