import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import type { ProfileForCards } from '@/app/[locale]/(platform)/_components/ProfileOverviewCard'
import type { PortfolioSnapshot } from '@/lib/portfolio'

import { hoisted } from '../bun-test-helpers'

const counters = hoisted(() => ({ mounted: 0 }))

void mock.module('next-intl', () => ({
  useExtracted: () => (value: string) => value,
  useLocale: () => 'en-US',
}))

void mock.module('@/app/[locale]/(platform)/_components/ProfileOverviewCard', () => ({ default: () => null }))
void mock.module('@/components/SiteLogoIcon', () => ({ default: () => null }))
void mock.module('@/hooks/usePublicRuntimeConfig', () => ({
  usePublicRuntimeConfig: () => ({ dataUrl: 'https://data.test' }),
}))
void mock.module('@/hooks/useSiteIdentity', () => ({
  useSiteIdentity: () => ({ name: 'Kuest', logoSvg: '<svg />' }),
}))
void mock.module('@/stores/usePortfolioValueVisibility', () => ({
  usePortfolioValueVisibility: (selector: (state: { isHidden: boolean }) => unknown) => selector({ isHidden: false }),
}))
void mock.module('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: () => null,
  PopoverContent: () => null,
  PopoverTitle: () => null,
}))
void mock.module('react-animated-counter', () => ({
  AnimatedCounter: ({ value }: { value: number }) => {
    const [id] = React.useState(() => ++counters.mounted)
    return (
      <span data-testid="pnl-counter" data-instance={id}>
        {value.toFixed(2)}
      </span>
    )
  },
}))

import * as React from 'react'

const { default: PublicProfileHeroCards } =
  await import('@/app/[locale]/(platform)/profile/_components/PublicProfileHeroCards')

type PendingRequest = {
  interval: string | null
  signal: AbortSignal | undefined
  resolve: (response: Response) => void
  reject: (error: Error) => void
}

const requests: PendingRequest[] = []
const originalFetch = globalThis.fetch

function showProfile(address = '0xabc') {
  return render(
    <PublicProfileHeroCards
      profile={{ portfolioAddress: address } as ProfileForCards}
      snapshot={{} as PortfolioSnapshot}
      fallbackChartEndDate="2026-10-26T00:00:00.000Z"
    />,
  )
}

async function respond(index: number, values: number[]) {
  await act(async () => {
    requests[index].resolve(
      new Response(JSON.stringify(values.map((p, t) => ({ t: t + 1, p }))), {
        status: 200,
      }),
    )
  })
}

beforeEach(() => {
  counters.mounted = 0
  requests.length = 0
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    return new Promise<Response>((resolve, reject) => {
      requests.push({
        interval: url.searchParams.get('interval'),
        signal: init?.signal as AbortSignal,
        resolve,
        reject,
      })
    })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('profile P&L period transitions', () => {
  it('keeps the counter mounted and the previous value until each new period has data', async () => {
    showProfile()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(requests[0].interval).toBe('1d')
    await respond(0, [0, 120])
    const counter = screen.getByTestId('pnl-counter')
    expect(screen.getByText('+$120.00')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '1W' }))
    expect(requests[1].interval).toBe('1w')
    expect(screen.getByText('+$120.00')).toBeInTheDocument()
    expect(screen.getByTestId('pnl-counter')).toBe(counter)
    await respond(1, [0, -35])
    expect(screen.getByText('-$35.00')).toBeInTheDocument()
    expect(screen.getByTestId('pnl-counter')).toBe(counter)

    fireEvent.click(screen.getByRole('button', { name: '1M' }))
    expect(screen.getByText('-$35.00')).toBeInTheDocument()
    await respond(2, [5, 5])
    expect(screen.getByText('+$0.00')).toBeInTheDocument()
    expect(screen.getByTestId('pnl-counter')).toBe(counter)

    fireEvent.click(screen.getByRole('button', { name: 'ALL' }))
    expect(screen.getByText('+$0.00')).toBeInTheDocument()
    await respond(3, [5, 10])
    expect(screen.getByText('+$10.00')).toBeInTheDocument()
    expect(screen.getByTestId('pnl-counter')).toBe(counter)
    expect(counters.mounted).toBe(1)
  })

  it('ignores late responses and keeps valid data through errors, empty data, and repeated navigation', async () => {
    showProfile()
    await respond(0, [0, 20])
    fireEvent.click(screen.getByRole('button', { name: '1W' }))
    fireEvent.click(screen.getByRole('button', { name: '1M' }))
    expect(requests[1].signal?.aborted).toBe(true)
    await respond(1, [0, 999])
    expect(screen.getByText('+$20.00')).toBeInTheDocument()
    await respond(2, [0, -15])
    expect(screen.getByText('-$15.00')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ALL' }))
    await act(async () => requests[3].reject(new Error('network failure')))
    expect(screen.getByText('-$15.00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '1D' }))
    await respond(4, [])
    expect(screen.getByText('-$15.00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '1W' }))
    await respond(5, [0, 7])
    expect(screen.getByText('+$7.00')).toBeInTheDocument()
  })

  it('does not show a fabricated zero after an initial failure or while switching profile', async () => {
    const view = showProfile()
    await act(async () => requests[0].resolve(new Response('error', { status: 500 })))
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByTestId('pnl-counter')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '1W' }))
    await respond(1, [0, 0])
    expect(screen.getByText('+$0.00')).toBeInTheDocument()
    view.rerender(
      <PublicProfileHeroCards
        profile={{ portfolioAddress: '0xdef' } as ProfileForCards}
        snapshot={{} as PortfolioSnapshot}
      />,
    )
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByTestId('pnl-counter')).toBeNull()
  })

  it('discards an old profile response even when its fetch ignores abort', async () => {
    const view = showProfile()
    view.rerender(
      <PublicProfileHeroCards
        profile={{ portfolioAddress: '0xdef' } as ProfileForCards}
        snapshot={{} as PortfolioSnapshot}
      />,
    )
    expect(requests[0].signal?.aborted).toBe(true)
    await respond(0, [0, 999])
    expect(screen.getByText('—')).toBeInTheDocument()
    await respond(1, [0, -8])
    expect(screen.getByText('-$8.00')).toBeInTheDocument()
  })
})
