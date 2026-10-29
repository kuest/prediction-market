import { NextResponse } from 'next/server'

import type { SportsVertical } from '@/lib/sports-vertical'

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@/i18n/locales'
import { DEFAULT_ERROR_MESSAGE } from '@/lib/constants'
import { EventRepository } from '@/lib/db/queries/event'
import { UserRepository } from '@/lib/db/queries/user'
import { isEventListSortBy, isEventListStatusFilter } from '@/lib/event-list-filters'
import { listHomeEventsPage } from '@/lib/home-events-page'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tag = searchParams.get('tag') || 'trending'
  const mainTag = searchParams.get('mainTag') || ''
  const search = searchParams.get('search') || ''
  const bookmarked = searchParams.get('bookmarked') === 'true'
  const includeBookmarkState = searchParams.get('includeBookmarkState') !== 'false'
  const frequency = searchParams.get('frequency') || 'all'
  const hideSports = searchParams.get('hideSports') === 'true'
  const hideCrypto = searchParams.get('hideCrypto') === 'true'
  const hideEarnings = searchParams.get('hideEarnings') === 'true'
  const homeFeed = searchParams.get('homeFeed') === 'true'
  const cardPayload = searchParams.get('cardPayload') === 'true'
  const includePageInfo = searchParams.get('includePageInfo') === 'true'
  const statusParam = searchParams.get('status')
  const status = statusParam ?? 'active'
  const sportsSportSlug = searchParams.get('sportsSportSlug') || ''
  const sportsVerticalParam = searchParams.get('sportsVertical') || ''
  const sportsVertical: SportsVertical | '' =
    sportsVerticalParam === 'sports' || sportsVerticalParam === 'esports' ? sportsVerticalParam : ''
  const sportsSectionParam = searchParams.get('sportsSection') || ''
  const sportsSection = sportsSectionParam.trim().toLowerCase()
  const sortParam = searchParams.get('sort')
  const sortBy = isEventListSortBy(sortParam) ? sortParam : undefined
  const currentTimestampParam = Number.parseInt(searchParams.get('currentTimestamp') || '', 10)
  const currentTimestamp = Number.isNaN(currentTimestampParam) ? null : currentTimestampParam
  const localeParam = searchParams.get('locale') ?? DEFAULT_LOCALE
  const locale = SUPPORTED_LOCALES.includes(localeParam as (typeof SUPPORTED_LOCALES)[number])
    ? (localeParam as (typeof SUPPORTED_LOCALES)[number])
    : DEFAULT_LOCALE
  const offset = Number.parseInt(searchParams.get('offset') || '0', 10)
  const clampedOffset = Number.isNaN(offset) ? 0 : Math.max(0, offset)
  const limitParam = Number.parseInt(searchParams.get('limit') || '', 10)
  const limit = Number.isNaN(limitParam) ? undefined : Math.max(1, limitParam)

  if (!isEventListStatusFilter(status)) {
    return NextResponse.json({ error: 'Invalid status filter.' }, { status: 400 })
  }

  if (frequency !== 'all' && frequency !== 'daily' && frequency !== 'weekly' && frequency !== 'monthly') {
    return NextResponse.json({ error: 'Invalid frequency filter.' }, { status: 400 })
  }

  if (sportsSection && sportsSection !== 'games' && sportsSection !== 'props') {
    return NextResponse.json({ error: 'Invalid sports section filter.' }, { status: 400 })
  }

  const shouldResolveCurrentUser = bookmarked || includeBookmarkState
  const user = shouldResolveCurrentUser ? await UserRepository.getCurrentUser({ minimal: true }) : null
  const userId = user?.id

  try {
    if (bookmarked && !userId) {
      return NextResponse.json([])
    }

    if (homeFeed) {
      const {
        data: events,
        error,
        hasMore,
      } = await listHomeEventsPage({
        cardPayload,
        tag,
        mainTag,
        search,
        sortBy,
        userId: userId ?? '',
        bookmarked,
        frequency: frequency === 'daily' || frequency === 'weekly' || frequency === 'monthly' ? frequency : 'all',
        status,
        offset: clampedOffset,
        currentTimestamp,
        locale,
        hideSports,
        hideCrypto,
        hideEarnings,
      })

      if (error) {
        return NextResponse.json({ error: DEFAULT_ERROR_MESSAGE }, { status: 500 })
      }

      return NextResponse.json(includePageInfo ? { events, hasMore } : events)
    }

    const { data: events, error } = await EventRepository.listEvents({
      tag,
      mainTag,
      search,
      sortBy,
      userId,
      bookmarked,
      frequency,
      status,
      offset: clampedOffset,
      limit,
      locale,
      hideSports,
      hideCrypto,
      hideEarnings,
      sportsVertical,
      sportsSportSlug,
      sportsSection: sportsSection === 'games' || sportsSection === 'props' ? sportsSection : '',
    })

    if (error) {
      return NextResponse.json({ error: DEFAULT_ERROR_MESSAGE }, { status: 500 })
    }

    return NextResponse.json(events)
  } catch (error) {
    console.error('API Error:', error)
    return NextResponse.json({ error: DEFAULT_ERROR_MESSAGE }, { status: 500 })
  }
}
