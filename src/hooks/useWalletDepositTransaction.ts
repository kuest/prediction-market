import type { PublicClient } from 'viem'

import { useQuery, useQueryClient } from '@tanstack/react-query'

interface PendingDepositTransaction {
  hash: `0x${string}`
  chainId: number
  phase: 'approval' | 'deposit'
  replaced?: boolean
}

// Share the broadcast hash across both execution modes and modal remounts.
export function useWalletDepositTransaction(fromAddress?: string | null) {
  const queryClient = useQueryClient()
  const queryKey = ['wallet-deposit-transaction', fromAddress?.toLowerCase()]
  const { data: pendingTransaction } = useQuery<PendingDepositTransaction | null>({
    queryKey,
    queryFn: () => null,
    enabled: false,
    gcTime: Infinity,
  })

  function trackTransaction(transaction: PendingDepositTransaction) {
    queryClient.setQueryData(queryKey, transaction)
  }

  async function checkPendingTransaction(client: Pick<PublicClient, 'waitForTransactionReceipt'>) {
    const pending = queryClient.getQueryData<PendingDepositTransaction | null>(queryKey)
    if (!pending) {
      return null
    }

    // RPC errors/timeouts leave the hash intact. Only a confirmed receipt
    // allows clearing it; the next execution checks this hash before sending.
    const receipt = await client.waitForTransactionReceipt({
      hash: pending.hash,
      onReplaced: ({ transaction, reason }) => {
        trackTransaction({ ...pending, hash: transaction.hash, replaced: pending.replaced || reason !== 'repriced' })
      },
    })
    const settled = queryClient.getQueryData<PendingDepositTransaction>(queryKey)
    queryClient.setQueryData(queryKey, null)
    if (settled?.replaced) {
      throw new Error('Transaction was cancelled or replaced.')
    }
    if (receipt.status !== 'success') {
      throw new Error('Transaction reverted.')
    }
    return pending.phase === 'deposit' ? receipt.transactionHash : null
  }

  return { pendingTransaction, trackTransaction, checkPendingTransaction }
}
