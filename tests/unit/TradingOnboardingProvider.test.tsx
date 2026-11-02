import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock, jest } from 'bun:test'

import type { User } from '@/types'

import { useTradingOnboarding } from '@/app/[locale]/(platform)/_providers/TradingOnboardingContext'
import { TradingOnboardingProvider } from '@/app/[locale]/(platform)/_providers/TradingOnboardingProvider'
import { useUser } from '@/stores/useUser'

import { hoisted, mocked, spyOn, stubGlobal, unstubAllGlobals } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  createDepositWalletAction: mock(),
  dialogProps: null as any,
  enableTradingAuthAction: mock(),
  getSession: mock().mockResolvedValue({ data: { user: null } }),
  markApprovalStateWithoutTransactionAction: mock(),
  openAppKit: mock(),
  signAndSubmitDepositWalletCalls: mock(),
  signTypedDataAsync: mock(),
  trackEvent: mock(),
  updateOnboardingUsernameAction: mock(),
  usePathname: mock(() => '/'),
}))

void mock.module('@/hooks/useOperatorAnalytics', () => ({ useOperatorAnalytics: () => mocks.trackEvent }))

const PENDING_DEPOSIT_WALLET_MESSAGE = 'Your trading wallet is still being set up on-chain. Check back shortly.'
const WALLET_RECONNECT_MESSAGE = 'Your wallet connection expired. Reconnect your wallet and try again.'
const AUTO_REDEEM_RETRY_MESSAGE = 'Could not enable auto-redeem right now. Please try again in a few moments.'
const ENABLE_TRADING_RETRY_MESSAGE =
  'Could not create your Deposit Wallet right now. Please try again in a few moments.'

void mock.module('next-intl', () => ({
  useExtracted: () => (message: string) => message,
}))

void mock.module('next/navigation', () => ({
  usePathname: mocks.usePathname,
}))

void mock.module('wagmi', () => ({
  useSignMessage: () => ({
    signMessageAsync: mock(),
  }),
  useSignTypedData: () => ({
    signTypedDataAsync: mocks.signTypedDataAsync,
  }),
}))

void mock.module('@/app/[locale]/(platform)/_actions/approve-tokens', () => ({
  markApprovalStateWithoutTransactionAction: mocks.markApprovalStateWithoutTransactionAction,
}))

void mock.module('@/app/[locale]/(platform)/_actions/deposit-wallet', () => ({
  checkUsernameAvailabilityAction: mock(),
  createDepositWalletAction: mocks.createDepositWalletAction,
  enableTradingAuthAction: mocks.enableTradingAuthAction,
  markAutoRedeemApprovalCompletedAction: mock(),
  updateOnboardingEmailAction: mock(),
  updateOnboardingUsernameAction: mocks.updateOnboardingUsernameAction,
}))

void mock.module('@/app/[locale]/(platform)/_components/TradingOnboardingDialogs', () => ({
  __esModule: true,
  default: function MockTradingOnboardingDialogs(props: any) {
    mocks.dialogProps = props
    return <div data-testid="active-modal">{props.activeModal ?? ''}</div>
  },
}))

void mock.module('@/hooks/useAffiliateOrderMetadata', () => ({
  useAffiliateOrderMetadata: () => ({
    affiliateAddress: null,
    affiliateSharePercent: null,
    referrerAddress: null,
  }),
}))

void mock.module('@/hooks/useAppKit', () => ({
  useAppKit: () => ({
    open: mocks.openAppKit,
  }),
}))

void mock.module('@/hooks/useDepositWalletPolling', () => ({
  useDepositWalletPolling: mock(),
}))

void mock.module('@/hooks/useSignaturePromptRunner', () => ({
  useSignaturePromptRunner: () => ({
    runWithSignaturePrompt: (callback: () => Promise<string>) => callback(),
  }),
}))

void mock.module('@/lib/auth-client', () => ({
  authClient: {
    getSession: mocks.getSession,
  },
}))

void mock.module('@/lib/wallet/client', () => ({
  signAndSubmitDepositWalletCalls: mocks.signAndSubmitDepositWalletCalls,
}))

function createUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    address: '0x00000000000000000000000000000000000000bb',
    email: '',
    twoFactorEnabled: false,
    username: '',
    image: '',
    settings: {},
    is_admin: false,
    deposit_wallet_address: null,
    deposit_wallet_status: 'not_started',
    ...overrides,
  }
}

function getRequestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') {
    return input
  }
  return input instanceof URL ? input.href : input.url
}

function TradingReadyActionProbe({
  forceTradingAuth = true,
  onTradingReady,
}: {
  forceTradingAuth?: boolean
  onTradingReady: () => void
}) {
  const { openTradeRequirements } = useTradingOnboarding()

  return (
    <button
      type="button"
      onClick={() =>
        openTradeRequirements({
          forceTradingAuth,
          onTradingReady,
        })
      }
    >
      Start pending action
    </button>
  )
}

function EnsureTradingReadyProbe({ onTradingReady }: { onTradingReady: () => void }) {
  const { ensureTradingReady } = useTradingOnboarding()

  return (
    <button
      type="button"
      onClick={() => {
        if (ensureTradingReady()) {
          onTradingReady()
        }
      }}
    >
      Submit trade
    </button>
  )
}

function StartDepositFlowProbe() {
  const { startDepositFlow } = useTradingOnboarding()

  return (
    <button type="button" onClick={startDepositFlow}>
      Open deposit wallet
    </button>
  )
}

describe('tradingOnboardingProvider', () => {
  beforeEach(() => {
    stubGlobal(
      'fetch',
      mock().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              enabled: false,
              configured: false,
              effective: false,
              enforcement: 'disabled',
              levelName: '',
              status: 'not_started',
              approvedAt: null,
              updatedAt: null,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    )
    useUser.setState(null)
    mocks.createDepositWalletAction.mockReset()
    mocks.dialogProps = null
    mocks.enableTradingAuthAction.mockReset()
    mocks.getSession.mockClear()
    mocks.markApprovalStateWithoutTransactionAction.mockReset()
    mocks.openAppKit.mockClear()
    mocks.signAndSubmitDepositWalletCalls.mockReset()
    mocks.signTypedDataAsync.mockReset()
    mocks.trackEvent.mockReset()
    mocks.updateOnboardingUsernameAction.mockReset()
    window.localStorage.removeItem('community_auth')
    mocks.usePathname.mockReturnValue('/')
  })

  afterEach(() => {
    useUser.setState(null)
    jest.restoreAllMocks()
    unstubAllGlobals()
  })

  it.each([
    { communityOk: true, localOk: true },
    { communityOk: true, localOk: false },
    { communityOk: false, localOk: true },
  ])('tracks profile completion only after both saves succeed (%j)', async ({ communityOk, localOk }) => {
    const user = createUser()
    useUser.setState(user)
    window.localStorage.setItem(
      'community_auth',
      JSON.stringify({
        version: 3,
        token: 'test-token',
        address: user.address,
        expires_at: '2999-01-01T00:00:00Z',
      }),
    )
    mocked(fetch).mockImplementation(
      async (_input, init) =>
        new Response(JSON.stringify(init?.method === 'POST' ? { username: 'chosen-name' } : { enabled: false }), {
          status: init?.method === 'POST' && !communityOk ? 409 : 200,
        }),
    )
    mocks.updateOnboardingUsernameAction.mockResolvedValue(
      localOk ? { error: null, data: { username: 'chosen-name', settings: {} } } : { error: 'Save failed', data: null },
    )
    render(
      <TradingOnboardingProvider>
        <div />
      </TradingOnboardingProvider>,
    )
    await waitFor(() => expect(mocks.dialogProps?.activeModal).toBe('username'))
    await act(async () => {
      await mocks.dialogProps.onUsernameSubmit('chosen-name', true)
    })

    expect(mocks.trackEvent.mock.calls).toEqual(communityOk && localOk ? [['profile_completed']] : [])
    if (communityOk && localOk) {
      await act(async () => {
        await mocks.dialogProps.onUsernameSubmit('chosen-name', true)
      })
      expect(mocks.trackEvent.mock.calls).toEqual([['profile_completed']])
    }
  })

  it('does not track a restored profile or trading state as a new completion', async () => {
    const user = createUser({
      username: 'existing-name',
      email: 'test@example.com',
      deposit_wallet_address: '0xbc040c5a56d757986475005f8cde8e41fe3e2486',
      deposit_wallet_status: 'deployed',
      settings: {
        tradingAuth: {
          clob: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z' },
          relayer: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z' },
          approvals: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z', version: 'v1' },
        },
      },
    })
    useUser.setState(user)
    render(
      <TradingOnboardingProvider>
        <div />
      </TradingOnboardingProvider>,
    )
    await waitFor(() => expect(mocks.dialogProps?.hasTokenApprovals).toBe(true))
    await act(async () => {
      useUser.setState({ ...user })
    })
    expect(mocks.trackEvent).not.toHaveBeenCalled()
  })

  it('places Required Sumsub after profile details and before wallet setup', async () => {
    mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          enabled: true,
          configured: true,
          effective: true,
          enforcement: 'required',
          levelName: 'basic-kyc-level',
          status: 'pending',
          approvedAt: null,
          updatedAt: '2026-07-19T12:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    useUser.setState(createUser({ email: 'user@example.com', username: 'user' }))

    render(
      <TradingOnboardingProvider>
        <div />
      </TradingOnboardingProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('active-modal')).toHaveTextContent('sumsub'))
    expect(mocks.createDepositWalletAction).not.toHaveBeenCalled()
  })

  it('does not report trading ready before the Sumsub status loads', async () => {
    let resolveStatus: ((response: Response) => void) | undefined
    mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      if (getRequestUrl(input) === '/api/payments/meld/enabled') {
        return Promise.resolve(
          new Response(JSON.stringify({ enabled: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return new Promise<Response>((resolve) => {
        resolveStatus = resolve
      })
    })
    const onTradingReady = mock()
    useUser.setState(
      createUser({
        deposit_wallet_address: '0xbc040c5a56d757986475005f8cde8e41fe3e2486',
        deposit_wallet_status: 'deployed',
        email: 'user@example.com',
        settings: {
          tradingAuth: {
            approvals: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z', version: 'v1' },
            clob: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z' },
            relayer: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z' },
          },
        },
        username: 'user',
      }),
    )

    render(
      <TradingOnboardingProvider>
        <EnsureTradingReadyProbe onTradingReady={onTradingReady} />
      </TradingOnboardingProvider>,
    )
    screen.getByRole('button', { name: 'Submit trade' }).click()
    expect(onTradingReady).not.toHaveBeenCalled()

    await act(async () => {
      resolveStatus?.(
        new Response(
          JSON.stringify({
            enabled: true,
            configured: true,
            effective: true,
            enforcement: 'required',
            levelName: 'basic-kyc-level',
            status: 'pending',
            approvedAt: null,
            updatedAt: '2026-07-19T12:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    })

    await waitFor(() => expect(screen.getByTestId('active-modal')).toHaveTextContent('sumsub'))
    expect(onTradingReady).not.toHaveBeenCalled()
  })

  it('keeps trading unresolved when the Sumsub status request fails', async () => {
    mocked(fetch).mockImplementation(async () => new Response(null, { status: 503 }))
    const onTradingReady = mock()
    useUser.setState(
      createUser({
        deposit_wallet_address: '0xbc040c5a56d757986475005f8cde8e41fe3e2486',
        deposit_wallet_status: 'deployed',
        email: 'user@example.com',
        settings: {
          tradingAuth: {
            approvals: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z', version: 'v1' },
            clob: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z' },
            relayer: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z' },
          },
        },
        username: 'user',
      }),
    )

    render(
      <TradingOnboardingProvider>
        <EnsureTradingReadyProbe onTradingReady={onTradingReady} />
      </TradingOnboardingProvider>,
    )
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    act(() => screen.getByRole('button', { name: 'Submit trade' }).click())

    expect(onTradingReady).not.toHaveBeenCalled()
    expect(screen.getByTestId('active-modal')).toBeEmptyDOMElement()
  })

  it.each([
    ['Disabled', false, false, false, 'disabled', ''],
    ['Observe only', true, true, true, 'observe', 'basic-kyc-level'],
  ] as const)(
    'continues trading when a failed status response confirms %s enforcement',
    async (_label, enabled, configured, effective, enforcement, levelName) => {
      mocked(fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            enabled,
            configured,
            effective,
            enforcement,
            levelName,
            status: 'error',
            approvedAt: null,
            updatedAt: null,
            error: 'Unable to load verification status.',
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      const onTradingReady = mock()
      useUser.setState(
        createUser({
          deposit_wallet_address: '0xbc040c5a56d757986475005f8cde8e41fe3e2486',
          deposit_wallet_status: 'deployed',
          email: 'user@example.com',
          settings: {
            tradingAuth: {
              approvals: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z', version: 'v1' },
              clob: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z' },
              relayer: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z' },
            },
          },
          username: 'user',
        }),
      )

      render(
        <TradingOnboardingProvider>
          <EnsureTradingReadyProbe onTradingReady={onTradingReady} />
        </TradingOnboardingProvider>,
      )
      await waitFor(() => expect(fetch).toHaveBeenCalled())
      act(() => screen.getByRole('button', { name: 'Submit trade' }).click())

      await waitFor(() => expect(onTradingReady).toHaveBeenCalledOnce())
    },
  )

  it('keeps trading blocked when a failed status response confirms Required enforcement', async () => {
    mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          enabled: true,
          configured: true,
          effective: true,
          enforcement: 'required',
          levelName: 'basic-kyc-level',
          status: 'error',
          approvedAt: null,
          updatedAt: null,
          error: 'Unable to load verification status.',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const onTradingReady = mock()
    useUser.setState(
      createUser({
        deposit_wallet_address: '0xbc040c5a56d757986475005f8cde8e41fe3e2486',
        deposit_wallet_status: 'deployed',
        email: 'user@example.com',
        settings: {
          tradingAuth: {
            approvals: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z', version: 'v1' },
            clob: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z' },
            relayer: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z' },
          },
        },
        username: 'user',
      }),
    )

    render(
      <TradingOnboardingProvider>
        <EnsureTradingReadyProbe onTradingReady={onTradingReady} />
      </TradingOnboardingProvider>,
    )
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    act(() => screen.getByRole('button', { name: 'Submit trade' }).click())

    expect(onTradingReady).not.toHaveBeenCalled()
  })

  it('allows buying Meld only after the server confirms payments are enabled', async () => {
    mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = getRequestUrl(input)
      const payload =
        url === '/api/payments/meld/enabled'
          ? { enabled: true }
          : {
              enabled: false,
              configured: false,
              effective: false,
              enforcement: 'disabled',
              levelName: '',
              status: 'not_started',
              approvedAt: null,
              updatedAt: null,
            }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    useUser.setState(
      createUser({
        deposit_wallet_address: '0xbc040c5a56d757986475005f8cde8e41fe3e2486',
        deposit_wallet_status: 'deployed',
      }),
    )

    render(
      <TradingOnboardingProvider>
        <div />
      </TradingOnboardingProvider>,
    )

    await waitFor(() => expect(mocks.dialogProps.canBuyMeld).toBe(true))
  })

  it('refreshes Meld availability when the page regains focus', async () => {
    let resolveRefresh!: (response: Response) => void
    const refreshedPaymentsEnabled = new Promise<Response>((resolve) => {
      resolveRefresh = resolve
    })
    let enabledRequestCount = 0
    mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = getRequestUrl(input)
      if (url === '/api/payments/meld/enabled') {
        enabledRequestCount += 1
        return enabledRequestCount === 1
          ? Promise.resolve(new Response(JSON.stringify({ enabled: true }), { status: 200 }))
          : refreshedPaymentsEnabled
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            enabled: false,
            configured: false,
            effective: false,
            enforcement: 'disabled',
            levelName: '',
            status: 'not_started',
            approvedAt: null,
            updatedAt: null,
          }),
          { status: 200 },
        ),
      )
    })
    useUser.setState(
      createUser({
        deposit_wallet_address: '0xbc040c5a56d757986475005f8cde8e41fe3e2486',
        deposit_wallet_status: 'deployed',
      }),
    )

    render(
      <TradingOnboardingProvider>
        <div />
      </TradingOnboardingProvider>,
    )

    await waitFor(() => expect(mocks.dialogProps.canBuyMeld).toBe(true))
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(enabledRequestCount).toBe(2))
    expect(mocks.dialogProps.canBuyMeld).toBe(false)

    await act(async () => {
      resolveRefresh(new Response(JSON.stringify({ enabled: false }), { status: 200 }))
    })

    await waitFor(() => expect(mocks.dialogProps.canBuyMeld).toBe(false))
  })

  it('refreshes Meld availability when the deposit wallet opens', async () => {
    let resolveRefresh!: (response: Response) => void
    const refreshedPaymentsEnabled = new Promise<Response>((resolve) => {
      resolveRefresh = resolve
    })
    let enabledRequestCount = 0
    mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = getRequestUrl(input)
      if (url === '/api/payments/meld/enabled') {
        enabledRequestCount += 1
        return enabledRequestCount === 1
          ? Promise.resolve(new Response(JSON.stringify({ enabled: true }), { status: 200 }))
          : refreshedPaymentsEnabled
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            enabled: false,
            configured: false,
            effective: false,
            enforcement: 'disabled',
            levelName: '',
            status: 'not_started',
            approvedAt: null,
            updatedAt: null,
          }),
          { status: 200 },
        ),
      )
    })
    useUser.setState(
      createUser({
        deposit_wallet_address: '0xbc040c5a56d757986475005f8cde8e41fe3e2486',
        deposit_wallet_status: 'deployed',
      }),
    )

    render(
      <TradingOnboardingProvider>
        <StartDepositFlowProbe />
      </TradingOnboardingProvider>,
    )

    await waitFor(() => expect(mocks.dialogProps.canBuyMeld).toBe(true))
    await act(async () => {
      screen.getByRole('button', { name: 'Open deposit wallet' }).click()
    })
    await waitFor(() => expect(enabledRequestCount).toBe(2))
    expect(mocks.dialogProps.depositModalOpen).toBe(true)
    expect(mocks.dialogProps.canBuyMeld).toBe(false)

    await act(async () => {
      resolveRefresh(new Response(JSON.stringify({ enabled: false }), { status: 200 }))
    })
  })

  it('lets Observe only continue after the single Sumsub prompt is dismissed', async () => {
    mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          enabled: true,
          configured: true,
          effective: true,
          enforcement: 'observe',
          levelName: 'basic-kyc-level',
          status: 'not_started',
          approvedAt: null,
          updatedAt: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    useUser.setState(createUser({ email: 'user@example.com', username: 'user' }))
    render(
      <TradingOnboardingProvider>
        <div />
      </TradingOnboardingProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('active-modal')).toHaveTextContent('sumsub'))

    await act(async () => {
      await mocks.dialogProps.onModalOpenChange('sumsub', false)
    })

    await waitFor(() => expect(screen.getByTestId('active-modal')).toHaveTextContent('enable'))
  })

  it('resumes Required onboarding only after server-confirmed approval', async () => {
    mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          enabled: true,
          configured: true,
          effective: true,
          enforcement: 'required',
          levelName: 'basic-kyc-level',
          status: 'pending',
          approvedAt: null,
          updatedAt: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    useUser.setState(createUser({ email: 'user@example.com', username: 'user' }))
    render(
      <TradingOnboardingProvider>
        <div />
      </TradingOnboardingProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('active-modal')).toHaveTextContent('sumsub'))

    await act(async () => {
      await mocks.dialogProps.onSumsubStatusChange({
        ...mocks.dialogProps.sumsubStatus,
        status: 'approved',
        approvedAt: '2026-07-19T12:00:00.000Z',
      })
    })

    await waitFor(() => expect(screen.getByTestId('active-modal')).toHaveTextContent('enable'))
  })

  it('keeps polling an in-progress review after the Sumsub dialog closes', async () => {
    let poll: (() => void) | undefined
    let pollRegistrations = 0
    const originalSetInterval = window.setInterval.bind(window)
    spyOn(window, 'setInterval').mockImplementation((handler, timeout, ...args): ReturnType<typeof setInterval> => {
      if (timeout === 5_000) {
        poll = handler as () => void
        pollRegistrations += 1
        return 1 as unknown as ReturnType<typeof setInterval>
      }
      return originalSetInterval(handler, timeout, ...args) as unknown as ReturnType<typeof setInterval>
    })
    const pendingStatus = {
      enabled: true,
      configured: true,
      effective: true,
      enforcement: 'required',
      levelName: 'basic-kyc-level',
      status: 'pending',
      approvedAt: null,
      updatedAt: '2026-07-19T12:00:00.000Z',
    }
    mocked(fetch).mockImplementation(
      async () =>
        new Response(JSON.stringify(pendingStatus), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const onTradingReady = mock()
    useUser.setState(
      createUser({
        deposit_wallet_address: '0xbc040c5a56d757986475005f8cde8e41fe3e2486',
        deposit_wallet_status: 'deployed',
        email: 'user@example.com',
        settings: {
          tradingAuth: {
            approvals: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z', version: 'v1' },
            clob: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z' },
            relayer: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z' },
          },
        },
        username: 'user',
      }),
    )

    render(
      <TradingOnboardingProvider>
        <TradingReadyActionProbe forceTradingAuth={false} onTradingReady={onTradingReady} />
      </TradingOnboardingProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('active-modal')).toHaveTextContent('sumsub'))
    act(() => screen.getByRole('button', { name: 'Start pending action' }).click())
    await act(async () => {
      await mocks.dialogProps.onModalOpenChange('sumsub', false)
    })
    await waitFor(() => expect(pollRegistrations).toBeGreaterThanOrEqual(2))

    mocked(fetch).mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            ...pendingStatus,
            status: 'approved',
            approvedAt: '2026-07-19T12:05:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    await act(async () => {
      poll?.()
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => expect(mocks.dialogProps.sumsubStatus.status).toBe('approved'))
    await waitFor(() => expect(onTradingReady).toHaveBeenCalledTimes(1))
  })

  it('shows username before email when the current username is generated from the deposit wallet', async () => {
    const depositWalletAddress = '0xbc040c5a56d757986475005f8cde8e41fe3e2486'
    const generatedUsername = `${depositWalletAddress}-1770000000000`

    useUser.setState(
      createUser({
        deposit_wallet_address: depositWalletAddress,
        deposit_wallet_status: 'deployed',
        email: '',
        settings: {
          onboarding: {
            termsAcceptedAt: '2026-05-18T18:32:43.349Z',
            usernameCompletedAt: '2026-05-18T18:32:43.349Z',
          },
        },
        username: generatedUsername,
      }),
    )

    render(
      <TradingOnboardingProvider>
        <div />
      </TradingOnboardingProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('active-modal')).toHaveTextContent('username')
    })
    expect(mocks.dialogProps.usernameDefaultValue).toBe('')
  })

  it('keeps the initial enable trading flow inside the large modal when trading auth is missing', async () => {
    const depositWalletAddress = '0xbc040c5a56d757986475005f8cde8e41fe3e2486'
    mocks.signTypedDataAsync.mockResolvedValue('0xsignature')
    mocks.enableTradingAuthAction.mockResolvedValue({
      error: null,
      data: {
        tradingAuth: {
          relayer: { enabled: true, updatedAt: '2026-06-06T12:00:00.000Z' },
          clob: { enabled: true, updatedAt: '2026-06-06T12:00:00.000Z' },
        },
      },
    })
    mocks.createDepositWalletAction
      .mockResolvedValueOnce({ error: 'Enable trading to continue.', data: null })
      .mockResolvedValueOnce({
        error: null,
        data: {
          deposit_wallet_address: depositWalletAddress,
          deposit_wallet_signature: null,
          deposit_wallet_signed_at: null,
          deposit_wallet_status: 'deploying',
          deposit_wallet_tx_hash: '0xtx',
        },
      })

    useUser.setState(
      createUser({
        email: 'user@example.com',
        username: 'user',
      }),
    )

    render(
      <TradingOnboardingProvider>
        <div />
      </TradingOnboardingProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('active-modal')).toHaveTextContent('enable')
    })

    await act(async () => {
      await mocks.dialogProps.onCreateDepositWallet()
    })

    expect(mocks.signTypedDataAsync).toHaveBeenCalledTimes(1)
    expect(mocks.enableTradingAuthAction).toHaveBeenCalledTimes(1)
    expect(mocks.createDepositWalletAction).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('active-modal')).toHaveTextContent('enable')
    expect(screen.getByTestId('active-modal')).not.toHaveTextContent('enable-status')
    expect(mocks.trackEvent).not.toHaveBeenCalled()
  })

  it('auto-prompts trading auth on event routes', async () => {
    mocks.usePathname.mockReturnValue('/event/test-market')

    useUser.setState(
      createUser({
        deposit_wallet_address: '0xbc040c5a56d757986475005f8cde8e41fe3e2486',
        deposit_wallet_status: 'deployed',
        email: 'user@example.com',
        username: 'user',
      }),
    )

    render(
      <TradingOnboardingProvider>
        <div />
      </TradingOnboardingProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('active-modal')).toHaveTextContent('enable-status')
    })
  })

  it('waits for the session refresh before completing trading auth', async () => {
    let resolveSession: ((value: { data: { user: null } }) => void) | undefined
    mocks.getSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSession = resolve
        }),
    )
    mocks.signTypedDataAsync.mockResolvedValue('0xsignature')
    mocks.enableTradingAuthAction.mockResolvedValue({
      error: null,
      data: {
        tradingAuth: {
          relayer: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z' },
          clob: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z' },
        },
      },
    })

    useUser.setState(
      createUser({
        deposit_wallet_address: '0xbc040c5a56d757986475005f8cde8e41fe3e2486',
        deposit_wallet_status: 'deployed',
        email: 'user@example.com',
        username: 'user',
      }),
    )

    render(
      <TradingOnboardingProvider>
        <div />
      </TradingOnboardingProvider>,
    )

    let completed = false
    const request = mocks.dialogProps.onEnableTradingAuth().then(() => {
      completed = true
    })

    await waitFor(() => {
      expect(mocks.enableTradingAuthAction).toHaveBeenCalledTimes(1)
      expect(mocks.getSession).toHaveBeenCalledWith({
        query: { disableCookieCache: true },
      })
    })
    expect(completed).toBe(false)

    await act(async () => {
      resolveSession?.({ data: { user: null } })
      await request
    })

    expect(completed).toBe(true)
  })

  it('resumes a pending action after trading becomes ready again', async () => {
    const onTradingReady = mock()
    mocks.signTypedDataAsync.mockResolvedValue('0xsignature')
    mocks.enableTradingAuthAction.mockResolvedValue({
      error: null,
      data: {
        tradingAuth: {
          relayer: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z' },
          clob: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z' },
        },
      },
    })

    useUser.setState(
      createUser({
        deposit_wallet_address: '0xbc040c5a56d757986475005f8cde8e41fe3e2486',
        deposit_wallet_status: 'deployed',
        email: 'user@example.com',
        settings: {
          tradingAuth: {
            approvals: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z', version: 'v1' },
            clob: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z' },
            relayer: { enabled: true, updatedAt: '2026-07-10T10:41:37.944Z' },
          },
        },
        username: 'user',
      }),
    )

    render(
      <TradingOnboardingProvider>
        <TradingReadyActionProbe onTradingReady={onTradingReady} />
      </TradingOnboardingProvider>,
    )

    await act(async () => {
      screen.getByRole('button', { name: 'Start pending action' }).click()
    })

    await waitFor(() => {
      expect(screen.getByTestId('active-modal')).toHaveTextContent('enable-status')
    })
    expect(onTradingReady).not.toHaveBeenCalled()

    await act(async () => {
      await mocks.dialogProps.onEnableTradingAuth()
    })

    await waitFor(() => {
      expect(onTradingReady).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => expect(mocks.trackEvent.mock.calls).toEqual([['trading_enabled']]))
    await act(async () => {
      useUser.setState((previous) => (previous ? { ...previous } : previous))
    })
    expect(mocks.trackEvent.mock.calls).toEqual([['trading_enabled']])
  })

  it('opens AppKit instead of exposing wagmi connector errors during enable trading', async () => {
    mocks.createDepositWalletAction.mockResolvedValue({
      error: 'Enable trading to continue.',
      data: null,
    })
    mocks.signTypedDataAsync.mockRejectedValue({
      name: 'ConnectorNotConnectedError',
      message: 'Connector not connected.\n\nVersion:\n@wagmi/core@2.22.1',
    })

    useUser.setState(
      createUser({
        email: 'user@example.com',
        username: 'user',
      }),
    )

    render(
      <TradingOnboardingProvider>
        <div />
      </TradingOnboardingProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('active-modal')).toHaveTextContent('enable')
    })

    await act(async () => {
      await mocks.dialogProps.onCreateDepositWallet()
    })

    await waitFor(() => {
      expect(mocks.dialogProps.enableTradingError).toBe(WALLET_RECONNECT_MESSAGE)
    })
    expect(mocks.openAppKit).toHaveBeenCalledWith({ view: 'Connect' })
    expect(mocks.enableTradingAuthAction).not.toHaveBeenCalled()
  })

  it('hides RPC timeouts while enabling trading', async () => {
    mocks.createDepositWalletAction.mockResolvedValue({
      error: 'RPC Request failed. Request timeout on the free plan, please upgrade to paid plan',
      data: null,
    })

    useUser.setState(createUser({ email: 'user@example.com', username: 'user' }))

    render(
      <TradingOnboardingProvider>
        <div />
      </TradingOnboardingProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('active-modal')).toHaveTextContent('enable')
    })

    await act(async () => {
      await mocks.dialogProps.onCreateDepositWallet()
    })

    expect(mocks.dialogProps.enableTradingError).toBe(ENABLE_TRADING_RETRY_MESSAGE)
    expect(mocks.trackEvent).not.toHaveBeenCalled()
  })

  it('does not start token approval signing before the deposit wallet is deployed', async () => {
    useUser.setState(
      createUser({
        deposit_wallet_address: '0xbc040c5a56d757986475005f8cde8e41fe3e2486',
        deposit_wallet_status: 'deploying',
        email: 'user@example.com',
        settings: {
          tradingAuth: {
            clob: { enabled: true, updatedAt: '2026-06-06T12:00:00.000Z' },
            relayer: { enabled: true, updatedAt: '2026-06-06T12:00:00.000Z' },
          },
        },
        username: 'user',
      }),
    )

    render(
      <TradingOnboardingProvider>
        <div />
      </TradingOnboardingProvider>,
    )

    await act(async () => {
      await mocks.dialogProps.onApproveTokens()
    })

    await waitFor(() => {
      expect(mocks.dialogProps.tokenApprovalError).toBe(PENDING_DEPOSIT_WALLET_MESSAGE)
    })
    expect(mocks.markApprovalStateWithoutTransactionAction).not.toHaveBeenCalled()
    expect(mocks.signAndSubmitDepositWalletCalls).not.toHaveBeenCalled()
    expect(mocks.signTypedDataAsync).not.toHaveBeenCalled()
  })

  it('does not start auto-redeem signing before the deposit wallet is deployed', async () => {
    useUser.setState(
      createUser({
        deposit_wallet_address: '0xbc040c5a56d757986475005f8cde8e41fe3e2486',
        deposit_wallet_status: 'deploying',
        email: 'user@example.com',
        settings: {
          tradingAuth: {
            approvals: { enabled: true, updatedAt: '2026-06-06T12:00:00.000Z', version: 'v1' },
            clob: { enabled: true, updatedAt: '2026-06-06T12:00:00.000Z' },
            relayer: { enabled: true, updatedAt: '2026-06-06T12:00:00.000Z' },
          },
        },
        username: 'user',
      }),
    )

    render(
      <TradingOnboardingProvider>
        <div />
      </TradingOnboardingProvider>,
    )

    await act(async () => {
      await mocks.dialogProps.onApproveAutoRedeem()
    })

    await waitFor(() => {
      expect(mocks.dialogProps.autoRedeemError).toBe(PENDING_DEPOSIT_WALLET_MESSAGE)
    })
    expect(mocks.signAndSubmitDepositWalletCalls).not.toHaveBeenCalled()
    expect(mocks.signTypedDataAsync).not.toHaveBeenCalled()
  })

  it('resumes deposit wallet polling when auto-redeem approval reports an undeployed wallet', async () => {
    mocks.signAndSubmitDepositWalletCalls.mockResolvedValue({
      code: 'deposit_wallet_not_deployed',
      error: 'Your Deposit Wallet is still being created. Try again in a moment.',
    })

    useUser.setState(
      createUser({
        deposit_wallet_address: '0xbc040c5a56d757986475005f8cde8e41fe3e2486',
        deposit_wallet_status: 'deployed',
        email: 'user@example.com',
        settings: {
          tradingAuth: {
            approvals: { enabled: true, updatedAt: '2026-06-06T12:00:00.000Z', version: 'v1' },
            clob: { enabled: true, updatedAt: '2026-06-06T12:00:00.000Z' },
            relayer: { enabled: true, updatedAt: '2026-06-06T12:00:00.000Z' },
          },
        },
        username: 'user',
      }),
    )

    render(
      <TradingOnboardingProvider>
        <div />
      </TradingOnboardingProvider>,
    )

    await act(async () => {
      await mocks.dialogProps.onApproveAutoRedeem()
    })

    await waitFor(() => {
      expect(mocks.dialogProps.autoRedeemError).toBe(PENDING_DEPOSIT_WALLET_MESSAGE)
    })
    expect(useUser.getState()?.deposit_wallet_status).toBe('deploying')
    expect(mocks.dialogProps.autoRedeemStep).toBe('idle')
  })

  it('opens AppKit when auto-redeem signing reports a stale wallet connector', async () => {
    mocks.signAndSubmitDepositWalletCalls.mockResolvedValue({
      code: 'wallet_connector_not_connected',
      error: WALLET_RECONNECT_MESSAGE,
    })

    useUser.setState(
      createUser({
        deposit_wallet_address: '0xbc040c5a56d757986475005f8cde8e41fe3e2486',
        deposit_wallet_status: 'deployed',
        email: 'user@example.com',
        settings: {
          tradingAuth: {
            approvals: { enabled: true, updatedAt: '2026-06-06T12:00:00.000Z', version: 'v1' },
            clob: { enabled: true, updatedAt: '2026-06-06T12:00:00.000Z' },
            relayer: { enabled: true, updatedAt: '2026-06-06T12:00:00.000Z' },
          },
        },
        username: 'user',
      }),
    )

    render(
      <TradingOnboardingProvider>
        <div />
      </TradingOnboardingProvider>,
    )

    await act(async () => {
      await mocks.dialogProps.onApproveAutoRedeem()
    })

    await waitFor(() => {
      expect(mocks.dialogProps.autoRedeemError).toBe(WALLET_RECONNECT_MESSAGE)
    })
    expect(mocks.openAppKit).toHaveBeenCalledWith({ view: 'Connect' })
    expect(mocks.dialogProps.autoRedeemStep).toBe('idle')
  })

  it('uses an auto-redeem-specific fallback when signing fails', async () => {
    mocks.signAndSubmitDepositWalletCalls.mockResolvedValue({
      error:
        'RPC Request failed. URL: https://polygon-amoy.drpc.org Request timeout on the free plan, please upgrade to paid plan',
    })

    useUser.setState(
      createUser({
        deposit_wallet_address: '0xbc040c5a56d757986475005f8cde8e41fe3e2486',
        deposit_wallet_status: 'deployed',
        email: 'user@example.com',
        settings: {
          tradingAuth: {
            approvals: { enabled: true, updatedAt: '2026-06-06T12:00:00.000Z', version: 'v1' },
            clob: { enabled: true, updatedAt: '2026-06-06T12:00:00.000Z' },
            relayer: { enabled: true, updatedAt: '2026-06-06T12:00:00.000Z' },
          },
        },
        username: 'user',
      }),
    )

    render(
      <TradingOnboardingProvider>
        <div />
      </TradingOnboardingProvider>,
    )

    await act(async () => {
      await mocks.dialogProps.onApproveAutoRedeem()
    })

    await waitFor(() => {
      expect(mocks.dialogProps.autoRedeemError).toBe(AUTO_REDEEM_RETRY_MESSAGE)
    })
  })
})
