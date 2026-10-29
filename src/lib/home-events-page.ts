import type { SupportedLocale } from '@/i18n/locales'
import type { EventListSortBy, EventListStatusFilter } from '@/lib/event-list-filters'
import type { Event } from '@/types'

import { EventRepository } from '@/lib/db/queries/event'
import { filterHomeEvents, HOME_EVENTS_PAGE_SIZE, isSportsPrimaryHomeEvent } from '@/lib/home-events'

const HOME_EVENTS_QUERY_BATCH_SIZE = 128

interface ListHomeEventsPageOptions {
  bookmarked: boolean
  cardPayload?: boolean
  currentTimestamp?: number | null
  includeUpdatedAt?: boolean
  frequency?: 'all' | 'daily' | 'weekly' | 'monthly'
  hideCrypto?: boolean
  hideEarnings?: boolean
  hideSports?: boolean
  locale: SupportedLocale
  mainTag: string
  offset?: number
  search?: string
  sortBy?: EventListSortBy
  sportsSection?: 'games' | 'props' | ''
  sportsSportSlug?: string
  status?: EventListStatusFilter
  tag: string
  userId: string
}

interface LoadHomeEventCandidatesOptions extends Omit<
  ListHomeEventsPageOptions,
  'cardPayload' | 'currentTimestamp' | 'includeUpdatedAt'
> {}

interface LoadHomeEventBatchesOptions extends Omit<LoadHomeEventCandidatesOptions, 'offset'> {
  initialEvents?: Event[]
  initialUpdatedAt?: number
  minimumVisibleEvents?: number
  offset: number
  skipLivePricing?: boolean
}

async function loadHomeEventBatches({
  bookmarked,
  frequency = 'all',
  hideCrypto = false,
  hideEarnings = false,
  hideSports = false,
  initialEvents = [],
  initialUpdatedAt = Number.POSITIVE_INFINITY,
  locale,
  mainTag,
  minimumVisibleEvents,
  offset,
  search = '',
  skipLivePricing = false,
  sortBy,
  sportsSection = '',
  sportsSportSlug = '',
  status = 'active',
  tag,
  userId,
}: LoadHomeEventBatchesOptions) {
  let rawOffset = Math.max(0, offset)
  const accumulatedEvents = [...initialEvents]
  let updatedAt = initialUpdatedAt

  while (true) {
    const {
      data: rawEvents,
      error,
      updatedAt: batchUpdatedAt,
    } = await EventRepository.listEvents({
      tag,
      mainTag,
      search,
      skipLivePricing,
      sortBy,
      userId,
      bookmarked,
      frequency,
      status,
      offset: rawOffset,
      limit: HOME_EVENTS_QUERY_BATCH_SIZE,
      locale,
      sportsSportSlug,
      sportsSection,
      hideSports,
      hideCrypto,
      hideEarnings,
      excludeSportsAuxiliary: true,
    })

    if (error) {
      return { data: [], error, updatedAt: 0 }
    }

    updatedAt = Math.min(updatedAt, batchUpdatedAt)

    const batch = rawEvents ?? []
    if (batch.length === 0) {
      break
    }

    accumulatedEvents.push(...batch)

    if (batch.length < HOME_EVENTS_QUERY_BATCH_SIZE) {
      break
    }

    // Later rows cannot replace an already complete page without recurring series.
    // Keep one visible lookahead so hasMore remains accurate without reading the rest.
    if (
      status === 'active' &&
      minimumVisibleEvents !== undefined &&
      accumulatedEvents.length >= minimumVisibleEvents &&
      !accumulatedEvents.some((event) => Boolean(event.series_slug?.trim()) && !isSportsPrimaryHomeEvent(event)) &&
      filterHomeEvents(accumulatedEvents, {
        hideSports,
        hideCrypto,
        hideEarnings,
        status,
      }).length >= minimumVisibleEvents
    ) {
      break
    }

    rawOffset += batch.length
  }

  return {
    data: accumulatedEvents,
    error: null,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
  }
}

async function loadHomeEventCandidates({
  bookmarked,
  frequency = 'all',
  hideCrypto = false,
  hideEarnings = false,
  hideSports = false,
  locale,
  mainTag,
  offset = 0,
  search = '',
  sortBy,
  sportsSection = '',
  sportsSportSlug = '',
  status = 'active',
  tag,
  userId,
}: LoadHomeEventCandidatesOptions) {
  const targetOffset = Math.max(0, offset)
  const hasHomeVisibilityFilters = hideSports || hideCrypto || hideEarnings

  if (status === 'resolved' && !hasHomeVisibilityFilters) {
    const { data, error, updatedAt } = await EventRepository.listEvents({
      tag,
      mainTag,
      search,
      sortBy,
      userId,
      bookmarked,
      frequency,
      status,
      offset: targetOffset,
      limit: HOME_EVENTS_PAGE_SIZE + 1,
      locale,
      sportsSportSlug,
      sportsSection,
      hideSports,
      hideCrypto,
      hideEarnings,
      excludeSportsAuxiliary: true,
      preferResolvedDateOrder: true,
      skipLivePricing: true,
    })

    return {
      data: data ?? [],
      error,
      updatedAt: error ? 0 : updatedAt,
    }
  }

  if (status === 'resolved') {
    let rawOffset = 0
    const accumulatedEvents: Event[] = []
    let visibleEventsCount = 0
    let updatedAt = Number.POSITIVE_INFINITY

    while (true) {
      const {
        data: rawEvents,
        error,
        updatedAt: batchUpdatedAt,
      } = await EventRepository.listEvents({
        tag,
        mainTag,
        search,
        sortBy,
        userId,
        bookmarked,
        frequency,
        status,
        offset: rawOffset,
        limit: HOME_EVENTS_QUERY_BATCH_SIZE,
        locale,
        sportsSportSlug,
        sportsSection,
        hideSports,
        hideCrypto,
        hideEarnings,
        excludeSportsAuxiliary: true,
        preferResolvedDateOrder: true,
        skipLivePricing: true,
      })

      if (error) {
        return { data: [], error, updatedAt: 0 }
      }

      updatedAt = Math.min(updatedAt, batchUpdatedAt)

      const batch = rawEvents ?? []
      if (batch.length === 0) {
        break
      }

      accumulatedEvents.push(...batch)

      const visibleBatch = filterHomeEvents(batch, {
        hideSports,
        hideCrypto,
        hideEarnings,
        status,
      })
      visibleEventsCount += visibleBatch.length
      if (visibleEventsCount > targetOffset + HOME_EVENTS_PAGE_SIZE) {
        break
      }

      if (batch.length < HOME_EVENTS_QUERY_BATCH_SIZE) {
        break
      }

      rawOffset += HOME_EVENTS_QUERY_BATCH_SIZE
    }

    return {
      data: accumulatedEvents,
      error: null,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    }
  }

  if (status === 'active' && !hasHomeVisibilityFilters && targetOffset === 0) {
    // Only non-sports-primary recurring series can be replaced by later candidates during home filtering.
    // A page without one is already final, so avoid scanning the rest of the category.
    const {
      data: firstPage,
      error,
      updatedAt,
    } = await EventRepository.listEvents({
      tag,
      mainTag,
      search,
      sortBy,
      userId,
      bookmarked,
      frequency,
      status,
      offset: 0,
      limit: HOME_EVENTS_PAGE_SIZE + 1,
      locale,
      sportsSportSlug,
      sportsSection,
      excludeSportsAuxiliary: true,
    })

    if (error) {
      return { data: [], error, updatedAt: 0 }
    }

    const candidates = firstPage ?? []
    // The lookahead must also survive filtering before it can establish hasMore.
    const firstPageHasReplaceableSeries = candidates.some(
      (event) => Boolean(event.series_slug?.trim()) && !isSportsPrimaryHomeEvent(event),
    )

    if (candidates.length < HOME_EVENTS_PAGE_SIZE + 1 || !firstPageHasReplaceableSeries) {
      return {
        data: candidates,
        error: null,
        updatedAt,
      }
    }

    // Series selection uses event dates and resolution state, not live prices.
    // Price only the cards that survive the full scan on the public landing pages.
    const skipIntermediateLivePricing = !bookmarked && !userId && (tag === 'trending' || tag === 'crypto')
    const result = await loadHomeEventBatches({
      bookmarked,
      frequency,
      hideCrypto,
      hideEarnings,
      hideSports,
      initialEvents: candidates,
      initialUpdatedAt: updatedAt,
      locale,
      mainTag,
      offset: candidates.length,
      search,
      skipLivePricing: skipIntermediateLivePricing,
      sortBy,
      sportsSection,
      sportsSportSlug,
      status,
      tag,
      userId,
    })
    return {
      ...result,
      initiallyPricedEventIds: skipIntermediateLivePricing ? new Set(candidates.map((event) => event.id)) : null,
    }
  }

  return loadHomeEventBatches({
    bookmarked,
    frequency,
    hideCrypto,
    hideEarnings,
    hideSports,
    locale,
    mainTag,
    minimumVisibleEvents: status === 'active' ? targetOffset + HOME_EVENTS_PAGE_SIZE + 1 : undefined,
    offset: 0,
    search,
    sortBy,
    sportsSection,
    sportsSportSlug,
    status,
    tag,
    userId,
  })
}

function toHomeEventCard(event: Event): Event {
  // Detail text is not rendered by cards. Copy before trimming so repository/cache
  // objects remain complete for event pages and other consumers.
  const cardEvent = { ...event }
  delete cardEvent.rules
  delete cardEvent.additional_context
  delete cardEvent.additional_context_updated_at

  if (cardEvent.markets) {
    cardEvent.markets = cardEvent.markets.map((market) => {
      const cardMarket = { ...market }
      delete cardMarket.market_rules
      return cardMarket
    })
  }

  return cardEvent
}

export async function listHomeEventsPage({
  bookmarked,
  cardPayload = false,
  currentTimestamp,
  includeUpdatedAt = false,
  frequency = 'all',
  hideCrypto = false,
  hideEarnings = false,
  hideSports = false,
  locale,
  mainTag,
  offset = 0,
  search = '',
  sortBy,
  sportsSection = '',
  sportsSportSlug = '',
  status = 'active',
  tag,
  userId,
}: ListHomeEventsPageOptions): Promise<{
  data: Event[]
  error: string | null
  currentTimestamp: number | null
  hasMore: boolean
  updatedAt?: number
}> {
  const targetOffset = Math.max(0, offset)
  const resolvedCurrentTimestamp = currentTimestamp ?? null
  const hasHomeVisibilityFilters = hideSports || hideCrypto || hideEarnings

  const candidatesResult = await loadHomeEventCandidates({
    bookmarked,
    frequency,
    hideCrypto,
    hideEarnings,
    hideSports,
    locale,
    mainTag,
    offset,
    search,
    sortBy,
    sportsSection,
    sportsSportSlug,
    status,
    tag,
    userId,
  })
  const { data: rawEvents, error } = candidatesResult

  if (error) {
    return {
      data: [],
      error,
      currentTimestamp: resolvedCurrentTimestamp ?? null,
      hasMore: false,
      ...(includeUpdatedAt && { updatedAt: 0 }),
    }
  }

  let visibleEvents: Event[] = rawEvents ?? []

  if (status !== 'resolved' || hasHomeVisibilityFilters) {
    visibleEvents =
      visibleEvents.length > 0
        ? filterHomeEvents(visibleEvents, {
            currentTimestamp: resolvedCurrentTimestamp,
            hideSports,
            hideCrypto,
            hideEarnings,
            status,
          })
        : []
  }
  const pageStart = status === 'resolved' && !hasHomeVisibilityFilters ? 0 : targetOffset
  const pageEnd = pageStart + HOME_EVENTS_PAGE_SIZE

  let pageEvents = visibleEvents.slice(pageStart, pageEnd)
  const initiallyPricedEventIds =
    'initiallyPricedEventIds' in candidatesResult ? candidatesResult.initiallyPricedEventIds : null
  const eventsNeedingPrices = initiallyPricedEventIds
    ? pageEvents.filter((event) => !initiallyPricedEventIds.has(event.id))
    : []
  if (eventsNeedingPrices.length > 0) {
    const { data: refreshedEvents, error: refreshError } = await EventRepository.getEventsBySlugs(
      eventsNeedingPrices.map((event) => event.slug),
      userId,
      locale,
      {
        bookmarked,
        excludeSportsAuxiliary: true,
        frequency,
        hideCrypto,
        hideEarnings,
        hideSports,
        mainTag,
        search,
        sortBy,
        sportsSection,
        sportsSportSlug,
        status,
        tag,
      },
    )
    const refreshedById = new Map((refreshError ? [] : (refreshedEvents ?? [])).map((event) => [event.id, event]))
    // A selected event may have become a draft or hidden since the cached scan.
    // Never restore an ineligible event from that scan if the fresh query omits it.
    pageEvents = pageEvents
      .filter((event) => initiallyPricedEventIds?.has(event.id) || refreshedById.has(event.id))
      .map((event) => refreshedById.get(event.id) ?? event)
  }

  return {
    data: cardPayload ? pageEvents.map(toHomeEventCard) : pageEvents,
    error: null,
    currentTimestamp: resolvedCurrentTimestamp ?? null,
    hasMore: visibleEvents.length > pageEnd,
    ...(includeUpdatedAt && { updatedAt: candidatesResult.updatedAt }),
  }
}
