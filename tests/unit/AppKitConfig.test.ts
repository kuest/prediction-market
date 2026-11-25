import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  cookieStorage: {},
  createStorage: mock(() => 'cookie-storage'),
  WagmiAdapter: mock(),
}))

void mock.module('@reown/appkit-adapter-wagmi', () => ({
  WagmiAdapter: class WagmiAdapter {
    constructor(options: unknown) {
      mocks.WagmiAdapter(options)
    }
  },
}))

void mock.module('wagmi', () => ({
  cookieStorage: mocks.cookieStorage,
  createStorage: mocks.createStorage,
}))

describe('appKit config', () => {
  beforeEach(() => {
    mocks.createStorage.mockClear()
    mocks.WagmiAdapter.mockClear()
  })

  it('configures cookie-backed SSR hydration', async () => {
    const { createAppKitWagmiAdapter, networks } = await import('@/lib/appkit')
    const { WAGMI_STORAGE_KEY } = await import('@/lib/wagmi-storage')

    createAppKitWagmiAdapter('test-project')

    expect(mocks.createStorage).toHaveBeenCalledWith({
      key: WAGMI_STORAGE_KEY,
      storage: mocks.cookieStorage,
    })
    expect(mocks.WagmiAdapter).toHaveBeenCalledWith({
      networks,
      projectId: 'test-project',
      ssr: true,
      storage: 'cookie-storage',
    })
  })
})
