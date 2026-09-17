import type { ComponentProps } from 'react'

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, mock } from 'bun:test'
import { createElement } from 'react'

import WalletTokenList from '@/app/[locale]/(platform)/_components/wallet-modal/WalletTokenList'

void mock.module('next-intl', () => ({
  useExtracted: () => (message: string) => message,
}))

void mock.module('next/image', () => ({
  default: function MockImage(props: any) {
    return createElement('img', props)
  },
}))

const cachedItems = [
  {
    id: '137:usdc',
    symbol: 'USDC',
    network: 'Polygon',
    icon: '/images/usdc.png',
    balance: '10.00',
    usd: '10.00',
    hasUsdValue: true,
    disabled: false,
  },
]

function renderWalletTokenList(overrides: Partial<ComponentProps<typeof WalletTokenList>> = {}) {
  return render(
    <WalletTokenList
      onContinue={mock()}
      items={cachedItems}
      isLoadingTokens={false}
      selectedId="137:usdc"
      onSelect={mock()}
      {...overrides}
    />,
  )
}

describe('walletTokenList', () => {
  it('keeps cached tokens usable when a background refetch fails', () => {
    const onContinue = mock()

    renderWalletTokenList({
      onContinue,
      hasError: true,
      errorMessage: 'Could not load wallet balances. Please try again.',
    })

    expect(screen.queryByText('Could not load wallet balances. Please try again.')).not.toBeInTheDocument()

    const continueButton = screen.getByRole('button', { name: 'Continue' })
    expect(continueButton).not.toBeDisabled()

    fireEvent.click(continueButton)

    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('shows the error when refetch fails without cached tokens', () => {
    renderWalletTokenList({
      items: [],
      hasError: true,
      errorMessage: 'Could not load wallet balances. Please try again.',
    })

    expect(screen.getByText('Could not load wallet balances. Please try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('exposes the bridge action for another network', () => {
    const onConnectAnotherNetwork = mock()

    renderWalletTokenList({ onConnectAnotherNetwork })

    const bridgeButton = screen.getByRole('button', { name: /Bridge from another network/ })
    fireEvent.click(bridgeButton)

    expect(onConnectAnotherNetwork).toHaveBeenCalledTimes(1)
  })

  it('keeps a native token selectable when its USD price is unavailable', () => {
    renderWalletTokenList({
      items: [
        {
          ...cachedItems[0],
          id: '137:pol',
          symbol: 'POL',
          balance: '1.50',
          usd: '—',
          hasUsdValue: false,
        },
      ],
      selectedId: '137:pol',
    })

    expect(screen.getByText('1.50 POL')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled()
  })
})
