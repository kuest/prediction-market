import type { ArbitrageAttempt } from '@/lib/arbitrage-execution'

const CHANGED_EVENT = 'kuest:arbitrage-execution-changed'
const inMemory = new Map<string, string | null>()

export function subscribeArbitrageAttempt(onChange: () => void) {
  window.addEventListener(CHANGED_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(CHANGED_EVENT, onChange)
    window.removeEventListener('storage', onChange)
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
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

export function saveArbitrageAttemptSnapshot(
  key: string,
  attempt: ArbitrageAttempt | null,
  requirePersistence = false,
) {
  const serialized = attempt ? JSON.stringify(attempt) : null
  try {
    if (serialized) {
      window.sessionStorage.setItem(key, serialized)
    } else {
      window.sessionStorage.removeItem(key)
    }
  } catch (error) {
    if (requirePersistence) {
      throw error
    }
    // After submission, retain newer IDs in memory even if browser storage becomes unavailable.
  }
  inMemory.set(key, serialized)
  window.dispatchEvent(new Event(CHANGED_EVENT))
}
