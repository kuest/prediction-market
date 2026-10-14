import type { ReactNode } from 'react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'

import type { LiFiWalletTokenItem } from '@/hooks/useLiFiWalletTokens'

import { useLiFiQuote } from '@/hooks/useLiFiQuote'

import { stubGlobal, unstubAllGlobals } from '../bun-test-helpers'

const params = {
  fromToken: { id: '137:usdc', chainId: 137, address: '0xtoken', decimals: 6 } as LiFiWalletTokenItem,
  amountValue: '804.78',
  fromAddress: '0xsource',
  toAddress: '0xdestination',
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(unstubAllGlobals)

describe('useLiFiQuote', () => {
  it('reports a failed quote and allows a successful retry', async () => {
    const fetchMock = mock()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ quote: { estimate: { toAmount: '804780000' }, action: { toToken: { decimals: 6 } } } }),
      })
    stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useLiFiQuote(params), { wrapper })

    await waitFor(() => expect(result.current.isQuoteError).toBe(true))
    expect(result.current.isLoadingQuote).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.refetchQuote()
    })
    await waitFor(() => expect(result.current.quote?.toAmountDisplay).toBe('804.78'))
    expect(result.current.isQuoteError).toBe(false)
  })

  it('reports invalid responses rather than displaying a zero amount', async () => {
    stubGlobal('fetch', mock().mockResolvedValue({ ok: true, json: async () => ({}) }))
    const { result } = renderHook(() => useLiFiQuote(params), { wrapper })
    await waitFor(() => expect(result.current.isQuoteError).toBe(true))
    expect(result.current.quote).toBeUndefined()
  })

  it('does not fetch a quote when disabled for a direct deposit', () => {
    const fetchMock = mock()
    stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useLiFiQuote({ ...params, enabled: false }), { wrapper })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.isLoadingQuote).toBe(false)
  })

  it.each(['invalid', '123abc', 'NaN', 'Infinity', '0', '-1', '1.5', '1e9', '9'.repeat(400)])(
    'rejects malformed or non-positive output amount %s',
    async (toAmount) => {
      stubGlobal(
        'fetch',
        mock().mockResolvedValue({
          ok: true,
          json: async () => ({
            quote: {
              estimate: { toAmount },
              action: { toToken: { decimals: 6 } },
            },
          }),
        }),
      )
      const { result } = renderHook(() => useLiFiQuote(params), { wrapper })
      await waitFor(() => expect(result.current.isQuoteError).toBe(true))
      expect(result.current.quote).toBeUndefined()
    },
  )

  it.each([-1, 1.5, 'invalid', 256])('rejects invalid output decimals %s', async (decimals) => {
    stubGlobal(
      'fetch',
      mock().mockResolvedValue({
        ok: true,
        json: async () => ({
          quote: {
            estimate: { toAmount: '804780000' },
            action: { toToken: { decimals } },
          },
        }),
      }),
    )
    const { result } = renderHook(() => useLiFiQuote(params), { wrapper })
    await waitFor(() => expect(result.current.isQuoteError).toBe(true))
    expect(result.current.quote).toBeUndefined()
  })
})
