import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'

import EventOrderPanelEarnings from '@/app/[locale]/(platform)/event/[slug]/_components/EventOrderPanelEarnings'
import { ORDER_SIDE } from '@/lib/constants'

const baseProps = {
  isMobile: false,
  side: ORDER_SIDE.BUY,
  sellAmountLabel: '$48.43',
  avgSellPriceLabel: '50.0¢',
  avgBuyPriceLabel: '50.0¢',
  avgSellPriceCents: 50,
  avgBuyPriceCents: 50,
  buyPayout: 100,
  buyProfit: 48.425,
  buyChangePct: 93.892,
  buyMultiplier: 1.939,
  totalFee: 1.575,
}

describe('event order panel earnings fee', () => {
  it.each([
    [ORDER_SIDE.BUY, false],
    [ORDER_SIDE.BUY, true],
    [ORDER_SIDE.SELL, false],
    [ORDER_SIDE.SELL, true],
  ] as const)('shows the existing combined fee for side %s on mobile %s', async (side, isMobile) => {
    render(<EventOrderPanelEarnings {...baseProps} side={side} isMobile={isMobile} />)

    fireEvent.click(screen.getByRole('button', { name: 'Price details' }))
    const feeLabel = await screen.findByText('Fee', { exact: true })
    const feeRow = feeLabel.parentElement!

    expect(within(feeRow).getByText('$1.58')).toBeInTheDocument()
    expect(screen.getAllByText('Fee', { exact: true })).toHaveLength(1)
    expect(screen.queryByText('Kuest fee')).not.toBeInTheDocument()
    expect(screen.queryByText('Operator fee')).not.toBeInTheDocument()
    expect(screen.queryByText('Total fee')).not.toBeInTheDocument()
    expect(screen.getByText('Avg. price 50.0¢')).toBeInTheDocument()
    expect(screen.getByText('+100.0')).toBeInTheDocument()
    expect(screen.getByText('2.000x')).toBeInTheDocument()
  })

  it.each([
    [null, '—'],
    [0, '$0.00'],
  ] as const)('preserves the display of a %s fee', async (totalFee, expectedLabel) => {
    render(<EventOrderPanelEarnings {...baseProps} totalFee={totalFee} />)

    fireEvent.click(screen.getByRole('button', { name: 'Price details' }))
    const feeLabel = await screen.findByText('Fee', { exact: true })

    expect(within(feeLabel.parentElement!).getByText(expectedLabel)).toBeInTheDocument()
  })
})
