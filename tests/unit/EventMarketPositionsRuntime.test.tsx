import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'

import type { Event, User } from '@/types'

import EventMarketPositions from '@/app/[locale]/(platform)/event/[slug]/_components/EventMarketPositions'
import { useOrder } from '@/stores/useOrder'
import { useUser } from '@/stores/useUser'

import { stubEnv, stubGlobal, unstubAllEnvs, unstubAllGlobals } from '../bun-test-helpers'

const conditionId = `0x${'a'.repeat(64)}`
const ownerAddress = `0x${'b'.repeat(40)}`
const market = {
  condition_id: conditionId,
  title: 'BTC Up or Down 15m',
  slug: 'btc-updown-15m-test',
  icon_url: '',
  is_active: true,
  is_resolved: false,
  outcomes: [
    { condition_id: conditionId, outcome_index: 0, outcome_text: 'Up', token_id: '1', buy_price: 0.96 },
    { condition_id: conditionId, outcome_index: 1, outcome_text: 'Down', token_id: '2', buy_price: 0.04 },
  ],
} as Event['markets'][number]

function renderPositions() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <EventMarketPositions market={market} />
    </QueryClientProvider>,
  )
}

describe('event Positions card runtime Data API URL', () => {
  afterEach(() => {
    unstubAllGlobals()
    unstubAllEnvs()
    delete window.__PUBLIC_RUNTIME_CONFIG__
    useUser.setState(null)
    useOrder.setState({ event: null })
  })

  it('shows indexed Up shares from the runtime Data API after a fresh render', async () => {
    window.__PUBLIC_RUNTIME_CONFIG__ = { chainId: 137, dataUrl: 'https://data-api.kuest.com' }
    stubEnv('CHAIN_ID', '80002')
    stubEnv('DATA_URL', 'https://wrong-build.example')
    useUser.setState({ deposit_wallet_address: ownerAddress } as User)
    useOrder.setState({ event: { total_markets_count: 1 } as Event })

    const fetchMock = mock(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      expect(url.origin).toBe('https://data-api.kuest.com')
      expect(url.pathname).toBe('/positions')
      expect(url.searchParams.get('user')).toBe(ownerAddress)
      expect(url.searchParams.get('market')).toBe(conditionId)

      return new Response(
        JSON.stringify([
          {
            conditionId,
            size: 15,
            avgPrice: 0.96,
            currentValue: 14.4,
            outcome: 'Up',
            outcomeIndex: 0,
            slug: market.slug,
            title: market.title,
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })
    stubGlobal('fetch', fetchMock)

    const firstPage = renderPositions()
    expect(await screen.findByRole('heading', { name: 'Positions' })).toBeInTheDocument()
    expect(screen.getByText('15')).toBeInTheDocument()
    firstPage.unmount()

    renderPositions()
    expect(await screen.findByRole('heading', { name: 'Positions' })).toBeInTheDocument()
    expect(screen.getByText('15')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
