import type { EventSeriesEntry } from '@/types'

const INITIAL_PAST_EVENTS = 5

function parseTimestamp(value: string | null | undefined) {
  if (!value?.trim()) {
    return null
  }

  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value
  const timestamp = Date.parse(normalized)
  return Number.isFinite(timestamp) ? timestamp : null
}

function getSeriesEventTimestamp(event: EventSeriesEntry) {
  return (
    parseTimestamp(event.end_date) ??
    parseTimestamp(event.resolved_at) ??
    parseTimestamp(event.created_at) ??
    Number.NEGATIVE_INFINITY
  )
}

export function isResolvedSeriesEvent(event: EventSeriesEntry) {
  return event.status === 'resolved' || event.status === 'archived' || parseTimestamp(event.resolved_at) !== null
}

export function selectInitialSeriesEvents(seriesEvents: EventSeriesEntry[], currentEventSlug: string) {
  const pastEvents = seriesEvents
    .filter(isResolvedSeriesEvent)
    .sort((left, right) => getSeriesEventTimestamp(right) - getSeriesEventTimestamp(left))
  const retainedPastIds = new Set([
    ...pastEvents.slice(0, INITIAL_PAST_EVENTS).map((event) => event.id),
    ...pastEvents
      .filter(
        (event) =>
          event.slug !== currentEventSlug && (event.resolved_direction === 'up' || event.resolved_direction === 'down'),
      )
      .slice(0, INITIAL_PAST_EVENTS)
      .map((event) => event.id),
  ])

  // Full history is requested when Past opens; keep every live/future round for rollover and More.
  return seriesEvents.filter(
    (event) => event.slug === currentEventSlug || !isResolvedSeriesEvent(event) || retainedPastIds.has(event.id),
  )
}
