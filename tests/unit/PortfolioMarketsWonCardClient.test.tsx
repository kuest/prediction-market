import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { hoisted } from '../bun-test-helpers'

const WALLET_RECONNECT_MESSAGE = 'Your wallet connection expired. Reconnect your wallet and try again.'

const mocks = hoisted(() => ({
  openAppKit: mock(),
  submitClaim: mock(),
  toastError: mock(),
  toastSuccess: mock(),
  openTradeRequirements: mock(),
  promptAutoRedeem: mock(),
  refresh: mock(),
}))

void mock.module('@tanstack/react-query', () => ({
  useQueryClient: () => ({ getQueriesData: () => [] }),
}))

void mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

void mock.module('wagmi', () => ({
  useSignTypedData: () => ({ signTypedDataAsync: mock() }),
}))

void mock.module('@/app/[locale]/(platform)/_providers/TradingOnboardingProvider', () => ({
  useTradingOnboarding: () => ({
    ensureTradingReady: () => true,
    openTradeRequirements: mocks.openTradeRequirements,
    promptAutoRedeem: mocks.promptAutoRedeem,
  }),
}))

void mock.module('@/components/ui/toast', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess, info: mock() },
}))

void mock.module('@/components/EventIconImage', () => ({ default: () => null }))
void mock.module('@/components/SiteLogoIcon', () => ({ default: () => null }))

void mock.module('@/hooks/useAppKit', () => ({
  useAppKit: () => ({ open: mocks.openAppKit }),
}))

void mock.module('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }))

void mock.module('@/hooks/useSignaturePromptRunner', () => ({
  useSignaturePromptRunner: () => ({
    runWithSignaturePrompt: (operation: () => unknown) => operation(),
  }),
}))

void mock.module('@/hooks/useSiteIdentity', () => ({
  useSiteIdentity: () => ({ name: 'Kuest' }),
}))

void mock.module('@/i18n/navigation', () => ({ Link: () => null }))

void mock.module('@/lib/trading-cache', () => ({ invalidatePortfolioClaimQueries: mock() }))

void mock.module('@/lib/utils', () => ({
  cn: (...classes: string[]) => classes.join(' '),
  triggerConfetti: mock(),
}))

void mock.module('@/lib/wallet/client', () => ({
  DepositWalletCallItemsSplitFallbackError: class extends Error {},
  signAndSubmitDepositWalletCallItemsWithSplitFallback: mocks.submitClaim,
}))

void mock.module('@/lib/wallet/transactions', () => ({
  buildNegRiskRedeemPositionCall: mock(),
  buildRedeemPositionCall: mock(),
}))

void mock.module('@/stores/useUser', () => ({
  useUser: () => ({
    address: '0x0000000000000000000000000000000000000001',
    deposit_wallet_address: '0x0000000000000000000000000000000000000002',
  }),
}))

const { default: PortfolioMarketsWonCardClient } =
  await import('@/app/[locale]/(platform)/portfolio/_components/PortfolioMarketsWonCardClient')

const markets = [
  {
    conditionId: '0x01',
    title: 'First winning market',
    shares: 10,
    invested: 5,
    proceeds: 10,
    returnPercent: 100,
    indexSets: [1],
  },
  {
    conditionId: '0x02',
    title: 'Second winning market',
    shares: 10,
    invested: 5,
    proceeds: 10,
    returnPercent: 100,
    indexSets: [1],
  },
]

async function submitClaim() {
  render(
    <PortfolioMarketsWonCardClient
      data={{
        summary: { marketsWon: 2, totalProceeds: 20, totalInvested: 10, totalReturnPercent: 100 },
        markets,
      }}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Claim', exact: true }))
  await userEvent.click(screen.getByRole('button', { name: /^Claim \$/ }))
}

describe('portfolio claims', () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) {
      fn.mockReset()
    }
    mocks.openAppKit.mockResolvedValue(undefined)
  })

  it('closes the claim dialog and opens Reown when the wallet connection expired', async () => {
    mocks.submitClaim.mockResolvedValue({
      error: WALLET_RECONNECT_MESSAGE,
      code: 'wallet_connector_not_connected',
      successfulItems: [],
      failedItems: markets,
      partialFailure: false,
    })

    await submitClaim()

    await waitFor(() => {
      expect(mocks.openAppKit).toHaveBeenCalledWith({ view: 'Connect' })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(mocks.toastError).toHaveBeenCalledWith(WALLET_RECONNECT_MESSAGE)
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(mocks.openTradeRequirements).not.toHaveBeenCalled()
    expect(mocks.promptAutoRedeem).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Claim', exact: true })).toBeEnabled()
  })

  it('preserves submitted claims and opens Reown when the remaining claims need reconnection', async () => {
    mocks.submitClaim.mockResolvedValue({
      error: null,
      successfulItems: [markets[0]],
      failedItems: [markets[1]],
      partialFailure: true,
      failure: { error: WALLET_RECONNECT_MESSAGE, code: 'wallet_connector_not_connected' },
    })

    await submitClaim()

    await waitFor(() => {
      expect(mocks.openAppKit).toHaveBeenCalledWith({ view: 'Connect' })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Claim submitted', expect.any(Object))
    expect(mocks.toastError).toHaveBeenCalledWith(WALLET_RECONNECT_MESSAGE)
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(mocks.promptAutoRedeem).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Claim', exact: true }))
    expect(screen.queryByText('First winning market')).not.toBeInTheDocument()
    expect(screen.getByText('Second winning market')).toBeInTheDocument()
  })

  it('keeps ordinary claim errors in the claim dialog without opening Reown', async () => {
    mocks.submitClaim.mockResolvedValue({ error: 'Claim unavailable.' })

    await submitClaim()

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Claim unavailable.')
    })
    expect(mocks.openAppKit).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Claim \$/ })).toBeEnabled()
  })
})
