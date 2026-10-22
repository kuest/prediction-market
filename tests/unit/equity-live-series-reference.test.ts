import { afterEach, expect, it, jest, mock } from 'bun:test'

import { GET } from '@/app/api/price-reference/live-series/route'

import { useFakeTimers, useRealTimers } from '../bun-test-helpers'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  useRealTimers()
})

it('uses the current HOOD event reference and never promotes an older close into it', async () => {
  useFakeTimers()
  jest.setSystemTime(new Date('2026-10-22T19:00:00Z'))

  const eventSlug = 'hood-up-or-down-on-october-22-2026'
  const previousSlug = 'hood-up-or-down-on-october-21-2026'
  const start = Date.parse('2026-10-22T13:30:00Z')
  const end = Date.parse('2026-10-22T20:00:00Z')
  const previousClose = Date.parse('2026-10-21T20:00:00Z')
  const oldClose = Date.parse('2026-10-20T20:00:00Z')
  let includeCurrentReference = false
  const oldRow = {
    instrument: 'HOOD',
    interval: '1d',
    source: 'pyth',
    status: 'final',
    window_start_ms: Date.parse('2026-10-19T00:00:00Z'),
    window_end_ms: Date.parse('2026-10-20T00:00:00Z'),
    settlement_price: 98.22531,
    source_timestamp_ms: oldClose,
    source_ref: `polymarket-price-to-beat:${previousSlug}`,
  }
  const currentRow = {
    ...oldRow,
    window_start_ms: Date.parse('2026-10-20T00:00:00Z'),
    window_end_ms: Date.parse('2026-10-21T00:00:00Z'),
    settlement_price: 101.94,
    source_timestamp_ms: previousClose,
    source_ref: `polymarket-price-to-beat:${eventSlug}`,
  }
  const nonPolymarketRow = {
    ...currentRow,
    settlement_price: 999,
    source_ref: 'other-daily-settlement',
  }
  globalThis.fetch = mock(async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/series-map') {
      return Response.json({
        series: [
          {
            series_slug: 'hood-daily-up-or-down',
            instrument: 'HOOD',
            interval: '1d',
            source: 'pyth',
            display_name: 'Robinhood',
            display_symbol: 'HOOD',
          },
        ],
      })
    }
    if (url.pathname === '/marks/latest') {
      const row = includeCurrentReference ? currentRow : oldRow
      return Response.json({
        markets: [
          {
            instrument: 'HOOD',
            interval: '1d',
            source: 'pyth',
            last_final: {
              price: row.settlement_price,
              window_end_ms: row.window_end_ms,
              source_timestamp_ms: row.source_timestamp_ms,
              source_ref: row.source_ref,
            },
            next_window: null,
          },
        ],
      })
    }
    if (url.pathname === '/marks/history') {
      return Response.json({
        rows:
          url.searchParams.get('interval') === '1d'
            ? includeCurrentReference
              ? [nonPolymarketRow, currentRow, oldRow]
              : [nonPolymarketRow, oldRow]
            : [],
      })
    }
    throw new Error(`unexpected request ${url}`)
  }) as unknown as typeof fetch

  const request = new Request(
    `https://kuest.test/api/price-reference/live-series?seriesSlug=hood-daily-up-or-down&eventSlug=${eventSlug}&eventStartMs=${start}&eventEndMs=${end}`,
  )
  const missing = await (await GET(request)).json()
  expect(missing.opening_price).toBeNull()
  expect(missing.closing_price).toBeNull()
  expect(missing.latest_price).toBeNull()

  const priorStart = Date.parse('2026-10-21T13:30:00Z')
  const priorRequest = new Request(
    `https://kuest.test/api/price-reference/live-series?seriesSlug=hood-daily-up-or-down&eventSlug=${previousSlug}&eventStartMs=${priorStart}&eventEndMs=${previousClose}`,
  )
  const awaitingClose = await (await GET(priorRequest)).json()
  expect(awaitingClose.opening_price).toBe(98.22531)
  expect(awaitingClose.closing_price).toBeNull()
  expect(awaitingClose.latest_price).toBeNull()

  includeCurrentReference = true
  const available = await (await GET(request)).json()
  expect(available.opening_price).toBe(101.94)
  expect(available.closing_price).toBeNull()
  expect(available.latest_price).toBe(101.94)

  const closed = await (await GET(priorRequest)).json()
  expect(closed.opening_price).toBe(98.22531)
  expect(closed.closing_price).toBe(101.94)
  expect(closed.latest_price).toBeNull()
})
