import type { Event, EventSeriesEntry, HomeFeaturedContextItem, HomeFeaturedRolloverEvent } from '@/types'

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
