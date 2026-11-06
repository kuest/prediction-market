'use client'

import type { ApiKeyCreds } from '@polymarket/clob-client-v2'
import type { Address } from 'viem'
import type { Config } from 'wagmi'

import {
  ApiError,
  Chain,
  ClobClient,
  createL2Headers,
  isV2Order,
  orderToJsonV1,
  orderToJsonV2,
  OrderType,
  Side,
  SignatureTypeV2,
} from '@polymarket/clob-client-v2'
import { getConnections, getWalletClient, switchChain } from 'wagmi/actions'

import type { ArbitrageExecution } from '@/lib/arbitrage-execution'
import type { PolymarketTickSize } from '@/lib/polymarket-market'

import { parseArbitragePlacement, readArbitrageExecution } from '@/lib/arbitrage-execution'
import { POLYGON_MAINNET_CHAIN_ID } from '@/lib/network'
import { runOnPolymarketChain, selectPolymarketConnection } from '@/lib/polymarket-connection'

const credentialsByOwner = new Map<string, Promise<ApiKeyCreds>>()
const POLYMARKET_ORDER_PATH = '/order'
const POLYMARKET_CREDENTIALS_SESSION_PREFIX = 'kuest:polymarket-clob-credentials:'
export const POLYMARKET_MIN_MARKETABLE_BUY_AMOUNT = 1

export class PolymarketAuthenticationError extends Error {
  constructor(cause?: unknown) {
    super('Polymarket authentication failed.', { cause })
    this.name = 'PolymarketAuthenticationError'
  }
}

export async function deriveOrCreatePolymarketCredentials(client: Pick<ClobClient, 'deriveApiKey' | 'createApiKey'>) {
  try {
    return await client.deriveApiKey()
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 400) {
      throw error
    }
    return client.createApiKey()
  }
}

function getSessionCredentials(client: ClobClient, ownerAddress: Address) {
  const key = ownerAddress.toLowerCase()
  const cached = credentialsByOwner.get(key)
  if (cached) {
    return cached
  }

  const stored = readStoredSessionCredentials(key)
  const pending = stored
    ? Promise.resolve(stored)
    : deriveOrCreatePolymarketCredentials(client)
        .then((credentials) => {
          storeSessionCredentials(key, credentials)
          return credentials
        })
        .catch((error) => {
          credentialsByOwner.delete(key)
          throw new PolymarketAuthenticationError(error)
        })
  credentialsByOwner.set(key, pending)
  return pending
}

function readStoredSessionCredentials(ownerAddress: string) {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.sessionStorage.getItem(`${POLYMARKET_CREDENTIALS_SESSION_PREFIX}${ownerAddress}`)
    const value = raw ? (JSON.parse(raw) as Partial<ApiKeyCreds>) : null
    return value?.key && value.secret && value.passphrase
      ? { key: value.key, secret: value.secret, passphrase: value.passphrase }
      : null
  } catch {
    return null
  }
}

function storeSessionCredentials(ownerAddress: string, credentials: ApiKeyCreds) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.setItem(
      `${POLYMARKET_CREDENTIALS_SESSION_PREFIX}${ownerAddress}`,
      JSON.stringify(credentials),
    )
  } catch {}
}

interface PreparePolymarketOrderArgs {
  wagmiConfig: Config
  ownerAddress: Address
  funderAddress: Address
  signatureType: 0 | 1 | 2 | 3
  connectorId: string
  connectorUid: string
  tokenId: string
  price: number
  amount: number
  tickSize: PolymarketTickSize
}

export function buildPolymarketMarketOrder({
  tokenId,
  price,
  amount,
}: Pick<PreparePolymarketOrderArgs, 'tokenId' | 'price' | 'amount'>) {
  if (!Number.isFinite(amount) || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) {
    throw new Error('Polymarket BUY budget must use cents precision.')
  }
  if (amount < POLYMARKET_MIN_MARKETABLE_BUY_AMOUNT) {
    throw new Error('Polymarket marketable BUY amount must be at least $1.')
  }
  if (!Number.isFinite(price) || price <= 0 || price >= 1) {
    throw new Error('Invalid Polymarket price limit.')
  }
  return { tokenID: tokenId, price, amount, side: Side.BUY, orderType: OrderType.FOK as const }
}

export async function ensurePolymarketOrderReady(tokenId: string) {
  const params = new URLSearchParams({ tokenId })
  const response = await fetch(`/api/arbitrage/polymarket-order?${params}`, {
    cache: 'no-store',
  })
  const data = (await response.json().catch(() => null)) as { error?: unknown; ready?: unknown } | null
  if (!response.ok || data?.ready !== true) {
    throw new ApiError(
      typeof data?.error === 'string' ? data.error : 'Polymarket order service is temporarily unavailable.',
      response.status,
      data,
    )
  }
}

async function withPolymarketClient<T>(
  { wagmiConfig, ownerAddress, funderAddress, signatureType, connectorId, connectorUid }: PolymarketSessionArgs,
  operation: (
    client: ClobClient,
    signer: Awaited<ReturnType<typeof getWalletClient>>,
    creds: ApiKeyCreds,
  ) => Promise<T>,
) {
  const connection = selectPolymarketConnection(getConnections(wagmiConfig), {
    ownerAddress,
    connectorId,
    connectorUid,
  })
  if (!connection) {
    throw new Error('Polymarket wallet session is not connected.')
  }

  const connectionChainId = await connection.connector.getChainId()
  return runOnPolymarketChain({
    connectionChainId,
    switchToPolymarket: () =>
      switchChain(wagmiConfig, {
        chainId: POLYGON_MAINNET_CHAIN_ID,
        connector: connection.connector,
      }),
    restoreOriginalChain: () =>
      switchChain(wagmiConfig, {
        chainId: connectionChainId,
        connector: connection.connector,
      }),
    operation: async () => {
      const signer = await getWalletClient(wagmiConfig, {
        account: ownerAddress,
        chainId: POLYGON_MAINNET_CHAIN_ID,
        connector: connection.connector,
      })
      const authClient = new ClobClient({
        host: 'https://clob.polymarket.com',
        chain: Chain.POLYGON,
        signer,
        useServerTime: true,
        throwOnError: true,
      })
      const creds = await getSessionCredentials(authClient, ownerAddress)
      const client = new ClobClient({
        host: 'https://clob.polymarket.com',
        chain: Chain.POLYGON,
        signer,
        creds,
        signatureType:
          signatureType === 3
            ? SignatureTypeV2.POLY_1271
            : signatureType === 2
              ? SignatureTypeV2.POLY_GNOSIS_SAFE
              : signatureType === 1
                ? SignatureTypeV2.POLY_PROXY
                : SignatureTypeV2.EOA,
        funderAddress,
        useServerTime: true,
        throwOnError: true,
      })
      return operation(client, signer, creds)
    },
  })
}

type PolymarketSessionArgs = Omit<PreparePolymarketOrderArgs, 'tokenId' | 'price' | 'amount' | 'tickSize'>

export async function reconcilePolymarketOrder(
  args: PolymarketSessionArgs & { tokenId: string; orderId: string },
): Promise<ArbitrageExecution> {
  const previous: ArbitrageExecution = { state: 'pending', orderId: args.orderId }
  try {
    return await withPolymarketClient(args, async (client) =>
      readArbitrageExecution({
        previous,
        tokenId: args.tokenId,
        readOrder: (id) => client.getOrder(id),
        readTrade: (id) => client.getTrades({ id }, true),
      }),
    )
  } catch (error) {
    return {
      ...previous,
      state: 'unknown',
      error: error instanceof Error ? error.message : 'The order could not be verified.',
    }
  }
}

export async function preparePolymarketOrder(args: PreparePolymarketOrderArgs) {
  await ensurePolymarketOrderReady(args.tokenId)
  return withPolymarketClient(args, async (client, signer, creds) => {
    const negRisk = await client.getNegRisk(args.tokenId)
    const order = await client.createMarketOrder(buildPolymarketMarketOrder(args), { tickSize: args.tickSize, negRisk })
    if (BigInt(order.makerAmount) !== BigInt(Math.round(args.amount * 1_000_000))) {
      throw new Error('The signed budget changed. Refresh the arbitrage quote before signing again.')
    }
    const orderPayload = isV2Order(order)
      ? orderToJsonV2(order, creds.key, OrderType.FOK)
      : orderToJsonV1(order, creds.key, OrderType.FOK)
    let submitted = false
    return {
      post: async (): Promise<ArbitrageExecution> => {
        if (submitted) {
          return { state: 'unknown', error: 'This order was already submitted. Check its status before trading again.' }
        }
        submitted = true
        try {
          const body = JSON.stringify(orderPayload)
          const headers = await createL2Headers(
            signer,
            creds,
            {
              method: 'POST',
              requestPath: POLYMARKET_ORDER_PATH,
              body,
            },
            await client.getServerTime(),
          )
          const response = await fetch('/api/arbitrage/polymarket-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ headers, body }),
            signal: AbortSignal.timeout(20_000),
          })
          const data: unknown = await response.json().catch(() => null)
          if (!response.ok) {
            return {
              ...parseArbitragePlacement(data, 'polymarket'),
              state: 'unknown',
              error: 'The submission response could not be verified. Check the order before trading again.',
            }
          }
          return parseArbitragePlacement(data, 'polymarket')
        } catch {
          return { state: 'unknown', error: 'The submission response was lost. The order may have executed.' }
        }
      },
      reconcile: (previous: ArbitrageExecution) =>
        readArbitrageExecution({
          previous,
          tokenId: args.tokenId,
          readOrder: (id) => client.getOrder(id),
          readTrade: (id) => client.getTrades({ id }, true),
        }),
    }
  })
}
