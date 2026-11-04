'use server'

import type { ArbitrageExecution } from '@/lib/arbitrage-execution'

import { readArbitrageExecution } from '@/lib/arbitrage-execution'
import { UserRepository } from '@/lib/db/queries/user'
import { buildClobHmacSignature } from '@/lib/hmac'
import { resolvePublicRuntimeEnv } from '@/lib/public-runtime-config.shared'
import { getUserTradingAuthSecrets } from '@/lib/trading-auth/server'

export async function reconcileArbitrageOrder(orderId: string, tokenId: string): Promise<ArbitrageExecution> {
  const previous: ArbitrageExecution = { state: 'pending', orderId }
  if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(orderId) || !/^\d{1,78}$/u.test(tokenId)) {
    return { ...previous, state: 'unknown', error: 'Invalid order reference.' }
  }
  const user = await UserRepository.getCurrentUser({ minimal: true })
  const auth = user ? await getUserTradingAuthSecrets(user.id) : null
  if (!user?.deposit_wallet_address || !auth?.clob) {
    return { ...previous, state: 'unknown', error: 'Reconnect your trading session to verify this order.' }
  }
  const credentials = auth.clob
  const { clobUrl } = resolvePublicRuntimeEnv(process.env)
  async function read(path: string, query = '') {
    const timestamp = Math.floor(Date.now() / 1000)
    const response = await fetch(`${clobUrl}${path}${query}`, {
      headers: {
        Accept: 'application/json',
        KUEST_ADDRESS: user!.address,
        KUEST_API_KEY: credentials.key,
        KUEST_PASSPHRASE: credentials.passphrase,
        KUEST_TIMESTAMP: String(timestamp),
        KUEST_SIGNATURE: buildClobHmacSignature(credentials.secret, timestamp, 'GET', path),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) {
      throw new Error('The order status is temporarily unavailable.')
    }
    return response.json()
  }
  return readArbitrageExecution({
    previous,
    tokenId,
    readOrder: async (id) => {
      const order = await read(`/data/order/${encodeURIComponent(id)}`)
      if (
        typeof order?.maker_address !== 'string' ||
        order.maker_address.toLowerCase() !== user.deposit_wallet_address!.toLowerCase()
      ) {
        throw new Error('This order does not belong to the connected trading wallet.')
      }
      return order
    },
    readTrade: async (id) => {
      const page = await read('/data/trades', `?id=${encodeURIComponent(id)}`)
      return Array.isArray(page?.data) ? page.data : []
    },
  })
}
