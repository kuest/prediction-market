'use client'

import dynamic from 'next/dynamic'

import type { Event, EventLiveChartConfig, EventSeriesEntry } from '@/types'

import { Skeleton } from '@/components/ui/skeleton'
import { useIsMobile } from '@/hooks/useIsMobile'

import { shouldUseLiveSeriesChart } from '../_utils/eventLiveSeriesChartEligibility'

const EventChart = dynamic(() => import('./EventChart'), {
  loading: () => <Skeleton className="h-96 w-full" />,
})

const EventLiveSeriesChart = dynamic(() => import('./EventLiveSeriesChart'), {
  loading: () => <Skeleton className="h-96 w-full" />,
})

interface EventChartSectionProps {
  event: Event
  seriesEvents?: EventSeriesEntry[]
  liveChartConfig?: EventLiveChartConfig | null
}

export default function EventChartSection({
  event,
  seriesEvents = [],
  liveChartConfig = null,
}: EventChartSectionProps) {
  const isMobile = useIsMobile()

  if (liveChartConfig && shouldUseLiveSeriesChart(event, liveChartConfig)) {
    return (
      <EventLiveSeriesChart event={event} isMobile={isMobile} seriesEvents={seriesEvents} config={liveChartConfig} />
    )
  }

  return <EventChart event={event} isMobile={isMobile} seriesEvents={seriesEvents} />
}
