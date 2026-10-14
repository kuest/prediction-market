import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { createElement } from 'react'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  quote: mock(),
  direct: mock(),
  lifi: mock(),
  refetch: mock(),
  pending: null as { hash: string; chainId: number } | null,
}))

void mock.module('@/hooks/useLiFiQuote', () => ({ useLiFiQuote: (params: unknown) => mocks.quote(params) }))
void mock.module('@/hooks/useDirectUsdcDepositExecution', () => ({
  useDirectUsdcDepositExecution: () => ({
    execute: mocks.direct,
    isExecuting: false,
    pendingTransaction: mocks.pending,
  }),
}))
void mock.module('@/hooks/useLiFiExecution', () => ({
  useLiFiExecution: () => ({ execute: mocks.lifi, isExecuting: false }),
}))
void mock.module('next/image', () => ({ default: (props: any) => createElement('img', props) }))

const { default: WalletConfirmStep } =
  await import('@/app/[locale]/(platform)/_components/wallet-modal/WalletConfirmStep')

const props = {
  walletEoaAddress: '0x0000000000000000000000000000000000000001',
  walletAddress: '0x0000000000000000000000000000000000000002',
  siteLabel: 'Kuest',
  amountValue: '804.78',
  refreshIndex: 0,
  onComplete: mock(),
}

beforeEach(() => {
  mocks.quote.mockReset()
  mocks.direct.mockReset()
  mocks.lifi.mockReset()
  mocks.refetch.mockReset()
  props.onComplete.mockReset()
  mocks.pending = null
  mocks.quote.mockReturnValue({ isLoadingQuote: false, isQuoteError: false, refetchQuote: mocks.refetch })
})

describe('wallet deposit confirmation', () => {
  it('confirms a direct USDC deposit without waiting for LI.FI', async () => {
    mocks.direct.mockResolvedValue('0xhash')
    render(
      <WalletConfirmStep
        {...props}
        executionMode="direct-usdc"
        quote={{ toAmountDisplay: '804.78', gasUsdDisplay: null }}
      />,
    )
    expect(mocks.quote.mock.calls[0][0].enabled).toBe(false)
    const button = screen.getByRole('button', { name: 'Confirm order' })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1))
    expect(mocks.direct).toHaveBeenCalledTimes(1)
    expect(mocks.lifi).not.toHaveBeenCalled()
  })

  it('shows an error and retry when LI.FI cannot prepare a quote', () => {
    mocks.quote.mockReturnValue({ isLoadingQuote: false, isQuoteError: true, refetchQuote: mocks.refetch })
    render(<WalletConfirmStep {...props} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(mocks.refetch).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Preparing your quote...')).not.toBeInTheDocument()
  })

  it('keeps the form usable after a rejected wallet transaction', async () => {
    mocks.direct.mockRejectedValue(new Error('User rejected transaction'))
    render(
      <WalletConfirmStep
        {...props}
        executionMode="direct-usdc"
        quote={{ toAmountDisplay: '804.78', gasUsdDisplay: null }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirm order' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(props.onComplete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirm order' })).toBeEnabled()
  })

  it('checks an existing transaction even if the refreshed quote failed', async () => {
    mocks.pending = { hash: '0xhash', chainId: 137 }
    mocks.direct.mockResolvedValue('0xhash')
    mocks.quote.mockReturnValue({ isLoadingQuote: false, isQuoteError: true, refetchQuote: mocks.refetch })
    render(<WalletConfirmStep {...props} executionMode="direct-usdc" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Transaction sent.')
    fireEvent.click(screen.getByRole('button', { name: 'Check transaction status' }))
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1))
    expect(mocks.refetch).not.toHaveBeenCalled()
  })
})
