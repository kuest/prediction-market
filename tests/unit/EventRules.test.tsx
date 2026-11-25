import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, mock } from 'bun:test'

import type { Event } from '@/types'

import { useOrder } from '@/stores/useOrder'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  useLocale: mock(),
}))

void mock.module('next-intl', () => ({
  useExtracted: () => (message: string | { message: string }) =>
    typeof message === 'string' ? message : message.message,
  useLocale: () => mocks.useLocale(),
}))

void mock.module('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

void mock.module('@/components/ui/button', () => ({
  Button: function MockButton({ children, nativeButton: _nativeButton, render, ...props }: any) {
    return render ?? <button {...props}>{children}</button>
  },
}))

void mock.module('@/hooks/useSiteIdentity', () => ({
  useSiteIdentity: () => ({ name: 'Kuest' }),
}))

void mock.module('@/lib/uma', () => ({
  resolveUmaProposeTarget: () => null,
  buildUmaProposeUrl: () => null,
  buildUmaSettledUrl: () => null,
}))

void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/DirectResolutionButton', () => ({
  default: ({ market, resolutionSourceLabel, onResolutionRewardAmountChange }: any) => (
    <section>
      <h4>{market.is_resolved ? 'Resolution' : 'Propose resolution'}</h4>
      <span data-testid="direct-resolution-market">{market.condition_id}</span>
      <span data-testid="direct-resolution-question">{market.question}</span>
      {resolutionSourceLabel && <span>{resolutionSourceLabel}</span>}
      <button type="button" onClick={() => onResolutionRewardAmountChange?.('$4')}>
        Load reward
      </button>
    </section>
  ),
}))

const { default: SportsEventAboutPanel } =
  await import('@/app/[locale]/(platform)/sports/_components/SportsEventAboutPanel')
const { default: EventRules } = await import('@/app/[locale]/(platform)/event/[slug]/_components/EventRules')

function createEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'event-1',
    slug: 'event-1',
    title: 'Event 1',
    creator: 'Creator',
    icon_url: '',
    show_market_icons: false,
    status: 'active',
    active_markets_count: 1,
    total_markets_count: 1,
    volume: 0,
    end_date: '2026-02-10T00:00:00.000Z',
    created_at: '2026-02-05T19:25:00.000Z',
    updated_at: '2026-02-05T19:25:00.000Z',
    rules: 'Resolves according to the official source.',
    tags: [],
    main_tag: 'trending',
    is_bookmarked: false,
    is_trending: false,
    markets: [
      {
        condition_id: 'condition-1',
        outcomes: [],
      } as any,
    ],
    ...overrides,
  }
}

describe('eventRules', () => {
  beforeEach(() => {
    mocks.useLocale.mockReset()
    mocks.useLocale.mockReturnValue('en')
    useOrder.getState().reset()
  })

  it('uses clarifications from a selected sports market outside the hero rules event', () => {
    function createMarket(conditionId: string, content: string): Event['markets'][number] {
      return {
        ...createEvent().markets[0]!,
        condition_id: conditionId,
        metadata: JSON.stringify({
          market_clarifications: [{ id: 1, content, state: 'success', showInFrontend: true }],
        }),
      }
    }
    const market = createMarket('selected-prop', 'The selected prop uses the official box score.')
    const heroMarket = createMarket('hero-market', 'The hero market uses the match result.')
    render(
      <SportsEventAboutPanel
        event={createEvent({ markets: [market] })}
        rulesEvent={createEvent({ markets: [heroMarket] })}
        market={market}
      />,
    )
    expect(screen.getByText('The selected prop uses the official box score.')).toBeInTheDocument()
    expect(screen.queryByText('The hero market uses the match result.')).not.toBeInTheDocument()
  })

  it('renders the created-at label for english with the full localized timestamp', () => {
    render(<EventRules event={createEvent()} mode="inline" />)

    expect(
      screen.getByText(
        (_, node) => node?.tagName === 'P' && node.textContent === 'Created At: Feb 5, 2026, 2:25 PM ET',
      ),
    ).toBeInTheDocument()
  })

  it('renders the same english timestamp format for non-english locales', () => {
    mocks.useLocale.mockReturnValue('zh')

    render(<EventRules event={createEvent()} mode="inline" />)

    expect(
      screen.getByText(
        (_, node) => node?.tagName === 'P' && node.textContent === 'Created At: Feb 5, 2026, 2:25 PM ET',
      ),
    ).toBeInTheDocument()
  })

  it('renders the additional context block above the rules text', () => {
    render(
      <EventRules
        event={createEvent({
          additional_context: 'Abelardo de la Espriella has been added as an option to this market.',
          additional_context_updated_at: '2026-08-25T12:00:00.000Z',
        })}
        mode="inline"
      />,
    )

    expect(screen.getByText('Additional context')).toBeInTheDocument()
    expect(screen.getByText('Updated Aug 25')).toBeInTheDocument()
    expect(screen.getByText('Abelardo de la Espriella has been added as an option to this market.')).toBeInTheDocument()
  })

  it('shows only the selected market’s visible clarifications, separated below manual context', () => {
    const note = { state: 'success', showInFrontend: true, txTimestamp: '2026-11-25T00:12:00Z' }
    const firstMarket = {
      condition_id: 'condition-first',
      outcomes: [],
      metadata: JSON.stringify({ market_clarifications: [{ ...note, id: 1, content: 'First market note' }] }),
    } as any
    const secondMarket = {
      condition_id: 'condition-second',
      outcomes: [],
      metadata: JSON.stringify({
        market_clarifications: [
          { ...note, id: 2, content: 'Second market first note' },
          { ...note, id: 3, content: 'Second market next note' },
          { ...note, id: 4, content: 'Hidden note', showInFrontend: false },
          { ...note, id: 5, content: 'Unpublished note', state: 'queued' },
        ],
      }),
    } as any

    act(() => useOrder.getState().setMarket(secondMarket))
    render(
      <EventRules
        event={createEvent({
          additional_context: 'Manual event context',
          additional_context_updated_at: '2026-11-24T00:00:00Z',
          markets: [firstMarket, secondMarket],
        })}
        mode="inline"
      />,
    )

    expect(screen.getAllByText('Additional context')).toHaveLength(1)
    const panel = screen.getByText('Additional context').closest('section')!
    expect(panel).toHaveTextContent('Manual event context')
    expect(panel).toHaveTextContent('Second market first note')
    expect(panel).toHaveTextContent('Second market next note')
    expect(panel.querySelectorAll('[role="separator"]')).toHaveLength(3)
    expect(screen.getByText('Updated Nov 25')).toBeInTheDocument()
    expect(screen.queryByText('First market note')).not.toBeInTheDocument()
    expect(screen.queryByText('Hidden note')).not.toBeInTheDocument()
    expect(screen.queryByText('Unpublished note')).not.toBeInTheDocument()

    act(() => useOrder.getState().setMarket(firstMarket))
    expect(panel).toHaveTextContent('First market note')
    expect(panel).toHaveTextContent('Manual event context')
    expect(screen.queryByText('Second market first note')).not.toBeInTheDocument()
    expect(screen.queryByText('Second market next note')).not.toBeInTheDocument()
  })

  it('starts expanded with a single market note and no manual event context', () => {
    const metadata = {
      market_clarifications: [{ id: 1, state: 'success', showInFrontend: true, content: 'Only note' }],
    }
    render(
      <EventRules
        event={createEvent({
          markets: [{ condition_id: 'condition-1', outcomes: [], metadata } as any],
        })}
      />,
    )

    expect(screen.getByRole('button', { name: 'Rules & Resolution' })).toHaveAttribute('aria-expanded', 'true')
    const panel = screen.getByText('Additional context').closest('section')!
    expect(panel).toHaveTextContent('Only note')
    expect(panel.querySelectorAll('[role="separator"]')).toHaveLength(1)
  })

  it('honors a preselected route market and an explicitly selected sports market', () => {
    const note = { state: 'success', showInFrontend: true }
    const markets = [
      {
        condition_id: 'condition-first',
        outcomes: [],
        metadata: { market_clarifications: [{ ...note, id: 1, content: 'First market note' }] },
      },
      {
        condition_id: 'condition-second',
        outcomes: [],
        metadata: { market_clarifications: [{ ...note, id: 2, content: 'Second market note' }] },
      },
    ] as any
    const event = createEvent({ markets })

    const { rerender } = render(<EventRules event={event} initialMarketConditionId="condition-second" mode="inline" />)
    expect(screen.getByText('Second market note')).toBeInTheDocument()
    expect(screen.queryByText('First market note')).not.toBeInTheDocument()

    act(() => useOrder.getState().setMarket(markets[1]))
    rerender(<EventRules event={event} marketConditionId="condition-first" mode="inline" />)
    expect(screen.getByText('First market note')).toBeInTheDocument()
    expect(screen.queryByText('Second market note')).not.toBeInTheDocument()
  })

  it('shows market-specific rules once in place of the event fallback', () => {
    render(
      <EventRules
        event={createEvent({
          rules: 'General event rules.',
          markets: [
            {
              condition_id: 'condition-1',
              market_rules: 'Resolve using the market-specific official source.',
              outcomes: [],
            } as any,
          ],
        })}
        mode="inline"
      />,
    )

    expect(screen.getByText('Resolve using the market-specific official source.')).toBeInTheDocument()
    expect(screen.queryByText('General event rules.')).not.toBeInTheDocument()
  })

  it('uses the selected NegRisk market throughout rules and resolution', () => {
    const lulaMarket = {
      condition_id: 'condition-lula',
      question_id: `0x${'a'.repeat(64)}`,
      question: 'Will Trump endorse Lula da Silva for President of Brazil?',
      market_rules: 'Rules for Lula.',
      metadata: JSON.stringify({ resolution_type: 'dro_moov2' }),
      outcomes: [],
    } as any
    const zemaMarket = {
      condition_id: 'condition-zema',
      question_id: `0x${'b'.repeat(64)}`,
      question: 'Will Trump endorse Romeu Zema for President of Brazil?',
      market_rules: 'Rules for Zema.',
      metadata: JSON.stringify({ resolution_type: 'dro_moov2' }),
      outcomes: [],
    } as any
    const negRiskEvent = createEvent({
      neg_risk_market_id: `0x${'c'.repeat(64)}`,
      markets: [lulaMarket, zemaMarket],
    })

    act(() => useOrder.getState().setMarket(zemaMarket))
    render(<EventRules event={negRiskEvent} mode="inline" />)

    expect(screen.getByText('Rules for Zema.')).toBeInTheDocument()
    expect(screen.queryByText('Rules for Lula.')).not.toBeInTheDocument()
    expect(screen.getByTestId('direct-resolution-market')).toHaveTextContent('condition-zema')
    expect(screen.getByTestId('direct-resolution-question')).toHaveTextContent(
      'Will Trump endorse Romeu Zema for President of Brazil?',
    )

    act(() => useOrder.getState().setMarket(lulaMarket))

    expect(screen.getByText('Rules for Lula.')).toBeInTheDocument()
    expect(screen.queryByText('Rules for Zema.')).not.toBeInTheDocument()
    expect(screen.getByTestId('direct-resolution-market')).toHaveTextContent('condition-lula')
    expect(screen.getByTestId('direct-resolution-question')).toHaveTextContent(
      'Will Trump endorse Lula da Silva for President of Brazil?',
    )
  })

  it('starts expanded in accordion mode when additional context exists', () => {
    render(
      <EventRules
        event={createEvent({
          additional_context: 'Abelardo de la Espriella has been added as an option to this market.',
          additional_context_updated_at: '2026-08-25T12:00:00.000Z',
        })}
      />,
    )

    expect(screen.getByRole('button', { name: 'Rules & Resolution' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('re-syncs the accordion expansion when the event additional context changes', () => {
    const { rerender } = render(<EventRules event={createEvent()} />)

    expect(screen.getByRole('button', { name: 'Rules & Resolution' })).toHaveAttribute('aria-expanded', 'false')

    rerender(
      <EventRules
        event={createEvent({
          id: 'event-2',
          slug: 'event-2',
          additional_context: 'Abelardo de la Espriella has been added as an option to this market.',
          additional_context_updated_at: '2026-08-25T12:00:00.000Z',
        })}
      />,
    )

    expect(screen.getByRole('button', { name: 'Rules & Resolution' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows the resolution reward badge for an active NegRisk direct-resolution market', () => {
    render(
      <EventRules
        event={createEvent({
          markets: [
            {
              condition_id: 'condition-1',
              question_id: `0x${'a'.repeat(64)}`,
              neg_risk: true,
              neg_risk_request_id: `0x${'b'.repeat(64)}`,
              is_active: true,
              is_resolved: false,
              metadata: JSON.stringify({ resolution_type: 'dro_moov2', mirror_resolution_type: 'chainlink' }),
              condition: { resolved: false },
              outcomes: [],
            } as any,
          ],
        })}
        mode="inline"
      />,
    )

    expect(screen.getByRole('heading', { name: 'Propose resolution' })).toBeInTheDocument()
    expect(screen.getByText('Chainlink')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Propose resolution' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load reward' }))

    expect(screen.getByLabelText('Resolution reward: $4')).toBeInTheDocument()
  })

  it('hides the resolution reward badge after the market is resolved', () => {
    render(
      <EventRules
        event={createEvent({
          status: 'resolved',
          active_markets_count: 0,
          markets: [
            {
              condition_id: 'condition-1',
              question_id: `0x${'a'.repeat(64)}`,
              neg_risk: true,
              neg_risk_request_id: `0x${'b'.repeat(64)}`,
              is_active: false,
              is_resolved: true,
              metadata: JSON.stringify({ resolution_type: 'dro_moov2' }),
              condition: { resolved: true },
              outcomes: [],
            } as any,
          ],
        })}
        mode="inline"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load reward' }))

    expect(screen.queryByLabelText('Resolution reward: $4')).not.toBeInTheDocument()
  })
})
