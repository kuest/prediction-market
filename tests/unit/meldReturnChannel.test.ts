import { afterEach, describe, expect, it, spyOn } from 'bun:test'

import {
  clearMeldPendingCheckout,
  ensureMeldPendingCheckout,
  getMeldPendingCheckout,
  listMeldPendingCheckouts,
  MELD_CHECKOUT_PENDING_TTL_MS,
  persistMeldPendingCheckout,
  isMeldCheckoutId,
  isMeldCheckoutReturnMessage,
} from '@/lib/payments/meld-return-channel'

const checkoutIdA = '123e4567-e89b-12d3-a456-426614174000'
const checkoutIdB = '223e4567-e89b-12d3-a456-426614174000'
const checkoutIdC = '323e4567-e89b-12d3-a456-426614174000'
const storageKey = 'kuest:pending-meld-checkout'

afterEach(() => {
  clearMeldPendingCheckout(checkoutIdA)
  clearMeldPendingCheckout(checkoutIdB)
  clearMeldPendingCheckout(checkoutIdC)
  window.localStorage.removeItem(storageKey)
})

describe('Meld pending checkout storage', () => {
  it('validates checkout IDs and return messages', () => {
    expect(isMeldCheckoutId(checkoutIdA)).toBe(true)
    expect(isMeldCheckoutId('------------------------------------')).toBe(false)
    expect(isMeldCheckoutId('123e4567e-89b-12d3-a456-426614174000')).toBe(false)
    expect(isMeldCheckoutId('123e4567-e89b-12d3-a456-42661417400g')).toBe(false)
    expect(isMeldCheckoutReturnMessage({ type: 'return', checkoutId: checkoutIdA })).toBe(true)
    expect(isMeldCheckoutReturnMessage({ type: 'ack', checkoutId: checkoutIdA })).toBe(true)
    expect(isMeldCheckoutReturnMessage({ type: 'other', checkoutId: checkoutIdA })).toBe(false)
    expect(isMeldCheckoutReturnMessage(null)).toBe(false)
  })

  it('persists and returns two simultaneous checkouts', () => {
    const now = Date.now()

    persistMeldPendingCheckout(checkoutIdA, now)
    persistMeldPendingCheckout(checkoutIdB, now)

    const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null') as { checkoutId: string }[]
    expect(stored.map(({ checkoutId }) => checkoutId)).toEqual([checkoutIdA, checkoutIdB])
    expect(getMeldPendingCheckout(checkoutIdA, now)?.checkoutId).toBe(checkoutIdA)
    expect(getMeldPendingCheckout(checkoutIdB, now)?.checkoutId).toBe(checkoutIdB)
    expect(listMeldPendingCheckouts(now).map(({ checkoutId }) => checkoutId)).toEqual([checkoutIdA, checkoutIdB])

    const updatedNow = now + 1_000
    persistMeldPendingCheckout(checkoutIdA, updatedNow)
    const updatedStored = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null') as {
      checkoutId: string
      expiresAt: number
    }[]
    expect(updatedStored).toEqual([
      { checkoutId: checkoutIdB, expiresAt: now + MELD_CHECKOUT_PENDING_TTL_MS },
      { checkoutId: checkoutIdA, expiresAt: updatedNow + MELD_CHECKOUT_PENDING_TTL_MS },
    ])
  })

  it('loads the persisted list after reload and migrates both legacy formats', () => {
    const now = Date.now()
    const recordA = { checkoutId: checkoutIdA, expiresAt: now + MELD_CHECKOUT_PENDING_TTL_MS }
    const recordB = { checkoutId: checkoutIdB, expiresAt: now + MELD_CHECKOUT_PENDING_TTL_MS }

    window.localStorage.setItem(storageKey, JSON.stringify([recordA, recordB]))
    expect(listMeldPendingCheckouts(now).map(({ checkoutId }) => checkoutId)).toEqual([checkoutIdA, checkoutIdB])

    window.localStorage.setItem(storageKey, checkoutIdA)
    expect(listMeldPendingCheckouts(now).map(({ checkoutId }) => checkoutId)).toEqual([checkoutIdA])
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')).toEqual([recordA])

    window.localStorage.setItem(storageKey, JSON.stringify(recordB))
    expect(listMeldPendingCheckouts(now).map(({ checkoutId }) => checkoutId)).toEqual([checkoutIdB])
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')).toEqual([recordB])
  })

  it('removes only the requested checkout and prunes expired records individually', () => {
    const now = Date.now()
    persistMeldPendingCheckout(checkoutIdA, now - MELD_CHECKOUT_PENDING_TTL_MS)
    persistMeldPendingCheckout(checkoutIdB, now)

    expect(listMeldPendingCheckouts(now).map(({ checkoutId }) => checkoutId)).toEqual([checkoutIdB])
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')).toEqual([
      { checkoutId: checkoutIdB, expiresAt: now + MELD_CHECKOUT_PENDING_TTL_MS },
    ])

    persistMeldPendingCheckout(checkoutIdC, now)
    clearMeldPendingCheckout(checkoutIdB)

    const remaining = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null') as { checkoutId: string }[]
    expect(remaining.map(({ checkoutId }) => checkoutId)).toEqual([checkoutIdC])
    expect(getMeldPendingCheckout(checkoutIdB, now)).toBeNull()
    clearMeldPendingCheckout(checkoutIdC)
  })

  it('does not recreate an expired checkout when restoring its URL', () => {
    const now = Date.now()
    window.localStorage.setItem(storageKey, JSON.stringify([{ checkoutId: checkoutIdA, expiresAt: now - 1 }]))

    expect(ensureMeldPendingCheckout(checkoutIdA, now)).toBeNull()
    expect(listMeldPendingCheckouts(now)).toEqual([])
    expect(window.localStorage.getItem(storageKey)).toBeNull()
  })

  it('keeps simultaneous checkouts in memory when localStorage is unavailable', () => {
    const getItemSpy = spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage_unavailable')
    })
    const setItemSpy = spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage_unavailable')
    })

    try {
      persistMeldPendingCheckout(checkoutIdA)
      persistMeldPendingCheckout(checkoutIdB)

      expect(listMeldPendingCheckouts().map(({ checkoutId }) => checkoutId)).toEqual([checkoutIdA, checkoutIdB])
    } finally {
      getItemSpy.mockRestore()
      setItemSpy.mockRestore()
    }
  })

  it('repairs malformed storage from valid pending checkouts in memory', () => {
    persistMeldPendingCheckout(checkoutIdA)
    const validRecords = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null') as {
      checkoutId: string
      expiresAt: number
    }[]
    window.localStorage.setItem(storageKey, '{malformed-json')

    expect(listMeldPendingCheckouts().map(({ checkoutId }) => checkoutId)).toEqual([checkoutIdA])
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')).toEqual(validRecords)
  })
})
