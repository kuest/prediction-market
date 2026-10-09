import { useSyncExternalStore } from 'react'

import { getMeldCheckoutIdFromUrl, MELD_CHECKOUT_URL_EVENT } from '@/lib/payments/meld-return-channel'

function subscribeToMeldCheckoutUrl(onStoreChange: () => void) {
  window.addEventListener(MELD_CHECKOUT_URL_EVENT, onStoreChange)
  window.addEventListener('popstate', onStoreChange)

  return () => {
    window.removeEventListener(MELD_CHECKOUT_URL_EVENT, onStoreChange)
    window.removeEventListener('popstate', onStoreChange)
  }
}

function getMeldCheckoutServerSnapshot() {
  return null
}

export function useMeldCheckoutIdFromUrl() {
  return useSyncExternalStore(subscribeToMeldCheckoutUrl, getMeldCheckoutIdFromUrl, getMeldCheckoutServerSnapshot)
}
