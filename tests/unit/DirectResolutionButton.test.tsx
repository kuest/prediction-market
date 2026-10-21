import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render as testingRender, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock, jest } from 'bun:test'

import { ORDER_SIDE } from '@/lib/constants'
import { NEGRISK_DRO_CTF_ADAPTER_V4_ADDRESS } from '@/lib/contracts'

import { hoisted, spyOn, stubGlobal, unstubAllGlobals } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  fetch: mock(),
  readContract: mock(),
  readWhitelist: mock(),
  runWithSignaturePrompt: mock(),
  signAndSubmit: mock(),
  signTypedDataAsync: mock(),
  balanceRaw: 1000,
  balanceLoading: false,
  balanceError: false,
  refetchBalance: mock(),
  clobUrl: '',
  user: {
    id: 'user-1',
    address: '0x1111111111111111111111111111111111111111',
    deposit_wallet_address: '0x5555555555555555555555555555555555555555',
    deposit_wallet_status: 'deployed',
    image: '',
  },
}))

void mock.module('@reown/appkit/react', () => ({
  useAppKitAccount: () => ({ address: '0x1111111111111111111111111111111111111111' }),
}))

void mock.module('next-intl', () => ({
  useExtracted: () => (value: string, values?: Record<string, string>) =>
    Object.entries(values ?? {}).reduce(
      (translated, [key, replacement]) => translated.replaceAll(`{${key}}`, replacement),
      value,
    ),
}))

void mock.module('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

void mock.module('wagmi', () => ({
  usePublicClient: () => ({ readContract: mocks.readContract }),
  useSignTypedData: () => ({ signTypedDataAsync: mocks.signTypedDataAsync }),
  useWalletClient: () => ({ data: {} }),
}))

void mock.module('@/stores/useUser', () => ({
  useUser: () => mocks.user,
}))

void mock.module('@/lib/wallet/client', () => ({
  signAndSubmitDepositWalletCalls: mocks.signAndSubmit,
}))

void mock.module('@/hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}))

void mock.module('@/hooks/usePublicRuntimeConfig', () => ({
  usePublicRuntimeConfig: () => ({ polygonRpcUrl: '', clobUrl: mocks.clobUrl }),
}))

void mock.module('@/hooks/useBalance', () => ({
  useBalance: () => ({
    balance: { raw: mocks.balanceRaw, text: mocks.balanceRaw.toFixed(2), symbol: 'USDC' },
    isLoadingBalance: mocks.balanceLoading,
    isBalanceError: mocks.balanceError,
    refetchBalance: mocks.refetchBalance,
  }),
}))

void mock.module('@/hooks/useSignaturePromptRunner', () => ({
  useSignaturePromptRunner: () => ({ runWithSignaturePrompt: mocks.runWithSignaturePrompt }),
}))

void mock.module('@/lib/proposer-whitelist', () => ({
  readCreatorProposerWhitelistStatus: mocks.readWhitelist,
}))

const { default: DirectResolutionButton } =
  await import('@/app/[locale]/(platform)/event/[slug]/_components/DirectResolutionButton?bun-test')
const { useOrder } = await import('@/stores/useOrder')

function render(ui: Parameters<typeof testingRender>[0], queryClient = new QueryClient()) {
  return testingRender(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

const market = {
  condition_id: 'condition-1',
  question_id: `0x${'c'.repeat(64)}`,
  title: 'Will this happen?',
  question: 'Will this happen?',
  metadata: JSON.stringify({ resolution_type: 'dro_moov2' }),
  neg_risk: false,
  is_resolved: false,
  is_active: true,
  price: 0.55,
  outcomes: [
    { outcome_index: 0, outcome_text: 'Yes', price: 0.55 },
    { outcome_index: 1, outcome_text: 'No', price: 0.45 },
  ],
  condition: {
    oracle: '0x2222222222222222222222222222222222222222',
    resolved: false,
  },
} as never

const event = {
  id: 'event-1',
  slug: 'event-slug',
  title: 'Will this happen?',
  creator: '0x3333333333333333333333333333333333333333',
  icon_url: '',
  rules: 'Resolve according to the official result.',
  markets: [market],
} as never

describe('DirectResolutionButton', () => {
  beforeEach(() => {
    useOrder.getState().reset()
    window.localStorage.clear()
    mocks.fetch.mockReset()
    mocks.readContract.mockReset()
    mocks.readWhitelist.mockReset()
    mocks.runWithSignaturePrompt.mockReset()
    mocks.signAndSubmit.mockReset()
    mocks.signTypedDataAsync.mockReset()
    mocks.balanceRaw = 1000
    mocks.balanceLoading = false
    mocks.balanceError = false
    mocks.refetchBalance.mockReset()
    mocks.clobUrl = ''
    mocks.user.id = 'user-1'
    mocks.user.address = '0x1111111111111111111111111111111111111111'
    mocks.user.deposit_wallet_address = '0x5555555555555555555555555555555555555555'
    mocks.user.deposit_wallet_status = 'deployed'
    mocks.readWhitelist.mockResolvedValue({
      whitelistAddress: '0x4444444444444444444444444444444444444444',
      proposers: [],
    })
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        marketId: `0x${'a'.repeat(64)}`,
        bond: '300000000',
        rewardPool: '4000000',
        lockDuration: '172800',
        withdrawalDelay: '86400',
        rewardEnabled: true,
        outcomeCounts: { yes: 1, no: 0, unknown: 0 },
        reporters: [],
        currentOutcome: 'yes',
        eligibility: 'eligible',
      }),
    })
    mocks.readContract.mockResolvedValue({
      requestTimestamp: 1n,
      resolved: false,
      ancillaryData: '0x1234',
    })
    mocks.runWithSignaturePrompt.mockImplementation(async (callback: () => Promise<unknown>) => callback())
    mocks.signAndSubmit.mockResolvedValue({ error: null, txHash: `0x${'b'.repeat(64)}` })
    stubGlobal('fetch', mocks.fetch)
  })

  afterEach(() => {
    useOrder.getState().reset()
    unstubAllGlobals()
    jest.restoreAllMocks()
  })

  it('matches the order buttons for each outcome and trading side using their shared book cache', async () => {
    mocks.clobUrl = 'https://clob.test'
    const quotedMarket = {
      ...market,
      outcomes: (market as any).outcomes.map((outcome: any, index: number) => ({
        ...outcome,
        token_id: index === 0 ? 'yes-token' : 'no-token',
      })),
    }
    const quotedEvent = { ...event, markets: [quotedMarket] } as never
    const queryClient = new QueryClient()
    const yesBookKey = ['orderbook-summary', mocks.clobUrl, 'yes-token']
    const noBookKey = ['orderbook-summary', mocks.clobUrl, 'no-token']
    queryClient.setQueryData(yesBookKey, {
      'yes-token': {
        bids: [{ price: '0.57', size: '10' }],
        asks: [{ price: '0.61', size: '10' }],
      },
    })
    queryClient.setQueryData(noBookKey, {
      'no-token': {
        bids: [{ price: '0.39', size: '10' }],
        asks: [{ price: '0.43', size: '10' }],
      },
    })

    render(<DirectResolutionButton market={quotedMarket} event={quotedEvent} />, queryClient)
    expect(screen.getByText('61%')).toBeInTheDocument()
    expect(screen.getByText('43%')).toBeInTheDocument()

    act(() => useOrder.getState().setSide(ORDER_SIDE.SELL))
    await waitFor(() => expect(screen.getByText('57%')).toBeInTheDocument())
    expect(screen.getByText('39%')).toBeInTheDocument()
    act(() => useOrder.getState().setSide(ORDER_SIDE.BUY))
    await waitFor(() => expect(screen.getByText('61%')).toBeInTheDocument())

    act(() => {
      queryClient.setQueryData(yesBookKey, {
        'yes-token': { bids: [{ price: '0.78', size: '10' }], asks: [{ price: '0.82', size: '10' }] },
      })
      queryClient.setQueryData(noBookKey, {
        'no-token': { bids: [{ price: '0.16', size: '10' }], asks: [{ price: '0.2', size: '10' }] },
      })
    })
    await waitFor(() => expect(screen.getByText('82%')).toBeInTheDocument())
    expect(screen.getByText('20%')).toBeInTheDocument()

    act(() => {
      queryClient.setQueryData(yesBookKey, { 'yes-token': { bids: [], asks: [] } })
      queryClient.setQueryData(noBookKey, { 'no-token': { bids: [], asks: [] } })
    })
    await waitFor(() => expect(screen.getByText('55%')).toBeInTheDocument())
    expect(screen.getByText('45%')).toBeInTheDocument()
  })

  it('reuses the inline report summary when the review dialog opens', async () => {
    const onResolutionRewardAmountChange = mock()
    const eventWithIcon = { ...(event as any), icon_url: 'https://example.test/event.png' } as never
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        marketId: `0x${'a'.repeat(64)}`,
        bond: '300000000',
        rewardPool: '4000000',
        lockDuration: '172800',
        withdrawalDelay: '86400',
        rewardEnabled: true,
        outcomeCounts: { yes: 0, no: 0, unknown: 0 },
        reporters: [],
        currentOutcome: null,
        eligibility: 'eligible',
      }),
    })

    render(
      <DirectResolutionButton
        market={market}
        event={eventWithIcon}
        onResolutionRewardAmountChange={onResolutionRewardAmountChange}
      />,
    )

    await waitFor(() => expect(onResolutionRewardAmountChange).toHaveBeenCalledWith('$4'))
    await waitFor(() => expect(mocks.readWhitelist).toHaveBeenCalledOnce())
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.readContract).toHaveBeenCalledOnce()

    expect(screen.getByRole('heading', { name: 'Propose resolution' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Yes/ }).closest('section')?.children).toHaveLength(1)
    expect(screen.queryByRole('checkbox', { name: /I have read the market rules/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review proposal' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Yes/ }))
    expect(screen.queryByText('Resolve according to the official result.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('I have read the market rules and will resolve according to them.'))
    fireEvent.click(screen.getByRole('button', { name: 'Review proposal' }))
    const reviewDialog = await screen.findByRole('dialog', { name: 'Review proposal' })

    expect(within(reviewDialog).getByRole('img', { name: 'Will this happen?' })).toBeInTheDocument()
    expect(within(reviewDialog).getByText('Will this happen?')).toHaveClass('text-base')

    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.readContract).toHaveBeenCalledOnce()
  })

  it('loads the reward badge for NegRisk direct-resolution markets', async () => {
    const onResolutionRewardAmountChange = mock()
    const negRiskRequestId = `0x${'d'.repeat(64)}`
    const negRiskMarket = {
      ...(market as any),
      neg_risk: true,
      neg_risk_request_id: negRiskRequestId,
    } as never

    render(
      <DirectResolutionButton
        market={negRiskMarket}
        event={{ ...(event as any), markets: [negRiskMarket] }}
        onResolutionRewardAmountChange={onResolutionRewardAmountChange}
      />,
    )

    await waitFor(() => expect(onResolutionRewardAmountChange).toHaveBeenCalledWith('$4'))
    expect(mocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: NEGRISK_DRO_CTF_ADAPTER_V4_ADDRESS,
        args: [negRiskRequestId],
      }),
    )
  })

  it('identifies the selected NegRisk market in the review dialog', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        marketId: `0x${'a'.repeat(64)}`,
        bond: '300000000',
        rewardPool: '4000000',
        lockDuration: '172800',
        withdrawalDelay: '86400',
        rewardEnabled: true,
        outcomeCounts: { yes: 0, no: 0, unknown: 0 },
        reporters: [],
        currentOutcome: null,
        eligibility: 'eligible',
      }),
    })
    const zemaMarket = {
      ...(market as any),
      condition_id: 'condition-zema',
      question_id: `0x${'d'.repeat(64)}`,
      title: 'Romeu Zema',
      short_title: 'Romeu Zema',
      question: 'Will Trump endorse Romeu Zema for President of Brazil?',
      neg_risk: false,
      neg_risk_request_id: `0x${'e'.repeat(64)}`,
    } as never
    const negRiskEvent = {
      ...(event as any),
      title: 'Who will Trump endorse for President of Brazil?',
      neg_risk_market_id: `0x${'f'.repeat(64)}`,
      markets: [zemaMarket],
    } as never

    render(<DirectResolutionButton market={zemaMarket} event={negRiskEvent} />)

    fireEvent.click(await screen.findByRole('button', { name: /Yes/ }))
    fireEvent.click(screen.getByText('I have read the market rules and will resolve according to them.'))
    fireEvent.click(screen.getByRole('button', { name: 'Review proposal' }))

    const reviewDialog = await screen.findByRole('dialog', { name: 'Review proposal' })
    expect(within(reviewDialog).getByText('Who will Trump endorse for President of Brazil?')).toBeInTheDocument()
    expect(within(reviewDialog).getByText('Market')).toBeInTheDocument()
    expect(within(reviewDialog).getByText('Romeu Zema')).toBeInTheDocument()
  })

  it('blocks a proposal in review when the Deposit Wallet cannot cover the bond', async () => {
    mocks.balanceRaw = 299.99
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        marketId: `0x${'a'.repeat(64)}`,
        bond: '300000000',
        rewardPool: '4000000',
        lockDuration: '172800',
        withdrawalDelay: '86400',
        rewardEnabled: true,
        outcomeCounts: { yes: 0, no: 0, unknown: 0 },
        reporters: [],
        currentOutcome: null,
        eligibility: 'eligible',
      }),
    })

    render(<DirectResolutionButton market={market} event={event} />)

    fireEvent.click(await screen.findByRole('button', { name: /Yes/ }))
    fireEvent.click(screen.getByText('I have read the market rules and will resolve according to them.'))
    fireEvent.click(screen.getByRole('button', { name: 'Review proposal' }))

    const reviewDialog = await screen.findByRole('dialog', { name: 'Review proposal' })
    expect(within(reviewDialog).getByText('Insufficient USDC balance')).toBeInTheDocument()
    expect(within(reviewDialog).getByRole('button', { name: 'Lock $300 and propose Yes' })).toBeDisabled()
    expect(mocks.signAndSubmit).not.toHaveBeenCalled()
  })

  it('blocks submission and allows retry when the balance read fails', async () => {
    mocks.balanceRaw = 0
    mocks.balanceError = true
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        marketId: `0x${'a'.repeat(64)}`,
        bond: '300000000',
        rewardPool: '4000000',
        lockDuration: '172800',
        withdrawalDelay: '86400',
        rewardEnabled: true,
        outcomeCounts: { yes: 0, no: 0, unknown: 0 },
        reporters: [],
        currentOutcome: null,
        eligibility: 'eligible',
      }),
    })

    render(<DirectResolutionButton market={market} event={event} />)

    fireEvent.click(await screen.findByRole('button', { name: /Yes/ }))
    fireEvent.click(screen.getByText('I have read the market rules and will resolve according to them.'))
    fireEvent.click(screen.getByRole('button', { name: 'Review proposal' }))

    const reviewDialog = await screen.findByRole('dialog', { name: 'Review proposal' })
    expect(within(reviewDialog).getByText('Could not validate USDC balance right now.')).toBeInTheDocument()
    expect(within(reviewDialog).queryByText('Insufficient USDC balance')).not.toBeInTheDocument()
    expect(within(reviewDialog).getByRole('button', { name: 'Lock $300 and propose Yes' })).toBeDisabled()

    fireEvent.click(within(reviewDialog).getByRole('button', { name: 'Retry' }))
    expect(mocks.refetchBalance).toHaveBeenCalledOnce()
    expect(mocks.signAndSubmit).not.toHaveBeenCalled()
  })

  it('shows resolved outcome names without percentages, keeps them non-interactive, and grays out the loser', async () => {
    const onResolutionRewardAmountChange = mock()
    const resolvedMarket = {
      ...(market as any),
      is_active: false,
      is_resolved: true,
      condition: { ...(market as any).condition, resolved: true },
      outcomes: [
        { outcome_index: 0, outcome_text: 'Yes', price: 0.55, is_winning_outcome: true },
        { outcome_index: 1, outcome_text: 'No', price: 0.45, is_winning_outcome: false },
      ],
    } as never
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        marketId: `0x${'a'.repeat(64)}`,
        bond: '300000000',
        rewardPool: '10000000',
        lockDuration: '172800',
        withdrawalDelay: '86400',
        rewardEnabled: false,
        outcomeCounts: { yes: 1, no: 1, unknown: 0 },
        reporters: [
          {
            seed: 'winner',
            username: 'winner',
            image: 'https://example.test/winner.png',
            outcome: 'yes',
            rewardAmount: '4000000',
            historyCorrectCount: 4,
            historyIncorrectCount: 1,
          },
          {
            seed: 'loser',
            username: 'loser',
            image: 'https://example.test/loser.png',
            outcome: 'no',
            rewardAmount: '0',
            historyCorrectCount: 2,
            historyIncorrectCount: 3,
          },
        ],
        currentOutcome: 'no',
        eligibility: 'ineligible',
      }),
    })

    render(
      <DirectResolutionButton
        market={resolvedMarket}
        event={{ ...(event as any), markets: [resolvedMarket] }}
        onResolutionRewardAmountChange={onResolutionRewardAmountChange}
      />,
    )

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce())
    expect(onResolutionRewardAmountChange).toHaveBeenLastCalledWith(null)
    expect(onResolutionRewardAmountChange).not.toHaveBeenCalledWith('$4')
    expect(screen.getByLabelText('Yes')).toBeInTheDocument()
    expect(screen.getByLabelText('No')).toBeInTheDocument()
    expect(screen.getByLabelText('Yes')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByLabelText('Yes')).not.toHaveClass('text-white')
    expect(screen.getByLabelText('No')).not.toHaveAttribute('aria-current')
    expect(screen.queryByText('100%')).not.toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Yes/ })).not.toBeInTheDocument()
    const winnerProfile = screen.getByRole('link', { name: 'winner' })
    expect(winnerProfile.querySelector('img')).not.toHaveClass('grayscale')
    expect(within(winnerProfile).getByLabelText('Resolution reward: $4')).toBeInTheDocument()
    expect(within(winnerProfile).queryByLabelText('Resolution reward: $10')).not.toBeInTheDocument()
    const winnerHistory = "winner's proposal history: 4 correct and 1 incorrect."
    fireEvent.focus(winnerProfile)
    expect(await screen.findByRole('tooltip', { name: winnerHistory })).toBeVisible()
    expect(screen.getByRole('link', { name: 'loser' }).querySelector('img')).toHaveClass('grayscale')
    expect(screen.getByRole('heading', { name: 'Final resolution' })).toBeInTheDocument()
    expect(screen.queryByText('This market is already resolved.')).not.toBeInTheDocument()
  })

  it('shows an unawarded reward below the winning outcome when nobody proposed', async () => {
    const resolvedMarket = {
      ...(market as any),
      is_active: false,
      is_resolved: true,
      condition: { ...(market as any).condition, resolved: true, payout_numerators: [1, 0] },
      outcomes: [
        { outcome_index: 0, outcome_text: 'Yes', price: 0.55, is_winning_outcome: false },
        { outcome_index: 1, outcome_text: 'No', price: 0.45, is_winning_outcome: false },
      ],
    } as never
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        marketId: `0x${'a'.repeat(64)}`,
        bond: '300000000',
        rewardPool: '4000000',
        lockDuration: '172800',
        withdrawalDelay: '86400',
        rewardEnabled: false,
        outcomeCounts: { yes: 0, no: 0, unknown: 0 },
        reporters: [],
        currentOutcome: null,
        eligibility: 'ineligible',
      }),
    })

    render(<DirectResolutionButton market={resolvedMarket} event={{ ...(event as any), markets: [resolvedMarket] }} />)

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce())
    expect(screen.getByText('$4 not awarded')).toBeInTheDocument()
    expect(screen.getByLabelText('Yes')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByLabelText('No')).not.toHaveAttribute('aria-current')
    expect(screen.queryByText('×')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /winner|loser/ })).not.toBeInTheDocument()
  })

  it('shows an explicit final inconclusive result only from 50/50 resolution data', async () => {
    const resolvedMarket = {
      ...(market as any),
      is_active: false,
      is_resolved: true,
      condition: { ...(market as any).condition, resolved: true, payout_numerators: [1, 1] },
      outcomes: [
        { outcome_index: 0, outcome_text: 'Yes', price: 0.5, is_winning_outcome: false },
        { outcome_index: 1, outcome_text: 'No', price: 0.5, is_winning_outcome: false },
      ],
    } as never
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        marketId: `0x${'a'.repeat(64)}`,
        bond: '300000000',
        rewardPool: '4000000',
        lockDuration: '172800',
        withdrawalDelay: '86400',
        rewardEnabled: false,
        outcomeCounts: { yes: 0, no: 0, unknown: 0 },
        reporters: [],
        currentOutcome: null,
        eligibility: 'ineligible',
      }),
    })

    render(<DirectResolutionButton market={resolvedMarket} event={{ ...(event as any), markets: [resolvedMarket] }} />)

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce())
    expect(screen.getByRole('status')).toHaveTextContent('Inconclusive result')
    expect(screen.getByLabelText('Yes')).not.toHaveAttribute('aria-current')
    expect(screen.getByLabelText('No')).not.toHaveAttribute('aria-current')
    expect(screen.getByText('$4 not awarded')).toBeInTheDocument()
  })

  it('does not infer an inconclusive result from missing winner metadata', async () => {
    const resolvedMarket = {
      ...(market as any),
      is_active: false,
      is_resolved: true,
      condition: { ...(market as any).condition, resolved: true },
      outcomes: [
        { outcome_index: 0, outcome_text: 'Yes', price: 0.5, is_winning_outcome: false },
        { outcome_index: 1, outcome_text: 'No', price: 0.5, is_winning_outcome: false },
      ],
    } as never

    render(<DirectResolutionButton market={resolvedMarket} event={{ ...(event as any), markets: [resolvedMarket] }} />)

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText('Inconclusive result')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Yes')).not.toHaveAttribute('aria-current')
    expect(screen.getByLabelText('No')).not.toHaveAttribute('aria-current')
  })

  it('hides the reward badge when the on-chain rewards market is inactive', async () => {
    const onResolutionRewardAmountChange = mock()
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        marketId: `0x${'a'.repeat(64)}`,
        bond: '300000000',
        rewardPool: '4000000',
        lockDuration: '172800',
        withdrawalDelay: '86400',
        rewardEnabled: false,
        outcomeCounts: { yes: 0, no: 0, unknown: 0 },
        reporters: [],
        currentOutcome: null,
        eligibility: 'ineligible',
      }),
    })

    render(
      <DirectResolutionButton
        market={market}
        event={event}
        onResolutionRewardAmountChange={onResolutionRewardAmountChange}
      />,
    )

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce())
    expect(onResolutionRewardAmountChange).toHaveBeenCalledWith(null)
    expect(onResolutionRewardAmountChange).not.toHaveBeenCalledWith('$4')
  })

  it('ignores an obsolete report summary after the market changes', async () => {
    let resolveFirstResponse!: (response: Response) => void
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirstResponse = resolve
    })
    mocks.fetch
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          marketId: `0x${'b'.repeat(64)}`,
          bond: '300000000',
          rewardPool: '8000000',
          lockDuration: '172800',
          withdrawalDelay: '86400',
          rewardEnabled: true,
          outcomeCounts: { yes: 0, no: 0, unknown: 0 },
          reporters: [],
          currentOutcome: null,
          eligibility: 'eligible',
        }),
      })
    const onResolutionRewardAmountChange = mock()
    const { rerender } = render(
      <DirectResolutionButton
        market={market}
        event={event}
        onResolutionRewardAmountChange={onResolutionRewardAmountChange}
      />,
    )

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce())

    const nextMarket = {
      ...(market as any),
      condition_id: 'condition-2',
      question_id: `0x${'d'.repeat(64)}`,
    } as never
    const nextEvent = { ...(event as any), id: 'event-2', slug: 'event-2', markets: [nextMarket] } as never
    rerender(
      <DirectResolutionButton
        market={nextMarket}
        event={nextEvent}
        onResolutionRewardAmountChange={onResolutionRewardAmountChange}
      />,
    )

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(onResolutionRewardAmountChange).toHaveBeenCalledWith('$8'))

    await act(async () => {
      resolveFirstResponse({
        ok: true,
        json: async () => ({
          marketId: `0x${'a'.repeat(64)}`,
          bond: '300000000',
          rewardPool: '4000000',
          lockDuration: '172800',
          withdrawalDelay: '86400',
          rewardEnabled: true,
          outcomeCounts: { yes: 1, no: 0, unknown: 0 },
          reporters: [],
          currentOutcome: 'yes',
          eligibility: 'eligible',
        }),
      } as Response)
      await Promise.resolve()
    })
    expect(onResolutionRewardAmountChange).not.toHaveBeenCalledWith('$4')
  })

  it('invalidates the report summary when the authenticated identity changes', async () => {
    const onResolutionRewardAmountChange = mock()
    const { rerender } = render(
      <DirectResolutionButton
        market={market}
        event={event}
        onResolutionRewardAmountChange={onResolutionRewardAmountChange}
      />,
    )

    await waitFor(() => expect(onResolutionRewardAmountChange).toHaveBeenCalledWith('$4'))
    expect(mocks.fetch).toHaveBeenCalledOnce()

    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        marketId: `0x${'a'.repeat(64)}`,
        bond: '300000000',
        rewardPool: '8000000',
        lockDuration: '172800',
        withdrawalDelay: '86400',
        rewardEnabled: true,
        outcomeCounts: { yes: 0, no: 1, unknown: 0 },
        reporters: [],
        currentOutcome: 'no',
        eligibility: 'eligible',
      }),
    })
    mocks.user.id = 'user-2'
    mocks.user.address = '0x6666666666666666666666666666666666666666'
    mocks.user.deposit_wallet_address = '0x7777777777777777777777777777777777777777'

    rerender(
      <DirectResolutionButton
        market={market}
        event={event}
        onResolutionRewardAmountChange={onResolutionRewardAmountChange}
      />,
    )

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(onResolutionRewardAmountChange).toHaveBeenCalledWith('$8'))

    const selectedOutcome = await screen.findByRole('button', { name: /No/ })
    expect(selectedOutcome).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps an existing proposal selected and removes submission controls', async () => {
    render(<DirectResolutionButton market={market} event={event} />)

    expect(screen.queryByText('Inconclusive result')).not.toBeInTheDocument()
    const selectedOutcome = await screen.findByRole('button', { name: /Yes/ })
    await waitFor(() => expect(selectedOutcome).toBeDisabled())

    expect(selectedOutcome).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'Review proposal' })).not.toBeInTheDocument()
    expect(screen.queryByText('Resolve according to the official result.')).not.toBeInTheDocument()
  })

  it('shows the inconclusive option only after final-resolution access is confirmed', async () => {
    let resolveWhitelist!: (value: { whitelistAddress: string; proposers: string[] }) => void
    mocks.readWhitelist.mockReturnValue(
      new Promise((resolve) => {
        resolveWhitelist = resolve
      }),
    )

    render(<DirectResolutionButton market={market} event={event} />)
    expect(screen.queryByText('Inconclusive result')).not.toBeInTheDocument()

    await act(async () => {
      resolveWhitelist({
        whitelistAddress: '0x4444444444444444444444444444444444444444',
        proposers: ['0x1111111111111111111111111111111111111111'],
      })
    })

    expect((await screen.findAllByText('Inconclusive result')).length).toBeGreaterThan(0)
  })

  it('shows reporter accuracy to an approved resolver', async () => {
    mocks.readWhitelist.mockResolvedValue({
      whitelistAddress: '0x4444444444444444444444444444444444444444',
      proposers: ['0x1111111111111111111111111111111111111111'],
    })
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        marketId: `0x${'a'.repeat(64)}`,
        bond: '300000000',
        rewardPool: '4000000',
        lockDuration: '172800',
        withdrawalDelay: '86400',
        rewardEnabled: true,
        outcomeCounts: { yes: 1, no: 0, unknown: 0 },
        reporters: [
          {
            seed: '0x5555555555555555555555555555555555555555',
            image: '',
            outcome: 'yes',
            historyCorrectCount: 4,
            historyIncorrectCount: 1,
          },
        ],
        currentOutcome: null,
        eligibility: 'eligible',
      }),
    })

    render(<DirectResolutionButton market={market} event={event} />)
    expect(await screen.findByLabelText('4 Correct')).toBeInTheDocument()
    expect(screen.getByLabelText('1 Incorrect')).toBeInTheDocument()
    expect(document.querySelector('span.block.size-12.rounded-full.border-dashed')).toBeInTheDocument()
  })

  it('reuses the approved resolver permission when opening the final-result review', async () => {
    mocks.readWhitelist.mockResolvedValue({
      whitelistAddress: '0x4444444444444444444444444444444444444444',
      proposers: ['0x1111111111111111111111111111111111111111'],
    })

    render(<DirectResolutionButton market={market} event={event} />)

    fireEvent.click(await screen.findByRole('button', { name: /Yes/ }))
    fireEvent.click(screen.getByText('I have read the market rules and will resolve according to them.'))
    fireEvent.click(screen.getByRole('button', { name: 'Review proposal' }))

    const reviewDialog = await screen.findByRole('dialog', { name: 'Review proposal' })
    expect(within(reviewDialog).getByRole('button', { name: 'Submit final result' })).toBeInTheDocument()
    expect(mocks.readWhitelist).toHaveBeenCalledOnce()
  })

  it('locks the proposal CTA immediately after a successful submission', async () => {
    let summaryRequests = 0
    const pendingSummary = new Promise<Response>(() => undefined)
    mocks.fetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: 'report-1', outcome: 'yes', updatedAt: new Date().toISOString() }),
        })
      }

      summaryRequests += 1
      if (summaryRequests === 1) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            marketId: `0x${'a'.repeat(64)}`,
            bond: '300000000',
            rewardPool: '4000000',
            lockDuration: '172800',
            withdrawalDelay: '86400',
            rewardEnabled: true,
            outcomeCounts: { yes: 0, no: 0, unknown: 0 },
            reporters: [],
            currentOutcome: null,
            currentReporterHistory: { correctCount: 7, incorrectCount: 2 },
            eligibility: 'eligible',
          }),
        })
      }
      return pendingSummary
    })

    const { unmount } = render(<DirectResolutionButton market={market} event={event} />)
    expect(await screen.findByText('Bond at risk: $300')).toBeInTheDocument()
    expect(screen.getByText('Reward: $4')).toBeInTheDocument()
    expect(
      screen.getByText('Propose the outcome once it can be verified. Earn the reward if confirmed.'),
    ).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /Yes/ }))
    fireEvent.click(screen.getByText('I have read the market rules and will resolve according to them.'))
    const reviewButton = screen.getByRole('button', { name: 'Review proposal' })
    await waitFor(() => expect(reviewButton).toBeEnabled())
    fireEvent.click(reviewButton)

    const confirmationDialog = await screen.findByRole('dialog', { name: 'Review proposal' })
    expect(within(confirmationDialog).getByText('Your proposal')).toBeInTheDocument()
    expect(within(confirmationDialog).getByText('Yes 55%')).toBeInTheDocument()
    expect(within(confirmationDialog).getByText('$304 returned')).toBeInTheDocument()
    expect(within(confirmationDialog).queryByText(/Withdrawal opens/)).not.toBeInTheDocument()
    fireEvent.click(within(confirmationDialog).getByRole('button', { name: 'Lock $300 and propose Yes' }))

    await waitFor(() => expect(mocks.signAndSubmit).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Review proposal' })).not.toBeInTheDocument())
    expect(screen.getByLabelText('7 Correct')).toBeInTheDocument()
    expect(screen.getByLabelText('2 Incorrect')).toBeInTheDocument()

    unmount()
    render(<DirectResolutionButton market={market} event={event} />)

    expect(await screen.findByRole('button', { name: /Yes/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('7 Correct')).toBeInTheDocument()
    expect(screen.getByLabelText('2 Incorrect')).toBeInTheDocument()
  })

  it('does not repeat the rules inline and prompts for acceptance before review', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        marketId: `0x${'a'.repeat(64)}`,
        bond: '300000000',
        rewardPool: '4000000',
        lockDuration: '172800',
        withdrawalDelay: '86400',
        rewardEnabled: true,
        outcomeCounts: { yes: 0, no: 0, unknown: 0 },
        reporters: [],
        currentOutcome: null,
        eligibility: 'eligible',
      }),
    })

    render(<DirectResolutionButton market={market} event={event} />)
    fireEvent.click(await screen.findByRole('button', { name: /Yes/ }))

    const reviewButton = screen.getByRole('button', { name: 'Review proposal' })
    await waitFor(() => expect(reviewButton).toBeEnabled())
    expect(screen.queryByText('Accept the market rules to continue.')).not.toBeInTheDocument()

    fireEvent.click(reviewButton)

    expect(screen.queryByText('Resolve according to the official result.')).not.toBeInTheDocument()
    expect(screen.getByText('Accept the market rules to continue.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Review proposal' })).toBeNull()
  })

  it('requires confirming the existing resolution source link before review', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        marketId: `0x${'a'.repeat(64)}`,
        bond: '300000000',
        rewardPool: '4000000',
        lockDuration: '172800',
        withdrawalDelay: '86400',
        rewardEnabled: true,
        outcomeCounts: { yes: 0, no: 0, unknown: 0 },
        reporters: [],
        currentOutcome: null,
        eligibility: 'eligible',
      }),
    })
    const marketWithSource = {
      ...(market as any),
      resolution_source: 'Official source',
      resolution_source_url: 'https://example.test/result',
    } as never

    render(
      <DirectResolutionButton market={marketWithSource} event={{ ...(event as any), markets: [marketWithSource] }} />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /Yes/ }))
    fireEvent.click(screen.getByText('I have read the market rules and will resolve according to them.'))
    fireEvent.click(screen.getByRole('button', { name: 'Review proposal' }))

    expect(screen.queryByRole('dialog', { name: 'Review proposal' })).not.toBeInTheDocument()
    const sourceCheckbox = screen.getByRole('checkbox', { name: /I checked the final result at/ })
    expect(screen.getByRole('link', { name: /https:\/\/example\.test\/result/ })).toHaveAttribute(
      'href',
      'https://example.test/result',
    )
    fireEvent.click(sourceCheckbox.parentElement!)
    fireEvent.click(screen.getByRole('button', { name: 'Review proposal' }))

    expect(await screen.findByRole('dialog', { name: 'Review proposal' })).toBeInTheDocument()
  })

  it('uses the resolution provider name as the source link label', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        marketId: `0x${'a'.repeat(64)}`,
        bond: '300000000',
        rewardPool: '4000000',
        lockDuration: '172800',
        withdrawalDelay: '86400',
        rewardEnabled: true,
        outcomeCounts: { yes: 0, no: 0, unknown: 0 },
        reporters: [],
        currentOutcome: null,
        eligibility: 'eligible',
      }),
    })
    const marketWithSource = {
      ...(market as any),
      resolution_source: 'Official source',
      resolution_source_url: 'https://data.chain.link/streams/eth-usd-twap-60s-streams',
    } as never

    render(
      <DirectResolutionButton
        market={marketWithSource}
        event={{ ...(event as any), markets: [marketWithSource] }}
        resolutionSourceLabel="Chainlink"
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /Yes/ }))

    const sourceLink = screen.getByRole('link', { name: /Chainlink/ })
    expect(sourceLink).toHaveTextContent('Chainlink')
    expect(sourceLink).not.toHaveTextContent('data.chain.link')
    expect(sourceLink).toHaveAttribute('href', 'https://data.chain.link/streams/eth-usd-twap-60s-streams')
  })

  it('requires confirming a text-only resolution source before review', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        marketId: `0x${'a'.repeat(64)}`,
        bond: '300000000',
        rewardPool: '4000000',
        lockDuration: '172800',
        withdrawalDelay: '86400',
        rewardEnabled: true,
        outcomeCounts: { yes: 0, no: 0, unknown: 0 },
        reporters: [],
        currentOutcome: null,
        eligibility: 'eligible',
      }),
    })
    const marketWithTextSource = {
      ...(market as any),
      resolution_source: 'Official agency final report',
      resolution_source_url: null,
    } as never

    render(
      <DirectResolutionButton
        market={marketWithTextSource}
        event={{ ...(event as any), markets: [marketWithTextSource] }}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /Yes/ }))
    fireEvent.click(screen.getByText('I have read the market rules and will resolve according to them.'))
    fireEvent.click(screen.getByRole('button', { name: 'Review proposal' }))

    expect(screen.queryByRole('dialog', { name: 'Review proposal' })).not.toBeInTheDocument()
    const sourceCheckbox = screen.getByRole('checkbox', { name: /Official agency final report/ })
    fireEvent.click(sourceCheckbox.parentElement!)
    fireEvent.click(screen.getByRole('button', { name: 'Review proposal' }))

    expect(await screen.findByRole('dialog', { name: 'Review proposal' })).toBeInTheDocument()
  })

  it.each(['signed', 'deploying'])(
    'keeps proposal submission disabled while the Deposit Wallet is %s',
    async (status) => {
      mocks.user.deposit_wallet_status = status
      mocks.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          marketId: `0x${'a'.repeat(64)}`,
          bond: '300000000',
          rewardPool: '4000000',
          lockDuration: '172800',
          withdrawalDelay: '86400',
          rewardEnabled: true,
          outcomeCounts: { yes: 0, no: 0, unknown: 0 },
          reporters: [],
          currentOutcome: null,
          eligibility: 'eligible',
        }),
      })

      render(<DirectResolutionButton market={market} event={event} />)
      fireEvent.click(await screen.findByRole('button', { name: /Yes/ }))
      fireEvent.click(screen.getByText('I have read the market rules and will resolve according to them.'))

      expect(screen.getByRole('button', { name: 'Review proposal' })).toBeDisabled()
      expect(screen.queryByRole('dialog', { name: 'Review proposal' })).not.toBeInTheDocument()
    },
  )

  it('does not expose Viem details when the wallet rejects the proposal', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        marketId: `0x${'a'.repeat(64)}`,
        bond: '300000000',
        rewardPool: '4000000',
        lockDuration: '172800',
        withdrawalDelay: '86400',
        rewardEnabled: true,
        outcomeCounts: { yes: 0, no: 0, unknown: 0 },
        reporters: [],
        currentOutcome: null,
        eligibility: 'eligible',
      }),
    })
    mocks.signAndSubmit.mockRejectedValue(
      new Error('User rejected the request. Details: User rejected the request. Version: viem@2.55.10'),
    )

    render(<DirectResolutionButton market={market} event={event} />)
    fireEvent.click(await screen.findByRole('button', { name: /Yes/ }))
    fireEvent.click(screen.getByText('I have read the market rules and will resolve according to them.'))
    fireEvent.click(screen.getByRole('button', { name: 'Review proposal' }))

    const confirmationDialog = await screen.findByRole('dialog', { name: 'Review proposal' })
    fireEvent.click(within(confirmationDialog).getByRole('button', { name: 'Lock $300 and propose Yes' }))

    await waitFor(() => expect(screen.getAllByText('Wallet signature was rejected.').length).toBeGreaterThan(0))
    expect(screen.queryByText(/viem@2\.55\.10/)).not.toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('explains when the rewards contract no longer accepts proposals', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => undefined)
    const onResolutionRewardAmountChange = mock()
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        marketId: `0x${'a'.repeat(64)}`,
        bond: '300000000',
        rewardPool: '4000000',
        lockDuration: '172800',
        withdrawalDelay: '86400',
        rewardEnabled: true,
        outcomeCounts: { yes: 0, no: 0, unknown: 0 },
        reporters: [],
        currentOutcome: null,
        eligibility: 'eligible',
      }),
    })
    mocks.signAndSubmit.mockResolvedValue({
      error:
        'wallet execution error: Contract call reverted with data: 0xb09725d200000000000000000000000000000000000000000000000000000000000000010000000000000000000000001eedf578442f4c52429bb2b6449ff0872ae73be100000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000004b521771a00000000000000000000000000000000000000000000000000000000',
    })

    render(
      <DirectResolutionButton
        market={market}
        event={event}
        onResolutionRewardAmountChange={onResolutionRewardAmountChange}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: /Yes/ }))
    fireEvent.click(screen.getByText('I have read the market rules and will resolve according to them.'))
    fireEvent.click(screen.getByRole('button', { name: 'Review proposal' }))

    const confirmationDialog = await screen.findByRole('dialog', { name: 'Review proposal' })
    fireEvent.click(within(confirmationDialog).getByRole('button', { name: 'Lock $300 and propose Yes' }))

    expect(await screen.findAllByText('Resolution rewards are not available for this market.')).not.toHaveLength(0)
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Review proposal' })?.isConnected ?? false).toBe(false),
    )
    expect(onResolutionRewardAmountChange).toHaveBeenLastCalledWith(null)
    expect(screen.queryByText(/b521771a/)).toBeNull()
    consoleError.mockRestore()
  })
})
