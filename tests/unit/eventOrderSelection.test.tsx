import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  summaries: {} as Record<
    string,
    { bids: Array<{ price: string; size: string }>; asks: Array<{ price: string; size: string }> }
  >,
}))

void mock.module('@/app/[locale]/(platform)/event/[slug]/_hooks/useOrderBookSummaries', () => ({
  useOrderBookSummaries: () => ({ data: mocks.summaries }),
}))

const { selectOrderOutcomeAtDisplayedPrice, useOrder, useSyncLimitPriceWithOutcome } =
  await import('@/stores/useOrder?event-order-selection-test')

const yes = { condition_id: 'condition-1', outcome_index: 0, token_id: 'yes-token', buy_price: 0.55 } as any
const no = { condition_id: 'condition-1', outcome_index: 1, token_id: 'no-token', buy_price: 0.45 } as any
const market = { condition_id: 'condition-1', price: 0.55, outcomes: [yes, no] } as any
const event = { id: 'event-1', markets: [market] } as any

describe('event order outcome selection', () => {
  afterEach(() => {
    useOrder.getState().reset()
    mocks.summaries = {}
  })

  it('copies every clicked button price, including repeat clicks, and preserves later manual edits', () => {
    mocks.summaries = {
      'yes-token': { bids: [], asks: [{ price: '0.55', size: '10' }] },
      'no-token': { bids: [], asks: [{ price: '0.45', size: '10' }] },
    }
    act(() => {
      const state = useOrder.getState()
      state.setEvent(event)
      state.setMarket(market)
      state.setOutcome(yes)
    })
    const { rerender } = renderHook(() => useSyncLimitPriceWithOutcome())
    expect(useOrder.getState().limitPrice).toBe('55.0')

    act(() => {
      selectOrderOutcomeAtDisplayedPrice({
        market,
        outcome: no,
        displayedPrice: 0.2,
        currentMarketConditionId: market.condition_id,
        setMarket: useOrder.getState().setMarket,
        setOutcome: useOrder.getState().setOutcome,
        setLimitPrice: useOrder.getState().setLimitPrice,
      })
    })
    rerender()
    expect(useOrder.getState().limitPrice).toBe('20.0')

    act(() => {
      selectOrderOutcomeAtDisplayedPrice({
        market,
        outcome: no,
        displayedPrice: 0.31,
        currentMarketConditionId: market.condition_id,
        setMarket: useOrder.getState().setMarket,
        setOutcome: useOrder.getState().setOutcome,
        setLimitPrice: useOrder.getState().setLimitPrice,
      })
    })
    rerender()
    expect(useOrder.getState().limitPrice).toBe('31.0')

    act(() => useOrder.getState().setLimitPrice('27.0'))
    mocks.summaries = {
      ...mocks.summaries,
      'no-token': { bids: [], asks: [{ price: '0.4', size: '10' }] },
    }
    rerender()
    expect(useOrder.getState().limitPrice).toBe('27.0')

    act(() => useOrder.getState().setOutcome(yes))
    rerender()
    expect(useOrder.getState().limitPrice).toBe('55.0')
  })

  it('clears a stale limit when a clicked outcome has no displayed price', () => {
    act(() => {
      const state = useOrder.getState()
      state.setEvent(event)
      state.setMarket(market)
      state.setOutcome(yes)
    })
    const { rerender } = renderHook(() => useSyncLimitPriceWithOutcome())
    expect(useOrder.getState().limitPrice).toBe('55.0')

    act(() => {
      selectOrderOutcomeAtDisplayedPrice({
        market,
        outcome: no,
        displayedPrice: null,
        currentMarketConditionId: market.condition_id,
        setMarket: useOrder.getState().setMarket,
        setOutcome: useOrder.getState().setOutcome,
        setLimitPrice: useOrder.getState().setLimitPrice,
      })
    })
    rerender()
    expect(useOrder.getState().limitPrice).toBe('')
  })
})
