'use client'

import type { SignTypedDataParameters } from 'wagmi/actions'

import type { WalletCall } from '@/lib/wallet/transactions'
import type { User } from '@/types'

import {
  getDepositWalletNonceAction,
  submitDepositWalletTransactionAction,
} from '@/app/[locale]/(platform)/_actions/approve-tokens'
import { DEFAULT_ERROR_MESSAGE } from '@/lib/constants'
import { DEFAULT_CHAIN_ID } from '@/lib/network'
import { isTradingAuthRequiredError } from '@/lib/trading-auth/errors'
import { isRecoverableWalletConnectorError, WALLET_CONNECTOR_NOT_CONNECTED_MESSAGE } from '@/lib/wallet'
import { buildWalletTransactionRequestPayload, getDepositWalletBatchTypedData } from '@/lib/wallet/transactions'

type SignTypedDataFn = (args: SignTypedDataParameters) => Promise<string>

const DEPOSIT_WALLET_NONCE_MISMATCH_ATTEMPTS = 3
const DEPOSIT_WALLET_NONCE_MISMATCH_BACKOFF_MS = 350
const DEPOSIT_WALLET_NONCE_MISMATCH_JITTER_MS = 200

export interface SignAndSubmitDepositWalletCallsResult {
  error: string | null
  code?: string
  txHash?: string
  approvals?: {
    enabled: boolean
    updatedAt: string
    version: string
  }
  autoRedeem?: {
    enabled: boolean
    updatedAt: string
    version: string
  }
}

export interface SignAndSubmitDepositWalletCallItemsResult<T> extends SignAndSubmitDepositWalletCallsResult {
  successfulItems: T[]
  failedItems: T[]
  partialFailure: boolean
  failure?: SignAndSubmitDepositWalletCallsResult
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function depositWalletNonceMismatchBackoffMs(attempt: number) {
  const backoff = DEPOSIT_WALLET_NONCE_MISMATCH_BACKOFF_MS * 2 ** Math.max(0, attempt - 1)
  const jitter = Math.floor(Math.random() * DEPOSIT_WALLET_NONCE_MISMATCH_JITTER_MS)
  return backoff + jitter
}

export class DepositWalletCallItemsSplitFallbackError<T> extends Error {
  readonly successfulItems: T[]
  readonly failedItems: T[]
  readonly originalError: unknown

  constructor(error: unknown, successfulItems: T[], failedItems: T[]) {
    super(error instanceof Error && error.message ? error.message : DEFAULT_ERROR_MESSAGE)
    this.name = 'DepositWalletCallItemsSplitFallbackError'
    this.successfulItems = successfulItems
    this.failedItems = failedItems
    this.originalError = error
  }
}

export async function signAndSubmitDepositWalletCalls({
  user,
  calls,
  metadata,
  signTypedDataAsync,
  onSigning,
  onSigned,
}: {
  user: Pick<User, 'address' | 'deposit_wallet_address'>
  calls: WalletCall[]
  metadata?: string
  signTypedDataAsync: SignTypedDataFn
  onSigning?: () => void
  onSigned?: () => void
}): Promise<SignAndSubmitDepositWalletCallsResult> {
  if (!user.deposit_wallet_address) {
    return { error: DEFAULT_ERROR_MESSAGE, code: 'missing_deposit_wallet' }
  }
  if (calls.length === 0) {
    return { error: DEFAULT_ERROR_MESSAGE, code: 'empty_wallet_calls' }
  }

  async function submitWithFreshSignature(): Promise<SignAndSubmitDepositWalletCallsResult> {
    const nonceResult = await getDepositWalletNonceAction(metadata)
    if (nonceResult.error || !nonceResult.nonce) {
      return {
        error: nonceResult.error ?? DEFAULT_ERROR_MESSAGE,
        code: nonceResult.code,
      }
    }

    const typedData = getDepositWalletBatchTypedData({
      chainId: DEFAULT_CHAIN_ID,
      depositWallet: user.deposit_wallet_address as `0x${string}`,
      calls,
      nonce: nonceResult.nonce,
    })

    onSigning?.()
    const signature = await signTypedDataAsync({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    })
    onSigned?.()

    const payload = buildWalletTransactionRequestPayload({
      from: user.address,
      nonce: nonceResult.nonce,
      signature,
      typedData,
      metadata,
    })

    return await submitDepositWalletTransactionAction(payload)
  }

  let lastNonceMismatch: SignAndSubmitDepositWalletCallsResult | null = null
  for (let attempt = 1; attempt <= DEPOSIT_WALLET_NONCE_MISMATCH_ATTEMPTS; attempt += 1) {
    let result: SignAndSubmitDepositWalletCallsResult
    try {
      result = await submitWithFreshSignature()
    } catch (error) {
      if (isRecoverableWalletConnectorError(error)) {
        return {
          error: WALLET_CONNECTOR_NOT_CONNECTED_MESSAGE,
          code: 'wallet_connector_not_connected',
        }
      }
      throw error
    }

    if (result.code !== 'wallet_nonce_mismatch') {
      return result
    }

    lastNonceMismatch = result
    if (attempt < DEPOSIT_WALLET_NONCE_MISMATCH_ATTEMPTS) {
      await sleep(depositWalletNonceMismatchBackoffMs(attempt))
    }
  }

  return lastNonceMismatch ?? { error: DEFAULT_ERROR_MESSAGE }
}

function shouldSplitDepositWalletCallFailure(result: SignAndSubmitDepositWalletCallsResult) {
  if (!result.error || result.code || isTradingAuthRequiredError(result.error)) {
    return false
  }

  const normalized = result.error.toLowerCase()
  return (
    normalized.includes('revert') ||
    normalized.includes('transaction failed') ||
    (normalized.includes('estimated gas') && normalized.includes('tx_gas_limit')) ||
    (normalized.includes('gas') && normalized.includes('exceeds') && normalized.includes('cap'))
  )
}

function getPreferredFailure(
  current: SignAndSubmitDepositWalletCallsResult | null,
  next: SignAndSubmitDepositWalletCallsResult,
) {
  if (!current || next.code === 'wallet_connector_not_connected') {
    return next
  }

  if (current.code === 'wallet_connector_not_connected') {
    return current
  }

  if (next.error && isTradingAuthRequiredError(next.error) && !isTradingAuthRequiredError(current.error)) {
    return next
  }

  return current
}

export async function signAndSubmitDepositWalletCallItemsWithSplitFallback<T>({
  user,
  items,
  getCall,
  metadata,
  signTypedDataAsync,
  maxChunkSize,
  onProgress,
}: {
  user: Pick<User, 'address' | 'deposit_wallet_address'>
  items: T[]
  getCall: (item: T) => WalletCall
  metadata?: string
  signTypedDataAsync: SignTypedDataFn
  maxChunkSize?: number
  onProgress?: (progress: { successfulItems: T[]; failedItems: T[] }) => void
}): Promise<SignAndSubmitDepositWalletCallItemsResult<T>> {
  const successfulItems: T[] = []
  const failedItems: T[] = []
  let lastSuccess: SignAndSubmitDepositWalletCallsResult | null = null
  let firstFailure: SignAndSubmitDepositWalletCallsResult | null = null

  function notifyProgress() {
    onProgress?.({
      successfulItems: [...successfulItems],
      failedItems: [...failedItems],
    })
  }

  async function submitChunk(chunk: T[], unprocessedAfterChunk: T[]): Promise<boolean> {
    let result: SignAndSubmitDepositWalletCallsResult
    try {
      result = await signAndSubmitDepositWalletCalls({
        user,
        calls: chunk.map(getCall),
        metadata,
        signTypedDataAsync,
      })
    } catch (error) {
      if (successfulItems.length > 0) {
        throw new DepositWalletCallItemsSplitFallbackError(error, successfulItems, [
          ...failedItems,
          ...chunk,
          ...unprocessedAfterChunk,
        ])
      }
      throw error
    }

    if (!result.error) {
      successfulItems.push(...chunk)
      lastSuccess = result
      notifyProgress()
      return true
    }

    firstFailure = getPreferredFailure(firstFailure, result)
    if (isTradingAuthRequiredError(result.error)) {
      failedItems.push(...chunk, ...unprocessedAfterChunk)
      notifyProgress()
      return false
    }

    if (chunk.length <= 1 || !shouldSplitDepositWalletCallFailure(result)) {
      failedItems.push(...chunk)
      notifyProgress()
      return true
    }

    const midpoint = Math.ceil(chunk.length / 2)
    const left = chunk.slice(0, midpoint)
    const right = chunk.slice(midpoint)
    const shouldContinueAfterLeft = await submitChunk(left, [...right, ...unprocessedAfterChunk])
    if (!shouldContinueAfterLeft) {
      return false
    }

    return await submitChunk(right, unprocessedAfterChunk)
  }

  const initialChunkSize = Math.max(
    1,
    Math.min(items.length || 1, Number.isFinite(maxChunkSize) ? Math.floor(maxChunkSize as number) : items.length || 1),
  )

  for (let index = 0; index < items.length; index += initialChunkSize) {
    const shouldContinue = await submitChunk(
      items.slice(index, index + initialChunkSize),
      items.slice(index + initialChunkSize),
    )
    if (!shouldContinue) {
      break
    }
  }

  if (successfulItems.length === 0) {
    return {
      ...(firstFailure ?? { error: DEFAULT_ERROR_MESSAGE }),
      successfulItems,
      failedItems: failedItems.length ? failedItems : items,
      partialFailure: false,
      failure: firstFailure ?? undefined,
    }
  }

  return {
    ...(lastSuccess ?? { error: null }),
    error: null,
    successfulItems,
    failedItems,
    partialFailure: failedItems.length > 0,
    failure: firstFailure ?? undefined,
  }
}
