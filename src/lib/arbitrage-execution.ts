export interface ArbitrageExecution {
  state: 'confirmed' | 'failed' | 'pending' | 'unknown'
  orderId?: string
  shares?: number
  principal?: number
  error?: string
}

type RecordValue = Record<string, unknown>

function record(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : null
}

function amount(value: unknown, scale = 1): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined
  }
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/u.test(value)) {
    return undefined
  }
  const parsed = Number(value) / scale
  return Number.isFinite(parsed) && parsed >= 0 && parsed * 1_000_000 <= Number.MAX_SAFE_INTEGER ? parsed : undefined
}

export function parseArbitragePlacement(value: unknown, venue: 'kuest' | 'polymarket'): ArbitrageExecution {
  const response = record(value)
  const rawOrderId = response?.orderID ?? response?.orderId
  const orderId = typeof rawOrderId === 'string' && rawOrderId ? rawOrderId : undefined
  if (response?.success === false) {
    return {
      state: orderId ? 'unknown' : 'failed',
      orderId,
      error: typeof response.errorMsg === 'string' ? response.errorMsg : 'The order was rejected.',
    }
  }
  if (response?.success !== true || !orderId) {
    return { state: 'unknown', orderId, error: 'The order result could not be verified.' }
  }
  const scale = venue === 'kuest' ? 1_000_000 : 1
  return {
    state: 'pending',
    orderId,
    shares: amount(response.takingAmount, scale),
    principal: amount(response.makingAmount, scale),
  }
}

async function readWithTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('The order status request timed out.')), 8_000)
      }),
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

export async function readArbitrageExecution({
  previous,
  tokenId,
  readOrder,
  readTrades,
}: {
  previous: ArbitrageExecution
  tokenId: string
  readOrder: (id: string) => Promise<unknown>
  readTrades: (market: string, cursor?: string, after?: string) => Promise<{ trades: unknown[]; nextCursor: string }>
}): Promise<ArbitrageExecution> {
  if (!previous.orderId || previous.state === 'failed' || previous.state === 'confirmed') {
    return previous
  }
  try {
    const order = record(await readWithTimeout(readOrder(previous.orderId)))
    if (!order || order.id !== previous.orderId || order.asset_id !== tokenId || order.side !== 'BUY') {
      throw new Error('The returned order does not match this trade.')
    }
    const status = (typeof order.status === 'string' ? order.status : '').toUpperCase()
    const matched = amount(order.size_matched)
    if (matched === undefined || typeof order.market !== 'string' || !order.market) {
      throw new Error('The order execution could not be verified.')
    }
    if (matched === 0) {
      if (['UNMATCHED', 'CANCELED', 'CANCELLED', 'EXPIRED', 'REJECTED'].includes(status)) {
        return { state: 'failed', orderId: previous.orderId, shares: 0, principal: 0 }
      }
      return { ...previous, state: 'pending' }
    }
    const rawCreatedAt = order.created_at
    const createdAt =
      typeof rawCreatedAt === 'number'
        ? rawCreatedAt < 1e12
          ? rawCreatedAt * 1000
          : rawCreatedAt
        : typeof rawCreatedAt === 'string' && /^\d+(?:\.\d+)?$/u.test(rawCreatedAt)
          ? Number(rawCreatedAt) < 1e12
            ? Number(rawCreatedAt) * 1000
            : Number(rawCreatedAt)
          : typeof rawCreatedAt === 'string'
            ? Date.parse(rawCreatedAt)
            : Number.NaN
    const after = Number.isFinite(createdAt) && createdAt > 0 ? String(Math.floor(createdAt / 1000) - 1) : undefined
    const scanStartedAt = Date.now()
    const trades: RecordValue[] = []
    const seenTrades = new Set<string>()
    const seenCursors = new Set<string>()
    let cursor: string | undefined
    let complete = false
    let discoveredShares = 0
    while (Date.now() - scanStartedAt < 30_000) {
      const page = await readWithTimeout(readTrades(order.market, cursor, after))
      if (!Array.isArray(page.trades) || typeof page.nextCursor !== 'string') {
        throw new Error('The trade history could not be verified.')
      }
      for (const value of page.trades) {
        const trade = record(value)
        if (trade?.taker_order_id !== previous.orderId) {
          continue
        }
        const isBuy = trade.side === 'BUY' || trade.side === 'buy'
        if (trade.asset_id !== tokenId || !isBuy || typeof trade.id !== 'string' || !trade.id) {
          return { ...previous, state: 'pending', error: 'Some fills are still being verified.' }
        }
        if (!seenTrades.has(trade.id)) {
          seenTrades.add(trade.id)
          trades.push(trade)
          const size = amount(trade.size)
          if (size === undefined || size <= 0) {
            throw new Error('A fill is missing its execution quantity.')
          }
          discoveredShares += size
        }
      }
      if (discoveredShares >= matched || page.nextCursor === 'LTE=') {
        complete = true
        break
      }
      if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
        break
      }
      seenCursors.add(page.nextCursor)
      cursor = page.nextCursor
    }
    if (!complete || !trades.length) {
      return { ...previous, state: 'pending', error: 'The order and its fills are still synchronizing.' }
    }
    if (
      trades.some(
        (trade) =>
          !['CONFIRMED', 'FAILED'].includes((typeof trade.status === 'string' ? trade.status : '').toUpperCase()),
      )
    ) {
      return { ...previous, state: 'pending' }
    }
    let shares = 0
    let matchedShares = 0
    let failed = false
    for (const trade of trades) {
      const size = amount(trade.size)
      if (size === undefined || size <= 0) {
        throw new Error('A fill is missing its execution quantity.')
      }
      matchedShares += size
      if ((typeof trade.status === 'string' ? trade.status : '').toUpperCase() === 'FAILED') {
        failed = true
        continue
      }
      if (typeof trade.transaction_hash !== 'string' || !/^0x[a-fA-F0-9]{64}$/u.test(trade.transaction_hash)) {
        throw new Error('A confirmed fill is missing its execution details.')
      }
      shares += size
    }
    if (Math.abs(matchedShares - matched) > 0.000001) {
      return { ...previous, state: 'pending', error: 'The order and its fills are still synchronizing.' }
    }
    if (!['MATCHED', 'FILLED', 'UNMATCHED', 'CANCELED', 'CANCELLED', 'EXPIRED'].includes(status)) {
      return { ...previous, state: 'pending' }
    }
    return {
      state: shares > 0 ? 'confirmed' : 'failed',
      orderId: previous.orderId,
      shares,
      principal: failed ? undefined : previous.principal,
      ...(failed ? { error: 'Some fills failed to settle.' } : {}),
    }
  } catch (error) {
    return {
      ...previous,
      state: 'unknown',
      error: error instanceof Error ? error.message : 'The order result could not be verified.',
    }
  }
}

export function summarizeArbitrageExecution(kuest: ArbitrageExecution, polymarket: ArbitrageExecution) {
  const finalized = [kuest, polymarket].every((leg) => leg.state === 'confirmed' || leg.state === 'failed')
  const kuestShares = kuest.state === 'confirmed' ? (kuest.shares ?? 0) : 0
  const polymarketShares = polymarket.state === 'confirmed' ? (polymarket.shares ?? 0) : 0
  return {
    finalized,
    balanced:
      finalized && kuestShares > 0 && polymarketShares > 0 && Math.abs(kuestShares - polymarketShares) <= 0.000001,
    matchedShares: finalized ? Math.min(kuestShares, polymarketShares) : undefined,
    kuestShares,
    polymarketShares,
  }
}

export interface ArbitrageAttempt {
  attemptId?: string
  kuest: ArbitrageExecution
  polymarket: ArbitrageExecution
  kuestTokenId: string
  polymarketTokenId: string
  kuestMaker: string
  polymarketOwner: string
  polymarketFunder: string
  signatureType: 0 | 1 | 2 | 3
  connectorId: string
  connectorUid: string
}

export function parseStoredArbitrageAttempt(value: unknown): ArbitrageAttempt | null {
  const attempt = record(value)
  if (
    !attempt ||
    (attempt.attemptId !== undefined &&
      (typeof attempt.attemptId !== 'string' || !attempt.attemptId || attempt.attemptId.length > 128)) ||
    !['kuestTokenId', 'polymarketTokenId', 'connectorId', 'connectorUid'].every(
      (key) => typeof attempt[key] === 'string' && Boolean(attempt[key]),
    )
  ) {
    return null
  }
  if (
    !['kuestMaker', 'polymarketOwner', 'polymarketFunder'].every(
      (key) => typeof attempt[key] === 'string' && /^0x[a-fA-F0-9]{40}$/u.test(attempt[key] as string),
    ) ||
    ![0, 1, 2, 3].includes(attempt.signatureType as number)
  ) {
    return null
  }
  for (const key of ['kuest', 'polymarket']) {
    const leg = record(attempt[key])
    if (
      !leg ||
      !['confirmed', 'failed', 'pending', 'unknown'].includes(typeof leg.state === 'string' ? leg.state : '') ||
      (leg.orderId !== undefined && typeof leg.orderId !== 'string') ||
      (leg.shares !== undefined && (typeof leg.shares !== 'number' || amount(leg.shares) === undefined)) ||
      (leg.error !== undefined && typeof leg.error !== 'string') ||
      (leg.principal !== undefined && (typeof leg.principal !== 'number' || amount(leg.principal) === undefined))
    ) {
      return null
    }
  }
  return attempt as unknown as ArbitrageAttempt
}
