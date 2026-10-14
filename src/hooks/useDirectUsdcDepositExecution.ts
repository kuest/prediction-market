import { useMutation } from '@tanstack/react-query'
import { encodeFunctionData, erc20Abi, parseUnits } from 'viem'
import { usePublicClient, useWalletClient } from 'wagmi'

import { useWalletDepositTransaction } from '@/hooks/useWalletDepositTransaction'
import { COLLATERAL_TOKEN_ADDRESS } from '@/lib/contracts'
import { sanitizeLiFiAmount } from '@/lib/lifi-amount'
import { DEFAULT_CHAIN_ID } from '@/lib/network'
import { defaultViemNetwork } from '@/lib/viem-network'

interface UseDirectUsdcDepositExecutionParams {
  amountValue: string
  fromAddress?: string | null
  toAddress?: string | null
}

export function useDirectUsdcDepositExecution({
  amountValue,
  fromAddress,
  toAddress,
}: UseDirectUsdcDepositExecutionParams) {
  const { data: walletClient } = useWalletClient()
  const { pendingTransaction, trackTransaction, checkPendingTransaction } = useWalletDepositTransaction(fromAddress)
  const publicClient = usePublicClient({ chainId: pendingTransaction?.chainId ?? DEFAULT_CHAIN_ID })

  const mutation = useMutation({
    mutationFn: async () => {
      if (!publicClient) {
        throw new Error('Public client not available.')
      }
      const pendingHash = await checkPendingTransaction(publicClient)
      if (pendingHash) {
        return pendingHash
      }
      if (!walletClient) {
        throw new Error('Wallet not connected.')
      }
      if (!fromAddress || !toAddress) {
        throw new Error('Missing wallet addresses.')
      }

      const sanitizedAmount = sanitizeLiFiAmount(amountValue, 6)
      let amount: bigint
      try {
        amount = parseUnits(sanitizedAmount, 6)
      } catch {
        throw new Error('Enter a valid amount.')
      }
      if (amount <= 0n) {
        throw new Error('Enter a valid amount.')
      }

      if (walletClient.chain?.id && walletClient.chain.id !== DEFAULT_CHAIN_ID) {
        throw new Error(`Switch wallet to ${defaultViemNetwork.name} before depositing.`)
      }

      const hash = await walletClient.sendTransaction({
        account: fromAddress as `0x${string}`,
        chain: defaultViemNetwork,
        to: COLLATERAL_TOKEN_ADDRESS,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [toAddress as `0x${string}`, amount],
        }),
        value: 0n,
      })

      trackTransaction({ hash, chainId: DEFAULT_CHAIN_ID, phase: 'deposit' })
      return await checkPendingTransaction(publicClient)
    },
  })

  return {
    execute: mutation.mutateAsync,
    isExecuting: mutation.isPending,
    executionError: mutation.error,
    executionHash: mutation.data,
    pendingTransaction,
  }
}
