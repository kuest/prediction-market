'use server'

import { getExtracted } from 'next-intl/server'
import { updateTag } from 'next/cache'
import { z } from 'zod'

import type { SupportedLocale } from '@/i18n/locales'
import type { ArbitrageExecution } from '@/lib/arbitrage-execution'

import { DEFAULT_LOCALE, resolveSupportedLocale, SUPPORTED_LOCALES } from '@/i18n/locales'
import { parseArbitragePlacement } from '@/lib/arbitrage-execution'
import { cacheTags } from '@/lib/cache-tags'
import { CLOB_ORDER_TYPE, MAX_CLOB_BATCH_ORDERS, MAX_ORDER_SUBMISSION_ORDERS, ORDER_TYPE } from '@/lib/constants'
import { OrderRepository } from '@/lib/db/queries/order'
import { UserRepository } from '@/lib/db/queries/user'
import { buildClobHmacSignature } from '@/lib/hmac'
import { resolvePublicRuntimeEnv } from '@/lib/public-runtime-config.shared'
import { requireSumsubTradingApproval, SUMSUB_APPROVAL_REQUIRED_MESSAGE } from '@/lib/sumsub/enforcement'
import {
  TRADING_AUTH_REQUIRED_ERROR,
  TRADING_DEPOSIT_WALLET_REQUIRED_ERROR,
  UNAUTHENTICATED_ERROR,
} from '@/lib/trading-auth/errors'
import { getUserTradingAuthSecrets } from '@/lib/trading-auth/server'
import { normalizeAddress } from '@/lib/wallet'

const StoreOrderSchema = z.object({
  // begin blockchain data
  salt: z.string(),
  maker: z.string(),
  signer: z.string(),
  taker: z.string(),
  token_id: z.string(),
  maker_amount: z.string(),
  taker_amount: z.string(),
  expiration: z.string(),
  nonce: z.string(),
  fee_rate_bps: z.string(),
  side: z.union([z.literal(0), z.literal(1)]),
  signature_type: z.number(),
  timestamp: z.string(),
  metadata: z.string(),
  builder: z.string(),
  signature: z.string(),
  // end blockchain data

  type: z.union([z.literal(ORDER_TYPE.MARKET), z.literal(ORDER_TYPE.LIMIT)]),
  clob_type: z.enum(CLOB_ORDER_TYPE).optional(),
  post_only: z.boolean().optional(),
  condition_id: z.string(),
  slug: z.string(),
  locale: z.string().optional(),
})
const StoreOrdersSchema = z.array(StoreOrderSchema).min(1).max(MAX_ORDER_SUBMISSION_ORDERS)

type StoreOrderInput = z.infer<typeof StoreOrderSchema>
type ClobOrderType = Exclude<StoreOrderInput['clob_type'], undefined>

export type StoreOrderActionResult = {
  error: string | null
  orderId?: string | null
  code?: string
  retryAfterSeconds?: number
  execution?: ArbitrageExecution
}

const CLOB_REQUEST_TIMEOUT_MS = 20_000

type ClobErrorMessageKey =
  | 'default'
  | 'conditionPaused'
  | 'systemPaused'
  | 'marketNotActive'
  | 'tradingSessionOutOfSync'
  | 'tradingSessionExpired'
  | 'userBanned'
  | 'tradingUnavailable'
  | 'invalidOrderSignature'
  | 'orderExpired'
  | 'invalidExpiration'
  | 'duplicateOrder'
  | 'notEnoughLiquidity'
  | 'marketUnavailable'
  | 'orderSizeTooSmall'
  | 'invalidPrice'
  | 'insufficientBalance'
  | 'onChainPrecheckFailed'
  | 'onChainSettlementFailed'
  | 'couldNotSubmit'
  | 'couldNotExecute'
  | 'orderDelayed'
  | 'matchingDelayed'
  | 'invalidExpirationRefreshPrices'
  | 'staleMarketData'
  | 'postOnlyLimitOrders'
  | 'postOnlyWouldCross'
  | 'invalidOrderSize'
  | 'outdatedTradingSettings'
  | 'orderExecutionFailed'
  | 'postOnlyMode'
  | 'tradingRestarting'

const CLOB_ERROR_MESSAGES: Record<string, ClobErrorMessageKey> = {
  condition_paused: 'conditionPaused',
  system_paused: 'systemPaused',
  'condition is not registered': 'marketNotActive',
  'token is not registered': 'marketNotActive',
  owner_address_mismatch: 'tradingSessionOutOfSync',
  invalid_l2: 'tradingSessionExpired',
  user_banned: 'userBanned',
  internal_error: 'tradingUnavailable',
  'invalid order signature': 'invalidOrderSignature',
  'order expired': 'orderExpired',
  'invalid expiration': 'invalidExpiration',
  "order is invalid. duplicated. same order has already been placed, can't be placed again": 'duplicateOrder',
  "order couldn't be fully filled, fok orders are fully filled/killed": 'notEnoughLiquidity',
  'market not yet accepting orders': 'conditionPaused',
  'the market is not yet ready to process new orders': 'marketUnavailable',
  'order is invalid. size lower than the minimum': 'orderSizeTooSmall',
  'order is invalid. price breaks minimum tick size rules': 'invalidPrice',
  'not enough balance / allowance': 'insufficientBalance',
  'on-chain precheck failed': 'onChainPrecheckFailed',
  'on-chain settlement failed': 'onChainSettlementFailed',
  'could not insert order': 'couldNotSubmit',
  'could not run the execution': 'couldNotExecute',
  'error delaying the order': 'orderDelayed',
  'order match delayed due to market conditions': 'matchingDelayed',
  'post-only mode: only post-only orders and cancels are allowed': 'postOnlyMode',
  post_only_mode: 'postOnlyMode',
  'trading is temporarily unavailable while the clob is restarting.': 'tradingRestarting',
  trading_restarting: 'tradingRestarting',
}

const CLOB_ERROR_PATTERNS: Array<{ pattern: RegExp; messageKey: ClobErrorMessageKey }> = [
  {
    pattern: /\b(not enough (unlocked )?balance|insufficient unlocked (position|collateral)|insufficient unlocked)\b/i,
    messageKey: 'insufficientBalance',
  },
  {
    pattern: /\b(collateral|position) (balance|allowance) \d+ below required \d+\b/i,
    messageKey: 'insufficientBalance',
  },
  {
    pattern:
      /\b(order .* expired|expiration must be in the future|expiration must be non-negative|expiration is required)\b/i,
    messageKey: 'invalidExpirationRefreshPrices',
  },
  {
    pattern:
      /\b(tokenid is required|conditionid is required|tokenid not found for conditionid lookup|maker is required|signer is required)\b/i,
    messageKey: 'staleMarketData',
  },
  {
    pattern: /\b(postonly requires gtc or gtd)\b/i,
    messageKey: 'postOnlyLimitOrders',
  },
  {
    pattern: /\b(postonly would cross the best (ask|bid))\b/i,
    messageKey: 'postOnlyWouldCross',
  },
  {
    pattern: /\b(post-only mode|only post-only orders and cancels are allowed)\b/i,
    messageKey: 'postOnlyMode',
  },
  {
    pattern: /\b(trading is temporarily unavailable while the clob is restarting|clob is restarting)\b/i,
    messageKey: 'tradingRestarting',
  },
  {
    pattern:
      /\b(orderbook not ready|market is not yet ready|market not yet accepting orders|unable to derive price for postonly|unable to derive price for order)\b/i,
    messageKey: 'marketUnavailable',
  },
  {
    pattern: /\b(failed to verify signature|invalid signature for order)\b/i,
    messageKey: 'invalidOrderSignature',
  },
  {
    pattern:
      /\b(failed to check balances|makeramount must be positive|order quantity must be positive|makeramount and takeramount must be positive)\b/i,
    messageKey: 'invalidOrderSize',
  },
  {
    pattern:
      /\b(unsupported verifying contract|feeratebps must be >= exchangebasefeerate|feeratebps must be non-negative)\b/i,
    messageKey: 'outdatedTradingSettings',
  },
  {
    pattern: /\b(transaction reverted|transport error|condition worker dropped response)\b/i,
    messageKey: 'orderExecutionFailed',
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getStringField(payload: Record<string, unknown> | null, key: string) {
  if (!payload) {
    return null
  }
  const value = payload[key]
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getNonNegativeIntegerField(payload: Record<string, unknown> | null, key: string) {
  if (!payload) {
    return null
  }
  const value = payload[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return null
  }
  return value
}

function buildClobActionError(
  error: string,
  code: string | null,
  retryAfterSeconds: number | null,
): StoreOrderActionResult {
  return {
    error,
    ...(code ? { code } : {}),
    ...(retryAfterSeconds != null ? { retryAfterSeconds } : {}),
  }
}

function isPostOnlyModeError(rawError: string | null, code: string | null) {
  return code?.trim().toLowerCase() === 'post_only_mode' || mapClobErrorMessageKey(rawError, false) === 'postOnlyMode'
}

function mapClobErrorMessageKey(rawError: string | null, logUnmapped = true): ClobErrorMessageKey {
  if (!rawError) {
    return 'default'
  }
  const normalized = rawError.trim()
  if (!normalized) {
    return 'default'
  }

  const lower = normalized.toLowerCase()
  const mapped = CLOB_ERROR_MESSAGES[lower]
  if (mapped) {
    return mapped
  }

  for (const { pattern, messageKey } of CLOB_ERROR_PATTERNS) {
    if (pattern.test(lower)) {
      return messageKey
    }
  }

  if (logUnmapped) {
    console.error('Unmapped CLOB error message.', normalized)
  }
  return 'default'
}

async function mapClobErrorMessage(
  rawError: string | null,
  locale: SupportedLocale = DEFAULT_LOCALE,
  retryAfterSeconds: number | null = null,
) {
  const messageKey = mapClobErrorMessageKey(rawError)
  const t = await getExtracted({ locale })

  switch (messageKey) {
    case 'conditionPaused':
      return t('Trading is paused for this market.')
    case 'systemPaused':
      return t('Trading is temporarily paused. Please try again shortly.')
    case 'marketNotActive':
      return t('Market is not active yet. Try again shortly.')
    case 'tradingSessionOutOfSync':
      return t('Your trading session is out of sync. Reconnect and try again.')
    case 'tradingSessionExpired':
      return t('Your trading session expired. Please sign in again.')
    case 'userBanned':
      return t('Your account is not allowed to trade right now.')
    case 'tradingUnavailable':
      return t('Trading is temporarily unavailable. Please try again shortly.')
    case 'invalidOrderSignature':
      return t('Your order signature could not be verified. Please sign and try again.')
    case 'orderExpired':
      return t('This order expired. Refresh prices and submit again.')
    case 'invalidExpiration':
      return t('This order expiration is invalid. Please refresh and try again.')
    case 'duplicateOrder':
      return t('This exact order was already submitted.')
    case 'notEnoughLiquidity':
      return t('Not enough liquidity to fully fill this order right now.')
    case 'marketUnavailable':
      return t('This market is temporarily unavailable for trading. Please try again shortly.')
    case 'orderSizeTooSmall':
      return t('Order size is too small for this market.')
    case 'invalidPrice':
      return t('Order price is invalid for this market.')
    case 'insufficientBalance':
      return t('Insufficient available balance for this order.')
    case 'onChainPrecheckFailed':
      return t('We could not validate this order on-chain. Please try again.')
    case 'onChainSettlementFailed':
      return t('This order could not be settled right now. Please try again.')
    case 'couldNotSubmit':
      return t('Could not submit your order right now. Please try again.')
    case 'couldNotExecute':
      return t('Could not execute your order right now. Please try again.')
    case 'orderDelayed':
      return t('Order processing is delayed right now. Please try again.')
    case 'matchingDelayed':
      return t('Order matching is delayed due to market conditions.')
    case 'invalidExpirationRefreshPrices':
      return t('This order expiration is invalid. Refresh prices and try again.')
    case 'staleMarketData':
      return t('Market data is out of date. Please refresh and try again.')
    case 'postOnlyLimitOrders':
      return t('Post-only is only available for limit orders.')
    case 'postOnlyWouldCross':
      return t('Post-only orders must not execute immediately. Adjust the price and try again.')
    case 'invalidOrderSize':
      return t('Order size is invalid for this market.')
    case 'outdatedTradingSettings':
      return t('Trading settings are out of date. Refresh and try again.')
    case 'orderExecutionFailed':
      return t('Order execution failed. Please try again shortly.')
    case 'postOnlyMode':
      if (retryAfterSeconds == null || retryAfterSeconds < 1) {
        return t('The matching engine is restarting. Please try again shortly. You can still cancel open orders.')
      }
      return t('Restart in progress. Trading resumes in {seconds}s. Cancels still available.', {
        seconds: retryAfterSeconds.toString(),
      })
    case 'tradingRestarting':
      return t('The matching engine is restarting. Please try again shortly. You can still cancel open orders.')
    case 'default':
      return t('Something went wrong while processing your order. Please try again.')
  }

  return t('Something went wrong while processing your order. Please try again.')
}

function resolveBatchLocale(payloads: unknown) {
  if (!Array.isArray(payloads)) {
    return DEFAULT_LOCALE
  }

  const locale = payloads
    .map((payload) =>
      isRecord(payload) && typeof payload.locale === 'string' ? payload.locale.trim().toLowerCase() : null,
    )
    .find((value): value is SupportedLocale => SUPPORTED_LOCALES.includes(value as SupportedLocale))

  return locale ?? DEFAULT_LOCALE
}

async function readClobJsonResponsePayload(response: { text?: () => Promise<string>; json?: () => Promise<unknown> }) {
  let responseText = ''
  let payload: unknown = null

  if (typeof response.text === 'function') {
    responseText = await response.text()
    if (responseText) {
      try {
        const parsed = JSON.parse(responseText) as unknown
        payload = parsed
      } catch (error) {
        console.error('Failed to parse CLOB response payload.', error)
      }
    }
    return { responseText, payload }
  }

  if (typeof response.json === 'function') {
    try {
      const parsed = await response.json()
      payload = parsed
      responseText = JSON.stringify(parsed)
    } catch (error) {
      console.error('Failed to parse CLOB response payload.', error)
    }
  }

  return { responseText, payload }
}

async function readClobResponsePayload(response: { text?: () => Promise<string>; json?: () => Promise<unknown> }) {
  const { responseText, payload } = await readClobJsonResponsePayload(response)
  return { responseText, payload: isRecord(payload) ? payload : null }
}

export async function storeOrderAction(payload: StoreOrderInput): Promise<StoreOrderActionResult> {
  const user = await UserRepository.getCurrentUser({ disableCookieCache: true, minimal: true })
  if (!user) {
    return { error: UNAUTHENTICATED_ERROR }
  }
  if (!(await requireSumsubTradingApproval(user.id)).allowed) {
    return { error: SUMSUB_APPROVAL_REQUIRED_MESSAGE }
  }

  const auth = await getUserTradingAuthSecrets(user.id)
  const clobAuth = auth?.clob
  if (!clobAuth) {
    return { error: TRADING_AUTH_REQUIRED_ERROR }
  }
  if (!user.deposit_wallet_address) {
    return { error: TRADING_DEPOSIT_WALLET_REQUIRED_ERROR }
  }

  const validated = StoreOrderSchema.safeParse(payload)

  if (!validated.success) {
    return {
      error: validated.error.issues[0].message,
    }
  }

  const locale = resolveSupportedLocale(validated.data.locale)
  function getLocalizedClobError(rawError: string | null, retryAfterSeconds: number | null = null) {
    return mapClobErrorMessage(rawError, locale, retryAfterSeconds)
  }

  const defaultMarketOrderType = user.settings?.trading?.market_order_type ?? CLOB_ORDER_TYPE.FAK
  const clobOrderType =
    validated.data.clob_type ??
    (validated.data.type === ORDER_TYPE.MARKET ? defaultMarketOrderType : CLOB_ORDER_TYPE.GTC)

  try {
    const expectedMaker = normalizeAddress(user.deposit_wallet_address)
    const maker = normalizeAddress(validated.data.maker)
    const signer = normalizeAddress(validated.data.signer)

    if (!expectedMaker || !maker || !signer) {
      return { error: 'Invalid Deposit Wallet address for this order.' }
    }

    if (validated.data.signature_type !== 3) {
      return { error: 'Orders must use Deposit Wallet signature type.' }
    }

    if (maker.toLowerCase() !== expectedMaker.toLowerCase() || signer.toLowerCase() !== expectedMaker.toLowerCase()) {
      return { error: 'Invalid Deposit Wallet maker or signer for this order.' }
    }

    const clobPayload = {
      order: {
        salt: validated.data.salt,
        maker: validated.data.maker,
        signer: validated.data.signer,
        conditionId: validated.data.condition_id,
        tokenId: validated.data.token_id,
        makerAmount: validated.data.maker_amount,
        takerAmount: validated.data.taker_amount,
        expiration: validated.data.expiration,
        side: validated.data.side === 0 ? 'BUY' : 'SELL',
        signatureType: validated.data.signature_type,
        timestamp: validated.data.timestamp,
        metadata: validated.data.metadata,
        builder: validated.data.builder,
        signature: validated.data.signature,
      },
      orderType: clobOrderType,
      postOnly: validated.data.post_only ?? false,
      owner: clobAuth.key,
    }

    const method = 'POST'
    const path = '/order'
    const { clobUrl } = resolvePublicRuntimeEnv(process.env)
    const body = JSON.stringify(clobPayload)
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = buildClobHmacSignature(clobAuth.secret, timestamp, method, path, body)

    const clobStoreOrderResponse = await fetch(`${clobUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        KUEST_ADDRESS: user.address,
        KUEST_API_KEY: clobAuth.key,
        KUEST_PASSPHRASE: clobAuth.passphrase,
        KUEST_TIMESTAMP: timestamp.toString(),
        KUEST_SIGNATURE: signature,
      },
      body,
      signal: AbortSignal.timeout(CLOB_REQUEST_TIMEOUT_MS),
    })

    const { responseText, payload: clobStoreOrderResponseJson } = await readClobResponsePayload(clobStoreOrderResponse)

    if (!clobStoreOrderResponse.ok) {
      const responseError =
        getStringField(clobStoreOrderResponseJson, 'error') ??
        getStringField(clobStoreOrderResponseJson, 'errorMsg') ??
        getStringField(clobStoreOrderResponseJson, 'message') ??
        getStringField(clobStoreOrderResponseJson, 'code')
      const responseCode = getStringField(clobStoreOrderResponseJson, 'code')
      const retryAfterSeconds = getNonNegativeIntegerField(clobStoreOrderResponseJson, 'retry_after_seconds')
      const humanMessage = await getLocalizedClobError(responseError, retryAfterSeconds)
      const message = `Status ${clobStoreOrderResponse.status} (${clobStoreOrderResponse.statusText})`
      console.error('Failed to send order to CLOB.', message, responseError ?? responseText)
      return {
        ...buildClobActionError(humanMessage, responseCode, retryAfterSeconds),
        ...(validated.data.clob_type === CLOB_ORDER_TYPE.FOK
          ? {
              execution: { ...parseArbitragePlacement(clobStoreOrderResponseJson, 'kuest'), state: 'unknown' as const },
            }
          : {}),
      }
    }

    if (!clobStoreOrderResponseJson) {
      console.error('Failed to send order to CLOB. Empty or invalid response payload.')
      return { error: await getLocalizedClobError(null) }
    }

    if (clobStoreOrderResponseJson?.success === false) {
      const responseError =
        getStringField(clobStoreOrderResponseJson, 'errorMsg') ??
        getStringField(clobStoreOrderResponseJson, 'error') ??
        getStringField(clobStoreOrderResponseJson, 'message') ??
        getStringField(clobStoreOrderResponseJson, 'code')
      const responseCode = getStringField(clobStoreOrderResponseJson, 'code')
      const retryAfterSeconds = getNonNegativeIntegerField(clobStoreOrderResponseJson, 'retry_after_seconds')
      return {
        ...buildClobActionError(
          await getLocalizedClobError(responseError, retryAfterSeconds),
          responseCode,
          retryAfterSeconds,
        ),
        ...(validated.data.clob_type === CLOB_ORDER_TYPE.FOK
          ? { execution: parseArbitragePlacement(clobStoreOrderResponseJson, 'kuest') }
          : {}),
      }
    }

    const clobOrderId =
      getStringField(clobStoreOrderResponseJson, 'orderID') ?? getStringField(clobStoreOrderResponseJson, 'orderId')
    if (!clobOrderId) {
      console.error('CLOB response did not include an order id.', clobStoreOrderResponseJson)
      return { error: await getLocalizedClobError(null) }
    }

    const { locale: _locale, ...orderData } = validated.data
    void OrderRepository.createOrder({
      ...orderData,
      salt: BigInt(orderData.salt),
      maker_amount: BigInt(validated.data.maker_amount),
      taker_amount: BigInt(validated.data.taker_amount),
      nonce: BigInt(validated.data.nonce),
      fee_rate_bps: Number(validated.data.fee_rate_bps),
      expiration: BigInt(validated.data.expiration),
      user_id: user.id,
      affiliate_user_id: user.referred_by_user_id,
      type: clobOrderType,
      clob_order_id: clobOrderId,
    })

    updateTag(cacheTags.activity(validated.data.slug))
    updateTag(cacheTags.holders(validated.data.condition_id))

    return {
      error: null,
      orderId: clobOrderId,
      ...(validated.data.clob_type === CLOB_ORDER_TYPE.FOK
        ? { execution: parseArbitragePlacement(clobStoreOrderResponseJson, 'kuest') }
        : {}),
    }
  } catch (error) {
    console.error('Failed to create order.', error)
    return { error: await getLocalizedClobError(null) }
  }
}

export async function storeOrdersAction(payloads: StoreOrderInput[]) {
  const user = await UserRepository.getCurrentUser({ disableCookieCache: true, minimal: true })
  if (!user) {
    return { error: UNAUTHENTICATED_ERROR, results: null }
  }
  if (!(await requireSumsubTradingApproval(user.id)).allowed) {
    return { error: SUMSUB_APPROVAL_REQUIRED_MESSAGE, results: null }
  }

  const auth = await getUserTradingAuthSecrets(user.id)
  const clobAuth = auth?.clob
  if (!clobAuth) {
    return { error: TRADING_AUTH_REQUIRED_ERROR, results: null }
  }
  if (!user.deposit_wallet_address) {
    return { error: TRADING_DEPOSIT_WALLET_REQUIRED_ERROR, results: null }
  }

  const validated = StoreOrdersSchema.safeParse(payloads)
  const batchLocale = resolveBatchLocale(payloads)

  function getLocalizedClobError(rawError: string | null, retryAfterSeconds: number | null = null) {
    return mapClobErrorMessage(rawError, batchLocale, retryAfterSeconds)
  }

  if (!validated.success) {
    return { error: await getLocalizedClobError(null), results: null }
  }

  const expectedMaker = normalizeAddress(user.deposit_wallet_address)
  if (!expectedMaker) {
    return { error: await getLocalizedClobError(null), results: null }
  }

  const defaultMarketOrderType = user.settings?.trading?.market_order_type ?? CLOB_ORDER_TYPE.FAK
  const preparedOrders: Array<{ data: StoreOrderInput; clobOrderType: ClobOrderType }> = []

  for (const data of validated.data) {
    const locale = resolveSupportedLocale(data.locale)
    const maker = normalizeAddress(data.maker)
    const signer = normalizeAddress(data.signer)
    if (!maker || !signer) {
      return { error: await mapClobErrorMessage(null, locale), results: null }
    }
    if (data.signature_type !== 3) {
      return { error: await mapClobErrorMessage(null, locale), results: null }
    }
    if (maker.toLowerCase() !== expectedMaker.toLowerCase() || signer.toLowerCase() !== expectedMaker.toLowerCase()) {
      return { error: await mapClobErrorMessage(null, locale), results: null }
    }

    const clobOrderType =
      data.clob_type ?? (data.type === ORDER_TYPE.MARKET ? defaultMarketOrderType : CLOB_ORDER_TYPE.GTC)
    preparedOrders.push({
      data,
      clobOrderType,
    })
  }

  try {
    const method = 'POST'
    const path = '/orders'
    const { clobUrl } = resolvePublicRuntimeEnv(process.env)
    const successfulSlugs = new Set<string>()
    const successfulConditionIds = new Set<string>()
    const results: Array<{ error: string | null; orderId: string | null }> = []
    let processedBatchCount = 0
    let batchFailureError: string | null = null
    let batchFailureCode: string | null = null
    let batchFailureRetryAfterSeconds: number | null = null
    let postOnlyBatchFailure: {
      error: string
      code: string | null
      retryAfterSeconds: number | null
    } | null = null

    for (let batchOffset = 0; batchOffset < preparedOrders.length; batchOffset += MAX_CLOB_BATCH_ORDERS) {
      const preparedBatch = preparedOrders.slice(batchOffset, batchOffset + MAX_CLOB_BATCH_ORDERS)
      const body = JSON.stringify(
        preparedBatch.map(({ data, clobOrderType }) => ({
          order: {
            salt: data.salt,
            maker: data.maker,
            signer: data.signer,
            conditionId: data.condition_id,
            tokenId: data.token_id,
            makerAmount: data.maker_amount,
            takerAmount: data.taker_amount,
            expiration: data.expiration,
            side: data.side === 0 ? 'BUY' : 'SELL',
            signatureType: data.signature_type,
            timestamp: data.timestamp,
            metadata: data.metadata,
            builder: data.builder,
            signature: data.signature,
          },
          orderType: clobOrderType,
          postOnly: data.post_only ?? false,
          owner: clobAuth.key,
        })),
      )
      const timestamp = Math.floor(Date.now() / 1000)
      const signature = buildClobHmacSignature(clobAuth.secret, timestamp, method, path, body)

      try {
        const response = await fetch(`${clobUrl}${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            KUEST_ADDRESS: user.address,
            KUEST_API_KEY: clobAuth.key,
            KUEST_PASSPHRASE: clobAuth.passphrase,
            KUEST_TIMESTAMP: timestamp.toString(),
            KUEST_SIGNATURE: signature,
          },
          body,
          signal: AbortSignal.timeout(CLOB_REQUEST_TIMEOUT_MS),
        })

        const { responseText, payload } = await readClobJsonResponsePayload(response)
        if (!response.ok) {
          const responsePayload = isRecord(payload) ? payload : null
          const responseError =
            getStringField(responsePayload, 'error') ??
            getStringField(responsePayload, 'errorMsg') ??
            getStringField(responsePayload, 'message') ??
            getStringField(responsePayload, 'code')
          const responseCode = getStringField(responsePayload, 'code')
          const retryAfterSeconds = getNonNegativeIntegerField(responsePayload, 'retry_after_seconds')
          console.error(
            'Failed to send order batch to CLOB.',
            `Status ${response.status} (${response.statusText})`,
            responseError ?? responseText,
          )
          const batchResults = await Promise.all(
            preparedBatch.map(async ({ data }) => {
              const error = await mapClobErrorMessage(
                responseError,
                resolveSupportedLocale(data.locale),
                retryAfterSeconds,
              )
              return {
                error,
                orderId: null,
                ...(responseCode ? { code: responseCode } : {}),
                ...(retryAfterSeconds != null ? { retryAfterSeconds } : {}),
              }
            }),
          )
          if (postOnlyBatchFailure == null && isPostOnlyModeError(responseError, responseCode)) {
            postOnlyBatchFailure = {
              error: await getLocalizedClobError(responseError, retryAfterSeconds),
              code: responseCode,
              retryAfterSeconds,
            }
          }
          if (batchFailureError == null) {
            batchFailureError = batchResults[0]!.error
            batchFailureCode = responseCode
            batchFailureRetryAfterSeconds = retryAfterSeconds
          }
          results.push(...batchResults)
          continue
        }

        if (!Array.isArray(payload) || payload.length !== preparedBatch.length) {
          console.error('CLOB batch response did not match the submitted order count.', payload)
          const batchResults = await Promise.all(
            preparedBatch.map(async ({ data }) => ({
              error: await mapClobErrorMessage(null, resolveSupportedLocale(data.locale)),
              orderId: null,
            })),
          )
          batchFailureError ??= batchResults[0]!.error
          results.push(...batchResults)
          continue
        }

        processedBatchCount += 1
        const batchResults = await Promise.all(
          payload.map(async (rawResult, index) => {
            const prepared = preparedBatch[index]
            if (!prepared) {
              return { error: await getLocalizedClobError(null), orderId: null }
            }

            const locale = resolveSupportedLocale(prepared.data.locale)
            if (!isRecord(rawResult)) {
              return { error: await mapClobErrorMessage(null, locale), orderId: null }
            }
            if (rawResult.success === false) {
              const responseError =
                getStringField(rawResult, 'errorMsg') ??
                getStringField(rawResult, 'error') ??
                getStringField(rawResult, 'message') ??
                getStringField(rawResult, 'code')
              const responseCode = getStringField(rawResult, 'code')
              const retryAfterSeconds = getNonNegativeIntegerField(rawResult, 'retry_after_seconds')
              const error = await mapClobErrorMessage(responseError, locale, retryAfterSeconds)
              return {
                error,
                orderId: null,
                ...(responseCode ? { code: responseCode } : {}),
                ...(retryAfterSeconds != null ? { retryAfterSeconds } : {}),
              }
            }

            const orderId = getStringField(rawResult, 'orderID') ?? getStringField(rawResult, 'orderId')
            if (!orderId) {
              return { error: await mapClobErrorMessage(null, locale), orderId: null }
            }

            try {
              const { locale: _locale, ...orderData } = prepared.data
              await OrderRepository.createOrder({
                ...orderData,
                salt: BigInt(orderData.salt),
                maker_amount: BigInt(orderData.maker_amount),
                taker_amount: BigInt(orderData.taker_amount),
                nonce: BigInt(orderData.nonce),
                fee_rate_bps: Number(orderData.fee_rate_bps),
                expiration: BigInt(orderData.expiration),
                user_id: user.id,
                affiliate_user_id: user.referred_by_user_id,
                type: prepared.clobOrderType,
                clob_order_id: orderId,
              })
            } catch (error) {
              console.error('CLOB accepted a batch order, but local persistence failed.', error)
            }

            successfulSlugs.add(prepared.data.slug)
            successfulConditionIds.add(prepared.data.condition_id)
            return { error: null, orderId }
          }),
        )
        results.push(...batchResults)
      } catch (error) {
        console.error('Failed to create order batch.', error)
        const batchResults = await Promise.all(
          preparedBatch.map(async ({ data }) => ({
            error: await mapClobErrorMessage(null, resolveSupportedLocale(data.locale)),
            orderId: null,
          })),
        )
        batchFailureError ??= batchResults[0]!.error
        results.push(...batchResults)
      }
    }

    if (processedBatchCount === 0) {
      const topLevelFailure = postOnlyBatchFailure ?? {
        error: batchFailureError ?? (await getLocalizedClobError(null)),
        code: batchFailureCode,
        retryAfterSeconds: batchFailureRetryAfterSeconds,
      }
      return {
        ...buildClobActionError(topLevelFailure.error, topLevelFailure.code, topLevelFailure.retryAfterSeconds),
        results: null,
      }
    }

    successfulSlugs.forEach((slug) => updateTag(cacheTags.activity(slug)))
    successfulConditionIds.forEach((conditionId) => updateTag(cacheTags.holders(conditionId)))

    return { error: null, results }
  } catch (error) {
    console.error('Failed to create order batch.', error)
    return { error: await getLocalizedClobError(null), results: null }
  }
}
