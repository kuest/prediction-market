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
  readTrade,
}: {
  previous: ArbitrageExecution
  tokenId: string
  readOrder: (id: string) => Promise<unknown>
  readTrade: (id: string) => Promise<unknown[]>
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
    const ids = Array.isArray(order.associate_trades)
      ? [...new Set(order.associate_trades.filter((id): id is string => typeof id === 'string' && Boolean(id)))]
      : []
    if (matched === undefined || ids.length > 500) {
      throw new Error('The order execution could not be verified.')
    }
    if (!ids.length) {
      if (matched === 0 && ['UNMATCHED', 'CANCELED', 'CANCELLED', 'EXPIRED', 'REJECTED'].includes(status)) {
        return { state: 'failed', orderId: previous.orderId, shares: 0, principal: 0 }
      }
      return { ...previous, state: 'pending' }
    }
    const trades: RecordValue[] = []
    for (let offset = 0; offset < ids.length; offset += 8) {
      const chunk = ids.slice(offset, offset + 8)
      const pages = await Promise.all(chunk.map((id) => readWithTimeout(readTrade(id))))
      for (let index = 0; index < chunk.length; index += 1) {
        const trade = pages[index]?.map(record).find((item) => item?.id === chunk[index])
        const isBuy = trade?.side === 'BUY' || trade?.side === 'buy'
        if (!trade || trade.taker_order_id !== previous.orderId || trade.asset_id !== tokenId || !isBuy) {
          return { ...previous, state: 'pending', error: 'Some fills are still being verified.' }
        }
        trades.push(trade)
      }
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
