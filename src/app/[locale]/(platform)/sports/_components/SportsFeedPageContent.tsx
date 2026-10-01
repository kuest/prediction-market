import { cacheLife, cacheTag } from 'next/cache'

import type { SportsVertical } from '@/lib/sports-vertical'

import SportsGamesCenter from '@/app/[locale]/(platform)/sports/_components/SportsGamesCenter'
import { buildSportsGamesCards } from '@/app/[locale]/(platform)/sports/_utils/sports-games-data'
import { getRootLocale } from '@/i18n/root-locale'
import { cacheTags } from '@/lib/cache-tags'
import { hasDatabaseEnv } from '@/lib/db/env'
import { EventRepository } from '@/lib/db/queries/event'
import { SportsMenuRepository } from '@/lib/db/queries/sports-menu'

type SportsFeedPageMode = 'liveAndSoon' | 'soon'
const SPORTS_FEED_PAGE_DATA_CACHE_VERSION = 2

interface SportsFeedPageContentProps {
  pageMode: SportsFeedPageMode
  sportSlug: string
  sportTitle: string
  vertical: SportsVertical
}

async function loadSportsFeedPageData({
  cacheVersion = SPORTS_FEED_PAGE_DATA_CACHE_VERSION,
  databaseEnvAvailable,
  pageMode,
  vertical,
}: {
  cacheVersion?: number
  databaseEnvAvailable: boolean
  pageMode: SportsFeedPageMode
  vertical: SportsVertical
}) {
  'use cache'
  cacheTag(cacheTags.eventsList, cacheTags.sportsMenu)
  const locale = await getRootLocale()

  if (!databaseEnvAvailable) {
    cacheLife('hours')
    return {
      cards: [],
      categoryTitleBySlug: {},
    }
  }

  const { cards, categoryTitleBySlug, hasQueryError } = await (async () => {
    try {
      const [{ data: feedEvents, error: feedError }, { data: layoutData, error: layoutError }] = await Promise.all([
        EventRepository.listSportsFeedEvents({
          cacheVersion,
          locale,
          mode: pageMode,
          sportsVertical: vertical,
        }),
        SportsMenuRepository.getLayoutData(vertical),
      ])
      let events = feedEvents ?? []
      let hasQueryError = Boolean(feedError || layoutError)
      if (!feedEvents?.length) {
        const fallback = await EventRepository.listEvents({
          tag: vertical,
          sportsVertical: vertical,
          search: '',
          userId: '',
          bookmarked: false,
          status: 'active',
          limit: 128,
          locale,
          sportsSection: 'games',
          excludeSportsAuxiliary: true,
        })
        events = fallback.data ?? []
        hasQueryError = hasQueryError || Boolean(fallback.error)
      }

      return {
        cards: buildSportsGamesCards(events),
        categoryTitleBySlug: layoutData?.h1TitleBySlug ?? {},
        hasQueryError,
      }
    } catch {
      return { cards: [], categoryTitleBySlug: {}, hasQueryError: true }
    }
  })()
  if (hasQueryError || cards.length > 0) {
    cacheLife('hours')
  } else {
    cacheLife('days')
  }

  return {
    cards,
    categoryTitleBySlug,
  }
}

export default async function SportsFeedPageContent({
  pageMode,
  sportSlug,
  sportTitle,
  vertical,
}: SportsFeedPageContentProps) {
  const { cards, categoryTitleBySlug } = await loadSportsFeedPageData({
    cacheVersion: SPORTS_FEED_PAGE_DATA_CACHE_VERSION,
    databaseEnvAvailable: hasDatabaseEnv(),
    pageMode,
    vertical,
  })

  return (
    <div key={`${vertical}-${sportSlug}-page`} className="contents">
      <SportsGamesCenter
        cards={cards}
        sportSlug={sportSlug}
        sportTitle={sportTitle}
        pageMode={pageMode}
        categoryTitleBySlug={categoryTitleBySlug}
        vertical={vertical}
      />
    </div>
  )
}
