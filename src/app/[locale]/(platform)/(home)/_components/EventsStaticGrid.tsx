import type { MouseEvent } from 'react'

import { useLocale } from 'next-intl'

import type { Event } from '@/types'

import EventCard from '@/app/[locale]/(platform)/(home)/_components/EventCard'
import { resolveHomeLiveSeriesEndTimestamp } from '@/lib/home-events'
import { isHomeFeaturedEventHref, resolveHomeFeaturedLiveLinkFallbackHref } from '@/lib/home-featured-rollover'
import { cn } from '@/lib/utils'

interface EventsStaticGridProps {
  events: Event[]
  priceOverridesByMarket: Record<string, number>
  maxColumns?: number
  isFetching?: boolean
  currentTimestamp?: number | null
}

export function getStaticGridColumnsClassName(maxColumns?: number) {
  const normalizedMaxColumns = Number.isFinite(maxColumns) ? Math.max(1, Math.floor(maxColumns as number)) : 4

  if (normalizedMaxColumns === 1) {
    return 'grid-cols-1'
  }

  if (normalizedMaxColumns === 2) {
    return 'grid-cols-1 md:grid-cols-2'
  }

  if (normalizedMaxColumns === 3) {
    return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
  }

  return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
}

function handleCardClickCapture(clickEvent: MouseEvent<HTMLDivElement>, event: Event, locale: string) {
  if (!event.has_live_chart || !event.series_slug?.trim()) {
    return
  }
  const endTimestamp = resolveHomeLiveSeriesEndTimestamp(event)
  if (!Number.isFinite(endTimestamp) || Date.now() < endTimestamp) {
    return
  }
  const anchor = (clickEvent.target as Element).closest<HTMLAnchorElement>('a[href]')
  if (!anchor || !isHomeFeaturedEventHref(event, anchor.href)) {
    return
  }
  const fallbackHref = resolveHomeFeaturedLiveLinkFallbackHref(event, anchor.href, event.series_slug, locale)
  if (fallbackHref) {
    anchor.href = fallbackHref
    clickEvent.stopPropagation()
    return
  }
  clickEvent.preventDefault()
  clickEvent.stopPropagation()
}

export default function EventsStaticGrid({
  events,
  priceOverridesByMarket,
  maxColumns,
  isFetching = false,
  currentTimestamp = null,
}: EventsStaticGridProps) {
  const locale = useLocale()

  return (
    <div className={cn('grid gap-3', getStaticGridColumnsClassName(maxColumns), { 'opacity-80': isFetching })}>
      {events.map((event) => (
        <div
          key={event.id}
          data-home-event-id={String(event.id)}
          onClickCapture={(clickEvent) => handleCardClickCapture(clickEvent, event, locale)}
        >
          <EventCard
            event={event}
            priceOverridesByMarket={priceOverridesByMarket}
            enableHomeSportsMoneylineLayout
            currentTimestamp={currentTimestamp}
          />
        </div>
      ))}
    </div>
  )
}
