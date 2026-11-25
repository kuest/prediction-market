import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'

import { resolveMarketAssetUrl, resolveRemoteAssetReference } from '@/lib/image/asset-reference'
import { getOptimizedImageRemotePatterns } from '@/lib/image/image-optimization'
import { fetchMarketAssetMetadata, RetryableMarketSyncError } from '@/lib/sync/market-asset-metadata'

import { stubEnv, stubGlobal, unstubAllEnvs, unstubAllGlobals } from '../bun-test-helpers'

const id = 'A'.repeat(43)
const assetUrl = `https://assets.kuest.com/${id}`
const operatorAssetUrl = `https://assets.operator.example/${id}`
const metadata = { name: 'Q', slug: 'q', event: { slug: 'event' } }

afterEach(() => {
  mock.restore()
  unstubAllEnvs()
  unstubAllGlobals()
})

describe('asset URLs', () => {
  it('resolves a bare ID and preserves full external and local image URLs', () => {
    expect(resolveMarketAssetUrl(id)).toBe(assetUrl)
    expect(resolveMarketAssetUrl(assetUrl)).toBe(assetUrl)
    expect(resolveMarketAssetUrl('https://cdn.example.com/photo.png?v=1')).toBe('https://cdn.example.com/photo.png?v=1')
    expect(resolveMarketAssetUrl('/images/logo.png')).toBe('/images/logo.png')
    expect(resolveRemoteAssetReference('/images/logo.png')).toBeNull()
  })

  it('does not resolve legacy schemes, gateway hosts, or invalid references', () => {
    expect(resolveMarketAssetUrl(`irys://${id}`)).toBeNull()
    expect(resolveMarketAssetUrl(`//gateway.irys.xyz./${id}`)).toBeNull()
    expect(resolveMarketAssetUrl('https://user@cdn.example.com/photo.png')).toBeNull()
    expect(resolveMarketAssetUrl('javascript:alert(1)')).toBeNull()
  })

  it('uses the public runtime hostname for bare IDs and canonical URLs without changing external images', () => {
    stubEnv('ASSETS_URL', 'https://assets.wrong-build.example')
    stubGlobal('window', { __PUBLIC_RUNTIME_CONFIG__: { assetsUrl: 'https://assets.operator.example' } })
    expect(resolveMarketAssetUrl(id)).toBe(operatorAssetUrl)
    expect(resolveMarketAssetUrl(`${assetUrl}?v=1`)).toBe(`${operatorAssetUrl}?v=1`)
    expect(resolveMarketAssetUrl(operatorAssetUrl)).toBe(operatorAssetUrl)
    expect(resolveMarketAssetUrl('https://images.example/photo.png')).toBe('https://images.example/photo.png')
    expect(resolveMarketAssetUrl('/images/logo.png')).toBe('/images/logo.png')
  })

  it('allows the registered origin and exact operator host and port, never the retired host', () => {
    expect(
      getOptimizedImageRemotePatterns({
        ASSETS_URL: 'https://assets.operator.example:8443',
        S3_PUBLIC_URL: 'https://gateway.irys.xyz',
      }),
    ).toEqual([
      { protocol: 'https', hostname: 'assets.kuest.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'assets.operator.example', port: '8443', pathname: '/**' },
      { protocol: 'https', hostname: '*.supabase.co', port: '', pathname: '/**' },
    ])
  })
})

describe('market metadata transport', () => {
  it('fetches only the Assets URL and parses current metadata', async () => {
    const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(metadata))
    expect(await fetchMarketAssetMetadata(id)).toEqual(metadata)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(assetUrl)
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe('error')
  })

  it('treats missing legacy metadata and malformed JSON as terminal', async () => {
    const fetchMock = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response('not JSON'))
    const missing = await fetchMarketAssetMetadata(id).catch((error) => error)
    expect(missing).toBeInstanceOf(Error)
    expect(missing).not.toBeInstanceOf(RetryableMarketSyncError)
    expect(missing.message).toContain('HTTP 404')
    await expect(fetchMarketAssetMetadata(id)).rejects.toBeInstanceOf(SyntaxError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fetches metadata only from the configured operator proxy, with no second origin after a 404', async () => {
    stubEnv('ASSETS_URL', 'https://assets.operator.example:8443/')
    const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(fetchMarketAssetMetadata(id)).rejects.toThrow('HTTP 404')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`https://assets.operator.example:8443/${id}`)
  })

  it('retries transient HTTP statuses and network or response-body errors via the existing cursor branch', async () => {
    const brokenBody = new ReadableStream({
      start: (controller) => controller.error(new Error('connection reset')),
    })
    const fetchMock = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(brokenBody))
    for (let retryable = 0; retryable < 4; retryable++) {
      await expect(fetchMarketAssetMetadata(id)).rejects.toBeInstanceOf(RetryableMarketSyncError)
    }
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
