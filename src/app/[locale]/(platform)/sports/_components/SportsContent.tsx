'use cache'

import { cacheLife, cacheTag } from 'next/cache'

import type { SportsVertical } from '@/lib/sports-vertical'
import type { Event } from '@/types'

import SportsClient from '@/app/[locale]/(platform)/sports/_components/SportsClient'
import { getRootLocale } from '@/i18n/root-locale'
import { cacheTags } from '@/lib/cache-tags'
import { EventRepository } from '@/lib/db/queries/event'

type SportsPageMode = 'all' | 'live' | 'futures'
type SportsSection = 'games' | 'props'

interface SportsContentProps {
  initialTag?: string
  mainTag?: string
  initialMode?: SportsPageMode
  sportsSportSlug?: string | null
  sportsSection?: SportsSection | null
}

export default async function SportsContent({
  initialTag = 'sports',
  mainTag = initialTag,
  initialMode = 'all',
  sportsSportSlug = null,
  sportsSection = null,
}: SportsContentProps) {
  cacheTag(cacheTags.eventsList)
  const locale = await getRootLocale()

  const normalizedSportsSportSlug = sportsSportSlug?.trim().toLowerCase() || ''
  const normalizedSportsSection = sportsSection?.trim().toLowerCase() || ''
  const sportsVertical: SportsVertical | '' = initialTag === 'sports' || initialTag === 'esports' ? initialTag : ''
  const resolvedSportsSection: SportsSection | '' =
    normalizedSportsSection === 'games' || normalizedSportsSection === 'props' ? normalizedSportsSection : ''

  let initialEvents: Event[] = []
  let hasQueryError = false
  try {
    const { data: events, error } = await EventRepository.listEvents({
      tag: initialTag,
      search: '',
      userId: '',
      bookmarked: false,
      locale,
      sportsVertical,
      sportsSportSlug: normalizedSportsSportSlug,
      sportsSection: resolvedSportsSection,
    })

    hasQueryError = Boolean(error)
    if (!hasQueryError) {
      initialEvents = events ?? []
    }
  } catch {
    hasQueryError = true
  }

  if (hasQueryError || initialEvents.length > 0) {
    cacheLife('hours')
  } else {
    cacheLife('days')
  }

  return (
    <SportsClient
      initialEvents={initialEvents}
      initialTag={initialTag}
      mainTag={mainTag}
      initialMode={initialMode}
      sportsVertical={sportsVertical || null}
      sportsSportSlug={normalizedSportsSportSlug || null}
      sportsSection={resolvedSportsSection || null}
    />
  )
}
