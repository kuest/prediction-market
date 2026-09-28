import { afterEach, describe, expect, it, mock } from 'bun:test'

import { clearMeldPendingCheckout, MELD_CHECKOUT_PENDING_TTL_MS } from '@/lib/payments/meld-return-channel'
import { startMeldCheckout } from '@/lib/payments/start-meld-checkout'

const checkoutId = '123e4567-e89b-12d3-a456-426614174000'
const launchUrl = `https://payments.kuest.com/launch/${'L'.repeat(43)}`

afterEach(() => {
  clearMeldPendingCheckout(checkoutId)
  try {
    window.localStorage.removeItem('kuest:pending-meld-checkout')
  } catch {
    // Storage may be unavailable in the test environment.
  }
})

describe('startMeldCheckout', () => {
  it('creates the checkout and navigates the synchronously opened popup to the launch route', async () => {
    const fetcher = mock(
      async () =>
        new Response(JSON.stringify({ checkoutId, launchUrl }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    const replace = mock()
    const close = mock()
    const popup = { closed: false, close, location: { replace } }
    const navigate = mock()
    const onCheckoutCreated = mock()

    await startMeldCheckout(popup, { fetcher, navigate, onCheckoutCreated })

    expect(fetcher).toHaveBeenCalledWith('/api/payments/meld/checkouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(replace).toHaveBeenCalledWith(launchUrl)
    expect(navigate).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    const pendingCheckout = JSON.parse(window.localStorage.getItem('kuest:pending-meld-checkout') ?? 'null') as {
      checkoutId: string
      expiresAt: number
    }
    expect(pendingCheckout.checkoutId).toBe(checkoutId)
    expect(pendingCheckout.expiresAt).toBeGreaterThan(Date.now())
    expect(pendingCheckout.expiresAt).toBeLessThanOrEqual(Date.now() + MELD_CHECKOUT_PENDING_TTL_MS)
    expect(onCheckoutCreated).toHaveBeenCalledWith(checkoutId)
    expect(onCheckoutCreated.mock.invocationCallOrder[0]).toBeLessThan(replace.mock.invocationCallOrder[0])
  })

  it('continues in the current tab when the popup was blocked', async () => {
    const fetcher = mock(
      async () =>
        new Response(JSON.stringify({ checkoutId, launchUrl }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    const navigate = mock()

    await startMeldCheckout(null, { fetcher, navigate })

    expect(navigate).toHaveBeenCalledWith(launchUrl)
  })

  it('rejects launch URLs outside the shared Worker URL contract', async () => {
    const popup = { closed: false, close: mock(), location: { replace: mock() } }
    const fetcher = mock(
      async () =>
        new Response(JSON.stringify({ checkoutId, launchUrl: 'https://evil.example/launch/forged' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
    )

    let caughtError: unknown
    try {
      await startMeldCheckout(popup, { fetcher })
    } catch (error) {
      caughtError = error
    }

    expect(caughtError).toBeInstanceOf(Error)
    expect((caughtError as Error).message).toBe('checkout_creation_failed')
    expect(popup.close).toHaveBeenCalledTimes(1)
    expect(popup.location.replace).not.toHaveBeenCalled()
  })

  it('closes the pre-opened popup when checkout creation fails', async () => {
    const popup = { closed: false, close: mock(), location: { replace: mock() } }
    const fetcher = mock(async () => new Response(JSON.stringify({ error: 'payments_unavailable' }), { status: 502 }))

    let caughtError: unknown
    try {
      await startMeldCheckout(popup, { fetcher })
    } catch (error) {
      caughtError = error
    }

    expect(caughtError).toBeInstanceOf(Error)
    expect((caughtError as Error).message).toBe('checkout_creation_failed')
    expect(popup.close).toHaveBeenCalledTimes(1)
    expect(popup.location.replace).not.toHaveBeenCalled()
  })
})
