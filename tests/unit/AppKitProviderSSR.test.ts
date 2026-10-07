import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import { unstubAllGlobals } from '../bun-test-helpers'

const createAppKit = mock()

void mock.module('@reown/appkit/react', () => ({
  createAppKit,
  useAppKitAccount: mock(),
  useAppKitTheme: () => ({ setThemeMode: mock() }),
}))

void mock.module('@reown/appkit-controllers', () => ({
  ChainController: { getActiveCaipAddress: mock() },
  SIWXUtil: { requestSignMessage: mock() },
}))

void mock.module('@reown/appkit-siwe', () => ({
  createSIWEConfig: mock(),
  formatMessage: mock(),
  getAddressFromMessage: mock(),
  getDidAddress: mock(),
}))

void mock.module('@/lib/appkit', () => ({
  createAppKitWagmiAdapter: mock(() => ({ wagmiConfig: {} })),
  defaultNetwork: { id: 1 },
  networks: [{ id: 1 }],
}))

void mock.module('@/hooks/usePublicRuntimeConfig', () => ({
  usePublicRuntimeConfig: () => ({ reownAppKitProjectId: 'test-project', siteUrl: 'https://markets.test' }),
}))

void mock.module('wagmi', () => ({
  WagmiProvider: ({ children }: { children: unknown }) => children,
  useConnections: () => [],
  useSignMessage: mock(),
}))

void mock.module('next-intl', () => ({ useExtracted: () => (value: string) => value }))
void mock.module('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }))
void mock.module('@/lib/auth-client', () => ({ authClient: {} }))

describe('appKitProvider SSR guard', () => {
  beforeEach(() => {
    createAppKit.mockReset()
  })

  afterEach(() => {
    unstubAllGlobals()
  })

  it('does not initialize AppKit during SSR import', async () => {
    const globalAny = globalThis as any
    const originalWindow = globalAny.window
    globalAny.window = undefined

    try {
      await import('@/providers/AppKitProvider?ssr')
      expect(createAppKit).not.toHaveBeenCalled()
    } finally {
      globalAny.window = originalWindow
    }
  })
})
