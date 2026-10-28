import type { EventListStatusFilter } from '@/lib/event-list-filters'

import { isSportsAuxiliaryEventSlug } from '@/lib/sports-event-slugs'

interface HomeEventVisibilityOptions {
  currentTimestamp?: number | null
  hideCrypto?: boolean
  hideEarnings?: boolean
  hideSports?: boolean
  status?: EventListStatusFilter
}

export const HOME_EVENTS_PAGE_SIZE = 32
const UTC_DAY_MS = 24 * 60 * 60 * 1000

interface HomeVisibleEventTagCandidate {
  slug?: string | null
}

interface HomeVisibleEventMarketCandidate {
  is_resolved: boolean
  end_time?: string | null
  condition?: {
    resolved?: boolean | null
  } | null
}

export interface HomeVisibleEventCandidate {
  id: number | string
  slug: string
  status: 'draft' | 'active' | 'resolved' | 'archived'
  series_slug?: string | null
  has_live_chart?: boolean
  start_date?: string | null
  sports_event_id?: string | null
  sports_event_slug?: string | null
  sports_parent_event_id?: number | string | null
  sports_series_slug?: string | null
  sports_sport_slug?: string | null
  end_date?: string | null
  created_at: string
  updated_at: string
  main_tag?: string | null
  tags?: HomeVisibleEventTagCandidate[]
  markets?: HomeVisibleEventMarketCandidate[]
}

function normalizeSeriesSlug(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase()
  return normalized || null
}

function hasSportsParentEventId(value: HomeVisibleEventCandidate['sports_parent_event_id']) {
  if (value === null || value === undefined || value === '') {
    return false
  }

  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue > 0
}

function isSportsAuxiliaryHomeEvent(event: HomeVisibleEventCandidate) {
  return (
    hasSportsParentEventId(event.sports_parent_event_id) ||
    isSportsAuxiliaryEventSlug(event.slug) ||
    isSportsAuxiliaryEventSlug(event.sports_event_slug)
  )
}

function hasTrimmedValue(value: string | null | undefined) {
  return Boolean(value?.trim())
}

export function isSportsPrimaryHomeEvent(event: HomeVisibleEventCandidate) {
  if (isSportsAuxiliaryHomeEvent(event)) {
    return false
  }

  return (
    hasTrimmedValue(event.sports_event_id) ||
    hasTrimmedValue(event.sports_event_slug) ||
    hasTrimmedValue(event.sports_series_slug) ||
    hasTrimmedValue(event.sports_sport_slug)
  )
}

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return Number.NEGATIVE_INFINITY
  }

  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value.trim())
    ? `${value.trim().replace(' ', 'T')}Z`
    : value.trim()
  const timestamp = Date.parse(normalized)
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY
}

export function resolveHomeLiveSeriesStartTimestamp(event: HomeVisibleEventCandidate) {
  return toTimestamp(event.start_date)
}

export function resolveHomeLiveSeriesEndTimestamp(event: HomeVisibleEventCandidate) {
  const endTimestamps = [
    toTimestamp(event.end_date),
    ...(event.markets ?? []).map((market) => toTimestamp(market.end_time)),
  ]
  return Math.max(...endTimestamps)
}

export function isCurrentHomeLiveSeriesEvent(event: HomeVisibleEventCandidate, nowMs: number) {
  const startTimestamp = resolveHomeLiveSeriesStartTimestamp(event)
  return (
    event.status === 'active' &&
    !isEventResolvedLike(event) &&
    startTimestamp <= nowMs &&
    nowMs < resolveHomeLiveSeriesEndTimestamp(event)
  )
}

function isMoreRecentEvent<T extends HomeVisibleEventCandidate>(candidate: T, current: T) {
  const candidateCreatedAt = toTimestamp(candidate.created_at)
  const currentCreatedAt = toTimestamp(current.created_at)

  if (candidateCreatedAt !== currentCreatedAt) {
    return candidateCreatedAt > currentCreatedAt
  }

  const candidateUpdatedAt = toTimestamp(candidate.updated_at)
  const currentUpdatedAt = toTimestamp(current.updated_at)

  if (candidateUpdatedAt !== currentUpdatedAt) {
    return candidateUpdatedAt > currentUpdatedAt
  }

  return candidate.id > current.id
}

export function isEventResolvedLike<T extends Pick<HomeVisibleEventCandidate, 'status' | 'markets'>>(event: T) {
  if (event.status === 'resolved') {
    return true
  }

  if (!event.markets || event.markets.length === 0) {
    return false
  }

  return event.markets.every((market) => market.is_resolved || market.condition?.resolved === true)
}

function isOverdueUnresolved<T extends HomeVisibleEventCandidate>(event: T, nowMs: number) {
  const endTimestamp = toTimestamp(event.end_date)
  return !isEventResolvedLike(event) && Number.isFinite(endTimestamp) && endTimestamp < nowMs
}

function isSameUtcDay(leftTimestamp: number, rightTimestamp: number) {
  return (
    Number.isFinite(leftTimestamp) &&
    Number.isFinite(rightTimestamp) &&
    Math.floor(leftTimestamp / UTC_DAY_MS) === Math.floor(rightTimestamp / UTC_DAY_MS)
  )
}

function isPreferredSeriesEvent<T extends HomeVisibleEventCandidate>(candidate: T, current: T, nowMs: number) {
  if (candidate.has_live_chart && current.has_live_chart) {
    const candidateCurrent = isCurrentHomeLiveSeriesEvent(candidate, nowMs)
    const currentCurrent = isCurrentHomeLiveSeriesEvent(current, nowMs)
    if (candidateCurrent !== currentCurrent) {
      return candidateCurrent
    }

    const candidateEnd = resolveHomeLiveSeriesEndTimestamp(candidate)
    const currentEnd = resolveHomeLiveSeriesEndTimestamp(current)
    const candidateNotEnded = candidateEnd > nowMs
    const currentNotEnded = currentEnd > nowMs
    if (candidateNotEnded !== currentNotEnded) {
      return candidateNotEnded
    }
    if (candidateEnd !== currentEnd) {
      return candidateNotEnded ? candidateEnd < currentEnd : candidateEnd > currentEnd
    }
    return isMoreRecentEvent(candidate, current)
  }

  const candidateEnd = toTimestamp(candidate.end_date)
  const currentEnd = toTimestamp(current.end_date)
  const candidateHasFutureEnd = candidateEnd >= nowMs
  const currentHasFutureEnd = currentEnd >= nowMs
  const candidateResolved = isEventResolvedLike(candidate)
  const currentResolved = isEventResolvedLike(current)
  const candidateOverdueUnresolved = isOverdueUnresolved(candidate, nowMs)
  const currentOverdueUnresolved = isOverdueUnresolved(current, nowMs)

  if (candidateOverdueUnresolved && currentOverdueUnresolved) {
    if (candidateEnd !== currentEnd) {
      return candidateEnd > currentEnd
    }

    return isMoreRecentEvent(candidate, current)
  }

  if (candidateHasFutureEnd && currentHasFutureEnd) {
    if (candidateResolved !== currentResolved) {
      return !candidateResolved
    }

    if (candidateEnd !== currentEnd) {
      return candidateEnd < currentEnd
    }

    return isMoreRecentEvent(candidate, current)
  }

  if (candidateHasFutureEnd !== currentHasFutureEnd) {
    if (candidateHasFutureEnd && currentOverdueUnresolved && isSameUtcDay(currentEnd, nowMs)) {
      return false
    }

    if (currentHasFutureEnd && candidateOverdueUnresolved && isSameUtcDay(candidateEnd, nowMs)) {
      return true
    }

    return candidateHasFutureEnd
  }

  if (candidateOverdueUnresolved !== currentOverdueUnresolved) {
    return candidateOverdueUnresolved
  }

  if (candidateResolved !== currentResolved) {
    return !candidateResolved
  }

  if (candidateEnd !== currentEnd) {
    return candidateEnd > currentEnd
  }

  return isMoreRecentEvent(candidate, current)
}

export function filterHomeEvents<T extends HomeVisibleEventCandidate>(
  events: T[],
  options: HomeEventVisibilityOptions = {},
) {
  if (events.length === 0) {
    return events
  }

  const {
    currentTimestamp = null,
    hideCrypto = false,
    hideEarnings = false,
    hideSports = false,
    status = 'active',
  } = options

  const eventsMatchingTagFilters = events.filter((event) => {
    if (isSportsAuxiliaryHomeEvent(event)) {
      return false
    }

    const tagSlugs = new Set<string>()

    if (event.main_tag) {
      tagSlugs.add(event.main_tag.toLowerCase())
    }

    for (const tag of event.tags ?? []) {
      if (tag?.slug) {
        tagSlugs.add(tag.slug.toLowerCase())
      }
    }

    const slugs = Array.from(tagSlugs)
    const hasSportsTag = slugs.some((slug) => slug.includes('sport'))
    const hasCryptoTag = slugs.some((slug) => slug.includes('crypto'))
    const hasEarningsTag = slugs.some((slug) => slug.includes('earning'))

    if (hideSports && hasSportsTag) {
      return false
    }

    if (hideCrypto && hasCryptoTag) {
      return false
    }

    return !(hideEarnings && hasEarningsTag)
  })

  if (status === 'resolved') {
    return eventsMatchingTagFilters.filter((event) => isEventResolvedLike(event))
  }

  const activeSeriesCandidates =
    status === 'all'
      ? eventsMatchingTagFilters.filter((event) => !isEventResolvedLike(event))
      : eventsMatchingTagFilters

  const newestBySeriesSlug = new Map<string, T>()

  for (const event of activeSeriesCandidates) {
    if (isSportsPrimaryHomeEvent(event)) {
      continue
    }

    const seriesSlug = normalizeSeriesSlug(event.series_slug)
    if (!seriesSlug) {
      continue
    }

    const currentNewest = newestBySeriesSlug.get(seriesSlug)
    const shouldReplaceCurrentNewest =
      currentTimestamp == null
        ? !currentNewest || isMoreRecentEvent(event, currentNewest)
        : !currentNewest || isPreferredSeriesEvent(event, currentNewest, currentTimestamp)

    if (shouldReplaceCurrentNewest) {
      newestBySeriesSlug.set(seriesSlug, event)
    }
  }

  if (newestBySeriesSlug.size === 0) {
    return eventsMatchingTagFilters
  }

  return eventsMatchingTagFilters.filter((event) => {
    if (status === 'all' && isEventResolvedLike(event)) {
      return true
    }

    const seriesSlug = normalizeSeriesSlug(event.series_slug)
    if (!seriesSlug) {
      return true
    }

    if (isSportsPrimaryHomeEvent(event)) {
      return true
    }

    return (
      newestBySeriesSlug.get(seriesSlug)?.id === event.id &&
      (status !== 'active' ||
        !event.has_live_chart ||
        currentTimestamp == null ||
        resolveHomeLiveSeriesEndTimestamp(event) > currentTimestamp)
    )
  })
}
