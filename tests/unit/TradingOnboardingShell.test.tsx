import type { ComponentProps, ComponentType } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { lazy, Suspense, useEffect } from 'react'

import {
  clearMeldPendingCheckout,
  listMeldPendingCheckouts,
  persistMeldPendingCheckout,
  resumeMeldCheckoutPolling,
  setMeldCheckoutIdInUrl,
} from '@/lib/payments/meld-return-channel'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  walletMount: mock(),
  walletUnmount: mock(),
  walletProps: null as any,
}))

void mock.module('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: ComponentType<any> } | ComponentType<any>>) => {
    const Component = lazy(async () => {
      const result = await loader()
      return typeof result === 'function' ? { default: result } : (result as { default: ComponentType<any> })
    })
    return function DeferredComponent(props: any) {
      return (
        <Suspense fallback={null}>
          <Component {...props} />
        </Suspense>
      )
    }
  },
}))
void mock.module('@/app/[locale]/(platform)/_components/TradingOnboardingDialogs', () => ({
  default: () => (
    <div data-testid="onboarding-dialogs">
      <input aria-label="Onboarding draft" />
    </div>
  ),
}))
void mock.module('@/app/[locale]/(platform)/_components/WalletFlow', () => ({
  WalletFlow: function WalletFlow(props: any) {
    mocks.walletProps = props
    useEffect(() => {
      mocks.walletMount(listMeldPendingCheckouts())
      return () => {
        mocks.walletUnmount()
      }
    }, [])
    return (
      <div data-testid="wallet-flow">
        <input aria-label="Wallet draft" />
      </div>
    )
  },
}))

const { default: TradingOnboardingShell } = await import('@/app/[locale]/(platform)/_components/TradingOnboardingShell')
type ShellProps = ComponentProps<typeof TradingOnboardingShell>
const checkoutId = '12345678-1234-1234-1234-123456789abc'

function createProps(overrides: Partial<ShellProps> = {}): ShellProps {
  return {
    activeModal: null,
    onModalOpenChange: mock(),
    usernameDefaultValue: '',
    usernameError: null,
    isUsernameSubmitting: false,
    onUsernameSubmit: mock(),
    emailDefaultValue: '',
    emailError: null,
    isEmailSubmitting: false,
    onEmailSubmit: mock(),
    onEmailSkip: mock(),
    sumsubStatus: {
      enabled: false,
      configured: false,
      effective: false,
      enforcement: 'disabled',
      levelName: '',
      status: 'not_started',
      approvedAt: null,
      updatedAt: null,
    },
    onSumsubStatusChange: mock(),
    enableTradingStep: 'idle',
    enableTradingError: null,
    onCreateDepositWallet: mock(),
    onEnableTradingAuth: mock(),
    hasDeployedDepositWallet: false,
    hasTradingAuth: false,
    hasTokenApprovals: false,
    approvalsStep: 'idle',
    tokenApprovalError: null,
    onApproveTokens: mock(),
    autoRedeemStep: 'idle',
    autoRedeemError: null,
    onApproveAutoRedeem: mock(),
    fundModalOpen: false,
    onFundOpenChange: mock(),
    onFundDeposit: mock(),
    depositModalOpen: false,
    onDepositOpenChange: mock(),
    withdrawModalOpen: false,
    onWithdrawOpenChange: mock(),
    user: null,
    canBuyMeld: false,
    ...overrides,
  }
}

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
  for (const checkout of listMeldPendingCheckouts()) {
    clearMeldPendingCheckout(checkout.checkoutId)
  }
  mocks.walletMount.mockClear()
  mocks.walletUnmount.mockClear()
  mocks.walletProps = null
})
afterEach(() => {
  cleanup()
  for (const checkout of listMeldPendingCheckouts()) {
    clearMeldPendingCheckout(checkout.checkoutId)
  }
  window.history.replaceState(null, '', '/')
})

describe('trading onboarding shell', () => {
  it('keeps both heavy visual branches unloaded for an ordinary first visit', async () => {
    render(<TradingOnboardingShell {...createProps()} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByTestId('onboarding-dialogs')).not.toBeInTheDocument()
    expect(screen.queryByTestId('wallet-flow')).not.toBeInTheDocument()
    expect(mocks.walletMount).not.toHaveBeenCalled()
  })

  it('loads onboarding on demand and retains its state after closing without loading the wallet', async () => {
    const props = createProps()
    const { rerender } = render(<TradingOnboardingShell {...props} />)
    rerender(<TradingOnboardingShell {...props} activeModal="username" />)
    const draft = await screen.findByLabelText('Onboarding draft')
    fireEvent.change(draft, { target: { value: 'Keep onboarding state' } })
    rerender(<TradingOnboardingShell {...props} />)
    expect(screen.getByLabelText('Onboarding draft')).toHaveValue('Keep onboarding state')
    expect(mocks.walletMount).not.toHaveBeenCalled()
  })

  it.each(['depositModalOpen', 'withdrawModalOpen'] as const)(
    'retains wallet state and callbacks after %s closes',
    async (flag) => {
      const props = createProps()
      const { rerender } = render(<TradingOnboardingShell {...props} />)
      rerender(<TradingOnboardingShell {...props} {...{ [flag]: true }} />)
      const draft = await screen.findByLabelText('Wallet draft')
      fireEvent.change(draft, { target: { value: 'Keep checkout session' } })
      rerender(<TradingOnboardingShell {...props} />)
      expect(screen.getByLabelText('Wallet draft')).toHaveValue('Keep checkout session')
      expect(mocks.walletMount).toHaveBeenCalledTimes(1)
      expect(mocks.walletUnmount).not.toHaveBeenCalled()
      expect(mocks.walletProps.onDepositOpenChange).toBe(props.onDepositOpenChange)
      expect(mocks.walletProps.onWithdrawOpenChange).toBe(props.onWithdrawOpenChange)
      expect(screen.queryByTestId('onboarding-dialogs')).not.toBeInTheDocument()
    },
  )

  it('restores persisted checkouts while every dialog stays closed', async () => {
    persistMeldPendingCheckout(checkoutId)
    render(<TradingOnboardingShell {...createProps()} />)
    await screen.findByTestId('wallet-flow')
    expect(mocks.walletMount).toHaveBeenCalledWith([expect.objectContaining({ checkoutId })])
    expect(mocks.walletProps.depositOpen).toBe(false)
    expect(mocks.walletProps.withdrawOpen).toBe(false)
    expect(screen.queryByTestId('onboarding-dialogs')).not.toBeInTheDocument()
  })

  it.each([checkoutId, 'invalid-checkout'])('loads the existing return handler for checkout URL %s', async (id) => {
    window.history.replaceState(null, '', `/?meldCheckoutId=${id}`)
    render(<TradingOnboardingShell {...createProps()} />)
    await screen.findByTestId('wallet-flow')
    expect(mocks.walletMount).toHaveBeenCalledTimes(1)
  })

  it.each(['url', 'poll', 'storage'] as const)(
    'wakes the wallet for a %s checkout arriving after first render',
    async (trigger) => {
      render(<TradingOnboardingShell {...createProps()} />)
      await act(async () => {
        if (trigger === 'url') {
          setMeldCheckoutIdInUrl(checkoutId)
        } else {
          persistMeldPendingCheckout(checkoutId)
          if (trigger === 'poll') {
            resumeMeldCheckoutPolling(checkoutId)
          } else {
            window.dispatchEvent(new StorageEvent('storage'))
          }
        }
      })
      await screen.findByTestId('wallet-flow')
      expect(mocks.walletMount).toHaveBeenCalledTimes(1)
      expect(screen.queryByTestId('onboarding-dialogs')).not.toBeInTheDocument()
    },
  )

  it('cleans up the wallet session when the provider user key changes', async () => {
    const props = createProps({ depositModalOpen: true })
    const { rerender } = render(<TradingOnboardingShell key="guest" {...props} />)
    await screen.findByTestId('wallet-flow')
    rerender(<TradingOnboardingShell key="signed-in-user" {...createProps()} />)
    expect(mocks.walletUnmount).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('wallet-flow')).not.toBeInTheDocument()
  })
})
