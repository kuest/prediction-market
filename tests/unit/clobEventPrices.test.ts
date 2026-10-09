import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'

import { EVENT_PRICES_TIMEOUT_MS, fetchOutcomePrices, isPrerenderAbortError } from '@/lib/clob-event-prices'

import { stubEnv, stubGlobal, unstubAllEnvs, unstubAllGlobals } from '../bun-test-helpers'

describe('event display prices', () => {
  afterEach(() => {
    mock.restore()
    unstubAllEnvs()
    unstubAllGlobals()
  })

  it.each([401, 403, 404, 405, 429, 500, 502, 503])(
    'avoids individual retries and further batches after HTTP %s',
    async (status) => {
      const fetchMock = mock().mockResolvedValue(new Response(null, { status }))
      stubGlobal('fetch', fetchMock)

      const prices = await fetchOutcomePrices(Array.from({ length: 501 }, (_, index) => `token-${index}`))

      expect(prices.size).toBe(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['timeout', 'network error', 'HTTP 408'])(
    'fetches later batches after a %s without individual retries',
    async (failure) => {
      const logSpy = spyOn(console, 'error').mockImplementation(() => {})
      const tokenIds = Array.from({ length: 1001 }, (_, index) => `token-${index}`)
      const fetchMock = mock((_url: string, options: RequestInit) => {
        const tokens = JSON.parse(options.body as string) as Array<{ token_id: string }>
        return Promise.resolve(
          Response.json(Object.fromEntries(tokens.map(({ token_id }) => [token_id, { BUY: '0.64' }]))),
        )
      })
      fetchMock.mockImplementationOnce(() => {
        if (failure === 'HTTP 408') {
          return Promise.resolve(new Response(null, { status: 408 }))
        }
        const error =
          failure === 'timeout'
            ? Object.assign(new Error('Request timed out'), { name: 'TimeoutError' })
            : new TypeError('Network request failed')
        return Promise.reject(error)
      })
      stubGlobal('fetch', fetchMock)

      const prices = await fetchOutcomePrices(tokenIds)

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(prices.size).toBe(501)
      expect(prices.has('token-0')).toBe(false)
      expect(prices.get('token-500')).toEqual({ buy: 0.64, sell: 0.64 })
      expect(prices.get('token-1000')).toEqual({ buy: 0.64, sell: 0.64 })
      expect(logSpy).toHaveBeenCalledTimes(failure === 'network error' ? 1 : 0)
    },
  )

  it('keeps available prices and only retries tokens missing from a successful batch', async () => {
    stubEnv('CLOB_URL', 'https://clob.example')
    const fetchMock = mock()
      .mockResolvedValueOnce(Response.json({ a: { BUY: '0.64', SELL: '0.60' } }))
      .mockResolvedValueOnce(Response.json({ b: { SELL: '0.25' } }))
    stubGlobal('fetch', fetchMock)

    const prices = await fetchOutcomePrices(['a', 'b', 'a', ''])

    expect(prices.get('a')).toEqual({ buy: 0.64, sell: 0.6 })
    expect(prices.get('b')).toEqual({ buy: 0.25, sell: 0.25 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://clob.example/prices',
      expect.objectContaining({
        body: JSON.stringify([{ token_id: 'a' }, { token_id: 'b' }]),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://clob.example/prices',
      expect.objectContaining({
        body: JSON.stringify([{ token_id: 'b' }]),
      }),
    )
  })

  it('can recover individual prices after a rejected bulk payload', async () => {
    const fetchMock = mock()
      .mockResolvedValueOnce(new Response(null, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ a: { BUY: '0.64', SELL: '0.60' } }))
    stubGlobal('fetch', fetchMock)

    expect((await fetchOutcomePrices(['a'])).get('a')).toEqual({ buy: 0.64, sell: 0.6 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retains prices already loaded when a later batch fails', async () => {
    const tokenIds = Array.from({ length: 501 }, (_, index) => `token-${index}`)
    const batchPrices = Object.fromEntries(tokenIds.slice(0, 500).map((tokenId) => [tokenId, { BUY: '0.64' }]))
    const fetchMock = mock()
      .mockResolvedValueOnce(Response.json(batchPrices))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
    stubGlobal('fetch', fetchMock)

    const prices = await fetchOutcomePrices(tokenIds)

    expect(prices.size).toBe(500)
    expect(prices.get('token-0')).toEqual({ buy: 0.64, sell: 0.64 })
    expect(prices.has('token-500')).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([401, 403, 404, 405, 429, 500, 502, 503])(
    'keeps successful prices and fetches later batches after an individual HTTP %s failure',
    async (status) => {
      const tokenIds = Array.from({ length: 501 }, (_, index) => `token-${index}`)
      const batchPrices = Object.fromEntries(tokenIds.slice(2, 500).map((tokenId) => [tokenId, { BUY: '0.64' }]))
      const fetchMock = mock()
        .mockResolvedValueOnce(Response.json(batchPrices))
        .mockResolvedValueOnce(new Response(null, { status }))
        .mockResolvedValueOnce(Response.json({ 'token-1': { BUY: '0.25' } }))
        .mockResolvedValueOnce(Response.json({ 'token-500': { BUY: '0.75' } }))
      stubGlobal('fetch', fetchMock)

      const prices = await fetchOutcomePrices(tokenIds)

      expect(prices.size).toBe(500)
      expect(prices.has('token-0')).toBe(false)
      expect(prices.get('token-1')).toEqual({ buy: 0.25, sell: 0.25 })
      expect(prices.get('token-500')).toEqual({ buy: 0.75, sell: 0.75 })
      expect(fetchMock).toHaveBeenCalledTimes(4)
    },
  )

  it.each([
    { digest: 'HANGING_PROMISE_REJECTION' },
    { name: 'AbortError' },
    { code: 'UND_ERR_ABORTED' },
    { message: 'During prerendering, fetch() rejects when the prerender is complete.' },
  ])('stops later batches after an individual prerender cancellation: %j', async (error) => {
    const logSpy = spyOn(console, 'error').mockImplementation(() => {})
    const tokenIds = Array.from({ length: 501 }, (_, index) => `token-${index}`)
    const batchPrices = Object.fromEntries(tokenIds.slice(2, 500).map((tokenId) => [tokenId, { BUY: '0.64' }]))
    const fetchMock = mock()
      .mockResolvedValueOnce(Response.json(batchPrices))
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(Response.json({ 'token-1': { BUY: '0.25' } }))
    stubGlobal('fetch', fetchMock)

    const prices = await fetchOutcomePrices(tokenIds)

    expect(prices.size).toBe(499)
    expect(prices.get('token-1')).toEqual({ buy: 0.25, sell: 0.25 })
    expect(prices.has('token-500')).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('cancels a stalled request without launching individual retries', async () => {
    const createTimeoutSignal = AbortSignal.timeout.bind(AbortSignal)
    const timeoutSpy = spyOn(AbortSignal, 'timeout').mockImplementation(() => createTimeoutSignal(10))
    const logSpy = spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = mock()
      .mockImplementationOnce(
        (_url: string, options: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true })
          }),
      )
      .mockResolvedValueOnce(Response.json({ 'token-500': { BUY: '0.25' } }))
    stubGlobal('fetch', fetchMock)

    const prices = await fetchOutcomePrices(Array.from({ length: 501 }, (_, index) => `token-${index}`))
    expect(prices.size).toBe(1)
    expect(prices.get('token-500')).toEqual({ buy: 0.25, sell: 0.25 })
    expect(timeoutSpy).toHaveBeenCalledWith(EVENT_PRICES_TIMEOUT_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('does not retry or log a prerender cancellation', async () => {
    const logSpy = spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = mock().mockRejectedValue({ digest: 'HANGING_PROMISE_REJECTION' })
    stubGlobal('fetch', fetchMock)

    expect((await fetchOutcomePrices(Array.from({ length: 501 }, (_, index) => `token-${index}`))).size).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('does not query prices for empty token lists', async () => {
    const fetchMock = mock()
    stubGlobal('fetch', fetchMock)

    expect((await fetchOutcomePrices([''])).size).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('shared prerender abort classification', () => {
  it.each([
    { digest: 'HANGING_PROMISE_REJECTION' },
    { name: 'AbortError' },
    { code: 'UND_ERR_ABORTED' },
    { message: 'During prerendering, fetch() rejects when the prerender is complete.' },
  ])('recognizes cancellation: %j', (error) => {
    expect(isPrerenderAbortError(error)).toBe(true)
  })

  it.each([null, { name: 'TimeoutError' }, new TypeError('Network request failed')])(
    'does not treat %j as prerender cancellation',
    (error) => {
      expect(isPrerenderAbortError(error)).toBe(false)
    },
  )
})
