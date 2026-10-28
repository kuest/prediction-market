import type { Event, EventSeriesEntry, HomeFeaturedContextItem, HomeFeaturedRolloverEvent } from '@/types'

import { resolveEventOutcomePath, resolveEventPagePath } from '@/lib/events-routing'
import { isEventResolvedLike } from '@/lib/home-events'

export interface HomeFeaturedRolloverQueueState {
  contextItems: HomeFeaturedContextItem[]
  sourceContextItems: HomeFeaturedContextItem[]
  activeIndex: number
  events: HomeFeaturedRolloverEvent[]
}

export function resolveHomeFeaturedRolloverContextItems(
  queue: HomeFeaturedRolloverQueueState,
  propContextItems: HomeFeaturedContextItem[],
) {
  return queue.activeIndex >= 0 || queue.sourceContextItems === propContextItems ? queue.contextItems : propContextItems
}

export function applyHomeFeaturedRolloverResponse(
  current: HomeFeaturedRolloverQueueState,
  initialEventId: string,
  sourceContextItems: HomeFeaturedContextItem[],
  response: {
    currentEventId?: string
    contextItems?: HomeFeaturedContextItem[]
    nextEvent?: HomeFeaturedRolloverEvent | null
  },
): HomeFeaturedRolloverQueueState {
  const currentEventId = current.events[current.activeIndex]?.event.id ?? initialEventId
  const nextEvent = response.nextEvent ?? null
  if (response.currentEventId !== currentEventId) {
    if (nextEvent?.event.id !== currentEventId || current.activeIndex < 0) {
      return current
    }
    const events = current.events.slice()
    events[current.activeIndex] = nextEvent
    return { ...current, events, contextItems: nextEvent.contextItems, sourceContextItems }
  }

  return {
    ...current,
    events: replaceHomeFeaturedRolloverSuccessor(current.events, current.activeIndex, nextEvent),
    contextItems: response.contextItems ?? current.contextItems,
    sourceContextItems,
  }
}

export function replaceHomeFeaturedRolloverSuccessor(
  events: HomeFeaturedRolloverEvent[],
  activeIndex: number,
  nextEvent: HomeFeaturedRolloverEvent | null,
) {
  const retainedEvents = events.slice(0, activeIndex + 1)
  return nextEvent ? [...retainedEvents, nextEvent] : retainedEvents
}

function parseFeaturedTimestamp(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value.trim())
    ? `${value.trim().replace(' ', 'T')}Z`
    : value.trim()
  const timestamp = Date.parse(normalized)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function resolveHomeFeaturedEventEndTimestamp(event: Event) {
  const timestamps = [
    parseFeaturedTimestamp(event.end_date),
    ...event.markets.map((market) => parseFeaturedTimestamp(market.end_time)),
  ].filter((timestamp): timestamp is number => timestamp != null)

  return timestamps.length > 0 ? Math.max(...timestamps) : null
}

export function isHomeFeaturedEventEnded(event: Event, nowTimestamp: number | null) {
  if (event.status === 'resolved' || event.status === 'archived' || event.resolved_at || isEventResolvedLike(event)) {
    return true
  }

  const endTimestamp = resolveHomeFeaturedEventEndTimestamp(event)
  return endTimestamp != null && nowTimestamp != null && nowTimestamp >= endTimestamp
}

export function isHomeFeaturedEventCurrent(event: Event, nowTimestamp: number) {
  const startTimestamp = parseFeaturedTimestamp(event.start_date)
  return (startTimestamp == null || startTimestamp <= nowTimestamp) && !isHomeFeaturedEventEnded(event, nowTimestamp)
}

export function canActivateHomeFeaturedSuccessor(currentEvent: Event, nextEvent: Event, nowTimestamp: number) {
  return isHomeFeaturedEventEnded(currentEvent, nowTimestamp) && isHomeFeaturedEventCurrent(nextEvent, nowTimestamp)
}

export function resolveHomeFeaturedRolloverAction(currentEvent: Event, nextEvent: Event | null, nowTimestamp: number) {
  if (!isHomeFeaturedEventEnded(currentEvent, nowTimestamp)) {
    return 'wait' as const
  }
  if (nextEvent && isHomeFeaturedEventCurrent(nextEvent, nowTimestamp)) {
    return 'promote' as const
  }
  return nextEvent && !isHomeFeaturedEventEnded(nextEvent, nowTimestamp) ? ('wait' as const) : ('refresh' as const)
}

export function resolveHomeFeaturedRolloverWakeTimestamp(
  currentEvent: Event,
  nextEvent: Event | null,
  nowTimestamp: number,
) {
  const endTimestamp = resolveHomeFeaturedEventEndTimestamp(currentEvent)
  if (!isHomeFeaturedEventEnded(currentEvent, nowTimestamp) && endTimestamp != null && endTimestamp > nowTimestamp) {
    return endTimestamp
  }
  const nextStartTimestamp = parseFeaturedTimestamp(nextEvent?.start_date)
  return nextStartTimestamp != null && nextStartTimestamp > nowTimestamp ? nextStartTimestamp : null
}

export function isHomeFeaturedEventHref(event: Event, href: string) {
  const url = new URL(href, 'https://featured.local')
  const currentPath = resolveEventPagePath(event)
  const currentPathIndex = url.pathname.indexOf(currentPath)
  if (currentPathIndex < 0) {
    return false
  }
  const remainingPath = url.pathname.slice(currentPathIndex + currentPath.length)
  return !remainingPath || remainingPath.startsWith('/')
}

export function resolveHomeFeaturedLiveLinkFallbackHref(
  event: Event,
  href: string,
  seriesSlug: string,
  locale: string,
) {
  if (!seriesSlug || !isHomeFeaturedEventHref(event, href)) {
    return null
  }

  const url = new URL(href, 'https://featured.local')
  const eventPath = resolveEventPagePath(event)
  const marketSlug = url.pathname
    .slice(url.pathname.indexOf(eventPath) + eventPath.length)
    .split('/')
    .filter(Boolean)[0]
  const query = new URLSearchParams({ seriesSlug, locale })
  if (marketSlug) {
    query.set('marketSlug', marketSlug)
  }
  const conditionId = url.searchParams.get('conditionId')
  if (conditionId) {
    query.set('conditionId', conditionId)
  }
  const outcomeIndex = url.searchParams.get('outcomeIndex')
  if (outcomeIndex && /^\d+$/.test(outcomeIndex)) {
    query.set('outcomeIndex', outcomeIndex)
  }

  return `/api/home-featured/live-link?${query.toString()}`
}

export function shouldPreloadHomeFeaturedRollover(
  isSeries: boolean,
  isPageVisible: boolean,
  nextEvent: Event | null,
  nowTimestamp: number,
) {
  return isSeries && isPageVisible && (!nextEvent || isHomeFeaturedEventEnded(nextEvent, nowTimestamp))
}

export function resolveHomeFeaturedSuccessorHref(currentEvent: Event, nextEvent: Event, href: string) {
  if (!isHomeFeaturedEventHref(currentEvent, href)) {
    return null
  }

  const url = new URL(href, 'https://featured.local')
  const currentPath = resolveEventPagePath(currentEvent)
  const currentPathIndex = url.pathname.indexOf(currentPath)
  const remainingPath = url.pathname.slice(currentPathIndex + currentPath.length)

  const localePrefix = url.pathname.slice(0, currentPathIndex)
  const outcomeIndex = url.searchParams.get('outcomeIndex')
  if (!outcomeIndex || !/^\d+$/.test(outcomeIndex)) {
    return `${localePrefix}${resolveEventPagePath(nextEvent)}`
  }

  const marketSlug = remainingPath.split('/').filter(Boolean)[0]
  const conditionId = url.searchParams.get('conditionId')
  const currentMarket = currentEvent.markets.find(
    (market) => market.slug === marketSlug || market.condition_id === conditionId,
  )
  const nextMarkets = nextEvent.markets.filter((market) => market.is_active && !market.is_resolved)
  const currentMarketLabel =
    currentMarket?.short_title?.trim().toLowerCase() || currentMarket?.title.trim().toLowerCase()
  const matchingMarkets = currentMarket
    ? nextMarkets.filter(
        (market) =>
          (market.short_title?.trim().toLowerCase() || market.title.trim().toLowerCase()) === currentMarketLabel,
      )
    : []
  const nextMarket =
    matchingMarkets.length === 1 ? matchingMarkets[0] : nextMarkets.length === 1 ? nextMarkets[0] : null
  if (!nextMarket) {
    return null
  }

  return `${localePrefix}${resolveEventOutcomePath(nextEvent, {
    marketSlug: nextMarket.slug,
    conditionId: nextMarket.condition_id,
    outcomeIndex: Number(outcomeIndex),
  })}`
}

export function findNextHomeFeaturedSeriesEvent(
  seriesEvents: EventSeriesEntry[],
  currentEvent: Event,
  nowTimestamp: number | null = null,
) {
  const currentEndTimestamp = resolveHomeFeaturedEventEndTimestamp(currentEvent)
  if (currentEndTimestamp == null) {
    return null
  }

  const minimumEndTimestamp = nowTimestamp == null ? currentEndTimestamp : Math.max(currentEndTimestamp, nowTimestamp)
  let nextEvent: EventSeriesEntry | null = null
  let nextEndTimestamp = Number.POSITIVE_INFINITY

  for (const seriesEvent of seriesEvents) {
    if (
      seriesEvent.id === currentEvent.id ||
      seriesEvent.slug === currentEvent.slug ||
      seriesEvent.status !== 'active'
    ) {
      continue
    }

    const endTimestamp = parseFeaturedTimestamp(seriesEvent.end_date)
    if (endTimestamp == null || endTimestamp <= minimumEndTimestamp || endTimestamp >= nextEndTimestamp) {
      continue
    }

    nextEvent = seriesEvent
    nextEndTimestamp = endTimestamp
  }

  return nextEvent
}
