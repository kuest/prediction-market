import { afterEach, describe, expect, it, mock } from 'bun:test'

import { GET } from '@/app/api/price-reference/live-series/route'

import { stubGlobal, unstubAllGlobals } from '../bun-test-helpers'

describe('GOLD live-series snapshot', () => {
  afterEach(() => {
    unstubAllGlobals()
  })

  it('uses the previous close as the opening reference and waits for the exact current close', async () => {
    const previousWindowEndMs = Date.parse('2026-10-19T00:00:00Z')
    const closingWindowEndMs = Date.parse('2026-10-20T00:00:00Z')
    const eventEndMs = Date.parse('2026-10-20T21:00:00Z')
    const eventStartMs = Date.parse('2026-10-20T13:30:00Z')
    const rows = [
      {
        instrument: 'XAUUSD',
        interval: '1d',
        window_start_ms: previousWindowEndMs - 86_400_000,
        window_end_ms: previousWindowEndMs,
        settlement_price: 4100,
        source: 'pyth',
        source_timestamp_ms: Date.parse('2026-10-19T21:00:00Z'),
        source_ref: 'polymarket-price-to-beat:previous',
        status: 'final',
      },
    ]

    stubGlobal(
      'fetch',
      mock((input: string | URL | Request) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
        let body: unknown
        if (url.pathname === '/series-map') {
          body = {
            series: [
              {
                series_slug: 'gold-daily-up-or-down',
                instrument: 'XAUUSD',
                interval: '1d',
                source: 'pyth',
                display_name: 'Gold',
                display_symbol: 'XAUUSD',
              },
            ],
          }
        } else if (url.pathname === '/marks/latest') {
          body = { markets: [] }
        } else {
          body = { rows: url.searchParams.get('interval') === '1d' ? rows : [] }
        }
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
      }),
    )

    const request = new Request(
      `https://kuest.test/api/price-reference/live-series?seriesSlug=gold-daily-up-or-down&eventStartMs=${eventStartMs}&eventEndMs=${eventEndMs}&activeWindowMinutes=450`,
    )
    const beforeClose = await GET(request)
    expect(beforeClose.status).toBe(200)
    expect(await beforeClose.json()).toMatchObject({
      event_window_start_ms: eventStartMs,
      opening_price: 4100,
      closing_price: null,
    })

    rows.push({
      ...rows[0],
      window_start_ms: previousWindowEndMs,
      window_end_ms: closingWindowEndMs,
      settlement_price: 4150,
      source_timestamp_ms: eventEndMs,
      source_ref: 'polymarket-price-to-beat:current',
    })

    const afterClose = await GET(request)
    expect(afterClose.status).toBe(200)
    expect(await afterClose.json()).toMatchObject({
      opening_price: 4100,
      closing_price: 4150,
    })
  })
})
