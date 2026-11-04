import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, mock } from 'bun:test'

import type { ArbitrageAttempt } from '@/lib/arbitrage-execution'

import EventArbitrageExecution from '@/app/[locale]/(platform)/event/[slug]/_components/EventArbitrageExecution'
import {
  getArbitrageAttemptSnapshot,
  saveArbitrageAttemptSnapshot,
  subscribeArbitrageAttempt,
} from '@/lib/arbitrage-execution-store'

const attempt: ArbitrageAttempt = {
  kuest: { state: 'confirmed', orderId: 'kuest-1', shares: 22 },
  polymarket: { state: 'pending', orderId: 'poly-1', shares: 20 },
  kuestTokenId: '123',
  polymarketTokenId: '456',
  kuestMaker: `0x${'1'.repeat(40)}`,
  polymarketOwner: `0x${'2'.repeat(40)}`,
  polymarketFunder: `0x${'3'.repeat(40)}`,
  signatureType: 3,
  connectorId: 'wallet',
  connectorUid: 'wallet-1',
}

describe('arbitrage execution review', () => {
  it('shows pending fills without presenting their placement quantity as confirmed', () => {
    const onCheck = mock()
    render(
      <EventArbitrageExecution
        attempt={attempt}
        siteName="Kuest"
        isChecking={false}
        onCheck={onCheck}
        onDismiss={mock()}
      />,
    )
    expect(screen.getByText('Kuest: Confirmed: 22 shares')).toBeInTheDocument()
    expect(screen.getByText('Polymarket: Confirmation pending')).toBeInTheDocument()
    expect(screen.queryByText(/Confirmed: 20 shares/u)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }))
    expect(onCheck).toHaveBeenCalledTimes(1)
  })

  it('reports different settled positions instead of a successful hedge', () => {
    render(
      <EventArbitrageExecution
        attempt={{ ...attempt, polymarket: { state: 'confirmed', shares: 20 } }}
        siteName="Kuest"
        isChecking={false}
        onCheck={mock()}
        onDismiss={mock()}
      />,
    )
    expect(
      screen.getByText('The positions have different quantities. No automatic trade will be sent to balance them.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Both positions are confirmed and balanced.')).not.toBeInTheDocument()
  })

  it('keeps an unknown response visible until the user explicitly reviews the positions', () => {
    const onDismiss = mock()
    render(
      <EventArbitrageExecution
        attempt={{ ...attempt, kuest: { state: 'unknown' }, polymarket: { state: 'unknown' } }}
        siteName="Kuest"
        isChecking={false}
        onCheck={mock()}
        onDismiss={onDismiss}
      />,
    )
    expect(screen.getByText('The trade is still being verified. Do not submit it again.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check status' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'I reviewed both positions' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('persists IDs across component lifetimes and clears only on explicit review', () => {
    const key = 'arbitrage-execution-test'
    const onChange = mock()
    const unsubscribe = subscribeArbitrageAttempt(onChange)
    saveArbitrageAttemptSnapshot(key, attempt, true)
    expect(JSON.parse(window.sessionStorage.getItem(key)!)).toEqual(attempt)
    expect(JSON.parse(getArbitrageAttemptSnapshot(key)!)).toEqual(attempt)
    expect(onChange).toHaveBeenCalledTimes(1)
    saveArbitrageAttemptSnapshot(key, null)
    expect(getArbitrageAttemptSnapshot(key)).toBeNull()
    expect(window.sessionStorage.getItem(key)).toBeNull()
    unsubscribe()
  })
})
