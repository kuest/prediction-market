import { describe, expect, it } from 'bun:test'

import { MICRO_UNIT } from '@/lib/constants'
import { mapDataApiActivityToActivityOrder, mapDataApiPositionToUserPosition } from '@/lib/data-api/user'

describe('mapDataApiActivityToActivityOrder', () => {
  describe.each(['SPLIT', 'MERGE', 'MERGED'])('%s collateral amounts', (type) => {
    const sharesPerSet = type === 'SPLIT' ? 2 : 1

    it.each([1, 1000, 1000.01, 2101.45, 1_000_000, 1_000_000.01])(
      'preserves %s units without inferring a different scale or trade quantity',
      (amount) => {
        const activity = mapDataApiActivityToActivityOrder({ type, size: amount, usdcSize: amount, price: 0.37 })

        expect(activity.amount).toBe(String(Math.round(amount * sharesPerSet * MICRO_UNIT)))
        expect(activity.total_value).toBe(Math.round(amount * MICRO_UNIT))
        expect(activity.price).toBe(type === 'SPLIT' ? '0.5' : '1')
      },
    )

    it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, -1])(
      'uses collateral one-for-one when size is unavailable (%s)',
      (size) => {
        const activity = mapDataApiActivityToActivityOrder({ type, size, usdcSize: 2101.45 })

        expect(activity.amount).toBe(String(2_101_450_000 * sharesPerSet))
        expect(activity.total_value).toBe(2_101_450_000)
      },
    )

    it('uses the full-set amount when collateral is missing, without a trade price', () => {
      const activity = mapDataApiActivityToActivityOrder({ type, size: 2101.45, price: 0 })

      expect(activity.amount).toBe(String(2_101_450_000 * sharesPerSet))
      expect(activity.total_value).toBe(2_101_450_000)
    })

    it.each([0, 2000])(
      'preserves reported collateral (%s) instead of replacing it with a derived value',
      (usdcSize) => {
        const activity = mapDataApiActivityToActivityOrder({ type, size: 2101.45, usdcSize, price: 0.37 })

        expect(activity.amount).toBe(String(2_101_450_000 * sharesPerSet))
        expect(activity.total_value).toBe(usdcSize * MICRO_UNIT)
      },
    )

    it('keeps an explicit zero size and handles missing amounts without inventing shares', () => {
      expect(mapDataApiActivityToActivityOrder({ type, size: 0, usdcSize: 1 }).amount).toBe('0')
      const missing = mapDataApiActivityToActivityOrder({ type })
      expect(missing.amount).toBe('0')
      expect(missing.total_value).toBe(0)
    })
  })

  it('preserves trade quantities and notional amounts', () => {
    const activity = mapDataApiActivityToActivityOrder({ type: 'TRADE', size: 2101.45, usdcSize: 840.58, price: 0.4 })

    expect(activity.amount).toBe('2101450000')
    expect(activity.price).toBe('0.4')
    expect(activity.total_value).toBe(840_580_000)
  })

  it('preserves the data-api event id for deterministic pagination', () => {
    const activity = mapDataApiActivityToActivityOrder({
      id: 'fill-123',
      proxyWallet: '0xAbC',
      conditionId: 'condition-1',
      timestamp: 1_786_017_600,
    })

    expect(activity.id).toBe('fill-123:0xabc')
    expect(activity.event_id).toBe('fill-123')
  })

  it('uses proxyWallet as the activity user address for DATA_URL responses', () => {
    const proxyWallet = '0xa6a0413f8fa248df51a49bfc759ff190d24fe25b'

    const activity = mapDataApiActivityToActivityOrder({
      proxyWallet,
      side: 'SELL',
      conditionId: '0x8d0af56260655c6c6d61949c76196114766112ebce7d32ea6acc43b779732c13',
      size: 19.66,
      price: 0.3,
      timestamp: 1779198845,
      transactionHash: '0xbdedb891c9e999602f9cb3416592fffbee8d0ec8eb4962906e3f92bdea4125d7',
      usdcSize: 5.898,
      title: 'Dogecoin Up or Down on May 19?',
      slug: 'dogecoin-up-or-down-on-may-19-2026',
      eventSlug: 'dogecoin-up-or-down-on-may-19-2026',
      outcome: 'Down',
      outcomeIndex: 1,
    })

    expect(activity.user.id).toBe(proxyWallet)
    expect(activity.user.address).toBe(proxyWallet)
    expect(activity.user.username).toBe(proxyWallet)
    expect(activity.side).toBe('sell')
  })

  it('normalizes PostgreSQL bytea-style transaction hashes', () => {
    const activity = mapDataApiActivityToActivityOrder({
      conditionId: 'condition-1',
      timestamp: 1_786_017_600,
      transactionHash: '\\x8646bf02263e6a7edc7dd7d01274779df93c83c66cfb07be23d26b9c6d137ed9',
    })

    expect(activity.tx_hash).toBe('0x8646bf02263e6a7edc7dd7d01274779df93c83c66cfb07be23d26b9c6d137ed9')
  })

  it('prefers the external profile pseudonym over proxyWallet for display name', () => {
    const activity = mapDataApiActivityToActivityOrder({
      proxyWallet: '0xa6a0413f8fa248df51a49bfc759ff190d24fe25b',
      pseudonym: 'doge.trader',
      conditionId: '0x8d0af56260655c6c6d61949c76196114766112ebce7d32ea6acc43b779732c13',
      size: 1,
      price: 0.5,
      timestamp: 1779198845,
    })

    expect(activity.user.username).toBe('doge.trader')
  })

  it('maps zero-value redeem activity as a loss row', () => {
    const activity = mapDataApiActivityToActivityOrder({
      proxyWallet: '0xa6a0413f8fa248df51a49bfc759ff190d24fe25b',
      type: 'REDEEM',
      conditionId: '0x8d0af56260655c6c6d61949c76196114766112ebce7d32ea6acc43b779732c13',
      size: 0,
      usdcSize: 0,
      price: 0,
      timestamp: 1779198845,
      transactionHash: '0xbdedb891c9e999602f9cb3416592fffbee8d0ec8eb4962906e3f92bdea4125d7',
      outcomeIndex: 999,
      outcome: '',
    })

    expect(activity.type).toBe('loss')
    expect(activity.outcome.text).toBe('Outcome')
    expect(activity.total_value).toBe(0)
  })
})

describe('mapDataApiPositionToUserPosition', () => {
  it('keeps Polymarket percentage points and treats totalBought as shares', () => {
    const position = mapDataApiPositionToUserPosition(
      {
        conditionId: 'condition-1',
        size: 417.0593,
        avgPrice: 0.6524,
        initialValue: 272.1183,
        currentValue: 264.8327,
        cashPnl: -7.2856,
        percentPnl: -0.9426,
        totalBought: 1525.0593,
        realizedPnl: 0,
      },
      'active',
    )

    expect(position.total_position_cost).toBe(272_118_300)
    expect(position.profit_loss_percent).toBe(-0.9426)
    expect(position.totalBought).toBe(1525.0593)
  })
})
