import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, jest, mock, spyOn } from 'bun:test'

import { MeldReturnStatus } from '@/app/[locale]/payments/meld/return/MeldReturnStatus'
import {
  clearMeldPendingCheckout,
  getMeldCheckoutIdFromUrl,
  listMeldPendingCheckouts,
  removeMeldCheckoutIdFromUrl,
} from '@/lib/payments/meld-return-channel'

import { advanceTimersByTimeAsync, useFakeTimers, useRealTimers } from '../bun-test-helpers'

const mocks = {
  refetchBalance: mock(),
}
const checkoutId = '123e4567-e89b-12d3-a456-426614174000'
const pendingCheckoutKey = 'kuest:pending-meld-checkout'
function translate(value: string) {
  return value
}

void mock.module('next-intl', () => ({
  useExtracted: () => translate,
}))

void mock.module('@/hooks/useBalance', () => ({
  useBalance: () => ({ refetchBalance: mocks.refetchBalance }),
}))

afterEach(() => {
  useRealTimers()
  jest.restoreAllMocks()
  clearMeldPendingCheckout(checkoutId)
  window.localStorage.removeItem(pendingCheckoutKey)
  removeMeldCheckoutIdFromUrl(checkoutId)
  mocks.refetchBalance.mockReset()
})

describe('Meld return status polling', () => {
  it('clears the checkout and asks WalletFlow to close it when the Worker returns 404', async () => {
    window.localStorage.setItem(pendingCheckoutKey, checkoutId)
    const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }))
    const url = new URL(window.location.href)
    url.searchParams.set('meldCheckoutId', checkoutId)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    const onExpired = mock((expiredCheckoutId: string) => removeMeldCheckoutIdFromUrl(expiredCheckoutId))

    render(<MeldReturnStatus checkoutId={checkoutId} open onClose={() => undefined} onExpired={onExpired} />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onExpired).toHaveBeenCalledWith(checkoutId))
    expect(window.localStorage.getItem(pendingCheckoutKey)).toBeNull()
    expect(listMeldPendingCheckouts()).toEqual([])
    expect(getMeldCheckoutIdFromUrl()).toBeNull()
  })

  it('stops polling after an unauthenticated 401 response', async () => {
    window.localStorage.setItem(pendingCheckoutKey, checkoutId)
    const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }))
    useFakeTimers()

    render(<MeldReturnStatus checkoutId={checkoutId} open onClose={() => undefined} />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await advanceTimersByTimeAsync(10_000)
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const pendingCheckouts = JSON.parse(window.localStorage.getItem(pendingCheckoutKey) ?? 'null') as {
      checkoutId: string
      expiresAt: number
    }[]
    const pendingCheckout = pendingCheckouts.find((checkout) => checkout.checkoutId === checkoutId)
    expect(pendingCheckout?.checkoutId).toBe(checkoutId)
    expect(pendingCheckout?.expiresAt).toBeGreaterThan(Date.now())
  })
})
