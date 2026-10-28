import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  buildHomeSportsMoneylineModel: mock(),
  dynamicSportsCard: mock(),
  eventCardFooter: mock(),
  eventCardHeader: mock(),
  isCurrentHomeLiveSeriesEvent: mock(),
  locale: 'en-US',
  singleMarketActions: mock(),
  useXTrackerTweetCount: mock(),
}))

void mock.module('next-intl', () => ({
  useExtracted: () => (message: string, values?: Record<string, string | number>) =>
    Object.entries(values ?? {}).reduce((label, [key, value]) => label.replace(`{${key}}`, String(value)), message),
  useLocale: () => mocks.locale,
}))

void mock.module('next/dynamic', () => ({
  __esModule: true,
  default: () =>
    function MockDynamicSportsCard(props: any) {
      mocks.dynamicSportsCard(props)
      return <div data-testid="sports-moneyline-card" />
    },
}))

void mock.module('@/app/[locale]/(platform)/(home)/_components/EventCardFooter', () => ({
  default: (props: any) => {
    mocks.eventCardFooter(props)
    return <div data-testid="event-card-footer" />
  },
}))

void mock.module('@/app/[locale]/(platform)/(home)/_components/EventCardHeader', () => ({
  default: (props: any) => {
    mocks.eventCardHeader(props)
    return <div data-testid="event-card-header" />
  },
}))

void mock.module('@/app/[locale]/(platform)/(home)/_components/EventCardMarketsList', () => ({
  default: () => <div data-testid="event-card-markets-list" />,
}))

void mock.module('@/app/[locale]/(platform)/(home)/_components/EventCardSingleMarketActions', () => ({
  default: (props: any) => {
    mocks.singleMarketActions(props)
    return <div data-testid="event-card-single-market-actions" />
  },
}))

void mock.module('@/app/[locale]/(platform)/(home)/_utils/eventCardResolvedOutcome', () => ({
  resolveEventCardResolvedOutcomeIndex: () => null,
  shouldUseResolvedXTracker: () => false,
}))

void mock.module('@/app/[locale]/(platform)/event/[slug]/_hooks/useXTrackerTweetCount', () => ({
  useXTrackerTweetCount: (...args: any[]) => mocks.useXTrackerTweetCount(...args),
}))

void mock.module('@/lib/event-new-badge', () => ({
  shouldShowEventNewBadge: () => false,
}))

void mock.module('@/lib/home-events', () => ({
  isCurrentHomeLiveSeriesEvent: (...args: any[]) => mocks.isCurrentHomeLiveSeriesEvent(...args),
  isEventResolvedLike: () => false,
  resolveHomeLiveSeriesEndTimestamp: () => Number.POSITIVE_INFINITY,
}))

void mock.module('@/lib/market-chance', () => ({
  buildChanceByMarket: () => ({ 'market-1': 62 }),
}))

void mock.module('@/lib/sports-home-card', () => ({
  buildHomeSportsMoneylineModel: (event: any) => mocks.buildHomeSportsMoneylineModel(event),
}))

const { default: EventCard } = await import('@/app/[locale]/(platform)/(home)/_components/EventCard?bun-test')

const EVENT = {
  id: 'event-1',
  title: 'Will this event happen?',
  creator: 'Creator',
  icon_url: null,
  total_markets_count: 1,
  markets: [
    {
      condition_id: 'market-1',
      is_resolved: false,
      condition: {
        resolved: false,
      },
      outcomes: [
        {
          outcome_index: 0,
          outcome_text: 'Yes',
        },
        {
          outcome_index: 1,
          outcome_text: 'No',
        },
      ],
    },
  ],
} as any

describe('eventCard', () => {
  beforeEach(() => {
    mocks.buildHomeSportsMoneylineModel.mockReset()
    mocks.dynamicSportsCard.mockReset()
    mocks.eventCardFooter.mockReset()
    mocks.eventCardHeader.mockReset()
    mocks.isCurrentHomeLiveSeriesEvent.mockReset()
    mocks.isCurrentHomeLiveSeriesEvent.mockReturnValue(false)
    mocks.locale = 'en-US'
    mocks.singleMarketActions.mockReset()
    mocks.useXTrackerTweetCount.mockReset()
    mocks.useXTrackerTweetCount.mockReturnValue({ data: null })
  })

  it('keeps the standard card path out of the sports moneyline component', () => {
    mocks.buildHomeSportsMoneylineModel.mockReturnValue(null)

    render(<EventCard event={EVENT} />)

    expect(screen.getByTestId('event-card-header')).toBeInTheDocument()
    expect(screen.getByTestId('event-card-footer')).toBeInTheDocument()
    expect(screen.getByTestId('event-card-single-market-actions')).toBeInTheDocument()
    expect(screen.queryByTestId('sports-moneyline-card')).not.toBeInTheDocument()
    expect(mocks.dynamicSportsCard).not.toHaveBeenCalled()
  })

  it('does not label an upcoming live series event as Live', () => {
    mocks.buildHomeSportsMoneylineModel.mockReturnValue(null)
    render(
      <EventCard
        event={{ ...EVENT, series_slug: 'live-series', has_live_chart: true } as any}
        currentTimestamp={Date.parse('2026-06-09T12:00:00.000Z')}
      />,
    )
    expect(mocks.eventCardFooter.mock.calls.at(-1)?.[0].showLiveBadge).toBe(false)
    mocks.isCurrentHomeLiveSeriesEvent.mockReturnValue(true)
    render(
      <EventCard
        event={{ ...EVENT, series_slug: 'live-series', has_live_chart: true } as any}
        currentTimestamp={Date.parse('2026-06-09T12:15:00.000Z')}
      />,
    )
    expect(mocks.eventCardFooter.mock.calls.at(-1)?.[0].showLiveBadge).toBe(true)
  })

  it('uses standard Yes and No action labels when a binary market has no outcome rows', () => {
    mocks.buildHomeSportsMoneylineModel.mockReturnValue(null)

    render(
      <EventCard
        event={
          {
            ...EVENT,
            volume: 0,
            markets: [
              {
                ...EVENT.markets[0],
                volume: 0,
                volume_24h: 0,
                outcomes: [],
                condition: {
                  resolved: false,
                  volume: 0,
                },
              },
            ],
          } as any
        }
      />,
    )

    expect(screen.getByTestId('event-card-single-market-actions')).toBeInTheDocument()
    expect(mocks.singleMarketActions).toHaveBeenCalledWith(
      expect.objectContaining({
        yesOutcome: expect.objectContaining({
          outcome_index: 0,
          outcome_text: 'Yes',
        }),
        noOutcome: expect.objectContaining({
          outcome_index: 1,
          outcome_text: 'No',
        }),
      }),
    )
  })

  it('shows a quote-derived chance when a market has planted orders but no matched volume', () => {
    mocks.buildHomeSportsMoneylineModel.mockReturnValue(null)

    render(
      <EventCard
        event={
          {
            ...EVENT,
            markets: [
              {
                ...EVENT.markets[0],
                volume: 0,
                volume_24h: 0,
                outcomes: [
                  {
                    outcome_index: 0,
                    outcome_text: 'Yes',
                    buy_price: 0.66,
                    sell_price: 0.58,
                  },
                  {
                    outcome_index: 1,
                    outcome_text: 'No',
                    buy_price: 0.42,
                    sell_price: 0.34,
                  },
                ],
                condition: {
                  resolved: false,
                  volume: 0,
                },
              },
            ],
          } as any
        }
      />,
    )

    expect(mocks.eventCardHeader).toHaveBeenCalledWith(
      expect.objectContaining({
        roundedPrimaryDisplayChance: 62,
      }),
    )
  })

  it('uses the canonical crypto cadence title on event cards', () => {
    mocks.buildHomeSportsMoneylineModel.mockReturnValue(null)

    render(
      <EventCard
        event={{
          ...EVENT,
          title: 'Bitcoin Up or Down - July 28, 8:15AM ET',
          end_date: '2026-07-28T12:15:00.000Z',
          main_tag: 'Crypto',
          series_recurrence: 'daily',
          series_slug: 'btc-up-or-down-15m',
          tags: [],
        }}
      />,
    )

    expect(mocks.eventCardHeader).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'BTC Up or Down 15m',
      }),
    )
  })

  it('uses the localized crypto cadence title on translated event cards', () => {
    mocks.buildHomeSportsMoneylineModel.mockReturnValue(null)
    mocks.locale = 'pt'

    render(
      <EventCard
        event={{
          ...EVENT,
          title: 'Bitcoin sobe ou desce — 28 de julho, 08:15 ET',
          end_date: '2026-07-28T12:15:00.000Z',
          main_tag: 'Cripto',
          series_recurrence: 'daily',
          series_slug: 'btc-up-or-down-15m',
          tags: [{ slug: 'crypto', name: 'Cripto' }],
        }}
      />,
    )

    expect(mocks.eventCardHeader).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'BTC sobe ou desce 15m',
      }),
    )
  })

  it('renders the sports moneyline branch through the dynamic component boundary', () => {
    const model = {
      team1Button: {
        conditionId: 'market-1',
        outcomeIndex: 0,
      },
      team2Button: {
        conditionId: 'market-1',
        outcomeIndex: 1,
      },
    }
    mocks.buildHomeSportsMoneylineModel.mockReturnValue(model)

    render(
      <EventCard
        event={EVENT}
        priceOverridesByMarket={{ 'market-1': 62 }}
        enableHomeSportsMoneylineLayout
        currentTimestamp={123}
      />,
    )

    expect(screen.getByTestId('sports-moneyline-card')).toBeInTheDocument()
    expect(screen.queryByTestId('event-card-header')).not.toBeInTheDocument()
    expect(mocks.dynamicSportsCard).toHaveBeenCalledWith(
      expect.objectContaining({
        currentTimestamp: 123,
        event: EVENT,
        model,
      }),
    )
    expect(mocks.dynamicSportsCard.mock.calls[0]?.[0].getDisplayChance('market-1')).toBe(62)
  })
})
