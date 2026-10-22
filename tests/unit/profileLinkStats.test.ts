import { afterEach, describe, expect, it, mock } from 'bun:test'

import { fetchProfileLinkStats } from '@/lib/data-api/profile-link-stats'
import { resolvePublicRuntimeEnv } from '@/lib/public-runtime-config.shared'

import {
  advanceTimersByTimeAsync,
  stubGlobal,
  unstubAllGlobals,
  useFakeTimers,
  useRealTimers,
} from '../bun-test-helpers'

describe('profileLinkStats', () => {
  afterEach(() => {
    unstubAllGlobals()
    useRealTimers()
  })

  it('uses user-pnl for profit/loss and the reconciled volume aggregate', async () => {
    const address = '0x0000000000000000000000000000000000000001'
    const fetchMock = mock(async (input: string | URL | Request) => {
      const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const url = new URL(requestUrl)
      let body: unknown

      if (url.pathname === '/gateway/value') {
        body = [{ value: 24.50555514 }]
      } else if (url.pathname === '/gateway/volume') {
        body = { volume: '103.792597' }
      } else if (url.pathname === '/gateway/user-pnl') {
        body = [
          { t: 200, p: 4.69 },
          { t: 100, p: 0 },
        ]
      } else {
        return new Response(null, { status: 404 })
      }

      return Response.json(body)
    })
    stubGlobal('fetch', fetchMock)

    const config = resolvePublicRuntimeEnv({
      CHAIN_ID: '137',
      DATA_URL: 'https://data-api.test/gateway/',
      USER_PNL_URL: 'https://user-pnl.test',
    })
    const stats = await fetchProfileLinkStats(address, {
      dataApiUrl: config.dataUrl,
    })

    expect(stats).toEqual({
      positionsValue: 24.50555514,
      profitLoss: 4.69,
      volume: '103.792597',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const pnlUrl = fetchMock.mock.calls
      .map(
        ([input]) => new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url),
      )
      .find((url) => url.pathname === '/gateway/user-pnl')
    expect(pnlUrl?.origin).toBe('https://data-api.test')
    expect(pnlUrl?.pathname).toBe('/gateway/user-pnl')
    expect(Object.fromEntries(pnlUrl?.searchParams ?? [])).toEqual({
      user_address: address,
      interval: 'all',
      fidelity: '12h',
    })
  })

  it('reuses a pending request after the freshness TTL has elapsed', async () => {
    useFakeTimers()
    const address = '0x0000000000000000000000000000000000000002'
    const responseResolvers: Array<(response: Response) => void> = []
    const fetchMock = mock(
      () =>
        new Promise<Response>((resolve) => {
          responseResolvers.push(resolve)
        }),
    )
    stubGlobal('fetch', fetchMock)

    const options = {
      dataApiUrl: 'https://data-api-delayed.test',
    }
    const firstRequest = fetchProfileLinkStats(address, options)
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(3)

    await advanceTimersByTimeAsync(2_001)
    const secondRequest = fetchProfileLinkStats(address, options)
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(3)

    for (const resolveResponse of responseResolvers) {
      resolveResponse(Response.json({ value: 10, volume: '20' }))
    }
    await expect(firstRequest).resolves.toEqual({
      positionsValue: 10,
      profitLoss: 0,
      volume: '20',
    })
    await expect(secondRequest).resolves.toEqual({
      positionsValue: 10,
      profitLoss: 0,
      volume: '20',
    })
  })
})
