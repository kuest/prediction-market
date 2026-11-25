import { describe, expect, it } from 'bun:test'

import {
  extractLivePriceUpdates,
  isSnapshotMessage,
  livePriceFeedKey,
  normalizeSubscriptionSymbol,
} from '@/app/[locale]/(platform)/event/[slug]/_utils/eventLiveSeriesChartUtils'

const timestamp = 1_800_000_000_000
const frame = {
  v: 1,
  channel: 'price.crypto.twap',
  seq: 1,
  ts: timestamp,
  payload: {
    symbol: 'btcusd',
    source: 'chainlink',
    window_seconds: 60,
    timestamp,
    value: 123,
    full_accuracy_value: '123.456789',
  },
}
function parse(message: unknown) {
  return extractLivePriceUpdates(message, 'price.crypto.twap', 'btc/usd', 'chainlink', 60)
}

describe('price frames', () => {
  it('normalizes equity and crypto symbols for the wire protocol', () => {
    expect(normalizeSubscriptionSymbol('price.equity', 'AAPL')).toBe('aapl')
    expect(normalizeSubscriptionSymbol('price.equity', 'XAUUSD')).toBe('xauusd')
    expect(normalizeSubscriptionSymbol('price.crypto', 'BTC/USD')).toBe('btcusd')
  })
  it('uses the precise value and source timestamp', () => {
    expect(parse(frame)).toEqual([{ symbol: 'btcusd', price: 123.456789, timestamp }])
  })
  it('rejects legacy, wrong-source, wrong-window and different quote frames', () => {
    expect(parse({ topic: 'crypto_prices_chainlink', payload: frame.payload })).toEqual([])
    expect(parse({ ...frame, payload: { ...frame.payload, source: 'pyth' } })).toEqual([])
    expect(parse({ ...frame, payload: { ...frame.payload, window_seconds: 30 } })).toEqual([])
    expect(parse({ ...frame, payload: { ...frame.payload, symbol: 'btcusdt' } })).toEqual([])
    expect(parse({ ...frame, dropped: true })).toEqual([])
  })
  it('uses snapshot point timestamps without inventing arrival prices', () => {
    const message = {
      ...frame,
      snapshot: true,
      payload: { ...frame.payload, data: [{ timestamp, value: 99, full_accuracy_value: '99.125' }] },
    }
    expect(isSnapshotMessage(message)).toBe(true)
    expect(parse(message)).toEqual([{ symbol: 'btcusd', price: 99.125, timestamp }])
    expect(parse({ ...frame, payload: { ...frame.payload, timestamp: undefined } })).toEqual([])
  })
  it('accepts Binance USDT spot only under the canonical symbol and its own source', () => {
    const point = { timestamp, value: 99, full_accuracy_value: '99.125' }
    const payload = { symbol: 'btcusd', source: 'binance', quote_asset: 'USDT', ...point }
    const spot = { ...frame, channel: 'price.crypto', payload }
    function parseSpot(message: unknown) {
      return extractLivePriceUpdates(message, 'price.crypto', 'btcusd', 'binance', null)
    }
    expect(parseSpot(spot)).toEqual([{ symbol: 'btcusd', price: 99.125, timestamp }])
    expect(
      parseSpot({
        ...spot,
        snapshot: true,
        payload: { symbol: 'btcusd', source: 'binance', quote_asset: 'USDT', data: [point] },
      }),
    ).toEqual([{ symbol: 'btcusd', price: 99.125, timestamp }])
    for (const invalid of [
      { source: 'chainlink' },
      { quote_asset: 'USD' },
      { quote_asset: undefined },
      { window_seconds: 60 },
      { symbol: 'btcusdt' },
    ]) {
      expect(parseSpot({ ...spot, payload: { ...payload, ...invalid } })).toEqual([])
    }
    expect(parse(spot)).toEqual([])
  })

  it('isolates cached prices by source and TWAP window', () => {
    expect(livePriceFeedKey({ topic: 'price.crypto.twap', provider: 'chainlink', window_seconds: 30 })).not.toBe(
      livePriceFeedKey({ topic: 'price.crypto.twap', provider: 'chainlink', window_seconds: 60 }),
    )
    const spot = livePriceFeedKey({ topic: 'price.crypto', provider: 'binance', window_seconds: null })
    expect(spot).not.toBe(livePriceFeedKey({ topic: 'price.crypto', provider: 'chainlink', window_seconds: null }))
    expect(spot).not.toBe(livePriceFeedKey({ topic: 'price.crypto.twap', provider: 'chainlink', window_seconds: 60 }))
  })
})
