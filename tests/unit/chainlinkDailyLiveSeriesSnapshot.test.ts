import { afterEach, describe, expect, it, mock } from 'bun:test'

import { GET } from '@/app/api/price-reference/live-series/route'

import { stubGlobal, unstubAllGlobals } from '../bun-test-helpers'

describe('Chainlink daily live-series snapshot', () => {
  afterEach(unstubAllGlobals)

  it.each([
    ['2026-11-17T17:00:00Z', '2026-11-18T17:00:00Z'],
    ['2026-03-07T17:00:00Z', '2026-03-08T16:00:00Z'],
  ])('preserves the event window %s to %s instead of UTC midnight', async (start, end) => {
    const eventStartMs = Date.parse(start)
    const eventEndMs = Date.parse(end)
    const rows = [
      {
        instrument: 'BTC/USD',
        interval: '1d',
        source: 'chainlink',
        window_start_ms: eventStartMs - 86_400_000,
        window_end_ms: eventStartMs,
        settlement_price: 100,
        source_timestamp_ms: eventStartMs,
        source_ref: 'polybolt-twap:60:btc',
        status: 'final',
      },
    ]
    const historyRequests: URL[] = []
    stubGlobal(
      'fetch',
      mock(async (input: string | URL | Request) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
        let body: unknown
        if (url.pathname === '/series-map') {
          body = {
            series: [
              { series_slug: 'chainlink-daily-test', instrument: 'BTC/USD', interval: '1d', source: 'chainlink' },
            ],
          }
        } else if (url.pathname === '/marks/latest') {
          body = { markets: [] }
        } else {
          historyRequests.push(url)
          body = {
            rows:
              url.searchParams.get('interval') === '1d'
                ? [...rows.map((row) => ({ ...row, source: 'binance', settlement_price: 999 })), ...rows]
                : [],
          }
        }
        return new Response(JSON.stringify(body))
      }),
    )
    const request = new Request(
      `https://kuest.test/api/price-reference/live-series?seriesSlug=chainlink-daily-test&eventStartMs=${eventStartMs}&eventEndMs=${eventEndMs}&activeWindowMinutes=1440`,
    )
    expect(await (await GET(request)).json()).toMatchObject({ opening_price: 100, closing_price: null })
    expect(historyRequests.every((url) => url.searchParams.get('source') === 'chainlink')).toBe(true)
    expect(
      historyRequests.some(
        (url) => url.searchParams.get('interval') === '1d' && url.searchParams.get('to') === String(eventEndMs),
      ),
    ).toBe(true)
    expect(
      historyRequests.some(
        (url) => url.searchParams.get('interval') === '1d' && url.searchParams.get('to') === String(eventStartMs),
      ),
    ).toBe(true)
    rows.push({
      ...rows[0],
      window_start_ms: eventStartMs,
      window_end_ms: eventEndMs,
      settlement_price: 105,
      source_timestamp_ms: eventEndMs,
    })
    expect(await (await GET(request)).json()).toMatchObject({ opening_price: 100, closing_price: 105 })
  })
})

describe('hourly event references', () => {
  afterEach(unstubAllGlobals)
  it('waits for the exact hourly close and honors an event-specific historical source', async () => {
    const start = Date.parse('2026-11-12T15:00:00Z')
    const end = start + 3_600_000
    let complete = false
    const requests: URL[] = []
    stubGlobal(
      'fetch',
      mock(async (input: string | URL | Request) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
        let body: unknown
        if (url.pathname === '/series-map') {
          body = {
            series: [{ series_slug: 'hourly-test', instrument: 'BTC/USD', interval: '1h', source: 'chainlink' }],
          }
        } else if (url.pathname === '/marks/latest') {
          body = { markets: [] }
        } else {
          requests.push(url)
          const source = url.searchParams.get('source')
          body = {
            rows: [start, ...(complete ? [end] : [])].map((timestamp) => ({
              instrument: 'BTC/USD',
              interval: '1h',
              source,
              window_start_ms: timestamp - 3_600_000,
              window_end_ms: timestamp,
              settlement_price: timestamp === end ? 105 : 100,
              source_timestamp_ms: timestamp,
              source_ref: 'polybolt-twap:60:btc',
              status: 'final',
            })),
          }
        }
        return new Response(JSON.stringify(body))
      }),
    )
    // Use an independent series cache base to isolate this test from the daily fixture.
    const originalUrl = process.env.PRICE_REFERENCE_URL
    process.env.PRICE_REFERENCE_URL = 'https://hourly-reference.test'
    try {
      const url = `https://kuest.test/api/price-reference/live-series?seriesSlug=hourly-test&eventStartMs=${start}&eventEndMs=${end}&activeWindowMinutes=60`
      expect(await (await GET(new Request(url))).json()).toMatchObject({ closing_price: null })
      complete = true
      expect(await (await GET(new Request(url))).json()).toMatchObject({ closing_price: 105 })
      requests.length = 0
      expect(await (await GET(new Request(`${url}&source=binance`))).json()).toMatchObject({
        source: 'binance',
        closing_price: 105,
      })
      expect(requests.every((request) => request.searchParams.get('source') === 'binance')).toBe(true)
      expect((await GET(new Request(`${url}&source=unknown`))).status).toBe(400)
    } finally {
      if (originalUrl == null) {
        delete process.env.PRICE_REFERENCE_URL
      } else {
        process.env.PRICE_REFERENCE_URL = originalUrl
      }
    }
  })
})
