import { afterEach, describe, expect, it } from 'bun:test'

import wsrvImageLoader from '@/lib/image/image-loader'

import { stubGlobal, unstubAllGlobals } from '../bun-test-helpers'

describe('wsrvImageLoader', () => {
  afterEach(unstubAllGlobals)

  it('keeps root-relative local assets on the app origin while encoding width', () => {
    expect(
      wsrvImageLoader({
        src: '/images/logo.png',
        width: 256,
        quality: 80,
      }),
    ).toBe('/images/logo.png?w=256&q=80')
  })

  it('preserves existing query params for root-relative local assets', () => {
    expect(
      wsrvImageLoader({
        src: '/images/logo.png?v=1',
        width: 128,
      }),
    ).toBe('/images/logo.png?v=1&w=128&q=75')
  })

  it('uses the Assets Worker directly without proxying through wsrv', () => {
    const assetUrl = `https://assets.kuest.com/${'A'.repeat(43)}`
    expect(
      wsrvImageLoader({
        src: assetUrl,
        width: 128,
        quality: 70,
      }),
    ).toBe(`${assetUrl}?w=128&q=70`)
  })

  it('uses the operator runtime origin for canonical Kuest artwork', () => {
    stubGlobal('window', { __PUBLIC_RUNTIME_CONFIG__: { assetsUrl: 'https://assets.operator.example:8443' } })
    const id = 'A'.repeat(43)
    expect(wsrvImageLoader({ src: `https://assets.kuest.com/${id}`, width: 128 })).toBe(
      `https://assets.operator.example:8443/${id}?w=128&q=75`,
    )
  })

  it('does not send retired URLs to the browser or optimizer', () => {
    expect(wsrvImageLoader({ src: 'https://gateway.irys.xyz/old-image', width: 128 })).toStartWith('data:image/gif;')
    expect(wsrvImageLoader({ src: 'irys://old-image', width: 128 })).toStartWith('data:image/gif;')
  })

  it('normalizes protocol-relative urls before proxying them through wsrv', () => {
    expect(
      wsrvImageLoader({
        src: '//cdn.example.com/image.png',
        width: 256,
        quality: 80,
      }),
    ).toBe('https://wsrv.nl/?url=https%3A%2F%2Fcdn.example.com%2Fimage.png&width=256&w=256&q=80&output=webp')
  })
})
