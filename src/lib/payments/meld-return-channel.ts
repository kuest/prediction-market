export const MELD_CHECKOUT_RETURN_CHANNEL = 'kuest:meld-checkout-return'
export const MELD_CHECKOUT_POLL_EVENT = 'kuest:meld-checkout-poll'
export const MELD_CHECKOUT_CLEARED_EVENT = 'kuest:meld-checkout-cleared'
const MELD_PENDING_CHECKOUT_STORAGE_KEY = 'kuest:pending-meld-checkout'
export const MELD_CHECKOUT_PENDING_TTL_MS = 24 * 60 * 60 * 1_000
const MELD_CHECKOUT_MAX_POLL_DELAY_MS = 5 * 60 * 1_000

export interface MeldCheckoutReturnMessage {
  type: 'return' | 'ack'
  checkoutId: string
}

export interface MeldPendingCheckout {
  checkoutId: string
  expiresAt: number
}

const pendingCheckouts = new Map<string, MeldPendingCheckout>()
const unauthorizedCheckouts = new Set<string>()

export function isMeldCheckoutId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)
}

export function isMeldCheckoutReturnMessage(value: unknown): value is MeldCheckoutReturnMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const message = value as Record<string, unknown>
  return (message.type === 'return' || message.type === 'ack') && isMeldCheckoutId(message.checkoutId)
}

export function getMeldCheckoutPollDelay(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0
  return Math.min(10_000 * 2 ** Math.min(safeAttempt, 10), MELD_CHECKOUT_MAX_POLL_DELAY_MS)
}

function isPendingCheckout(value: unknown): value is MeldPendingCheckout {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    isMeldCheckoutId(record.checkoutId) && typeof record.expiresAt === 'number' && Number.isFinite(record.expiresAt)
  )
}

function readStoredPendingCheckout(now: number): MeldPendingCheckout | null {
  if (typeof window === 'undefined') {
    return null
  }

  let raw: string | null
  try {
    raw = window.localStorage.getItem(MELD_PENDING_CHECKOUT_STORAGE_KEY)
  } catch {
    return null
  }

  if (!raw) {
    return null
  }

  let record: MeldPendingCheckout | null = null
  let needsMigration = false

  if (isMeldCheckoutId(raw)) {
    record = { checkoutId: raw, expiresAt: now + MELD_CHECKOUT_PENDING_TTL_MS }
    needsMigration = true
  } else {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (isPendingCheckout(parsed)) {
        record = parsed
      }
    } catch {
      // Invalid storage data is removed below.
    }
  }

  if (!record) {
    try {
      window.localStorage.removeItem(MELD_PENDING_CHECKOUT_STORAGE_KEY)
    } catch {
      // Storage is optional.
    }
    return null
  }

  if (record.expiresAt <= now) {
    pendingCheckouts.delete(record.checkoutId)
    unauthorizedCheckouts.delete(record.checkoutId)
    try {
      window.localStorage.removeItem(MELD_PENDING_CHECKOUT_STORAGE_KEY)
    } catch {
      // Storage is optional.
    }
    return null
  }

  pendingCheckouts.set(record.checkoutId, record)
  if (needsMigration) {
    try {
      window.localStorage.setItem(MELD_PENDING_CHECKOUT_STORAGE_KEY, JSON.stringify(record))
    } catch {
      // The migrated value remains available in memory for this page session.
    }
  }

  return record
}

function pruneExpiredMemoryRecords(now: number) {
  for (const [checkoutId, record] of pendingCheckouts) {
    if (record.expiresAt <= now) {
      pendingCheckouts.delete(checkoutId)
      unauthorizedCheckouts.delete(checkoutId)
    }
  }
}

function writePendingCheckout(record: MeldPendingCheckout) {
  pendingCheckouts.set(record.checkoutId, record)
  unauthorizedCheckouts.delete(record.checkoutId)

  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(MELD_PENDING_CHECKOUT_STORAGE_KEY, JSON.stringify(record))
  } catch {
    // Keep the deadline in memory when browser storage is unavailable.
  }
}

export function persistMeldPendingCheckout(checkoutId: string, now = Date.now()): MeldPendingCheckout | null {
  if (!isMeldCheckoutId(checkoutId)) {
    return null
  }

  const record = { checkoutId, expiresAt: now + MELD_CHECKOUT_PENDING_TTL_MS }
  writePendingCheckout(record)
  return record
}

export function getMeldPendingCheckout(checkoutId?: string, now = Date.now()): MeldPendingCheckout | null {
  pruneExpiredMemoryRecords(now)
  const storedRecord = readStoredPendingCheckout(now)

  if (checkoutId !== undefined) {
    if (!isMeldCheckoutId(checkoutId)) {
      return null
    }
    const inMemoryRecord = pendingCheckouts.get(checkoutId)
    if (inMemoryRecord && inMemoryRecord.expiresAt > now) {
      return inMemoryRecord
    }
    return storedRecord?.checkoutId === checkoutId ? storedRecord : null
  }

  if (storedRecord) {
    return storedRecord
  }

  const memoryRecords = [...pendingCheckouts.values()]
  return memoryRecords.at(-1) ?? null
}

export function ensureMeldPendingCheckout(checkoutId: string, now = Date.now()): MeldPendingCheckout | null {
  if (!isMeldCheckoutId(checkoutId)) {
    return null
  }

  const inMemoryRecord = pendingCheckouts.get(checkoutId)
  if (inMemoryRecord) {
    if (inMemoryRecord.expiresAt <= now) {
      pendingCheckouts.delete(checkoutId)
      unauthorizedCheckouts.delete(checkoutId)
      removeExpiredStoredPendingCheckout(checkoutId, now)
      return null
    }
    return inMemoryRecord
  }
  if (removeExpiredStoredPendingCheckout(checkoutId, now)) {
    return null
  }

  const existing = getMeldPendingCheckout(checkoutId, now)
  if (existing) {
    return existing
  }

  const storedRecord = readStoredPendingCheckout(now)
  const record = { checkoutId, expiresAt: now + MELD_CHECKOUT_PENDING_TTL_MS }
  pendingCheckouts.set(checkoutId, record)

  // There is one legacy storage slot. Keep its active checkout when another ID is already stored.
  if (!storedRecord || storedRecord.checkoutId === checkoutId) {
    try {
      window.localStorage.setItem(MELD_PENDING_CHECKOUT_STORAGE_KEY, JSON.stringify(record))
    } catch {
      // The checkout and its expiry remain available in memory.
    }
  }

  return record
}

function removeExpiredStoredPendingCheckout(checkoutId: string, now: number): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    const raw = window.localStorage.getItem(MELD_PENDING_CHECKOUT_STORAGE_KEY)
    if (!raw || isMeldCheckoutId(raw)) {
      return false
    }

    const parsed: unknown = JSON.parse(raw)
    if (!isPendingCheckout(parsed) || parsed.checkoutId !== checkoutId || parsed.expiresAt > now) {
      return false
    }

    window.localStorage.removeItem(MELD_PENDING_CHECKOUT_STORAGE_KEY)
    pendingCheckouts.delete(checkoutId)
    unauthorizedCheckouts.delete(checkoutId)
    return true
  } catch {
    return false
  }
}

export function listMeldPendingCheckouts(now = Date.now()): MeldPendingCheckout[] {
  pruneExpiredMemoryRecords(now)
  const storedRecord = readStoredPendingCheckout(now)
  if (storedRecord) {
    pendingCheckouts.set(storedRecord.checkoutId, storedRecord)
  }
  return [...pendingCheckouts.values()].filter((record) => record.expiresAt > now)
}

export function clearMeldPendingCheckout(checkoutId: string): void {
  if (!isMeldCheckoutId(checkoutId)) {
    return
  }

  const storedRecord = readStoredPendingCheckout(Date.now())
  pendingCheckouts.delete(checkoutId)
  unauthorizedCheckouts.delete(checkoutId)

  if (typeof window !== 'undefined' && storedRecord?.checkoutId === checkoutId) {
    try {
      window.localStorage.removeItem(MELD_PENDING_CHECKOUT_STORAGE_KEY)
    } catch {
      // Storage is optional.
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MELD_CHECKOUT_CLEARED_EVENT, { detail: checkoutId }))
  }
}

export function markMeldCheckoutUnauthorized(checkoutId: string): void {
  if (isMeldCheckoutId(checkoutId)) {
    unauthorizedCheckouts.add(checkoutId)
  }
}

export function isMeldCheckoutUnauthorized(checkoutId: string): boolean {
  return isMeldCheckoutId(checkoutId) && unauthorizedCheckouts.has(checkoutId)
}

export function resumeMeldCheckoutPolling(checkoutId: string): boolean {
  if (
    typeof window === 'undefined' ||
    !isMeldCheckoutId(checkoutId) ||
    isMeldCheckoutUnauthorized(checkoutId) ||
    !getMeldPendingCheckout(checkoutId)
  ) {
    return false
  }

  window.dispatchEvent(new CustomEvent(MELD_CHECKOUT_POLL_EVENT, { detail: checkoutId }))
  return true
}

export function getMeldCheckoutIdFromUrl(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const checkoutId = new URL(window.location.href).searchParams.get('meldCheckoutId')
  return isMeldCheckoutId(checkoutId) ? checkoutId : null
}

export function setMeldCheckoutIdInUrl(checkoutId: string): void {
  if (typeof window === 'undefined' || !isMeldCheckoutId(checkoutId)) {
    return
  }

  const url = new URL(window.location.href)
  url.searchParams.set('meldCheckoutId', checkoutId)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

export function removeMeldCheckoutIdFromUrl(checkoutId?: string): void {
  if (typeof window === 'undefined') {
    return
  }

  const url = new URL(window.location.href)
  const currentCheckoutId = url.searchParams.get('meldCheckoutId')
  if (checkoutId !== undefined && currentCheckoutId !== checkoutId) {
    return
  }

  url.searchParams.delete('meldCheckoutId')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}
