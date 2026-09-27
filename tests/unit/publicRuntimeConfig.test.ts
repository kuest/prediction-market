import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { resolveClobUrl } from '@/lib/clob'
import { DEFAULT_LIFI_INTEGRATOR, resolveLiFiIntegrator } from '@/lib/lifi-config.shared'
import { defaultPublicRuntimeConfig, resolvePublicRuntimeEnv } from '@/lib/public-runtime-config.shared'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  getSettings: mock(),
}))

void mock.module('@/lib/db/queries/settings', () => ({
  SettingsRepository: {
    getSettings: (...args: unknown[]) => mocks.getSettings(...args),
  },
}))

const RUNTIME_ENV_KEYS_BY_CONFIG_KEY = {
  clobUrl: 'CLOB_URL',
  communityUrl: 'COMMUNITY_URL',
  createMarketUrl: 'CREATE_MARKET_URL',
  dataUrl: 'DATA_URL',
  escrowUrl: 'ESCROW_URL',
  gammaUrl: 'GAMMA_URL',
  geoblockUrl: 'GEOBLOCK_URL',
  notificationsUrl: 'NOTIFICATIONS_URL',
  chainId: 'CHAIN_ID',
  polygonRpcUrl: 'POLYGON_RPC_URL',
  polymarketGammaUrl: 'POLYMARKET_GAMMA_URL',
  priceReferenceUrl: 'PRICE_REFERENCE_URL',
  relayerUrl: 'RELAYER_URL',
  reownAppKitProjectId: 'REOWN_APPKIT_PROJECT_ID',
  sdkDownloadUrl: 'SDK_DOWNLOAD_URL',
  sentryDsn: 'SENTRY_DSN',
  userPnlUrl: 'USER_PNL_URL',
  wsClobUrl: 'WS_CLOB_URL',
  wsLiveDataUrl: 'WS_LIVE_DATA_URL',
} as const

const KUEST_DEFAULT_CONFIG_KEYS = (
  Object.keys(RUNTIME_ENV_KEYS_BY_CONFIG_KEY) as Array<keyof typeof RUNTIME_ENV_KEYS_BY_CONFIG_KEY>
).filter((key) => {
  const value = defaultPublicRuntimeConfig[key]
  return typeof value === 'string' && value.includes('.kuest.com')
})

describe('public runtime config resolution', () => {
  beforeEach(() => {
    mocks.getSettings.mockReset()
    mocks.getSettings.mockResolvedValue({ data: null, error: 'Settings unavailable.' })
  })

  it('uses Kuest defaults for blank Kuest service URLs', () => {
    const config = resolvePublicRuntimeEnv({})

    for (const key of KUEST_DEFAULT_CONFIG_KEYS) {
      expect(config[key]).toBe(defaultPublicRuntimeConfig[key])
    }
  })

  it('uses Kuest defaults when Kuest service URL env values are blank', () => {
    const env = Object.fromEntries(KUEST_DEFAULT_CONFIG_KEYS.map((key) => [RUNTIME_ENV_KEYS_BY_CONFIG_KEY[key], ' ']))
    const config = resolvePublicRuntimeEnv(env)

    for (const key of KUEST_DEFAULT_CONFIG_KEYS) {
      expect(config[key]).toBe(defaultPublicRuntimeConfig[key])
    }
  })

  it('allows Kuest service URL env values to override defaults', () => {
    const env = Object.fromEntries(
      KUEST_DEFAULT_CONFIG_KEYS.map((key) => [RUNTIME_ENV_KEYS_BY_CONFIG_KEY[key], `https://override.example/${key}`]),
    )
    const config = resolvePublicRuntimeEnv(env)

    for (const key of KUEST_DEFAULT_CONFIG_KEYS) {
      expect(config[key]).toBe(`https://override.example/${key}`)
    }
  })

  it('parses CHAIN_ID from the environment', () => {
    expect(resolvePublicRuntimeEnv({ CHAIN_ID: '137' }).chainId).toBe(137)
    expect(resolvePublicRuntimeEnv({ CHAIN_ID: ' ' }).chainId).toBe(defaultPublicRuntimeConfig.chainId)
  })

  it('uses the configured LI.FI integrator and the shared fallback', () => {
    expect(resolveLiFiIntegrator('  kuest-widget  ')).toBe('kuest-widget')
    expect(resolveLiFiIntegrator('  ')).toBe(DEFAULT_LIFI_INTEGRATOR)
    expect(defaultPublicRuntimeConfig.lifiIntegrator).toBe(DEFAULT_LIFI_INTEGRATOR)
  })

  it('selects mainnet service URLs for Polygon mainnet', () => {
    const config = resolvePublicRuntimeEnv({ CHAIN_ID: '137' })

    expect(config.clobUrl).toBe('https://clob.kuest.com')
    expect(config.communityUrl).toBe('https://community.kuest.com')
    expect(config.createMarketUrl).toBe('https://create-market.kuest.com')
    expect(config.dataUrl).toBe('https://data-api.kuest.com')
    expect(config.subgraphsUrl).toBe('https://subgraphs.kuest.com')
    expect(config.wsClobUrl).toBe('wss://ws-subscriptions-clob.kuest.com')
  })

  it('selects staging service URLs for Polygon Amoy', () => {
    const config = resolvePublicRuntimeEnv({ CHAIN_ID: '80002' })

    expect(config.clobUrl).toBe('https://clob-staging.kuest.com')
    expect(config.communityUrl).toBe('https://community-staging.kuest.com')
    expect(config.createMarketUrl).toBe('https://create-market.kuest.com')
    expect(config.dataUrl).toBe('https://data-api-staging.kuest.com')
    expect(config.subgraphsUrl).toBe('https://subgraphs-staging.kuest.com')
    expect(config.wsClobUrl).toBe('wss://ws-subscriptions-clob-staging.kuest.com')
  })

  it('uses the network-specific CLOB URL when no URL is provided', () => {
    expect(resolveClobUrl()).toBe('https://clob-staging.kuest.com')
  })

  it('resolves the LI.FI integrator and commit SHA into public runtime config', async () => {
    mocks.getSettings.mockResolvedValue({
      data: { general: { lifi_integrator: { value: 'kuest-widget' } } },
      error: null,
    })

    const { getPublicRuntimeConfig } = await import('@/lib/public-runtime-config.server')
    const config = await getPublicRuntimeConfig({
      SITE_URL: 'https://kuest.test',
      VERCEL_GIT_COMMIT_MESSAGE: 'Sync fork\n\nUpstream: abcdef1234567890',
    })

    expect(config.commitSha).toBe('abcdef1')
    expect(config.lifiIntegrator).toBe('kuest-widget')
  })
})
