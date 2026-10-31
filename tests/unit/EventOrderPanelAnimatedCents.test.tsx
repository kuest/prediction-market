import { render, screen } from '@testing-library/react'
import { describe, expect, it, mock } from 'bun:test'

import EventOrderPanelAnimatedCents from '@/app/[locale]/(platform)/event/[slug]/_components/EventOrderPanelAnimatedCents'

void mock.module('@/components/ui/animated-counter', () => ({
  AnimatedCounter: ({ value, includeDecimals }: { value: number; includeDecimals: boolean }) => (
    <span data-testid="counter" data-decimals={String(includeDecimals)}>
      {value}
    </span>
  ),
}))

describe('event order panel animated cents', () => {
  it('normalizes floating-point noise before deciding whether to show decimals', () => {
    render(<EventOrderPanelAnimatedCents value={55.00000000000001} />)

    expect(screen.getByTestId('counter')).toHaveTextContent('55')
    expect(screen.getByTestId('counter')).toHaveAttribute('data-decimals', 'false')
  })

  it('keeps a meaningful tenth of a cent', () => {
    render(<EventOrderPanelAnimatedCents value={55.06} />)

    expect(screen.getByTestId('counter')).toHaveTextContent('55.1')
    expect(screen.getByTestId('counter')).toHaveAttribute('data-decimals', 'true')
  })
})
