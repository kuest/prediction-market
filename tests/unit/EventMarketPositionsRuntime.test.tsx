import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'

import type { DataApiPosition } from '@/lib/data-api/user'
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

function renderPositions(selectedMarket = market) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <EventMarketPositions market={selectedMarket} />
    </QueryClientProvider>,
  )
}

const btcFillPosition: DataApiPosition = {
  conditionId,
  asset: '1',
  size: 16,
  avgPrice: 0.896168,
  initialValue: 14.338688,
  totalBought: 16,
  currentValue: 14.56,
  curPrice: 0.91,
  realizedPnl: 0,
  cashPnl: 0.221312,
  outcome: 'Up',
  outcomeIndex: 0,
  slug: market.slug,
  title: market.title,
}

async function renderBtcPosition(position: DataApiPosition = btcFillPosition, selectedMarket = market) {
  window.__PUBLIC_RUNTIME_CONFIG__ = { chainId: 137, dataUrl: 'https://data-api.kuest.com' }
  useUser.setState({ deposit_wallet_address: ownerAddress } as User)
  useOrder.setState({ event: { total_markets_count: 1 } as Event })
  const requests: URL[] = []
  stubGlobal(
    'fetch',
    mock(async (input: string | URL | Request) => {
      requests.push(new URL(String(input)))
      return Response.json([position])
    }),
  )
  renderPositions(selectedMarket)
  const shares = await screen.findByText(String(position.size))
  const row = shares.closest('tr')!
  return { row, cells: within(row).getAllByRole('cell'), requests }
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

  it('shows the fee-inclusive BTC cost, average, value and return without treating shares as dollars', async () => {
    const { cells } = await renderBtcPosition()
    expect(cells[1]).toHaveTextContent('16')
    expect(cells[2]).toHaveTextContent('89.6¢')
    expect(cells[3]).toHaveTextContent('$14.56')
    expect(cells[3]).toHaveTextContent('Cost $14.34')
    expect(cells[4]).toHaveTextContent('+22.1¢')
    expect(cells[4]).toHaveTextContent('+1.5%')
  })

  it('uses the API mark rather than a stale event ask and refreshes all return fields consistently', async () => {
    const { cells } = await renderBtcPosition({ ...btcFillPosition, curPrice: 0.99, currentValue: 15.84 })
    expect(cells[3]).toHaveTextContent('$15.84')
    expect(cells[3]).toHaveTextContent('Cost $14.34')
    expect(cells[4]).toHaveTextContent('+$1.50')
    expect(cells[4]).toHaveTextContent('+10%')
  })

  it('keeps the explicit API valuation when its price field disagrees', async () => {
    const { cells } = await renderBtcPosition({ ...btcFillPosition, currentValue: 14.24, curPrice: 0.91 })
    expect(cells[3]).toHaveTextContent('$14.24')
    expect(cells[4]).toHaveTextContent('-9.9¢')
    expect(cells[4]).toHaveTextContent('-0.7%')
  })

  it('uses the event quote when the API has neither a valuation nor a mark', async () => {
    const { cells } = await renderBtcPosition({ ...btcFillPosition, currentValue: undefined, curPrice: undefined })
    expect(cells[3]).toHaveTextContent('$15.36')
    expect(cells[3]).toHaveTextContent('Cost $14.34')
    expect(cells[4]).toHaveTextContent('+$1.02')
    expect(cells[4]).toHaveTextContent('+7.1%')
  })

  it('marks at the indexed trade price when the API has no live book quote', async () => {
    const { cells } = await renderBtcPosition({ ...btcFillPosition, curPrice: 0.89, currentValue: 14.24 })
    expect(cells[3]).toHaveTextContent('$14.24')
    expect(cells[3]).toHaveTextContent('Cost $14.34')
    expect(cells[4]).toHaveTextContent('-9.9¢')
    expect(cells[4]).toHaveTextContent('-0.7%')
  })

  it('keeps a resolved zero payout instead of reviving a stale nonzero quote', async () => {
    const { cells, row, requests } = await renderBtcPosition(
      { ...btcFillPosition, curPrice: 0.91, currentValue: 0 },
      { ...market, is_active: false, is_resolved: true },
    )
    expect(cells[3]).toHaveTextContent('0¢')
    expect(cells[3]).toHaveTextContent('Cost $14.34')
    expect(cells[4]).toHaveTextContent('-$14.34')
    expect(cells[4]).toHaveTextContent('-100%')
    expect(requests.every((url) => url.pathname === '/positions')).toBe(true)
    expect(within(row).getByRole('button', { name: 'Sell position' })).toBeDisabled()
  })

  it('keeps outstanding holdings visible while the market has ended and awaits resolution', async () => {
    const { requests, row } = await renderBtcPosition(btcFillPosition, { ...market, is_active: false })
    expect(requests.every((url) => url.pathname === '/positions')).toBe(true)
    expect(within(row).getByRole('button', { name: 'Sell position' })).toBeDisabled()
  })

  it('values winning inventory at its payout before redemption, with profit separate from gross payout', async () => {
    const { cells } = await renderBtcPosition(
      { ...btcFillPosition, curPrice: 1, currentValue: 16 },
      { ...market, is_active: false, is_resolved: true },
    )
    expect(cells[3]).toHaveTextContent('$16.00')
    expect(cells[3]).toHaveTextContent('Cost $14.34')
    expect(cells[4]).toHaveTextContent('+$1.66')
    expect(cells[4]).toHaveTextContent('+12%')
  })

  it('does not count cashPnl as realized profit when realizedPnl is absent', async () => {
    const { cells } = await renderBtcPosition({ ...btcFillPosition, totalBought: undefined, realizedPnl: undefined })
    expect(cells[4]).toHaveTextContent('+22.1¢')
    expect(cells[4]).not.toHaveTextContent('44.3¢')
  })

  it('uses remaining cost after a partial sale and adds only actual realized profit', async () => {
    const { cells } = await renderBtcPosition({
      ...btcFillPosition,
      size: 8,
      initialValue: 7.169344,
      currentValue: 7.28,
      realizedPnl: 0.35,
      cashPnl: 0.110656,
    })
    expect(cells[3]).toHaveTextContent('Cost $7.17')
    expect(cells[3]).toHaveTextContent('$7.28')
    expect(cells[4]).toHaveTextContent('+46.1¢')
    expect(cells[4]).toHaveTextContent('+6.4%')
  })

  it('preserves an explicit zero cost and omits a percentage with no cost denominator', async () => {
    const { cells } = await renderBtcPosition({ ...btcFillPosition, initialValue: 0 })
    expect(cells[3]).toHaveTextContent('Cost 0¢')
    expect(cells[4]).toHaveTextContent('+$14.56')
    expect(cells[4].textContent).not.toContain('%')
  })
})
