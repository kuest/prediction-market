import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import type { ArbitrageAttempt } from '@/lib/arbitrage-execution'

import EventArbitrageExecution from '@/app/[locale]/(platform)/event/[slug]/_components/EventArbitrageExecution'
import { parseStoredArbitrageAttempt } from '@/lib/arbitrage-execution'
import {
  ArbitrageClaimConflictError,
  claimArbitrageAttemptSnapshot,
  dismissArbitrageAttemptSnapshot,
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

const originalLocks = Object.getOwnPropertyDescriptor(window.navigator, 'locks')
const requestLock = mock()
beforeEach(() => {
  const queues = new Map<string, Promise<unknown>>()
  requestLock.mockReset().mockImplementation((name: string, options: { mode: string }, operation: () => unknown) => {
    expect(options.mode).toBe('exclusive')
    const result = (queues.get(name) ?? Promise.resolve()).then(operation)
    queues.set(
      name,
      result.catch(() => {}),
    )
    return result
  })
  Object.defineProperty(window.navigator, 'locks', { configurable: true, value: { request: requestLock } })
})
afterEach(() => {
  if (originalLocks) {
    Object.defineProperty(window.navigator, 'locks', originalLocks)
  } else {
    Reflect.deleteProperty(window.navigator, 'locks')
  }
})

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

  it('persists an identified attempt until explicit review', async () => {
    const key = 'arbitrage-persisted'
    const onChange = mock()
    const unsubscribe = subscribeArbitrageAttempt(onChange)
    const claimed = await claimArbitrageAttemptSnapshot(key, attempt)
    expect(claimed.attemptId).toBeString()
    expect(JSON.parse(getArbitrageAttemptSnapshot(key)!)).toEqual(claimed)
    expect(onChange).toHaveBeenCalledTimes(1)
    await dismissArbitrageAttemptSnapshot(key, getArbitrageAttemptSnapshot(key)!)
    expect(getArbitrageAttemptSnapshot(key)).toBeNull()
    unsubscribe()
  })

  it('reads another tab’s updates and removal without a stale successful-write cache', () => {
    const key = 'arbitrage-other-tab'
    const onChange = mock()
    const unsubscribe = subscribeArbitrageAttempt(onChange)
    try {
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
      window.localStorage.removeItem(key)
    }
  })

  it('fails initial persistence without changing storage or notifying subscribers', async () => {
    const key = 'arbitrage-required-persistence'
    const onChange = mock()
    const unsubscribe = subscribeArbitrageAttempt(onChange)
    const failure = new Error('Storage unavailable')
    const restoreStorage = rejectStorageWrites(failure)
    try {
      await expect(claimArbitrageAttemptSnapshot(key, attempt)).rejects.toThrow(failure)
      expect(getArbitrageAttemptSnapshot(key)).toBeNull()
      expect(window.localStorage.getItem(key)).toBeNull()
      expect(onChange).not.toHaveBeenCalled()
    } finally {
      restoreStorage()
      unsubscribe()
    }
  })

  it('retains a newly received order id when a post-submission write fails', async () => {
    const key = 'arbitrage-fallback-persistence'
    const claimed = await claimArbitrageAttemptSnapshot(key, { ...attempt, polymarket: { state: 'unknown' } })
    const previous = window.localStorage.getItem(key)
    const next = { ...claimed, polymarket: { state: 'pending' as const, orderId: 'new-poly-id' } }
    const restoreStorage = rejectStorageWrites(new Error('Storage unavailable'))
    try {
      await saveArbitrageAttemptSnapshot(key, next)
      expect(JSON.parse(getArbitrageAttemptSnapshot(key)!)).toMatchObject(next)
      expect(window.localStorage.getItem(key)).toBe(previous)
    } finally {
      restoreStorage()
      await dismissArbitrageAttemptSnapshot(key, getArbitrageAttemptSnapshot(key)!)
    }
  })

  it('allows only one concurrent initial claim and preserves the winning attempt', async () => {
    const key = 'arbitrage-concurrent-claim'
    const results = await Promise.allSettled([
      claimArbitrageAttemptSnapshot(key, attempt),
      claimArbitrageAttemptSnapshot(key, attempt),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const conflict = results.find((result) => result.status === 'rejected')
    expect(conflict?.reason).toBeInstanceOf(ArbitrageClaimConflictError)
    const winner = results.find((result) => result.status === 'fulfilled')
    expect(JSON.parse(getArbitrageAttemptSnapshot(key)!)).toEqual(winner?.value)
    expect(requestLock).toHaveBeenCalledTimes(2)
    await dismissArbitrageAttemptSnapshot(key, getArbitrageAttemptSnapshot(key)!)
  })

  it('merges concurrent stale checks without downgrading either confirmed leg', async () => {
    const key = 'arbitrage-concurrent-checks'
    const pending = await claimArbitrageAttemptSnapshot(key, {
      ...attempt,
      kuest: { state: 'pending', orderId: 'kuest-1' },
      polymarket: { state: 'pending', orderId: 'poly-1' },
    })
    await Promise.all([
      saveArbitrageAttemptSnapshot(key, { ...pending, kuest: { state: 'confirmed', orderId: 'kuest-1', shares: 22 } }),
      saveArbitrageAttemptSnapshot(key, {
        ...pending,
        polymarket: { state: 'confirmed', orderId: 'poly-1', shares: 20 },
      }),
    ])
    const saved = JSON.parse(getArbitrageAttemptSnapshot(key)!)
    expect(saved.kuest).toMatchObject({ state: 'confirmed', shares: 22 })
    expect(saved.polymarket).toMatchObject({ state: 'confirmed', shares: 20 })
    await saveArbitrageAttemptSnapshot(key, pending)
    expect(JSON.parse(getArbitrageAttemptSnapshot(key)!)).toEqual(saved)
    await dismissArbitrageAttemptSnapshot(key, getArbitrageAttemptSnapshot(key)!)
  })

  it('reads current results only after acquiring the shared lock', async () => {
    const key = 'arbitrage-waiting-check'
    const claimed = await claimArbitrageAttemptSnapshot(key, attempt)
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    requestLock.mockImplementationOnce((_name: string, _options: unknown, operation: () => unknown) =>
      held.then(operation),
    )
    const pendingWrite = saveArbitrageAttemptSnapshot(key, claimed)
    const confirmed = { ...claimed, polymarket: { state: 'confirmed' as const, orderId: 'poly-1', shares: 20 } }
    // Model another tab finishing its write before releasing the shared lock.
    window.localStorage.setItem(key, JSON.stringify(confirmed))
    release()
    expect(await pendingWrite).toEqual(confirmed)
    await dismissArbitrageAttemptSnapshot(key, getArbitrageAttemptSnapshot(key)!)
  })

  it('does not resurrect dismissed attempts or overwrite a newer attempt', async () => {
    const key = 'arbitrage-obsolete-attempt'
    const old = await claimArbitrageAttemptSnapshot(key, attempt)
    await dismissArbitrageAttemptSnapshot(key, getArbitrageAttemptSnapshot(key)!)
    await expect(saveArbitrageAttemptSnapshot(key, old)).rejects.toThrow('reviewed or changed')
    const fresh = await claimArbitrageAttemptSnapshot(key, attempt)
    await expect(saveArbitrageAttemptSnapshot(key, old)).rejects.toThrow('reviewed or changed')
    expect(JSON.parse(getArbitrageAttemptSnapshot(key)!)).toEqual(fresh)
    await dismissArbitrageAttemptSnapshot(key, getArbitrageAttemptSnapshot(key)!)
  })

  it('refuses to dismiss results changed since the user reviewed them', async () => {
    const key = 'arbitrage-stale-review'
    const claimed = await claimArbitrageAttemptSnapshot(key, attempt)
    const reviewed = getArbitrageAttemptSnapshot(key)!
    await saveArbitrageAttemptSnapshot(key, {
      ...claimed,
      polymarket: { state: 'confirmed', orderId: 'poly-1', shares: 20 },
    })
    await expect(dismissArbitrageAttemptSnapshot(key, reviewed)).rejects.toThrow('changed while')
    expect(getArbitrageAttemptSnapshot(key)).not.toBeNull()
    await dismissArbitrageAttemptSnapshot(key, getArbitrageAttemptSnapshot(key)!)
  })

  it('blocks initial submission without cross-tab locks', async () => {
    Object.defineProperty(window.navigator, 'locks', { configurable: true, value: undefined })
    await expect(claimArbitrageAttemptSnapshot('arbitrage-no-locks', attempt)).rejects.toThrow('cannot coordinate')
    expect(getArbitrageAttemptSnapshot('arbitrage-no-locks')).toBeNull()
  })

  it('lets the user explicitly clear unreadable details without silently discarding them', async () => {
    const key = 'arbitrage-malformed'
    window.localStorage.setItem(key, '{bad json')
    let dismissed: Promise<void> | undefined
    render(
      <EventArbitrageExecution
        attempt={null}
        siteName="Kuest"
        isChecking={false}
        onCheck={mock()}
        onDismiss={() => {
          dismissed = dismissArbitrageAttemptSnapshot(key, '{bad json')
        }}
      />,
    )
    expect(
      screen.getByText('Saved trade details could not be read. Review both positions before clearing them.'),
    ).toBeInTheDocument()
    await expect(claimArbitrageAttemptSnapshot(key, attempt)).rejects.toThrow('Review the previous')
    fireEvent.click(screen.getByRole('button', { name: 'I reviewed both positions' }))
    await dismissed
    expect(getArbitrageAttemptSnapshot(key)).toBeNull()
  })

  it('rejects non-string persisted errors and never renders them as React children', () => {
    const malformed = { ...attempt, kuest: { ...attempt.kuest, error: { message: 'malformed' } } }
    expect(parseStoredArbitrageAttempt(malformed)).toBeNull()
    render(
      <EventArbitrageExecution
        attempt={malformed as unknown as ArbitrageAttempt}
        siteName="Kuest"
        isChecking={false}
        onCheck={mock()}
        onDismiss={mock()}
      />,
    )
    expect(screen.getByText('Kuest: Confirmed: 22 shares')).toBeInTheDocument()
  })
})
