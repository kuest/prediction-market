import type { ArbitrageAttempt } from '@/lib/arbitrage-execution'

const CHANGED_EVENT = 'kuest:arbitrage-execution-changed'
const inMemory = new Map<string, string | null>()

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

export function saveArbitrageAttemptSnapshot(
  key: string,
  attempt: ArbitrageAttempt | null,
  requirePersistence = false,
) {
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
