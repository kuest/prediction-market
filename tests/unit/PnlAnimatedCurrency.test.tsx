import { render, screen } from '@testing-library/react'
import { describe, expect, it, mock } from 'bun:test'

import PnlAnimatedCurrency from '@/app/[locale]/(platform)/profile/_components/PnlAnimatedCurrency'

const received: Array<{ value: number; fontSize: string; includeDecimals: boolean; decimalPrecision: number }> = []

void mock.module('react-animated-counter', () => ({
  AnimatedCounter: (props: { value: number; fontSize: string; includeDecimals: boolean; decimalPrecision: number }) => {
    received.push(props)
    return <span>{props.value.toFixed(2)}</span>
  },
}))

describe('P&L animated currency', () => {
  it('keeps its real value and sign accessible while animating both responsive sizes', () => {
    const view = render(<PnlAnimatedCurrency magnitude={0} sign="+" size="large" />)
    expect(screen.getByText('+$0.00')).toBeInTheDocument()

    view.rerender(<PnlAnimatedCurrency magnitude={0.8} sign="+" size="large" />)
    expect(screen.getByText('+$0.80')).toBeInTheDocument()
    expect(received.at(-1)).toMatchObject({ value: 0.8, fontSize: '30px', includeDecimals: true, decimalPrecision: 2 })
    expect(received.at(-2)).toMatchObject({ value: 0.8, fontSize: '24px', includeDecimals: true, decimalPrecision: 2 })

    view.rerender(<PnlAnimatedCurrency magnitude={0.8} sign="-" />)
    expect(screen.getByText('-$0.80')).toBeInTheDocument()
    expect(received.at(-1)).toMatchObject({ value: 0.8, fontSize: '14px' })
  })
})
