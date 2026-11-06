import { beforeEach, describe, expect, it, mock } from 'bun:test'
import * as actualViem from 'viem'

import type { storeOrderAction, storeOrdersAction } from '@/app/[locale]/(platform)/event/[slug]/_actions/store-order'

import { MAX_CLOB_BATCH_ORDERS, MAX_ORDER_SUBMISSION_ORDERS } from '@/lib/constants'
import { TRADING_AUTH_REQUIRED_ERROR } from '@/lib/trading-auth/errors'

import { hoisted, spyOn } from '../bun-test-helpers'

const sumsubMocks = hoisted(() => ({ requireApproval: mock() }))

void mock.module('@/lib/sumsub/enforcement', () => ({
  requireSumsubTradingApproval: sumsubMocks.requireApproval,
  SUMSUB_APPROVAL_REQUIRED_MESSAGE: 'Complete identity verification to continue.',
}))

type StoreOrderInput = Parameters<typeof storeOrderAction>[0]
type StoreOrdersInput = Parameters<typeof storeOrdersAction>[0]

const mocks = hoisted(() => ({
  updateTag: mock(),
  createPublicClient: mock(),
  http: mock(() => ({ transport: 'http' })),
  buildClobHmacSignature: mock(() => 'sig'),
  getUserTradingAuthSecrets: mock(),
  getExtracted: mock(),
  getCurrentUser: mock(),
  createOrder: mock(),
  fetch: mock(),
}))

void mock.module('next/cache', () => ({
  updateTag: mocks.updateTag,
}))

void mock.module('next-intl/server', () => ({
  getExtracted: (...args: any[]) => mocks.getExtracted(...args),
}))

void mock.module('viem', () => ({
  ...actualViem,
  createPublicClient: mocks.createPublicClient,
  erc1155Abi: [],
  http: mocks.http,
}))

void mock.module('@/lib/appkit', () => ({
  defaultNetwork: { rpcUrls: { default: { http: ['https://rpc.local'] } } },
}))

void mock.module('@/lib/hmac', () => ({
  buildClobHmacSignature: mocks.buildClobHmacSignature,
}))

void mock.module('@/lib/trading-auth/server', () => ({
  getUserTradingAuthSecrets: mocks.getUserTradingAuthSecrets,
}))

void mock.module('@/lib/db/queries/user', () => ({
  UserRepository: { getCurrentUser: (...args: any[]) => mocks.getCurrentUser(...args) },
}))

void mock.module('@/lib/db/queries/order', () => ({
  OrderRepository: { createOrder: (...args: any[]) => mocks.createOrder(...args) },
}))

describe('storeOrderAction', () => {
  beforeEach(() => {
    mocks.updateTag.mockReset()
    mocks.createPublicClient.mockReset()
    mocks.http.mockClear()
    mocks.buildClobHmacSignature.mockReset()
    mocks.getUserTradingAuthSecrets.mockReset()
    mocks.getExtracted.mockReset()
    mocks.getExtracted.mockResolvedValue((message: string) => message)
    mocks.getCurrentUser.mockReset()
    mocks.createOrder.mockReset()
    sumsubMocks.requireApproval.mockReset().mockResolvedValue({ allowed: true })
  })

  function address(lastByte: string) {
    return `0x${'0'.repeat(40 - lastByte.length)}${lastByte}` as const
  }

  function basePayload(overrides: Partial<StoreOrderInput> = {}): StoreOrderInput {
    return {
      salt: '1',
      maker: address('01'),
      signer: address('01'),
      taker: address('00'),
      token_id: '1',
      maker_amount: '100',
      taker_amount: '200',
      expiration: '999',
      nonce: '0',
      fee_rate_bps: '200',
      side: 0,
      signature_type: 3,
      timestamp: '1700000000000',
      metadata: '0x0000000000000000000000000000000000000000000000000000000000000000',
      builder: '0x0000000000000000000000000000000000000000000000000000000000000000',
      signature: '0xsig',
      type: 'MARKET',
      condition_id: 'cond-1',
      slug: 'event-1',
      ...overrides,
    }
  }

  it('rejects unauthenticated users', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    mocks.getCurrentUser.mockResolvedValueOnce(null)

    const { storeOrderAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    const result = await storeOrderAction(basePayload())
    expect(result).toEqual({ error: 'Unauthenticated.' })
    expect(mocks.getCurrentUser).toHaveBeenCalledWith({ disableCookieCache: true, minimal: true })
  })

  it('blocks order storage before reading credentials or calling the CLOB', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    mocks.getCurrentUser.mockResolvedValueOnce({ id: 'user-1' })
    sumsubMocks.requireApproval.mockResolvedValueOnce({ allowed: false })
    const fetchSpy = spyOn(globalThis, 'fetch')
    fetchSpy.mockClear()

    const { storeOrderAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    await expect(storeOrderAction(basePayload())).resolves.toEqual({
      error: 'Complete identity verification to continue.',
    })
    expect(mocks.getUserTradingAuthSecrets).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it('requires trading auth and Deposit Wallet', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    const baseUser = {
      id: 'user-1',
      address: address('aa'),
      deposit_wallet_address: null,
      settings: {},
    }
    mocks.getCurrentUser.mockResolvedValueOnce(baseUser)
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({ clob: null })

    const { storeOrderAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    const result = await storeOrderAction(basePayload())
    expect(result?.error).toBe(TRADING_AUTH_REQUIRED_ERROR)

    mocks.getCurrentUser.mockResolvedValueOnce(baseUser)
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'k', passphrase: 'p', secret: 's' },
    })
    const result2 = await storeOrderAction(basePayload())
    expect(result2?.error).toBe('Set up your Deposit Wallet before trading.')
  })

  it('returns schema validation errors', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-1',
      address: address('aa'),
      deposit_wallet_address: address('01'),
      settings: {},
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'k', passphrase: 'p', secret: 's' },
    })

    const { storeOrderAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    const result = await storeOrderAction({} as any)
    expect(typeof result?.error).toBe('string')
    expect(result?.error?.length).toBeGreaterThan(0)
  })

  it('returns translated friendly error for SELL orders with insufficient shares', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    const depositWallet = address('01')
    mocks.getExtracted.mockResolvedValueOnce((message: string) =>
      message === 'Insufficient available balance for this order.'
        ? 'Saldo disponible insuficiente para esta orden.'
        : message,
    )
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-1',
      address: address('aa'),
      deposit_wallet_address: depositWallet,
      settings: {},
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'k', passphrase: 'p', secret: 's' },
    })
    const fetchMock = mock().mockResolvedValueOnce({
      status: 422,
      statusText: 'Unprocessable Entity',
      ok: false,
      text: async () =>
        JSON.stringify({
          errorMsg: 'not enough unlocked balance',
        }),
    })
    globalThis.fetch = fetchMock as any

    const { storeOrderAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    const result = await storeOrderAction(
      basePayload({
        side: 1,
        maker: depositWallet,
        signer: depositWallet,
        maker_amount: '10',
        type: 'MARKET',
      }),
    )

    expect(result).toEqual({
      error: 'Saldo disponible insuficiente para esta orden.',
    })
  })

  it('returns friendly error for CLOB collateral balance precheck failures', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    const depositWallet = address('01')
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-1',
      address: address('aa'),
      deposit_wallet_address: depositWallet,
      settings: {},
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'k', passphrase: 'p', secret: 's' },
    })
    const fetchMock = mock().mockResolvedValueOnce({
      status: 422,
      statusText: 'Unprocessable Entity',
      ok: false,
      text: async () =>
        JSON.stringify({
          error: 'collateral balance 9980000 below required 10179600',
        }),
    })
    globalThis.fetch = fetchMock as any

    const { storeOrderAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    const result = await storeOrderAction(
      basePayload({
        maker: depositWallet,
        signer: depositWallet,
        type: 'MARKET',
      }),
    )

    expect(result).toEqual({
      error: 'Insufficient available balance for this order.',
    })
  })

  it('submits to CLOB, updates tags, and schedules local order creation', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    const depositWallet = address('01')

    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-1',
      address: address('aa'),
      deposit_wallet_address: depositWallet,
      referred_by_user_id: null,
      settings: { trading: { market_order_type: 'FAK' } },
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'k', passphrase: 'p', secret: 's' },
    })

    const fetchMock = mock()
      .mockResolvedValueOnce({
        status: 201,
        statusText: 'Created',
        ok: true,
        json: async () => ({ orderId: 'clob-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ order: { id: 'clob-123', status: 'live', sizeMatched: '1.23' } }),
      })
    globalThis.fetch = fetchMock as any

    const { storeOrderAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    const result = await storeOrderAction(
      basePayload({
        maker: depositWallet,
        signer: depositWallet,
        type: 'MARKET',
      }),
    )

    expect(result).toEqual({
      error: null,
      orderId: 'clob-123',
    })
    expect(fetchMock).toHaveBeenCalled()
    expect(mocks.updateTag).toHaveBeenCalledTimes(2)

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mocks.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        clob_order_id: 'clob-123',
        user_id: 'user-1',
        condition_id: 'cond-1',
        slug: 'event-1',
      }),
    )
  })

  it('retains actual FOK execution details without calling matching a confirmed settlement', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    const depositWallet = address('01')
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-1',
      address: address('aa'),
      deposit_wallet_address: depositWallet,
      settings: {},
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({ clob: { key: 'k', passphrase: 'p', secret: 's' } })
    mocks.createOrder.mockResolvedValueOnce({})
    globalThis.fetch = mock().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          orderID: 'clob-fok',
          status: 'matched',
          makingAmount: '9000000',
          takingAmount: '20000000',
        }),
      ),
    ) as any
    const { storeOrderAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    expect(
      await storeOrderAction(basePayload({ clob_type: 'FOK', maker: depositWallet, signer: depositWallet })),
    ).toMatchObject({ error: null, orderId: 'clob-fok', execution: { state: 'pending', principal: 9, shares: 20 } })
  })

  it('submits signed orders through the existing CLOB batch endpoint', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    const depositWallet = address('01')
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-1',
      address: address('aa'),
      deposit_wallet_address: depositWallet,
      referred_by_user_id: null,
      settings: { trading: { market_order_type: 'FAK' } },
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'k', passphrase: 'p', secret: 's' },
    })

    const fetchMock = mock().mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      ok: true,
      json: async () => [
        { success: true, errorMsg: '', orderID: 'yes-123', status: 'matched' },
        { success: true, errorMsg: '', orderID: 'no-456', status: 'matched' },
      ],
    })
    globalThis.fetch = fetchMock as any

    const { storeOrdersAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    const payloads: StoreOrdersInput = [
      basePayload({
        maker: depositWallet,
        signer: depositWallet,
        token_id: '1',
        type: 'LIMIT',
        post_only: true,
      }),
      basePayload({ maker: depositWallet, signer: depositWallet, token_id: '2', salt: '2' }),
    ]
    const result = await storeOrdersAction(payloads)

    expect(result).toEqual({
      error: null,
      results: [
        { error: null, orderId: 'yes-123' },
        { error: null, orderId: 'no-456' },
      ],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://clob.local/orders',
      expect.objectContaining({
        method: 'POST',
      }),
    )
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(requestBody[0]).toEqual(
      expect.objectContaining({
        orderType: 'GTC',
        postOnly: true,
      }),
    )
    expect(requestBody[1]).toEqual(
      expect.objectContaining({
        postOnly: false,
      }),
    )
    expect(mocks.buildClobHmacSignature).toHaveBeenCalledWith(
      's',
      expect.any(Number),
      'POST',
      '/orders',
      expect.any(String),
    )
    expect(mocks.updateTag).toHaveBeenCalledTimes(2)
    expect(mocks.createOrder).toHaveBeenCalledTimes(2)
  })

  it('splits a twenty-eight order submission into CLOB batches of fifteen', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    const depositWallet = address('01')
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-1',
      address: address('aa'),
      deposit_wallet_address: depositWallet,
      referred_by_user_id: null,
      settings: { trading: { market_order_type: 'FAK' } },
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'k', passphrase: 'p', secret: 's' },
    })

    const clobResults = Array.from({ length: MAX_ORDER_SUBMISSION_ORDERS }, (_, index) => ({
      success: true,
      errorMsg: '',
      orderID: `order-${index + 1}`,
      status: 'matched',
    }))
    const fetchMock = mock()
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        ok: true,
        json: async () => clobResults.slice(0, MAX_CLOB_BATCH_ORDERS),
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        ok: true,
        json: async () => clobResults.slice(MAX_CLOB_BATCH_ORDERS),
      })
    globalThis.fetch = fetchMock as any

    const { storeOrdersAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    const payloads: StoreOrdersInput = Array.from({ length: MAX_ORDER_SUBMISSION_ORDERS }, (_, index) =>
      basePayload({
        maker: depositWallet,
        signer: depositWallet,
        salt: (index + 1).toString(),
      }),
    )
    const result = await storeOrdersAction(payloads)
    const requestBodies = fetchMock.mock.calls.map(([, request]) => JSON.parse(request.body))

    expect(MAX_CLOB_BATCH_ORDERS).toBe(15)
    expect(MAX_ORDER_SUBMISSION_ORDERS).toBe(28)
    expect(result.error).toBeNull()
    expect(result.results).toHaveLength(28)
    expect(requestBodies.map((batch) => batch.length)).toEqual([15, 13])
    expect(mocks.buildClobHmacSignature).toHaveBeenCalledTimes(2)
    expect(mocks.createOrder).toHaveBeenCalledTimes(28)
  })

  it('preserves first-batch successes when a later CLOB batch fails', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    const depositWallet = address('01')
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-1',
      address: address('aa'),
      deposit_wallet_address: depositWallet,
      referred_by_user_id: null,
      settings: { trading: { market_order_type: 'FAK' } },
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'k', passphrase: 'p', secret: 's' },
    })

    const firstBatchResults = Array.from({ length: MAX_CLOB_BATCH_ORDERS }, (_, index) => ({
      success: true,
      errorMsg: '',
      orderID: `order-${index + 1}`,
      status: 'live',
    }))
    globalThis.fetch = mock()
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        ok: true,
        json: async () => firstBatchResults,
      })
      .mockResolvedValueOnce({
        status: 503,
        statusText: 'Service Unavailable',
        ok: false,
        json: async () => ({ error: 'internal_error' }),
      }) as any

    const { storeOrdersAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    const result = await storeOrdersAction(
      Array.from({ length: MAX_ORDER_SUBMISSION_ORDERS }, (_, index) =>
        basePayload({
          maker: depositWallet,
          signer: depositWallet,
          salt: (index + 1).toString(),
        }),
      ),
    )

    expect(result.error).toBeNull()
    expect(result.results).toHaveLength(28)
    expect(result.results?.slice(0, 15)).toEqual(
      firstBatchResults.map((resultItem) => ({
        error: null,
        orderId: resultItem.orderID,
      })),
    )
    expect(result.results?.slice(15)).toEqual(
      Array.from({ length: 13 }, () => ({
        error: 'Trading is temporarily unavailable. Please try again shortly.',
        orderId: null,
      })),
    )
    expect(mocks.createOrder).toHaveBeenCalledTimes(15)
  })

  it('returns a top-level error when every CLOB batch fails', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    const depositWallet = address('01')
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-1',
      address: address('aa'),
      deposit_wallet_address: depositWallet,
      referred_by_user_id: null,
      settings: { trading: { market_order_type: 'FAK' } },
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'k', passphrase: 'p', secret: 's' },
    })

    globalThis.fetch = mock().mockResolvedValue({
      status: 503,
      statusText: 'Service Unavailable',
      ok: false,
      json: async () => ({ error: 'internal_error' }),
    }) as any

    const { storeOrdersAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    const result = await storeOrdersAction(
      Array.from({ length: MAX_ORDER_SUBMISSION_ORDERS }, (_, index) =>
        basePayload({
          maker: depositWallet,
          signer: depositWallet,
          salt: (index + 1).toString(),
        }),
      ),
    )

    expect(result).toEqual({
      error: 'Trading is temporarily unavailable. Please try again shortly.',
      results: null,
    })
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it('preserves warmup metadata on top-level batch failures', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    const depositWallet = address('01')
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-1',
      address: address('aa'),
      deposit_wallet_address: depositWallet,
      referred_by_user_id: null,
      settings: { trading: { market_order_type: 'FAK' } },
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'k', passphrase: 'p', secret: 's' },
    })
    mocks.getExtracted.mockResolvedValue((message: string, values?: { seconds?: string }) =>
      message.replace('{seconds}', values?.seconds ?? ''),
    )

    globalThis.fetch = mock().mockResolvedValue({
      status: 503,
      statusText: 'Service Unavailable',
      ok: false,
      json: async () => ({
        error: 'post-only mode: only post-only orders and cancels are allowed',
        code: 'post_only_mode',
        retry_after_seconds: 79,
      }),
    }) as any

    const { storeOrdersAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    const result = await storeOrdersAction(
      Array.from({ length: MAX_ORDER_SUBMISSION_ORDERS }, (_, index) =>
        basePayload({
          maker: depositWallet,
          signer: depositWallet,
          salt: (index + 1).toString(),
        }),
      ),
    )

    expect(result).toEqual({
      error: 'Restart in progress. Trading resumes in 79s. Cancels still available.',
      code: 'post_only_mode',
      retryAfterSeconds: 79,
      results: null,
    })
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('preserves a later warmup failure after an earlier batch throws', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    const depositWallet = address('01')
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-1',
      address: address('aa'),
      deposit_wallet_address: depositWallet,
      referred_by_user_id: null,
      settings: { trading: { market_order_type: 'FAK' } },
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'k', passphrase: 'p', secret: 's' },
    })
    mocks.getExtracted.mockResolvedValue((message: string, values?: { seconds?: string }) =>
      message.replace('{seconds}', values?.seconds ?? ''),
    )

    globalThis.fetch = mock()
      .mockRejectedValueOnce(new Error('first batch transport failure'))
      .mockResolvedValueOnce({
        status: 503,
        statusText: 'Service Unavailable',
        ok: false,
        json: async () => ({
          error: 'Post-only mode: only post-only orders and cancels are allowed.',
          retry_after_seconds: 79,
        }),
      }) as any

    const { storeOrdersAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    const result = await storeOrdersAction(
      Array.from({ length: MAX_ORDER_SUBMISSION_ORDERS }, (_, index) =>
        basePayload({
          maker: depositWallet,
          signer: depositWallet,
          salt: (index + 1).toString(),
        }),
      ),
    )

    expect(result).toEqual({
      error: 'Restart in progress. Trading resumes in 79s. Cancels still available.',
      retryAfterSeconds: 79,
      results: null,
    })
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('blocks batch order storage when Sumsub approval is required', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    mocks.getCurrentUser.mockResolvedValueOnce({ id: 'user-1' })
    sumsubMocks.requireApproval.mockResolvedValueOnce({ allowed: false })
    const { storeOrdersAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    await expect(storeOrdersAction([basePayload()])).resolves.toEqual({
      error: 'Complete identity verification to continue.',
      results: null,
    })
    expect(mocks.getUserTradingAuthSecrets).not.toHaveBeenCalled()
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })

  it.each([null, undefined])('returns a validation error for malformed batch input: %s', async (payloads) => {
    process.env.CLOB_URL = 'https://clob.local'
    const depositWallet = address('01')
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-1',
      address: address('aa'),
      deposit_wallet_address: depositWallet,
      referred_by_user_id: null,
      settings: { trading: { market_order_type: 'FAK' } },
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'k', passphrase: 'p', secret: 's' },
    })
    const fetchMock = mock()
    globalThis.fetch = fetchMock as any

    const { storeOrdersAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    const result = await storeOrdersAction(payloads as StoreOrdersInput)

    expect(result).toEqual({
      error: 'Something went wrong while processing your order. Please try again.',
      results: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses a supported raw locale when batch schema validation fails', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    const depositWallet = address('01')
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-1',
      address: address('aa'),
      deposit_wallet_address: depositWallet,
      referred_by_user_id: null,
      settings: { trading: { market_order_type: 'FAK' } },
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'k', passphrase: 'p', secret: 's' },
    })
    mocks.getExtracted.mockImplementation(
      async ({ locale }: { locale: string }) =>
        (message: string) =>
          `${locale}:${message}`,
    )

    const { storeOrdersAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    const result = await storeOrdersAction([
      { ...basePayload({ locale: 'pt', maker: depositWallet, signer: depositWallet }), side: 2 },
    ] as unknown as StoreOrdersInput)

    expect(result).toEqual({
      error: 'pt:Something went wrong while processing your order. Please try again.',
      results: null,
    })
  })

  it('preserves individual failures returned by the CLOB batch endpoint', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    const depositWallet = address('01')
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-1',
      address: address('aa'),
      deposit_wallet_address: depositWallet,
      referred_by_user_id: null,
      settings: { trading: { market_order_type: 'FAK' } },
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'k', passphrase: 'p', secret: 's' },
    })

    globalThis.fetch = mock().mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      ok: true,
      json: async () => [
        { success: true, errorMsg: '', orderID: 'yes-123', status: 'matched' },
        {
          success: false,
          errorMsg: "order couldn't be fully filled, FOK orders are fully filled/killed",
          orderID: '',
          status: 'unmatched',
        },
      ],
    }) as any

    const { storeOrdersAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    const result = await storeOrdersAction([
      basePayload({ maker: depositWallet, signer: depositWallet, token_id: '1' }),
      basePayload({ maker: depositWallet, signer: depositWallet, token_id: '2', salt: '2' }),
    ])

    expect(result).toEqual({
      error: null,
      results: [
        { error: null, orderId: 'yes-123' },
        { error: 'Not enough liquidity to fully fill this order right now.', orderId: null },
      ],
    })
  })

  it('uses each order locale for individual batch errors', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    const depositWallet = address('01')
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-1',
      address: address('aa'),
      deposit_wallet_address: depositWallet,
      referred_by_user_id: null,
      settings: { trading: { market_order_type: 'FAK' } },
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'k', passphrase: 'p', secret: 's' },
    })
    mocks.getExtracted.mockImplementation(
      async ({ locale }: { locale: string }) =>
        (message: string) =>
          `${locale}:${message}`,
    )

    globalThis.fetch = mock().mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      ok: true,
      json: async () => [
        { success: true, errorMsg: '', orderID: 'yes-123', status: 'matched' },
        {
          success: false,
          errorMsg: "order couldn't be fully filled, FOK orders are fully filled/killed",
          orderID: '',
          status: 'unmatched',
        },
      ],
    }) as any

    const { storeOrdersAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    const result = await storeOrdersAction([
      basePayload({ maker: depositWallet, signer: depositWallet, token_id: '1' }),
      basePayload({ maker: depositWallet, signer: depositWallet, token_id: '2', salt: '2', locale: 'pt' }),
    ])

    expect(result).toEqual({
      error: null,
      results: [
        { error: null, orderId: 'yes-123' },
        { error: 'pt:Not enough liquidity to fully fill this order right now.', orderId: null },
      ],
    })
  })

  it('returns default message for unmapped CLOB errors', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    const depositWallet = address('01')

    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-1',
      address: address('aa'),
      deposit_wallet_address: depositWallet,
      referred_by_user_id: null,
      settings: { trading: { market_order_type: 'FAK' } },
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'k', passphrase: 'p', secret: 's' },
    })

    const fetchMock = mock().mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      ok: true,
      json: async () => ({ success: false, errorMsg: 'some internal-only clob detail' }),
    })
    globalThis.fetch = fetchMock as any

    const { storeOrderAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    const result = await storeOrderAction(
      basePayload({
        maker: depositWallet,
        signer: depositWallet,
        type: 'MARKET',
      }),
    )

    expect(result).toEqual({
      error: 'Something went wrong while processing your order. Please try again.',
    })
  })

  it('explains post-restart warmup errors with the CLOB countdown', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    const depositWallet = address('01')
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-1',
      address: address('aa'),
      deposit_wallet_address: depositWallet,
      referred_by_user_id: null,
      settings: {},
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'k', passphrase: 'p', secret: 's' },
    })
    mocks.getExtracted.mockResolvedValueOnce((message: string, values?: { seconds?: string }) =>
      message.replace('{seconds}', values?.seconds ?? ''),
    )

    globalThis.fetch = mock().mockResolvedValueOnce({
      status: 503,
      statusText: 'Service Unavailable',
      ok: false,
      json: async () => ({
        error: 'post-only mode: only post-only orders and cancels are allowed',
        code: 'post_only_mode',
        retry_after_seconds: 79,
      }),
    }) as any

    const { storeOrderAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    const result = await storeOrderAction(
      basePayload({
        maker: depositWallet,
        signer: depositWallet,
        type: 'MARKET',
        locale: 'pt',
      }),
    )

    expect(result).toEqual({
      error: 'Restart in progress. Trading resumes in 79s. Cancels still available.',
      code: 'post_only_mode',
      retryAfterSeconds: 79,
    })
    expect(mocks.getExtracted).toHaveBeenCalledWith({ locale: 'pt' })
  })

  it('does not turn the restart retry hint into a one-second completion estimate', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    const depositWallet = address('01')
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-1',
      address: address('aa'),
      deposit_wallet_address: depositWallet,
      referred_by_user_id: null,
      settings: {},
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'k', passphrase: 'p', secret: 's' },
    })

    globalThis.fetch = mock().mockResolvedValueOnce({
      status: 425,
      statusText: 'Too Early',
      ok: false,
      json: async () => ({
        error: 'Trading is temporarily unavailable while the CLOB is restarting.',
        retry_after_seconds: 1,
      }),
    }) as any

    const { storeOrderAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    const result = await storeOrderAction(
      basePayload({
        maker: depositWallet,
        signer: depositWallet,
        type: 'MARKET',
      }),
    )

    expect(result).toEqual({
      error: 'The matching engine is restarting. Please try again shortly. You can still cancel open orders.',
      retryAfterSeconds: 1,
    })
  })

  it('does not invent a countdown when post-restart warmup omits its retry hint', async () => {
    process.env.CLOB_URL = 'https://clob.local'
    const depositWallet = address('01')
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'user-1',
      address: address('aa'),
      deposit_wallet_address: depositWallet,
      referred_by_user_id: null,
      settings: {},
    })
    mocks.getUserTradingAuthSecrets.mockResolvedValueOnce({
      clob: { key: 'k', passphrase: 'p', secret: 's' },
    })

    globalThis.fetch = mock().mockResolvedValueOnce({
      status: 503,
      statusText: 'Service Unavailable',
      ok: false,
      json: async () => ({
        error: 'post-only mode: only post-only orders and cancels are allowed',
        code: 'post_only_mode',
      }),
    }) as any

    const { storeOrderAction } = await import('@/app/[locale]/(platform)/event/[slug]/_actions/store-order')
    const result = await storeOrderAction(
      basePayload({
        maker: depositWallet,
        signer: depositWallet,
        locale: 'pt',
      }),
    )

    expect(result).toEqual({
      error: 'The matching engine is restarting. Please try again shortly. You can still cancel open orders.',
      code: 'post_only_mode',
    })
  })
})
