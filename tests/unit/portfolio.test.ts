import { afterEach, describe, expect, it, mock } from 'bun:test'

import { fetchPortfolioSnapshot } from '@/lib/portfolio'

import { stubGlobal, unstubAllGlobals } from '../bun-test-helpers'

describe('fetchPortfolioSnapshot', () => {
  const originalDataUrl = process.env.DATA_URL

  afterEach(() => {
    unstubAllGlobals()
    if (originalDataUrl === undefined) {
      delete process.env.DATA_URL
    } else {
      process.env.DATA_URL = originalDataUrl
    }
  })

  it('uses the one-day PnL change and requests only the biggest closed position', async () => {
    stubGlobal('window', undefined)
    process.env.DATA_URL = 'https://data-api.test'

    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input instanceof URL ? input.toString() : input)
      if (url.pathname === '/value') {
        return Response.json([{ value: 25 }])
      }
      if (url.pathname === '/traded') {
        return Response.json({ traded: 75 })
      }
      if (url.pathname === '/user-pnl') {
        return Response.json([
          { t: 200, p: 27.5 },
          { t: 100, p: 20 },
        ])
      }
      if (url.pathname === '/closed-positions') {
        return Response.json([{ realizedPnl: 99 }])
      }
      return new Response(null, { status: 404 })
    })
    stubGlobal('fetch', fetchMock)

    await expect(fetchPortfolioSnapshot(`0x${'a'.repeat(40)}`)).resolves.toEqual({
      positionsValue: 25,
      profitLoss: 7.5,
      predictions: 75,
      biggestWin: 99,
    })

    const urls = fetchMock.mock.calls.map(
      ([input]) => new URL(input instanceof Request ? input.url : input instanceof URL ? input.toString() : input),
    )
    const closedUrls = urls.filter((url) => url.pathname === '/closed-positions')
    expect(closedUrls).toHaveLength(1)
    expect(Object.fromEntries(closedUrls[0].searchParams)).toEqual({
      limit: '1',
      offset: '0',
      sortBy: 'REALIZEDPNL',
      sortDirection: 'DESC',
      user: `0x${'a'.repeat(40)}`,
    })
    const pnlUrl = urls.find((url) => url.pathname === '/user-pnl')
    expect(pnlUrl?.origin).toBe('https://data-api.test')
    expect(pnlUrl?.searchParams.get('user_address')).toBe(`0x${'a'.repeat(40)}`)
    expect(pnlUrl?.searchParams.get('interval')).toBe('1d')
    expect(pnlUrl?.searchParams.get('fidelity')).toBe('1h')
  })

  it('discards malformed PnL points before calculating the one-day change', async () => {
    stubGlobal('window', undefined)
    process.env.DATA_URL = 'https://data-api.test'

    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input instanceof URL ? input.toString() : input)
      if (url.pathname === '/value') {
        return Response.json([{ value: 0 }])
      }
      if (url.pathname === '/traded') {
        return Response.json({ traded: 0 })
      }
      if (url.pathname === '/closed-positions') {
        return Response.json([])
      }
      if (url.pathname === '/user-pnl') {
        return Response.json([
          { t: '300', p: '30' },
          { t: 'not-a-timestamp', p: '1000' },
          { t: 250, p: '20not-a-number' },
          { t: null, p: 999 },
          { t: 200, p: '20' },
          { t: 100, p: 10 },
          { t: Infinity, p: 500 },
          { t: 50, p: '' },
        ])
      }
      return new Response(null, { status: 404 })
    })
    stubGlobal('fetch', fetchMock)

    await expect(fetchPortfolioSnapshot(`0x${'b'.repeat(40)}`)).resolves.toMatchObject({
      profitLoss: 20,
    })
    const pnlUrl = fetchMock.mock.calls
      .map(([input]) => new URL(input instanceof Request ? input.url : input instanceof URL ? input.toString() : input))
      .find((url) => url.pathname === '/user-pnl')
    expect(pnlUrl?.origin).toBe('https://data-api.test')
    expect(pnlUrl?.searchParams.get('user_address')).toBe(`0x${'b'.repeat(40)}`)
  })
})
