import type { ReactNode } from 'react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import type { LiFiWalletTokenItem } from '@/hooks/useLiFiWalletTokens'

import { hoisted, stubGlobal, unstubAllGlobals } from '../bun-test-helpers'

const mocks = hoisted(() => ({ send: mock(), receipt: mock(), allowance: mock() }))
void mock.module('wagmi', () => ({
  useWalletClient: () => ({ data: { chain: { id: 137 }, sendTransaction: mocks.send } }),
  usePublicClient: () => ({ waitForTransactionReceipt: mocks.receipt, readContract: mocks.allowance }),
}))

const { useLiFiExecution } = await import('@/hooks/useLiFiExecution')
const params = {
  fromToken: {
    chainId: 137,
    address: '0x0000000000000000000000000000000000000003',
    decimals: 6,
  } as LiFiWalletTokenItem,
  amountValue: '804.78',
  fromAddress: '0x0000000000000000000000000000000000000001',
  toAddress: '0x0000000000000000000000000000000000000002',
}
let client: QueryClient
let fetchMock: ReturnType<typeof mock>
let approval: string | undefined
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient()
  approval = undefined
  mocks.send.mockReset().mockResolvedValue('0xswap')
  mocks.receipt.mockReset().mockResolvedValue({ status: 'success', transactionHash: '0xswap' })
  mocks.allowance.mockReset().mockResolvedValue(0n)
  fetchMock = mock(async (url: string) => ({
    ok: true,
    json: async () =>
      url.includes('step-transaction')
        ? { step: { transactionRequest: { to: params.toAddress, data: '0x', value: '0' } } }
        : { quote: { estimate: { approvalAddress: approval } } },
  }))
  stubGlobal('fetch', fetchMock)
})
afterEach(unstubAllGlobals)

describe('LI.FI deposit receipt recovery', () => {
  it('rechecks a swap after an RPC failure without another quote or send', async () => {
    mocks.receipt.mockRejectedValueOnce(new Error('RPC timeout'))
    const { result } = renderHook(() => useLiFiExecution(params), { wrapper })
    await act(async () => {
      await expect(result.current.execute()).rejects.toThrow('RPC timeout')
    })
    await act(async () => {
      expect(await result.current.execute()).toBe('0xswap')
    })
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mocks.receipt.mock.calls[1][0].hash).toBe('0xswap')
  })

  it('checks a pending approval before allowing the swap', async () => {
    approval = params.toAddress
    mocks.send.mockResolvedValueOnce('0xapproval')
    mocks.receipt.mockRejectedValueOnce(new Error('RPC timeout'))
    const { result } = renderHook(() => useLiFiExecution(params), { wrapper })
    await act(async () => {
      await expect(result.current.execute()).rejects.toThrow('RPC timeout')
    })
    mocks.allowance.mockResolvedValue(804780000n)
    await act(async () => {
      await result.current.execute()
    })
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(mocks.receipt.mock.calls.map(([request]) => request.hash)).toEqual(['0xapproval', '0xapproval', '0xswap'])
  })

  it('tracks a repriced hash when receipt lookup fails again', async () => {
    mocks.receipt.mockImplementationOnce(async ({ onReplaced }) => {
      onReplaced({ reason: 'repriced', transaction: { hash: '0xreplacement' } })
      throw new Error('RPC timeout')
    })
    mocks.receipt.mockResolvedValue({ status: 'success', transactionHash: '0xreplacement' })
    const { result } = renderHook(() => useLiFiExecution(params), { wrapper })
    await act(async () => {
      await expect(result.current.execute()).rejects.toThrow('RPC timeout')
    })
    await act(async () => {
      expect(await result.current.execute()).toBe('0xreplacement')
    })
    expect(mocks.receipt.mock.calls[1][0].hash).toBe('0xreplacement')
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })

  it('does not report a cancelled transaction as a successful deposit', async () => {
    mocks.receipt.mockImplementationOnce(async ({ onReplaced }) => {
      onReplaced({ reason: 'cancelled', transaction: { hash: '0xcancel' } })
      return { status: 'success', transactionHash: '0xcancel' }
    })
    const { result } = renderHook(() => useLiFiExecution(params), { wrapper })
    await act(async () => {
      await expect(result.current.execute()).rejects.toThrow('Transaction was cancelled or replaced.')
    })
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
})
