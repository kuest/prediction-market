import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

import { useMeldCheckoutIdFromUrl } from '@/hooks/useMeldCheckoutIdFromUrl'
import { removeMeldCheckoutIdFromUrl, setMeldCheckoutIdInUrl } from '@/lib/payments/meld-return-channel'

const checkoutId = '123e4567-e89b-12d3-a456-426614174000'

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

function CheckoutStatus() {
  const id = useMeldCheckoutIdFromUrl()
  return createElement('output', null, id ?? 'closed')
}

describe('Meld checkout URL subscription', () => {
  it('restores the returned checkout on the client while keeping server rendering closed', () => {
    setMeldCheckoutIdInUrl(checkoutId)

    expect(renderToString(createElement(CheckoutStatus))).toBe('<output>closed</output>')

    const { result } = renderHook(() => useMeldCheckoutIdFromUrl())
    expect(result.current).toBe(checkoutId)
  })

  it('opens and closes when the checkout URL helpers update the return parameter', () => {
    const { result } = renderHook(() => useMeldCheckoutIdFromUrl())
    expect(result.current).toBeNull()

    act(() => setMeldCheckoutIdInUrl(checkoutId))
    expect(result.current).toBe(checkoutId)

    act(() => removeMeldCheckoutIdFromUrl(checkoutId))
    expect(result.current).toBeNull()
  })

  it('tracks browser navigation and ignores invalid checkout IDs', () => {
    const { result } = renderHook(() => useMeldCheckoutIdFromUrl())

    act(() => {
      window.history.replaceState(null, '', `/?meldCheckoutId=${checkoutId}`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(result.current).toBe(checkoutId)

    act(() => {
      window.history.replaceState(null, '', '/?meldCheckoutId=invalid')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(result.current).toBeNull()
  })
})
