import { beforeEach, describe, expect, it, mock, jest } from 'bun:test'

import { handleOrderSuccessFeedback } from '@/app/[locale]/(platform)/event/[slug]/_components/feedback'
import { ORDER_SIDE, OUTCOME_INDEX } from '@/lib/constants'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  toastSuccess: mock(),
}))

void mock.module('@/components/ui/toast', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mock(),
    info: mock(),
  },
}))

void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventTradeToast', () => ({
  default: ({ children }: { children: unknown }) => children,
}))

void mock.module('@/lib/confetti', () => ({
  triggerConfetti: mock(),
}))

describe('handleOrderSuccessFeedback', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('uses buyAmountValue when provided for buy success copy', () => {
    const queryClient = {
      invalidateQueries: mock(),
    }

    handleOrderSuccessFeedback({
      side: ORDER_SIDE.BUY,
      amountInput: '0.19',
      buyAmountValue: 9.9,
      buySharesLabel: '10',
      isLimitOrder: false,
      outcomeText: 'No',
      eventTitle: 'Event',
      marketImage: undefined,
      marketTitle: 'Market',
      sellAmountValue: 0,
      avgSellPrice: '—',
      buyPrice: 99,
      queryClient: queryClient as any,
      outcomeIndex: OUTCOME_INDEX.NO,
      lastMouseEvent: null,
    })

    expect(mocks.toastSuccess).toHaveBeenCalledWith('Buy 10 shares on No', expect.any(Object))
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['user-conditional-shares'],
    })
  })

  it('formats limit order toast prices from cents', () => {
    const queryClient = {
      invalidateQueries: mock(),
    }

    handleOrderSuccessFeedback({
      side: ORDER_SIDE.BUY,
      amountInput: '0.1',
      buyAmountValue: 0.1,
      buySharesLabel: '10',
      isLimitOrder: true,
      outcomeText: 'Yes',
      eventTitle: 'Event',
      marketImage: undefined,
      marketTitle: 'Market',
      sellAmountValue: 0,
      avgSellPrice: '—',
      buyPrice: 1,
      queryClient: queryClient as any,
      outcomeIndex: OUTCOME_INDEX.YES,
      lastMouseEvent: null,
    })

    const [, options] = mocks.toastSuccess.mock.calls[0]
    const children = (options as any).content.props.children
    expect(children).toBe('Total 10¢ @ 1¢')
  })
})
