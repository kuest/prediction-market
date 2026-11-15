import { describe, expect, it, mock } from 'bun:test'

import {
  buildHistoryWithLatestPointOverride,
  getFeaturedChartEvent,
  getSportsMoneylineMarketIds,
  resolveChartRangeStartMs,
  shouldHideEventChart,
} from '@/app/[locale]/(platform)/event/[slug]/_utils/EventChartUtils'

describe('eventChartUtils', () => {
  it('keeps only unresolved markets for a mixed multi-market chart', () => {
    const unresolvedMarket = { condition_id: 'active-market', is_resolved: false, condition: { resolved: false } }
    const resolvedMarket = { condition_id: 'resolved-market', is_resolved: true, condition: { resolved: false } }
    const conditionResolvedMarket = {
      condition_id: 'condition-resolved-market',
      is_resolved: false,
      condition: { resolved: true },
    }
    const event = { markets: [unresolvedMarket, resolvedMarket, conditionResolvedMarket] }

    expect(getFeaturedChartEvent(event, false).markets.map((market) => market.condition_id)).toEqual(['active-market'])
  })

  it('falls back to the original event when no market remains or when there is a single market', () => {
    const resolvedMarket = { condition_id: 'resolved-market', is_resolved: true, condition: { resolved: true } }
    const allResolvedEvent = {
      markets: [resolvedMarket, { ...resolvedMarket, condition_id: 'resolved-market-2' }],
    }
    const singleMarketEvent = { markets: [resolvedMarket] }

    expect(getFeaturedChartEvent(allResolvedEvent, false)).toBe(allResolvedEvent)
    expect(getFeaturedChartEvent(singleMarketEvent, true)).toBe(singleMarketEvent)
  })

  it('builds a flat series across the selected range when only a current quote exists', () => {
    const start = new Date('2026-07-30T12:00:00.000Z')
    const end = new Date('2026-07-30T13:00:00.000Z')

    expect(buildHistoryWithLatestPointOverride([], { market: 50 }, end.getTime(), start.getTime())).toEqual([
      { date: start, market: 50 },
      { date: end, market: 50 },
    ])
  })

  it('anchors quote-only charts to the selected time range without preceding event creation', () => {
    const createdAt = '2026-07-30T12:30:00.000Z'
    const end = new Date('2026-07-30T14:00:00.000Z')

    expect(resolveChartRangeStartMs('ALL', createdAt, end.getTime())).toBe(Date.parse(createdAt))
    expect(resolveChartRangeStartMs('1H', createdAt, end.getTime())).toBe(Date.parse('2026-07-30T13:00:00.000Z'))
    expect(resolveChartRangeStartMs('6H', createdAt, end.getTime())).toBe(Date.parse(createdAt))
  })

  it('extends an unchanged price through the chart end', () => {
    const start = new Date('2026-07-30T12:00:00.000Z')
    const end = new Date('2026-07-30T13:00:00.000Z')

    expect(buildHistoryWithLatestPointOverride([{ date: start, market: 42 }], { market: 42 }, end.getTime())).toEqual([
      { date: start, market: 42 },
      { date: end, market: 42 },
    ])
  })

  it('extends the last known values when live quotes are unavailable', () => {
    const start = new Date('2026-07-30T12:00:00.000Z')
    const end = new Date('2026-07-30T13:00:00.000Z')

    expect(buildHistoryWithLatestPointOverride([{ date: start, first: 35, second: 65 }], {}, end.getTime())).toEqual([
      { date: start, first: 35, second: 65 },
      { date: end, first: 35, second: 65 },
    ])
  })

  it('uses the resolved chart end instead of adding a later point', () => {
    const resolvedAt = new Date('2026-07-30T13:00:00.000Z')
    const laterNow = new Date('2026-07-30T14:00:00.000Z')
    const history = [
      { date: new Date('2026-07-30T12:00:00.000Z'), market: 42 },
      { date: resolvedAt, market: 58 },
    ]

    expect(buildHistoryWithLatestPointOverride(history, { market: 58 }, resolvedAt.getTime())).toBe(history)
    expect(buildHistoryWithLatestPointOverride(history, { market: 58 }, laterNow.getTime())).toEqual([
      ...history,
      { date: laterNow, market: 58 },
    ])
  })

  it('uses separated sports moneyline markets in team draw team order', () => {
    const event = {
      sports_sport_slug: 'soccer',
      sports_tags: ['games', 'fifwc'],
      tags: [],
      main_tag: 'games',
      sports_teams: [
        {
          name: 'United States',
          abbreviation: 'USA',
          host_status: 'home',
        },
        {
          name: 'Belgium',
          abbreviation: 'BEL',
          host_status: 'away',
        },
      ],
      markets: [
        {
          condition_id: 'united-states-market',
          sports_market_type: 'moneyline',
          short_title: 'United States',
          title: 'United States',
          outcomes: [
            { outcome_index: 0, outcome_text: 'Yes' },
            { outcome_index: 1, outcome_text: 'No' },
          ],
        },
        {
          condition_id: 'belgium-market',
          sports_market_type: 'moneyline',
          short_title: 'Belgium',
          title: 'Belgium',
          outcomes: [
            { outcome_index: 0, outcome_text: 'Yes' },
            { outcome_index: 1, outcome_text: 'No' },
          ],
        },
        {
          condition_id: 'draw-market',
          sports_market_type: 'moneyline',
          short_title: 'Draw',
          title: 'Draw',
          outcomes: [
            { outcome_index: 0, outcome_text: 'Yes' },
            { outcome_index: 1, outcome_text: 'No' },
          ],
        },
      ],
    } as any

    expect(getSportsMoneylineMarketIds(event)).toEqual(['united-states-market', 'draw-market', 'belgium-market'])
    expect(shouldHideEventChart(event, { isSingleMarket: false })).toBe(false)
    expect(shouldHideEventChart(event, { isSingleMarket: false, maxSeriesCount: 1 })).toBe(true)
    expect(shouldHideEventChart(event, { isSingleMarket: false, maxSeriesCount: 1, forceVisible: true })).toBe(false)
  })

  it('deduplicates binary sports moneyline outcome markets', () => {
    const event = {
      sports_sport_slug: 'soccer',
      sports_tags: ['games'],
      tags: [],
      main_tag: 'games',
      sports_teams: [
        {
          name: 'United States',
          abbreviation: 'USA',
          host_status: 'home',
        },
        {
          name: 'Belgium',
          abbreviation: 'BEL',
          host_status: 'away',
        },
      ],
      markets: [
        {
          condition_id: 'match-winner-market',
          sports_market_type: 'moneyline',
          short_title: 'Match Winner',
          title: 'Match Winner',
          outcomes: [
            { outcome_index: 0, outcome_text: 'United States' },
            { outcome_index: 1, outcome_text: 'Belgium' },
          ],
        },
      ],
    } as any

    expect(getSportsMoneylineMarketIds(event)).toEqual(['match-winner-market'])
    expect(shouldHideEventChart(event, { isSingleMarket: false })).toBe(true)
    expect(shouldHideEventChart(event, { isSingleMarket: true })).toBe(false)
  })

  it.each([
    [{ isSingleMarket: false }, true],
    [{ isSingleMarket: true }, false],
    [{ isSingleMarket: false, forceVisible: true }, false],
  ] as const)('respects explicit chart visibility context %j', (context, hidden) => {
    const event = { markets: [], total_markets_count: 2 } as any
    expect(shouldHideEventChart(event, context)).toBe(hidden)
  })

  it.each(['enable_neg_risk', 'neg_risk'] as const)('keeps %s event charts visible', (flag) => {
    const event = { markets: [], [flag]: true } as any
    expect(shouldHideEventChart(event, { isSingleMarket: false })).toBe(false)
  })

  it.each([
    [{ total_markets_count: 1 }, {}],
    [{ total_markets_count: 2 }, { isSingleMarket: true }],
    [{ total_markets_count: 2 }, { forceVisible: true }],
    [{ total_markets_count: 2, enable_neg_risk: true }, {}],
    [{ total_markets_count: 2, neg_risk: true }, {}],
  ] as const)('skips sports model lookup when chart visibility is already known (%j, %j)', (eventFields, context) => {
    const readSportsSlug = mock(() => undefined)
    const event = {
      ...eventFields,
      get sports_sport_slug() {
        return readSportsSlug()
      },
    } as any
    expect(shouldHideEventChart(event, context)).toBe(false)
    expect(readSportsSlug).not.toHaveBeenCalled()
  })

  it('looks up the sports model only when a regular multi-event needs classification', () => {
    const readSportsSlug = mock(() => undefined)
    const event = {
      total_markets_count: 2,
      get sports_sport_slug() {
        return readSportsSlug()
      },
    } as any
    expect(shouldHideEventChart(event)).toBe(true)
    expect(readSportsSlug).toHaveBeenCalledTimes(1)
  })

  it('uses the event total rather than the number of filtered markets for its default mode', () => {
    const event = { total_markets_count: 2, markets: [{ condition_id: 'remaining-market' }] } as any
    expect(shouldHideEventChart(event)).toBe(true)
    expect(shouldHideEventChart({ ...event, total_markets_count: 1 })).toBe(false)
    expect(shouldHideEventChart(event, { isSingleMarket: true })).toBe(false)
    expect(shouldHideEventChart({ ...event, total_markets_count: 1 }, { isSingleMarket: false })).toBe(true)
  })
})
