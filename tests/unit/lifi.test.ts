import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  actions: mock(),
  createClient: mock(),
  decryptSecret: mock(),
  ethereumProvider: mock(),
  getSettings: mock(),
}))

void mock.module('@lifi/sdk', () => ({
  actions: (...args: any[]) => mocks.actions(...args),
  createClient: (...args: any[]) => mocks.createClient(...args),
}))

void mock.module('@lifi/sdk-provider-ethereum', () => ({
  EthereumProvider: (...args: any[]) => mocks.ethereumProvider(...args),
}))

void mock.module('@/lib/db/queries/settings', () => ({
  SettingsRepository: {
    getSettings: (...args: any[]) => mocks.getSettings(...args),
  },
}))

void mock.module('@/lib/encryption', () => ({
  decryptSecret: (...args: any[]) => mocks.decryptSecret(...args),
}))

describe('getLiFiServerActions', () => {
  beforeEach(() => {
    mocks.actions.mockReset()
    mocks.createClient.mockReset()
    mocks.decryptSecret.mockReset()
    mocks.ethereumProvider.mockReset()
    mocks.getSettings.mockReset()

    mocks.createClient.mockImplementation((config: unknown) => ({ config }))
    mocks.ethereumProvider.mockReturnValue({ type: 'EVM' })
    mocks.actions.mockImplementation((client: unknown) => ({
      client,
      getQuote: mock(),
    }))
  })

  it('uses the default client when the first settings read fails', async () => {
    mocks.getSettings.mockResolvedValueOnce({ data: null, error: 'Temporary settings failure.' })

    const { getLiFiServerActions } = await import('@/lib/lifi')
    const lifi = await getLiFiServerActions()

    expect(lifi).toBe(mocks.actions.mock.results[0].value)
    expect(mocks.createClient).toHaveBeenCalledTimes(1)
    expect(mocks.createClient).toHaveBeenCalledWith({
      integrator: 'lifi-sdk',
      providers: [{ type: 'EVM' }],
    })
  })

  it('keeps the configured client when a later settings read fails', async () => {
    mocks.getSettings
      .mockResolvedValueOnce({
        data: {
          general: {
            lifi_integrator: { value: 'kuest-prod' },
            lifi_api_key: { value: 'enc.v1.lifi-key' },
          },
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: 'Temporary settings failure.' })
    mocks.decryptSecret.mockReturnValue('lifi-key')

    const { getLiFiServerActions } = await import('@/lib/lifi')
    const configuredLiFi = await getLiFiServerActions()
    const fallbackLiFi = await getLiFiServerActions()

    expect(fallbackLiFi).toBe(configuredLiFi)
    expect(mocks.createClient).toHaveBeenCalledTimes(1)
    expect(mocks.createClient).toHaveBeenCalledWith({
      integrator: 'kuest-prod',
      apiKey: 'lifi-key',
      providers: [{ type: 'EVM' }],
    })
  })
})
