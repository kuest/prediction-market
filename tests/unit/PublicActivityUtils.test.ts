import { describe, expect, it } from 'bun:test'

import type { ActivityOrder } from '@/types'

import {
  buildActivityCsv,
  formatActivityShares,
  normalizeActivityHistoryDisplay,
  resolveVariant,
} from '@/app/[locale]/(platform)/profile/_utils/PublicActivityUtils'
import { MICRO_UNIT } from '@/lib/constants'
import { mapDataApiActivityToActivityOrder } from '@/lib/data-api/user'

function createActivity(overrides: Partial<ActivityOrder> = {}): ActivityOrder {
  return {
    id: 'activity-1',
    type: 'redeem',
    user: {
      id: '0xuser',
      username: '0xuser',
      address: '0xuser',
      image: '',
    },
    side: 'buy',
    amount: String(MICRO_UNIT),
    price: '0',
    outcome: {
      index: 0,
      text: 'Up',
    },
    market: {
      condition_id: '0xcondition',
      title: 'Bitcoin Up or Down on June 26?',
      slug: 'bitcoin-up-or-down-on-june-26-2026',
      icon_url: '',
      event: {
        slug: 'bitcoin-up-or-down-on-june-26-2026',
        show_market_icons: false,
      },
    },
    total_value: MICRO_UNIT,
    created_at: '2026-06-26T22:06:33.000Z',
    status: 'completed',
    tx_hash: '0xtx',
    ...overrides,
  }
}

describe('public activity utils', () => {
  it.each(['SPLIT', 'MERGE'])('keeps %s quantities and collateral consistent in history and CSV', (type) => {
    const activity = mapDataApiActivityToActivityOrder({
      type,
      size: 2101.45,
      usdcSize: 2101.45,
      price: 0,
      timestamp: 1793653617,
      title: 'Bitcoin Up or Down',
      transactionHash: '0xsplit-or-merge',
    })

    expect(formatActivityShares(activity)).toBe('2,101.45 shares')
    expect(buildActivityCsv([activity], 'Kuest').csvContent.split('\n')[1]).toBe(
      `"Bitcoin Up or Down","${type === 'SPLIT' ? 'Split' : 'Merge'}","2101.45","2101.45","","1793653617","0xsplit-or-merge"`,
    )
  })

  it('deduplicates overlapping activity pages by activity id', () => {
    const activity = createActivity({ id: 'duplicate-activity' })

    const normalized = normalizeActivityHistoryDisplay([activity, { ...activity }])

    expect(normalized).toEqual([activity])
  })

  it('collapses duplicate opposite redeem outcomes into loss and redeem rows', () => {
    const activities = [
      createActivity({
        id: 'redeem-up',
        outcome: { index: 0, text: 'Up' },
      }),
      createActivity({
        id: 'redeem-down',
        outcome: { index: 1, text: 'Down' },
      }),
    ]

    const normalized = normalizeActivityHistoryDisplay(activities)

    expect(normalized).toHaveLength(2)
    expect(resolveVariant(normalized[0]!)).toBe('loss')
    expect(resolveVariant(normalized[1]!)).toBe('redeem')
    expect(normalized[0]!.outcome.text).toBe('Outcome')
    expect(normalized[1]!.outcome.text).toBe('Outcome')
    expect(normalized[0]!.total_value).toBe(0)
    expect(normalized[1]!.total_value).toBe(MICRO_UNIT)
    expect(formatActivityShares(normalized[0]!)).toBe('0.0 shares')
    expect(formatActivityShares(normalized[1]!)).toBeNull()
  })

  it('hides redeem shares and shows split shares as the original split amount', () => {
    expect(formatActivityShares(createActivity())).toBeNull()
    expect(
      formatActivityShares(
        createActivity({
          type: 'split',
          amount: String(MICRO_UNIT * 2),
        }),
      ),
    ).toBe('1 share')
  })

  it('recognizes resolution bond and reward activity types', () => {
    expect(resolveVariant(createActivity({ type: 'RESOLUTION_BOND' }))).toBe('resolution_bond')
    expect(resolveVariant(createActivity({ type: 'RESOLUTION_REWARD' }))).toBe('resolution_reward')
  })
})
