import type { ReactNode } from 'react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { decodeFunctionData, erc20Abi } from 'viem'
import { polygon } from 'viem/chains'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({ send: mock(), receipt: mock(), trackEvent: mock() }))

void mock.module('@/hooks/useOperatorAnalytics', () => ({ useOperatorAnalytics: () => mocks.trackEvent }))

void mock.module('@/lib/network', () => ({
  DEFAULT_CHAIN_ID: 137,
  IS_TEST_MODE: false,
  DEFAULT_NETWORK_KEY: 'polygon',
  AMOY_CHAIN_ID: 80_002,
  POLYGON_MAINNET_CHAIN_ID: 137,
}))
void mock.module('wagmi', () => ({
  useWalletClient: () => ({ data: { chain: { id: 137 }, sendTransaction: mocks.send } }),
  usePublicClient: () => ({ waitForTransactionReceipt: mocks.receipt }),
}))
void mock.module('@/lib/viem-network', () => ({ defaultViemNetwork: polygon }))

const { useDirectUsdcDepositExecution } = await import('@/hooks/useDirectUsdcDepositExecution')

const fromAddress = '0x0000000000000000000000000000000000000001'
const toAddress = '0x0000000000000000000000000000000000000002'
let queryClient: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

beforeEach(() => {
  queryClient = new QueryClient()
  mocks.send.mockReset().mockResolvedValue('0xhash')
  mocks.receipt.mockReset().mockResolvedValue({ status: 'success', transactionHash: '0xhash' })
  mocks.trackEvent.mockReset()
})

describe('direct USDC deposit execution on Polygon', () => {
  it('transfers 804.78 USDC from the EOA to the deposit wallet and waits for confirmation', async () => {
    const { result } = renderHook(
      () => useDirectUsdcDepositExecution({ amountValue: '804.78', fromAddress, toAddress }),
      { wrapper },
    )
    await act(async () => {
      await result.current.execute()
    })
    const tx = mocks.send.mock.calls[0][0]
    expect(tx.account).toBe(fromAddress)
    expect(tx.chain.id).toBe(137)
    expect(tx.to).toBe('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359')
    expect(tx.value).toBe(0n)
    expect(decodeFunctionData({ abi: erc20Abi, data: tx.data })).toEqual({
      functionName: 'transfer',
      args: [toAddress, 804780000n],
    })
    expect(mocks.receipt).toHaveBeenCalledWith({ hash: '0xhash', onReplaced: expect.any(Function) })
    expect(mocks.trackEvent.mock.calls).toEqual([['deposit_confirmed']])
  })

  it('does not report success when the transaction reverts', async () => {
    mocks.receipt.mockResolvedValue({ status: 'reverted' })
    const { result } = renderHook(
      () => useDirectUsdcDepositExecution({ amountValue: '804.78', fromAddress, toAddress }),
      { wrapper },
    )
    await act(async () => {
      await expect(result.current.execute()).rejects.toThrow('Transaction reverted.')
    })
    expect(mocks.trackEvent).not.toHaveBeenCalled()
  })

  it('checks the broadcast hash after an RPC timeout, including after remounting', async () => {
    mocks.receipt.mockRejectedValueOnce(new Error('RPC timeout'))
    const first = renderHook(() => useDirectUsdcDepositExecution({ amountValue: '804.78', fromAddress, toAddress }), {
      wrapper,
    })
    await act(async () => {
      await expect(first.result.current.execute()).rejects.toThrow('RPC timeout')
    })
    await waitFor(() => expect(first.result.current.pendingTransaction?.hash).toBe('0xhash'))
    expect(mocks.trackEvent).not.toHaveBeenCalled()
    first.unmount()
    const second = renderHook(() => useDirectUsdcDepositExecution({ amountValue: '804.78', fromAddress, toAddress }), {
      wrapper,
    })
    await act(async () => {
      expect(await second.result.current.execute()).toBe('0xhash')
    })
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.receipt).toHaveBeenCalledTimes(2)
    expect(mocks.trackEvent.mock.calls).toEqual([['deposit_confirmed']])
  })

  it('does not mistake a pending LI.FI origin transaction for a confirmed direct deposit', async () => {
    queryClient.setQueryData(['wallet-deposit-transaction', fromAddress], {
      hash: '0xhash',
      chainId: 137,
      phase: 'deposit',
    })
    const { result } = renderHook(() => useDirectUsdcDepositExecution({ amountValue: '1', fromAddress, toAddress }), {
      wrapper,
    })
    await act(async () => {
      await result.current.execute()
    })
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.trackEvent).not.toHaveBeenCalled()
  })

  it('does not count a cancelled or replaced transfer', async () => {
    mocks.receipt.mockImplementationOnce(async ({ onReplaced }) => {
      onReplaced({ reason: 'cancelled', transaction: { hash: '0xcancel' } })
      return { status: 'success', transactionHash: '0xcancel' }
    })
    const { result } = renderHook(() => useDirectUsdcDepositExecution({ amountValue: '1', fromAddress, toAddress }), {
      wrapper,
    })
    await act(async () => {
      await expect(result.current.execute()).rejects.toThrow('Transaction was cancelled or replaced.')
    })
    expect(mocks.trackEvent).not.toHaveBeenCalled()
  })

  it('counts an overlapping receipt check only once', async () => {
    queryClient.setQueryData(['wallet-deposit-transaction', fromAddress], {
      hash: '0xhash',
      chainId: 137,
      phase: 'deposit',
      isDirectUsdcDeposit: true,
    })
    const { result } = renderHook(() => useDirectUsdcDepositExecution({ amountValue: '1', fromAddress, toAddress }), {
      wrapper,
    })
    await act(async () => {
      await Promise.all([result.current.execute(), result.current.execute()])
    })
    expect(mocks.trackEvent.mock.calls).toEqual([['deposit_confirmed']])
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('allows another send only after a confirmed revert', async () => {
    mocks.receipt.mockResolvedValueOnce({ status: 'reverted', transactionHash: '0xhash' })
    const { result } = renderHook(
      () => useDirectUsdcDepositExecution({ amountValue: '804.78', fromAddress, toAddress }),
      { wrapper },
    )
    await act(async () => {
      await expect(result.current.execute()).rejects.toThrow('Transaction reverted.')
    })
    await act(async () => {
      await result.current.execute()
    })
    expect(mocks.send).toHaveBeenCalledTimes(2)
  })
})
