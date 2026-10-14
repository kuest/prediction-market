import type { ReactNode } from 'react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { decodeFunctionData, erc20Abi } from 'viem'
import { polygon } from 'viem/chains'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({ send: mock(), receipt: mock() }))

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

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}

beforeEach(() => {
  mocks.send.mockReset().mockResolvedValue('0xhash')
  mocks.receipt.mockReset().mockResolvedValue({ status: 'success' })
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
    expect(mocks.receipt).toHaveBeenCalledWith({ hash: '0xhash' })
  })

  it('does not report success when the transaction reverts', async () => {
    mocks.receipt.mockResolvedValue({ status: 'reverted' })
    const { result } = renderHook(
      () => useDirectUsdcDepositExecution({ amountValue: '804.78', fromAddress, toAddress }),
      { wrapper },
    )
    await act(async () => {
      await expect(result.current.execute()).rejects.toThrow('USDC transfer reverted.')
    })
  })
})
