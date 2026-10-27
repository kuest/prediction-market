import { afterEach, describe, expect, it } from 'bun:test'

import { buildDataApiUrl, getDataApiUrl } from '@/lib/data-api/client'

import { stubEnv, stubGlobal, unstubAllEnvs, unstubAllGlobals } from '../bun-test-helpers'

describe('Data API URL resolution', () => {
  afterEach(() => {
    unstubAllGlobals()
    unstubAllEnvs()
    delete window.__PUBLIC_RUNTIME_CONFIG__
  })

  it('preserves a Data API path prefix and query parameters with an explicit client base', () => {
    const params = new URLSearchParams({
      user_address: '0xabc',
      interval: 'all',
      fidelity: '12h',
    })

    expect(buildDataApiUrl('/user-pnl', params, 'https://data-api.test/gateway/')).toBe(
      'https://data-api.test/gateway/user-pnl?user_address=0xabc&interval=all&fidelity=12h',
    )
    expect(buildDataApiUrl('value', 'user=0xabc', 'https://data-api.test/gateway///')).toBe(
      'https://data-api.test/gateway/value?user=0xabc',
    )
  })

  it('uses the mainnet runtime URL in the browser even when the build environment differs', () => {
    stubEnv('CHAIN_ID', '80002')
    stubEnv('DATA_URL', 'https://wrong-build.example')
    window.__PUBLIC_RUNTIME_CONFIG__ = { chainId: 137, dataUrl: 'https://data-api.kuest.com' }

    expect(getDataApiUrl()).toBe('https://data-api.kuest.com')
    expect(buildDataApiUrl('/positions', new URLSearchParams({ user: '0xabc' }))).toBe(
      'https://data-api.kuest.com/positions?user=0xabc',
    )
  })

  it('uses the Amoy runtime URL for an Amoy browser session', () => {
    window.__PUBLIC_RUNTIME_CONFIG__ = { chainId: 80_002, dataUrl: 'https://data-api-staging.kuest.com' }

    expect(buildDataApiUrl('/positions')).toBe('https://data-api-staging.kuest.com/positions')
  })

  it('uses a custom runtime URL and removes its trailing slash', () => {
    window.__PUBLIC_RUNTIME_CONFIG__ = { dataUrl: ' https://custom.example/data/ ' }

    expect(buildDataApiUrl('positions', 'limit=50')).toBe('https://custom.example/data/positions?limit=50')
  })

  it('reads browser runtime config without process.env', () => {
    window.__PUBLIC_RUNTIME_CONFIG__ = { dataUrl: 'https://data-api.kuest.com' }
    stubGlobal('process', undefined)

    expect(getDataApiUrl()).toBe('https://data-api.kuest.com')
  })

  it('keeps server-side network defaults and custom DATA_URL overrides', () => {
    stubGlobal('window', undefined)
    stubEnv('CHAIN_ID', '137')
    stubEnv('DATA_URL', '')
    expect(getDataApiUrl()).toBe('https://data-api.kuest.com')

    stubEnv('CHAIN_ID', '80002')
    expect(getDataApiUrl()).toBe('https://data-api-staging.kuest.com')

    stubEnv('DATA_URL', 'https://custom.example/data')
    expect(getDataApiUrl()).toBe('https://custom.example/data')
  })
})
