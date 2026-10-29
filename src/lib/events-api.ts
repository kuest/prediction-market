import type { EventListSortBy, EventListStatusFilter } from '@/lib/event-list-filters'
import type { SportsVertical } from '@/lib/sports-vertical'
import type { Event } from '@/types'

type EventListFrequency = 'all' | 'daily' | 'weekly' | 'monthly'

export interface BuildEventsApiSearchParamsOptions {
  tag: string
  locale: string
  bookmarked?: boolean
  currentTimestamp?: number | null
  frequency?: EventListFrequency
  hideCrypto?: boolean
  hideEarnings?: boolean
  hideSports?: boolean
  homeFeed?: boolean
  mainTag?: string
  offset?: number
  search?: string
  sort?: EventListSortBy
  sportsSection?: 'games' | 'props' | '' | null
  sportsSportSlug?: string | null
  sportsVertical?: SportsVertical | '' | null
  status?: EventListStatusFilter
  signal?: AbortSignal
}

function buildEventsApiSearchParams({
  tag,
  locale,
  bookmarked = false,
  currentTimestamp = null,
  frequency = 'all',
  hideCrypto = false,
  hideEarnings = false,
  hideSports = false,
  homeFeed = false,
  mainTag,
  offset = 0,
  search = '',
  sort,
  sportsSection = null,
  sportsSportSlug = null,
  sportsVertical = null,
  status = 'active',
}: BuildEventsApiSearchParamsOptions) {
  const params = new URLSearchParams({
    tag,
    bookmarked: String(bookmarked),
    frequency,
    status,
    offset: offset.toString(),
    locale,
  })

  const normalizedMainTag = mainTag?.trim()
  if (normalizedMainTag) {
    params.set('mainTag', normalizedMainTag)
  }

  const normalizedSearch = search.trim()
  if (normalizedSearch) {
    params.set('search', normalizedSearch)
  }

  if (homeFeed) {
    params.set('homeFeed', 'true')
  }

  if (typeof currentTimestamp === 'number' && Number.isFinite(currentTimestamp)) {
    params.set('currentTimestamp', currentTimestamp.toString())
  }

  if (sort) {
    params.set('sort', sort)
  }

  if (hideSports) {
    params.set('hideSports', 'true')
  }

  if (hideCrypto) {
    params.set('hideCrypto', 'true')
  }

  if (hideEarnings) {
    params.set('hideEarnings', 'true')
  }

  const normalizedSportsSportSlug = sportsSportSlug?.trim()
  if (normalizedSportsSportSlug) {
    params.set('sportsSportSlug', normalizedSportsSportSlug)
  }

  if (sportsSection === 'games' || sportsSection === 'props') {
    params.set('sportsSection', sportsSection)
  }

  if (sportsVertical === 'sports' || sportsVertical === 'esports') {
    params.set('sportsVertical', sportsVertical)
  }

  return params
}

export async function fetchEventsApi(options: BuildEventsApiSearchParamsOptions): Promise<Event[]> {
  const params = buildEventsApiSearchParams(options)
  const response = await fetch(`/api/events?${params.toString()}`, { signal: options.signal })

  if (!response.ok) {
    throw new Error('Failed to fetch events')
  }

  return response.json()
}

export interface HomeEventsApiPage {
  events: Event[]
  hasMore: boolean
}

export async function fetchHomeEventsPageApi(options: BuildEventsApiSearchParamsOptions): Promise<HomeEventsApiPage> {
  const params = buildEventsApiSearchParams({ ...options, homeFeed: true })
  params.set('includePageInfo', 'true')
  params.set('cardPayload', 'true')
  const response = await fetch(`/api/events?${params.toString()}`, { signal: options.signal })

  if (!response.ok) {
    throw new Error('Failed to fetch home feed events')
  }

  const payload = await response.json()
  return {
    events: Array.isArray(payload?.events) ? payload.events : [],
    hasMore: payload?.hasMore === true,
  }
}
