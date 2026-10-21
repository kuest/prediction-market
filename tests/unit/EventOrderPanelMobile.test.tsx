import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'

import { ORDER_SIDE } from '@/lib/constants'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  summaries: {} as Record<
    string,
    { bids: Array<{ price: string; size: string }>; asks: Array<{ price: string; size: string }> }
  >,
}))

void mock.module('next-intl', () => ({ useExtracted: () => (value: string) => value }))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_hooks/useOrderBookSummaries', () => ({
  useOrderBookSummaries: () => ({ data: mocks.summaries }),
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventOrderPanelForm', () => ({
  default: () => null,
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventOrderPanelTermsDisclaimer', () => ({
  default: () => null,
}))
void mock.module('@/components/ui/drawer', () => ({
  Drawer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const { default: EventOrderPanelMobile } =
  await import('@/app/[locale]/(platform)/event/[slug]/_components/EventOrderPanelMobile?unit-test')
const { useOrder } = await import('@/stores/useOrder')

const yes = { condition_id: 'condition-1', outcome_index: 0, token_id: 'yes-token', outcome_text: 'Yes' }
const no = { condition_id: 'condition-1', outcome_index: 1, token_id: 'no-token', outcome_text: 'No' }
const market = { condition_id: 'condition-1', outcomes: [yes, no] } as never
const event = { id: 'event-1', title: 'Event', total_markets_count: 1, markets: [market] } as never

describe('mobile quick-buy price selection', () => {
  afterEach(() => {
    useOrder.getState().reset()
    mocks.summaries = {}
  })

  it('copies the displayed buy quote on every click, even after a manual edit or Sell selection', () => {
    mocks.summaries = {
      'yes-token': { bids: [{ price: '0.57', size: '10' }], asks: [{ price: '0.61', size: '10' }] },
      'no-token': { bids: [{ price: '0.39', size: '10' }], asks: [{ price: '0.43', size: '10' }] },
    }
    act(() => {
      useOrder.getState().setEvent(event)
      useOrder.getState().setMarket(market)
      useOrder.getState().setSide(ORDER_SIDE.SELL)
    })

    const { rerender } = render(<EventOrderPanelMobile event={event} initialMarket={market} />)
    fireEvent.click(screen.getByRole('button', { name: 'Buy Yes 61¢' }))
    expect(useOrder.getState().side).toBe(ORDER_SIDE.BUY)
    expect(useOrder.getState().limitPrice).toBe('61.0')

    act(() => useOrder.getState().setLimitPrice('27.0'))
    mocks.summaries = {
      ...mocks.summaries,
      'yes-token': { bids: [{ price: '0.78', size: '10' }], asks: [{ price: '0.82', size: '10' }] },
    }
    rerender(<EventOrderPanelMobile event={event} initialMarket={market} />)
    fireEvent.click(screen.getByRole('button', { name: 'Buy Yes 82¢' }))
    expect(useOrder.getState().limitPrice).toBe('82.0')

    fireEvent.click(screen.getByRole('button', { name: 'Buy No 43¢' }))
    expect(useOrder.getState().limitPrice).toBe('43.0')
  })

  it('does not invent a limit price when the quick-buy button has no quote', () => {
    act(() => {
      useOrder.getState().setEvent(event)
      useOrder.getState().setMarket(market)
      useOrder.getState().setLimitPrice('31.0')
    })

    render(<EventOrderPanelMobile event={event} initialMarket={market} />)
    fireEvent.click(screen.getByRole('button', { name: 'Buy Yes —' }))
    expect(useOrder.getState().limitPrice).toBe('')
  })
})
