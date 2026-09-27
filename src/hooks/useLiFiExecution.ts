import { useMutation } from '@tanstack/react-query'
import { encodeFunctionData, erc20Abi, maxUint256, parseUnits } from 'viem'
import { usePublicClient, useWalletClient } from 'wagmi'

import type { LiFiWalletTokenItem } from '@/hooks/useLiFiWalletTokens'

import { ZERO_ADDRESS } from '@/lib/contracts'
import { sanitizeLiFiAmount } from '@/lib/lifi-amount'

interface UseLiFiExecutionParams {
  fromToken?: LiFiWalletTokenItem | null
  amountValue: string
  fromAddress?: string | null
  toAddress?: string | null
}

export function useLiFiExecution({ fromToken, amountValue, fromAddress, toAddress }: UseLiFiExecutionParams) {
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()

  const mutation = useMutation({
    mutationFn: async () => {
      if (!walletClient) {
        throw new Error('Wallet not connected.')
      }
      if (!publicClient) {
        throw new Error('Public client not available.')
      }
      if (!fromToken || !fromAddress || !toAddress) {
        throw new Error('Missing token or wallet addresses.')
      }

      const sanitizedAmount = sanitizeLiFiAmount(amountValue, fromToken.decimals)
      let fromAmountBigInt: bigint
      try {
        fromAmountBigInt = parseUnits(sanitizedAmount, fromToken.decimals)
      } catch {
        throw new Error('Enter a valid amount.')
      }
      if (fromAmountBigInt <= 0n) {
        throw new Error('Enter a valid amount.')
      }

      const fromAmount = fromAmountBigInt.toString()
      const quoteResponse = await fetch('/api/lifi/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fromChainId: fromToken.chainId,
          fromTokenAddress: fromToken.address,
          fromTokenDecimals: fromToken.decimals,
          fromAddress,
          toAddress,
          amount: sanitizedAmount,
        }),
      })

      if (!quoteResponse.ok) {
        throw new Error('Failed to fetch LI.FI quote.')
      }

      const quoteJson = await quoteResponse.json()
      const quoteStep = quoteJson?.quote

      if (!quoteStep?.estimate) {
        throw new Error('Invalid LI.FI quote response.')
      }
      const approvalAddress = quoteStep.estimate?.approvalAddress
      const requiresApproval = Boolean(
        approvalAddress &&
        fromToken.address.toLowerCase() !== ZERO_ADDRESS.toLowerCase() &&
        approvalAddress.toLowerCase() !== ZERO_ADDRESS.toLowerCase(),
      )

      if (requiresApproval) {
        const allowance = await publicClient.readContract({
          address: fromToken.address as `0x${string}`,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [fromAddress as `0x${string}`, approvalAddress as `0x${string}`],
        })

        if (allowance < BigInt(fromAmount)) {
          const approveHash = await walletClient.sendTransaction({
            account: fromAddress as `0x${string}`,
            chain: walletClient.chain,
            to: fromToken.address as `0x${string}`,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: 'approve',
              args: [approvalAddress as `0x${string}`, maxUint256],
            }),
            value: 0n,
          })

          await publicClient.waitForTransactionReceipt({ hash: approveHash })
        }
      }

      const stepResponse = await fetch('/api/lifi/step-transaction', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ step: quoteStep }),
      })

      if (!stepResponse.ok) {
        throw new Error('Failed to prepare LI.FI transaction.')
      }

      const stepJson = await stepResponse.json()
      const stepWithTx = stepJson?.step
      const tx = stepWithTx.transactionRequest

      if (!tx?.to) {
        throw new Error('No transaction request returned by LI.FI.')
      }

      const hash = await walletClient.sendTransaction({
        account: fromAddress as `0x${string}`,
        chain: walletClient.chain,
        to: tx.to as `0x${string}`,
        data: (tx.data ?? '0x') as `0x${string}`,
        value: tx.value ? BigInt(tx.value) : 0n,
        gas: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
      })

      await publicClient.waitForTransactionReceipt({ hash })

      return hash
    },
  })

  return {
    execute: mutation.mutateAsync,
    isExecuting: mutation.isPending,
    executionError: mutation.error,
    executionHash: mutation.data,
  }
}
