'use client'

import dynamic from 'next/dynamic'

import type { Event, EventLiveChartConfig } from '@/types'

import EventSingleMarketOrderBook from '@/app/[locale]/(platform)/event/[slug]/_components/EventSingleMarketOrderBook'
import { shouldUseLiveSeriesChart } from '@/app/[locale]/(platform)/event/[slug]/_utils/eventLiveSeriesChartEligibility'
import { Skeleton } from '@/components/ui/skeleton'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useUser } from '@/stores/useUser'

const EventMarkets = dynamic(() => import('@/app/[locale]/(platform)/event/[slug]/_components/EventMarkets'), {
  loading: () => <Skeleton className="h-52" />,
})

const EventMarketPositions = dynamic(
  () => import('@/app/[locale]/(platform)/event/[slug]/_components/EventMarketPositions'),
  { ssr: false, loading: () => <Skeleton className="h-52" /> },
)

const EventMarketOpenOrders = dynamic(
  () => import('@/app/[locale]/(platform)/event/[slug]/_components/EventMarketOpenOrders'),
  { ssr: false, loading: () => <Skeleton className="h-52" /> },
)

const EventMarketHistory = dynamic(
  () => import('@/app/[locale]/(platform)/event/[slug]/_components/EventMarketHistory'),
  { ssr: false, loading: () => <Skeleton className="h-52" /> },
)

interface EventMarketsSectionProps {
  event: Event
  liveChartConfig?: EventLiveChartConfig | null
}

export default function EventMarketsSection({ event, liveChartConfig = null }: EventMarketsSectionProps) {
  const isMobile = useIsMobile()
  const user = useUser()
  const singleMarket = event.markets[0]
  const isNegRiskEnabled = Boolean(event.enable_neg_risk || event.neg_risk)
  const isSingleMarketResolved = Boolean(singleMarket?.is_resolved || singleMarket?.condition?.resolved)
  const usesLiveSeriesChart = Boolean(liveChartConfig && shouldUseLiveSeriesChart(event, liveChartConfig))

  if (event.total_markets_count > 1) {
    return (
      <div id="event-markets" className="min-w-0 overflow-x-hidden lg:overflow-x-visible">
        <EventMarkets event={event} isMobile={isMobile} />
      </div>
    )
  }

  if (!singleMarket) {
    return <div id="event-markets" className="min-w-0 overflow-x-hidden lg:overflow-x-visible" />
  }

  return (
    <>
      <div id="event-markets" className="min-w-0 overflow-x-hidden lg:overflow-x-visible" />
      <div className="grid gap-6">
        {user && (
          <EventMarketPositions
            market={singleMarket}
            isNegRiskEnabled={isNegRiskEnabled}
            isNegRiskAugmented={Boolean(event.neg_risk_augmented)}
            eventOutcomes={event.markets.map((market) => ({
              conditionId: market.condition_id,
              questionId: market.question_id,
              label: market.short_title || market.title,
              iconUrl: market.icon_url,
            }))}
            negRiskMarketId={event.neg_risk_market_id}
          />
        )}
        {!isSingleMarketResolved && (
          <EventSingleMarketOrderBook
            market={singleMarket}
            eventSlug={event.slug}
            showCompactVolume={usesLiveSeriesChart}
          />
        )}
        {user && <EventMarketOpenOrders market={singleMarket} eventSlug={event.slug} />}
        {user && <EventMarketHistory market={singleMarket} />}
      </div>
    </>
  )
}
