import type { ComponentType, ReactNode } from 'react'

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, mock } from 'bun:test'
import { lazy, Suspense } from 'react'

import type { Event, Market } from '@/types'

function createDialog(name: string) {
  return function Dialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    return (
      <div data-testid={`${name}-dialog`} data-open={open}>
        <button type="button" onClick={() => onOpenChange(false)}>{`Close ${name}`}</button>
      </div>
    )
  }
}

void mock.module('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: ComponentType<any> }>) => {
    const Component = lazy(loader)
    return function DeferredComponent(props: any) {
      return (
        <Suspense fallback={null}>
          <Component {...props} />
        </Suspense>
      )
    }
  },
}))

void mock.module('next-intl', () => ({
  useLocale: () => 'en',
  useExtracted: () => (message: string | { message: string }) =>
    typeof message === 'string' ? message : message.message,
}))

void mock.module('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
  useQuery: () => ({ data: null }),
}))
void mock.module('@/stores/useUser', () => ({ useUser: () => null }))
void mock.module('@/stores/useOrder', () => ({
  useIsSingleMarket: () => true,
  useOrder: (selector: (state: any) => unknown) => selector({ market: null }),
}))
void mock.module('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }))
void mock.module('@/hooks/useCurrentTimestamp', () => ({ useCurrentTimestamp: () => Date.now() }))
void mock.module('@/hooks/useWindowSize', () => ({ useWindowSize: () => ({ width: 1440 }) }))
void mock.module('@/hooks/useSiteIdentity', () => ({ useSiteIdentity: () => ({ name: 'Kuest' }) }))
void mock.module('@/hooks/usePublicRuntimeConfig', () => ({ usePublicRuntimeConfig: () => ({ dataApiUrl: '' }) }))
void mock.module('@/hooks/useMarketRewards', () => ({ useMarketRewards: () => ({ data: [] }) }))
void mock.module('@/hooks/usePolymarketOrderBooks', () => ({ usePolymarketOrderBooks: () => ({ data: {} }) }))
void mock.module('@/hooks/useOpenOrdersCacheInvalidation', () => ({
  useOpenOrdersCacheInvalidation: () => ({ removeOrdersFromCache: mock(), invalidateAfterCancel: mock() }),
}))
void mock.module('@/app/[locale]/(platform)/_providers/TradingOnboardingProvider', () => ({
  useTradingOnboarding: () => ({ openTradeRequirements: mock() }),
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_actions/cancel-order', () => ({ cancelOrderAction: mock() }))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_hooks/useUserOpenOrdersQuery', () => ({
  buildUserOpenOrdersQueryKey: () => [],
  useUserOpenOrdersQuery: () => ({ data: null }),
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_hooks/useOrderBookSummaries', () => ({
  useOrderBookSummaries: mock(),
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventMarketChannelProvider', () => ({
  useMarketChannelStatus: () => 'live',
  useMarketChannelSubscription: mock(),
  useOptionalMarketChannelSubscription: mock(),
  useOptionalMarketChannelLiveVolumes: () => ({ liveVolumeByCondition: {}, resetLiveVolumes: mock() }),
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_hooks/useCommentMetrics', () => ({
  useCommentMetrics: () => ({ data: { comments_count: 0 } }),
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_hooks/useLiveCommentsChannel', () => ({
  useLiveCommentsChannel: () => ({ status: 'live' }),
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventComments', () => ({
  default: () => <div>Comments content</div>,
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventFaq', () => ({ default: () => null }))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventTopHolders', () => ({
  default: () => <div>Holders content</div>,
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventActivity', () => ({
  default: () => <div>Activity content</div>,
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventTabSelector', () => ({
  default: () => null,
}))
void mock.module('@/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventChartEmbedDialog', () => ({
  default: createDialog('embed'),
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventProvideLiquidityDialog', () => ({
  default: createDialog('liquidity'),
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventChartExportDialog', () => ({
  default: createDialog('export'),
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_hooks/useEventChartAnnotations', () => ({
  useEventChartAnnotations: () => [],
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_hooks/useEventChartTradeFlow', () => ({
  useEventChartTradeFlow: () => ({ tradeFlowItems: [] }),
}))
const history = {
  normalizedHistory: [{ date: new Date('2026-01-01T00:00:00Z'), condition: 50 }],
  latestSnapshot: { condition: 50 },
  latestRawPrices: { condition: 0.5 },
  isRangeTransitioning: false,
}
void mock.module('@/app/[locale]/(platform)/event/[slug]/_hooks/useEventMarketChanceData', () => ({
  useEventMarketChanceData: () => ({ displayChanceByMarket: { condition: 50 }, yesPriceHistory: history }),
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory', () => ({
  TIME_RANGES: ['ALL'],
  buildMarketTargets: () => [],
  useEventPriceHistory: () => history,
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_hooks/useEventMidPrices', () => ({
  useEventMarketQuotes: () => ({}),
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventChartControls', () => ({
  defaultChartSettings: {
    autoscale: true,
    xAxis: true,
    yAxis: true,
    horizontalGrid: true,
    verticalGrid: false,
    annotations: false,
    bothOutcomes: false,
  },
  default: ({ onExportData }: { onExportData: () => void }) => (
    <button type="button" onClick={onExportData}>
      Export data
    </button>
  ),
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_hooks/useXTrackerTweetCount', () => ({
  useXTrackerTweetCount: () => ({ data: null }),
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventChartCanvas', () => ({ default: () => null }))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventChartHeader', () => ({ default: () => null }))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventChartLegend', () => ({ default: () => null }))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventChartLayout', () => ({
  default: ({ controls }: { controls: ReactNode }) => <div>{controls}</div>,
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventChartControlsBar', () => ({
  default: ({ onExportData }: { onExportData: () => void }) => (
    <button type="button" onClick={onExportData}>
      Export data
    </button>
  ),
}))

const { default: EventEmbed } = await import('@/app/[locale]/(platform)/event/[slug]/_components/EventEmbed')
const { default: EventTabs } = await import('@/app/[locale]/(platform)/event/[slug]/_components/EventTabs')
const { default: EventOrderBook } = await import('@/app/[locale]/(platform)/event/[slug]/_components/EventOrderBook')
const { default: EventChart } = await import('@/app/[locale]/(platform)/event/[slug]/_components/EventChart')
const { default: MarketOutcomeGraph } =
  await import('@/app/[locale]/(platform)/event/[slug]/_components/MarketOutcomeGraph')

const market = {
  condition_id: 'condition',
  title: 'Bitcoin up or down?',
  is_active: true,
  is_resolved: false,
  outcomes: [
    { outcome_index: 0, outcome_text: 'Yes', token_id: 'yes-token' },
    { outcome_index: 1, outcome_text: 'No', token_id: 'no-token' },
  ],
} as Market
const event = {
  id: 'event',
  slug: 'bitcoin-up-or-down',
  title: 'Bitcoin up or down?',
  total_markets_count: 1,
  created_at: '2026-01-01T00:00:00Z',
  tags: [],
  markets: [market],
} as Event

async function verifyDialogWrapperLifecycle(name: string, trigger: string) {
  await act(async () => {
    await Promise.resolve()
  })
  expect(screen.queryByTestId(`${name}-dialog`)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: trigger }))
  const wrapper = await screen.findByTestId(`${name}-dialog`)
  fireEvent.click(screen.getByRole('button', { name: `Close ${name}` }))
  expect(screen.getByTestId(`${name}-dialog`)).toBe(wrapper)
  expect(wrapper).toHaveAttribute('data-open', 'false')
  fireEvent.click(screen.getByRole('button', { name: trigger }))
  expect(screen.getByTestId(`${name}-dialog`)).toBe(wrapper)
  expect(wrapper).toHaveAttribute('data-open', 'true')
}

describe('event deferred content', () => {
  it('loads the embed wrapper on first open and leaves it mounted when closed', async () => {
    render(<EventEmbed event={event} />)
    await verifyDialogWrapperLifecycle('embed', 'Embed')
  })

  it('loads the liquidity wrapper on first open and leaves it mounted when closed', async () => {
    render(<EventOrderBook market={market} outcome={market.outcomes[0]} summaries={{}} eventSlug={event.slug} />)
    await verifyDialogWrapperLifecycle('liquidity', 'Provide liquidity')
  })

  it('loads the chart export wrapper on first open and leaves it mounted when closed', async () => {
    render(<EventChart event={event} isMobile={false} />)
    await verifyDialogWrapperLifecycle('export', 'Export data')
  })

  it('loads the per-market export wrapper on first open and leaves it mounted when closed', async () => {
    render(
      <MarketOutcomeGraph
        market={market}
        outcome={market.outcomes[0]}
        allMarkets={[market]}
        currentTimestamp={Date.now()}
        eventCreatedAt={event.created_at}
        isMobile={false}
      />,
    )
    await verifyDialogWrapperLifecycle('export', 'Export data')
  })

  it.each(['comments', 'holders', 'activity'] as const)(
    'only mounts secondary content for the selected %s tab',
    async (initialTab) => {
      render(<EventTabs event={event} user={null} faqItems={[]} initialTab={initialTab} />)
      await waitFor(() =>
        expect(
          screen.getByText(
            `${initialTab === 'comments' ? 'Comments' : initialTab === 'holders' ? 'Holders' : 'Activity'} content`,
          ),
        ).toBeInTheDocument(),
      )
      for (const [tab, label] of [
        ['holders', 'Holders content'],
        ['activity', 'Activity content'],
      ]) {
        if (tab !== initialTab) {
          expect(screen.queryByText(label)).not.toBeInTheDocument()
        }
      }
    },
  )
})
