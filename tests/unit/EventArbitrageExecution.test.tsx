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

function rejectStorageWrites(error: Error) {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
  const storage = window.localStorage
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.getItem(key),
      setItem: () => {
        throw error
      },
      removeItem: (key: string) => storage.removeItem(key),
    },
  })
  return () => {
    if (descriptor) {
      Object.defineProperty(window, 'localStorage', descriptor)
    } else {
      Reflect.deleteProperty(window, 'localStorage')
    }
  }
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
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual(attempt)
    expect(JSON.parse(getArbitrageAttemptSnapshot(key)!)).toEqual(attempt)
    expect(onChange).toHaveBeenCalledTimes(1)
    saveArbitrageAttemptSnapshot(key, null)
    expect(getArbitrageAttemptSnapshot(key)).toBeNull()
    expect(window.localStorage.getItem(key)).toBeNull()
    unsubscribe()
  })

  it('shows why each unverified leg needs review', () => {
    render(
      <EventArbitrageExecution
        attempt={{
          ...attempt,
          kuest: { state: 'failed', error: 'Not enough funds.' },
          polymarket: { state: 'unknown', error: 'The submission response was lost.' },
        }}
        siteName="Kuest"
        isChecking={false}
        onCheck={mock()}
        onDismiss={mock()}
      />,
    )
    expect(screen.getByText('Not enough funds.')).toBeInTheDocument()
    expect(screen.getByText('The submission response was lost.')).toBeInTheDocument()
  })

  it('reads another tab’s updates and removal without a stale successful-write cache', () => {
    const key = 'arbitrage-other-tab'
    const onChange = mock()
    const unsubscribe = subscribeArbitrageAttempt(onChange)
    try {
      saveArbitrageAttemptSnapshot(key, null)
      onChange.mockClear()
      window.localStorage.setItem(key, JSON.stringify(attempt))
      window.dispatchEvent(new StorageEvent('storage', { key, storageArea: window.localStorage }))
      expect(JSON.parse(getArbitrageAttemptSnapshot(key)!)).toEqual(attempt)
      expect(onChange).toHaveBeenCalledTimes(1)
      window.localStorage.removeItem(key)
      window.dispatchEvent(new StorageEvent('storage', { key, storageArea: window.localStorage }))
      expect(getArbitrageAttemptSnapshot(key)).toBeNull()
      expect(onChange).toHaveBeenCalledTimes(2)
      window.dispatchEvent(new StorageEvent('storage', { key, storageArea: window.sessionStorage }))
      expect(onChange).toHaveBeenCalledTimes(2)
    } finally {
      unsubscribe()
      saveArbitrageAttemptSnapshot(key, null)
    }
  })

  it('fails required persistence without changing the stored attempt or notifying subscribers', () => {
    const key = 'arbitrage-required-persistence'
    saveArbitrageAttemptSnapshot(key, attempt, true)
    const previous = getArbitrageAttemptSnapshot(key)
    const onChange = mock()
    const unsubscribe = subscribeArbitrageAttempt(onChange)
    const failure = new Error('Storage unavailable')
    const restoreStorage = rejectStorageWrites(failure)
    try {
      expect(() => saveArbitrageAttemptSnapshot(key, { ...attempt, kuest: { state: 'unknown' } }, true)).toThrow(
        failure,
      )
      expect(getArbitrageAttemptSnapshot(key)).toBe(previous)
      expect(window.localStorage.getItem(key)).toBe(previous)
      expect(onChange).not.toHaveBeenCalled()
    } finally {
      restoreStorage()
      unsubscribe()
      saveArbitrageAttemptSnapshot(key, null)
    }
  })

  it('retains newer IDs after a failed post-submission write and accepts later updates from another tab', () => {
    const key = 'arbitrage-fallback-persistence'
    saveArbitrageAttemptSnapshot(key, attempt, true)
    const previous = window.localStorage.getItem(key)
    const next = { ...attempt, polymarket: { state: 'pending' as const, orderId: 'new-poly-id' } }
    const onChange = mock()
    const unsubscribe = subscribeArbitrageAttempt(onChange)
    const restoreStorage = rejectStorageWrites(new Error('Storage unavailable'))
    try {
      saveArbitrageAttemptSnapshot(key, next)
      expect(JSON.parse(getArbitrageAttemptSnapshot(key)!)).toEqual(next)
      expect(window.localStorage.getItem(key)).toBe(previous)
      expect(onChange).toHaveBeenCalledTimes(1)
    } finally {
      restoreStorage()
    }
    try {
      window.localStorage.removeItem(key)
      window.dispatchEvent(new StorageEvent('storage', { key, storageArea: window.localStorage }))
      expect(getArbitrageAttemptSnapshot(key)).toBeNull()
    } finally {
      unsubscribe()
      saveArbitrageAttemptSnapshot(key, null)
    }
  })
})
