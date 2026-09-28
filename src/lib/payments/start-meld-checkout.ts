import { isPaymentsLaunchUrl } from '@/lib/payments/launch-url'
import {
  isMeldCheckoutId,
  persistMeldPendingCheckout,
  resumeMeldCheckoutPolling,
} from '@/lib/payments/meld-return-channel'

interface MeldCheckoutPopup {
  closed: boolean
  close: () => void
  location: { replace: (url: string) => void }
}

interface StartMeldCheckoutOptions {
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  navigate?: (url: string) => void
  onCheckoutCreated?: (checkoutId: string) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function startMeldCheckout(
  popup: MeldCheckoutPopup | null,
  {
    fetcher = fetch,
    navigate = (url) => window.location.assign(url),
    onCheckoutCreated,
  }: StartMeldCheckoutOptions = {},
): Promise<void> {
  try {
    const response = await fetcher('/api/payments/meld/checkouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    let result: unknown
    try {
      result = await response.json()
    } catch {
      throw new Error('checkout_creation_failed')
    }
    if (
      !response.ok ||
      !isRecord(result) ||
      !isMeldCheckoutId(result.checkoutId) ||
      !isPaymentsLaunchUrl(result.launchUrl)
    ) {
      throw new Error('checkout_creation_failed')
    }

    onCheckoutCreated?.(result.checkoutId)
    persistMeldPendingCheckout(result.checkoutId)
    resumeMeldCheckoutPolling(result.checkoutId)

    if (popup && !popup.closed) {
      popup.location.replace(result.launchUrl)
    } else {
      navigate(result.launchUrl)
    }
  } catch (error) {
    if (popup && !popup.closed) {
      popup.close()
    }
    throw error
  }
}
