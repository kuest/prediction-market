import type { ArbitrageAttempt, ArbitrageExecution } from '@/lib/arbitrage-execution'

import { parseStoredArbitrageAttempt } from '@/lib/arbitrage-execution'

const CHANGED_EVENT = 'kuest:arbitrage-execution-changed'
const inMemory = new Map<string, string | null>()

export class ArbitrageClaimConflictError extends Error {
  constructor() {
    super('Review the previous arbitrage before trading again.')
    this.name = 'ArbitrageClaimConflictError'
  }
}

export function subscribeArbitrageAttempt(onChange: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.storageArea !== window.localStorage) {
      return
    }
    if (event.key === null) {
      inMemory.clear()
    } else {
      inMemory.delete(event.key)
    }
    onChange()
  }
  window.addEventListener(CHANGED_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGED_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

export function getArbitrageAttemptSnapshot(key: string | null) {
  if (!key || typeof window === 'undefined') {
    return null
  }
  if (inMemory.has(key)) {
    return inMemory.get(key) ?? null
  }
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSnapshot(key: string, attempt: ArbitrageAttempt | null, requirePersistence = false) {
  const serialized = attempt ? JSON.stringify(attempt) : null
  try {
    if (serialized) {
      window.localStorage.setItem(key, serialized)
    } else {
      window.localStorage.removeItem(key)
    }
    inMemory.delete(key)
  } catch (error) {
    if (requirePersistence) {
      throw error
    }
    // After submission, retain newer IDs in memory even if browser storage becomes unavailable.
    inMemory.set(key, serialized)
  }
  window.dispatchEvent(new Event(CHANGED_EVENT))
}

async function withAttemptLock<T>(key: string, operation: () => T): Promise<T> {
  if (!window.navigator.locks?.request) {
    throw new Error('This browser cannot coordinate arbitrage between tabs.')
  }
  return window.navigator.locks.request(`kuest:arbitrage-write:${key}`, { mode: 'exclusive' }, operation)
}

export async function claimArbitrageAttemptSnapshot(key: string, attempt: ArbitrageAttempt) {
  return withAttemptLock(key, () => {
    // Read storage directly: a failed read must not allow a new submission.
    if (window.localStorage.getItem(key) !== null || inMemory.has(key)) {
      throw new ArbitrageClaimConflictError()
    }
    const claimed = { ...attempt, attemptId: crypto.randomUUID() }
    writeSnapshot(key, claimed, true)
    return claimed
  })
}

function mergeLeg(current: ArbitrageExecution, incoming: ArbitrageExecution): ArbitrageExecution {
  if (current.orderId && incoming.orderId && current.orderId !== incoming.orderId) {
    throw new Error('The arbitrage order reference changed.')
  }
  if (current.state === 'confirmed' || current.state === 'failed' || (current.orderId && !incoming.orderId)) {
    return current
  }
  return {
    ...current,
    ...incoming,
    orderId: incoming.orderId ?? current.orderId,
    shares: incoming.shares ?? current.shares,
    principal: incoming.principal ?? current.principal,
  }
}

export async function saveArbitrageAttemptSnapshot(key: string, attempt: ArbitrageAttempt) {
  return withAttemptLock(key, () => {
    const raw = getArbitrageAttemptSnapshot(key)
    const current = raw ? parseStoredArbitrageAttempt(JSON.parse(raw)) : null
    if (
      !current ||
      current.attemptId !== attempt.attemptId ||
      current.kuestTokenId !== attempt.kuestTokenId ||
      current.polymarketTokenId !== attempt.polymarketTokenId ||
      current.kuestMaker !== attempt.kuestMaker ||
      current.polymarketFunder !== attempt.polymarketFunder ||
      current.polymarketOwner !== attempt.polymarketOwner
    ) {
      throw new Error('The saved arbitrage was reviewed or changed. Refresh its status.')
    }
    const merged = {
      ...current,
      kuest: mergeLeg(current.kuest, attempt.kuest),
      polymarket: mergeLeg(current.polymarket, attempt.polymarket),
    }
    writeSnapshot(key, merged)
    return merged
  })
}

export async function dismissArbitrageAttemptSnapshot(key: string, expectedSnapshot: string) {
  return withAttemptLock(key, () => {
    if (getArbitrageAttemptSnapshot(key) !== expectedSnapshot) {
      throw new Error('The trade changed while it was being reviewed. Review the latest result.')
    }
    writeSnapshot(key, null, true)
  })
}
