import { render, screen } from '@testing-library/react'
import { describe, expect, it, mock } from 'bun:test'

import type { Event } from '@/types'

void mock.module('next/dynamic', () => ({
  default: (_loader: unknown, options: { loading: () => React.ReactNode }) => options.loading,
}))
void mock.module('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }))
void mock.module('@/hooks/useCurrentTimestamp', () => ({ useCurrentTimestamp: () => 1_800_000_000_000 }))
void mock.module('@/hooks/useSiteIdentity', () => ({ useSiteIdentity: () => ({ name: 'Kuest', logoSvg: '' }) }))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventMetaInformation', () => ({
  default: () => <div>Event metadata</div>,
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_utils/EventChartUtils', () => ({
  getSportsMoneylineMarketIds: (event: Event) => (event.sports_event_slug ? ['home', 'away'] : []),
}))

const { default: EventChartSection } =
  await import('@/app/[locale]/(platform)/event/[slug]/_components/EventChartSection')
const event = { id: 'event', total_markets_count: 2, markets: [], tags: [] } as unknown as Event

describe('event chart section', () => {
  it('shows compact metadata and the watermark immediately for events without an overview chart', () => {
    const { container } = render(<EventChartSection event={event} />)
    expect(screen.getByText('Event metadata')).toBeInTheDocument()
    expect(screen.getByText('Kuest')).toBeInTheDocument()
    expect(container.querySelector('.h-96')).toBeNull()
  })

  it.each([
    { total_markets_count: 1 },
    { enable_neg_risk: true },
    { neg_risk: true },
    { sports_event_slug: 'home-away' },
  ])('reserves chart space when the event has a visible chart (%j)', (overrides) => {
    const { container } = render(<EventChartSection event={{ ...event, ...overrides }} />)
    expect(container.querySelector('.h-96')).not.toBeNull()
    expect(screen.queryByText('Event metadata')).not.toBeInTheDocument()
  })
})
