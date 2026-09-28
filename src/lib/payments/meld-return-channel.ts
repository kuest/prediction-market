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
const memoryOnlyCheckouts = new Set<string>()
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

interface StoredPendingCheckouts {
  available: boolean
  records: MeldPendingCheckout[]
  expiredCheckoutIds: Set<string>
}

function writeStoredPendingCheckouts(records: MeldPendingCheckout[]): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    if (records.length === 0) {
      window.localStorage.removeItem(MELD_PENDING_CHECKOUT_STORAGE_KEY)
    } else {
      window.localStorage.setItem(MELD_PENDING_CHECKOUT_STORAGE_KEY, JSON.stringify(records))
    }
    return true
  } catch {
    return false
  }
}

function recoverPendingCheckoutsFromMemory(now: number): StoredPendingCheckouts {
  const recordsById = new Map<string, MeldPendingCheckout>()
  const expiredCheckoutIds = new Set<string>()

  for (const [checkoutId, record] of pendingCheckouts) {
    if (!isPendingCheckout(record) || record.expiresAt <= now) {
      pendingCheckouts.delete(checkoutId)
      memoryOnlyCheckouts.delete(checkoutId)
      unauthorizedCheckouts.delete(checkoutId)
      if (isPendingCheckout(record)) {
        expiredCheckoutIds.add(checkoutId)
      }
      continue
    }
    recordsById.set(record.checkoutId, record)
  }

  const records = [...recordsById.values()]
  if (writeStoredPendingCheckouts(records)) {
    for (const record of records) {
      memoryOnlyCheckouts.delete(record.checkoutId)
    }
  } else {
    for (const record of records) {
      memoryOnlyCheckouts.add(record.checkoutId)
    }
  }

  return { available: true, records, expiredCheckoutIds }
}

function readStoredPendingCheckouts(now: number): StoredPendingCheckouts {
  if (typeof window === 'undefined') {
    return { available: false, records: [], expiredCheckoutIds: new Set() }
  }

  let raw: string | null
  try {
    raw = window.localStorage.getItem(MELD_PENDING_CHECKOUT_STORAGE_KEY)
  } catch {
    return { available: false, records: [], expiredCheckoutIds: new Set() }
  }

  if (!raw) {
    return { available: true, records: [], expiredCheckoutIds: new Set() }
  }

  let storedValues: unknown[]
  let needsRewrite = false
  if (isMeldCheckoutId(raw)) {
    const legacyMemoryRecord = memoryOnlyCheckouts.has(raw) ? pendingCheckouts.get(raw) : undefined
    storedValues = [legacyMemoryRecord ?? { checkoutId: raw, expiresAt: now + MELD_CHECKOUT_PENDING_TTL_MS }]
    needsRewrite = true
  } else {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        storedValues = parsed
      } else if (isPendingCheckout(parsed)) {
        storedValues = [parsed]
        needsRewrite = true
      } else {
        return recoverPendingCheckoutsFromMemory(now)
      }
    } catch {
      return recoverPendingCheckoutsFromMemory(now)
    }
  }

  const recordsById = new Map<string, MeldPendingCheckout>()
  const expiredCheckoutIds = new Set<string>()
  for (const value of storedValues) {
    if (!isPendingCheckout(value)) {
      needsRewrite = true
      continue
    }
    if (value.expiresAt <= now) {
      expiredCheckoutIds.add(value.checkoutId)
      unauthorizedCheckouts.delete(value.checkoutId)
      needsRewrite = true
      continue
    }
    if (recordsById.has(value.checkoutId)) {
      needsRewrite = true
    }
    recordsById.set(value.checkoutId, value)
  }

  const records = [...recordsById.values()]
  if (needsRewrite) {
    if (writeStoredPendingCheckouts(records)) {
      for (const record of records) {
        memoryOnlyCheckouts.delete(record.checkoutId)
      }
    } else {
      for (const record of records) {
        memoryOnlyCheckouts.add(record.checkoutId)
      }
    }
  }

  return { available: true, records, expiredCheckoutIds }
}

function loadPendingCheckouts(now: number): { records: MeldPendingCheckout[]; expiredCheckoutIds: Set<string> } {
  const stored = readStoredPendingCheckouts(now)
  const expiredCheckoutIds = stored.expiredCheckoutIds

  for (const [checkoutId, record] of pendingCheckouts) {
    if (record.expiresAt <= now) {
      expiredCheckoutIds.add(checkoutId)
      pendingCheckouts.delete(checkoutId)
      memoryOnlyCheckouts.delete(checkoutId)
      unauthorizedCheckouts.delete(checkoutId)
    }
  }

  if (stored.available) {
    const memoryOnlyRecords = [...pendingCheckouts.values()].filter((record) =>
      memoryOnlyCheckouts.has(record.checkoutId),
    )
    pendingCheckouts.clear()
    for (const record of stored.records) {
      pendingCheckouts.set(record.checkoutId, record)
    }
    for (const record of memoryOnlyRecords) {
      pendingCheckouts.delete(record.checkoutId)
      pendingCheckouts.set(record.checkoutId, record)
    }
    for (const checkoutId of unauthorizedCheckouts) {
      if (!pendingCheckouts.has(checkoutId)) {
        unauthorizedCheckouts.delete(checkoutId)
      }
    }
  }

  const records = [...pendingCheckouts.values()]
  for (const record of records) {
    expiredCheckoutIds.delete(record.checkoutId)
  }

  return { records, expiredCheckoutIds }
}

function persistPendingCheckoutSnapshot(): void {
  const records = [...pendingCheckouts.values()]
  if (writeStoredPendingCheckouts(records)) {
    memoryOnlyCheckouts.clear()
    return
  }

  memoryOnlyCheckouts.clear()
  for (const record of records) {
    memoryOnlyCheckouts.add(record.checkoutId)
  }
}

function updatePendingCheckout(record: MeldPendingCheckout): void {
  pendingCheckouts.delete(record.checkoutId)
  pendingCheckouts.set(record.checkoutId, record)
  unauthorizedCheckouts.delete(record.checkoutId)
}

export function persistMeldPendingCheckout(checkoutId: string, now = Date.now()): MeldPendingCheckout | null {
  if (!isMeldCheckoutId(checkoutId)) {
    return null
  }

  loadPendingCheckouts(now)
  const record = { checkoutId, expiresAt: now + MELD_CHECKOUT_PENDING_TTL_MS }
  updatePendingCheckout(record)
  persistPendingCheckoutSnapshot()
  return record
}

export function getMeldPendingCheckout(checkoutId?: string, now = Date.now()): MeldPendingCheckout | null {
  const { records } = loadPendingCheckouts(now)

  if (checkoutId !== undefined) {
    if (!isMeldCheckoutId(checkoutId)) {
      return null
    }
    return records.find((record) => record.checkoutId === checkoutId) ?? null
  }

  return records.at(-1) ?? null
}

export function ensureMeldPendingCheckout(checkoutId: string, now = Date.now()): MeldPendingCheckout | null {
  if (!isMeldCheckoutId(checkoutId)) {
    return null
  }

  const { records, expiredCheckoutIds } = loadPendingCheckouts(now)
  if (expiredCheckoutIds.has(checkoutId)) {
    persistPendingCheckoutSnapshot()
    return null
  }
  const existing = records.find((record) => record.checkoutId === checkoutId)
  if (existing) {
    return existing
  }

  const record = { checkoutId, expiresAt: now + MELD_CHECKOUT_PENDING_TTL_MS }
  updatePendingCheckout(record)
  persistPendingCheckoutSnapshot()
  return record
}

export function listMeldPendingCheckouts(now = Date.now()): MeldPendingCheckout[] {
  const { records, expiredCheckoutIds } = loadPendingCheckouts(now)
  if (expiredCheckoutIds.size > 0) {
    persistPendingCheckoutSnapshot()
  }
  return records
}

export function clearMeldPendingCheckout(checkoutId: string): void {
  if (!isMeldCheckoutId(checkoutId)) {
    return
  }

  loadPendingCheckouts(Date.now())
  pendingCheckouts.delete(checkoutId)
  memoryOnlyCheckouts.delete(checkoutId)
  unauthorizedCheckouts.delete(checkoutId)
  persistPendingCheckoutSnapshot()

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
