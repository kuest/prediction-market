import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import type { Event } from '@/types'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({ isMobile: false, chartProps: null as any, chartRequests: [] as string[] }))

void mock.module('next/dynamic', () => ({
  default: (_loader: unknown, options: { loading: () => React.ReactNode }) =>
    function DeferredChart(props: any) {
      mocks.chartProps = props
      mocks.chartRequests.push(props.event.id)
      return options.loading()
    },
}))
void mock.module('@/hooks/useIsMobile', () => ({ useIsMobile: () => mocks.isMobile }))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_hooks/useOrderBookSummaries', () => ({
  useOrderBookSummaries: () => ({ data: {} }),
}))
void mock.module('@/hooks/useCurrentTimestamp', () => ({ useCurrentTimestamp: () => 1_800_000_000_000 }))
void mock.module('@/hooks/useSiteIdentity', () => ({ useSiteIdentity: () => ({ name: 'Kuest', logoSvg: '' }) }))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventMetaInformation', () => ({
  default: () => <div>Event metadata</div>,
}))
const { default: EventChartSection } =
  await import('@/app/[locale]/(platform)/event/[slug]/_components/EventChartSection')
const { useOrder } = await import('@/stores/useOrder')
const event = { id: 'event', total_markets_count: 2, markets: [], tags: [] } as unknown as Event
const singleEvent = { ...event, id: 'single-event', total_markets_count: 1 }

describe('event chart section', () => {
  beforeEach(() => {
    mocks.isMobile = false
    mocks.chartProps = null
    mocks.chartRequests = []
    useOrder.getState().reset()
  })

  afterEach(() => {
    act(() => useOrder.getState().reset())
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

  it.each([false, true])(
    'loads a single-event chart with an uninitialized order store and forwards mobile=%s',
    (isMobile) => {
      mocks.isMobile = isMobile
      expect(useOrder.getState().event).toBeNull()
      const { container } = render(<EventChartSection event={singleEvent} />)
      expect(container.querySelector('.h-96')).not.toBeNull()
      expect(mocks.chartProps.isMobile).toBe(isMobile)
      expect(mocks.chartProps.event).toBe(singleEvent)
      expect(useOrder.getState().event).toBeNull()
      expect(screen.queryByText('Event metadata')).not.toBeInTheDocument()
    },
  )

  it('does not request a chart when navigating from a single event to a multi-event before order sync', () => {
    useOrder.getState().setEvent(singleEvent)
    const { container, rerender } = render(<EventChartSection event={singleEvent} />)
    expect(mocks.chartRequests).toEqual([singleEvent.id])
    mocks.chartProps = null
    mocks.chartRequests = []

    rerender(<EventChartSection event={event} />)
    expect(useOrder.getState().event).toBe(singleEvent)
    expect(screen.getByText('Event metadata')).toBeInTheDocument()
    expect(container.querySelector('.h-96')).toBeNull()
    expect(mocks.chartRequests).toEqual([])
    expect(mocks.chartProps).toBeNull()

    act(() => useOrder.getState().setEvent(event))
    rerender(<EventChartSection event={event} />)
    expect(screen.getByText('Event metadata')).toBeInTheDocument()
    expect(mocks.chartRequests).toEqual([])
  })

  it('loads the current single-event chart when the order store still contains the previous multi-event', () => {
    useOrder.getState().setEvent(event)
    const { container, rerender } = render(<EventChartSection event={event} />)
    expect(mocks.chartRequests).toEqual([])

    rerender(<EventChartSection event={singleEvent} />)
    expect(useOrder.getState().event).toBe(event)
    expect(container.querySelector('.h-96')).not.toBeNull()
    expect(mocks.chartRequests).toEqual([singleEvent.id])
    expect(mocks.chartProps.event).toBe(singleEvent)
  })

  it('keeps a filtered event with one remaining market in multi-market mode', () => {
    const filteredEvent = {
      ...event,
      markets: [{ condition_id: 'remaining-market', outcomes: [] }],
    } as unknown as Event
    render(<EventChartSection event={filteredEvent} />)
    expect(screen.getByText('Event metadata')).toBeInTheDocument()
    expect(mocks.chartRequests).toEqual([])
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

    act(() => useOrder.getState().setEvent(singleEvent))
    rerender(<EventChartSection event={singleEvent} isSingleMarketOverride={false} />)
    expect(container.querySelector('.h-96')).toBeNull()
    expect(screen.getByText('Event metadata')).toBeInTheDocument()
  })

  it('lets forceVisible take precedence over an explicit multi-market override', () => {
    const { container } = render(<EventChartSection event={singleEvent} isSingleMarketOverride={false} forceVisible />)
    expect(container.querySelector('.h-96')).not.toBeNull()
    expect(mocks.chartProps.isSingleMarketOverride).toBe(false)
    expect(mocks.chartProps.forceVisible).toBe(true)
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
