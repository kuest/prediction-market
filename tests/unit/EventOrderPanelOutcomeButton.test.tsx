import { render, screen } from '@testing-library/react'
import { describe, expect, it, mock } from 'bun:test'

import EventOrderPanelOutcomeButton from '@/app/[locale]/(platform)/event/[slug]/_components/EventOrderPanelOutcomeButton'

void mock.module('@/components/ui/animated-counter', () => ({
  AnimatedCounter: ({ value }: { value: number }) => <span data-testid="animated-counter">{value}</span>,
}))

describe('eventOrderPanelOutcomeButton', () => {
  it('animates cent values when the order-side price changes', () => {
    const { rerender } = render(
      <EventOrderPanelOutcomeButton variant="yes" price={0.43} label="Yes" isSelected onSelect={() => {}} />,
    )

    expect(screen.getByTestId('animated-counter')).toHaveTextContent('43')
    expect(screen.getByText('¢')).toBeInTheDocument()

    rerender(<EventOrderPanelOutcomeButton variant="yes" price={0.275} label="Yes" isSelected onSelect={() => {}} />)

    expect(screen.getByTestId('animated-counter')).toHaveTextContent('27.5')
  })

  it('keeps non-price odds formats as plain labels', () => {
    render(
      <EventOrderPanelOutcomeButton
        variant="yes"
        price={0.5}
        label="Yes"
        isSelected
        oddsFormat="american"
        onSelect={() => {}}
      />,
    )

    expect(screen.queryByTestId('animated-counter')).not.toBeInTheDocument()
    expect(screen.getByText('+100')).toBeInTheDocument()
  })
})
