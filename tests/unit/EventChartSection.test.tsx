import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, mock } from 'bun:test'

import type { Event } from '@/types'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({ isMobile: false, isSingleMarket: false, chartProps: null as any }))

void mock.module('next/dynamic', () => ({
  default: (_loader: unknown, options: { loading: () => React.ReactNode }) =>
    function DeferredChart(props: any) {
      mocks.chartProps = props
      return options.loading()
    },
}))
void mock.module('@/hooks/useIsMobile', () => ({ useIsMobile: () => mocks.isMobile }))
void mock.module('@/stores/useOrder', () => ({ useIsSingleMarket: () => mocks.isSingleMarket }))
void mock.module('@/hooks/useCurrentTimestamp', () => ({ useCurrentTimestamp: () => 1_800_000_000_000 }))
void mock.module('@/hooks/useSiteIdentity', () => ({ useSiteIdentity: () => ({ name: 'Kuest', logoSvg: '' }) }))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventMetaInformation', () => ({
  default: () => <div>Event metadata</div>,
}))
const { default: EventChartSection } =
  await import('@/app/[locale]/(platform)/event/[slug]/_components/EventChartSection')
const event = { id: 'event', total_markets_count: 2, markets: [], tags: [] } as unknown as Event

describe('event chart section', () => {
  beforeEach(() => {
    mocks.isMobile = false
    mocks.isSingleMarket = false
    mocks.chartProps = null
  })

  it('shows compact metadata and the watermark immediately for events without an overview chart', () => {
    const { container } = render(<EventChartSection event={event} />)
    expect(screen.getByText('Event metadata')).toBeInTheDocument()
    expect(screen.getByText('Kuest')).toBeInTheDocument()
    expect(container.querySelector('.h-96')).toBeNull()
  })

  it.each([{ enable_neg_risk: true }, { neg_risk: true }])(
    'reserves chart space when the event has a visible chart (%j)',
    (overrides) => {
      const { container } = render(<EventChartSection event={{ ...event, ...overrides }} />)
      expect(container.querySelector('.h-96')).not.toBeNull()
      expect(screen.queryByText('Event metadata')).not.toBeInTheDocument()
    },
  )

  it.each([false, true])('uses the selected single-market context and forwards mobile=%s', (isMobile) => {
    mocks.isMobile = isMobile
    mocks.isSingleMarket = true
    const { container } = render(<EventChartSection event={event} />)
    expect(container.querySelector('.h-96')).not.toBeNull()
    expect(mocks.chartProps.isMobile).toBe(isMobile)
    expect(screen.queryByText('Event metadata')).not.toBeInTheDocument()
  })

  it('preserves explicit visibility even when the order context has multiple markets', () => {
    const { container } = render(<EventChartSection event={event} forceVisible />)
    expect(container.querySelector('.h-96')).not.toBeNull()
    expect(mocks.chartProps.forceVisible).toBe(true)
  })

  it('preserves the single-market override before loading the chart chunk', () => {
    const { container, rerender } = render(<EventChartSection event={event} isSingleMarketOverride />)
    expect(container.querySelector('.h-96')).not.toBeNull()
    expect(mocks.chartProps.isSingleMarketOverride).toBe(true)

    mocks.isSingleMarket = true
    rerender(<EventChartSection event={event} isSingleMarketOverride={false} />)
    expect(container.querySelector('.h-96')).toBeNull()
    expect(screen.getByText('Event metadata')).toBeInTheDocument()
  })

  it('shows the sports moneyline overview even when the selected order context has multiple markets', () => {
    const sportsEvent = {
      ...event,
      sports_sport_slug: 'soccer',
      sports_tags: ['games'],
      sports_teams: [
        { name: 'Home Team', host_status: 'home' },
        { name: 'Away Team', host_status: 'away' },
      ],
      markets: ['Home Team', 'Away Team'].map((name) => ({
        condition_id: name,
        sports_market_type: 'moneyline',
        short_title: name,
        title: name,
        outcomes: [
          { outcome_index: 0, outcome_text: 'Yes' },
          { outcome_index: 1, outcome_text: 'No' },
        ],
      })),
    } as unknown as Event
    const { container } = render(<EventChartSection event={sportsEvent} />)
    expect(container.querySelector('.h-96')).not.toBeNull()
    expect(screen.queryByText('Event metadata')).not.toBeInTheDocument()
  })
})
