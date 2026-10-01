import type { Metadata } from 'next'

import { cacheLife, cacheTag } from 'next/cache'

import {
  generateSportsVerticalSectionMetadata,
  renderSportsVerticalSectionPageWithState,
} from '@/app/[locale]/(platform)/sports/_utils/sports-section-page'
import { cacheTags } from '@/lib/cache-tags'
import { getPublicShellStaticParams, STATIC_PARAMS_PLACEHOLDER } from '@/lib/static-params'

export const instant = false

export async function generateStaticParams() {
  return getPublicShellStaticParams({
    sport: STATIC_PARAMS_PLACEHOLDER,
    week: STATIC_PARAMS_PLACEHOLDER,
  })
}

async function generateCachedMetadata(sport: string, week: string) {
  'use cache'
  cacheLife('max')
  cacheTag(cacheTags.settings, cacheTags.sportsMenu)

  return await generateSportsVerticalSectionMetadata({
    sport,
    week,
    vertical: 'esports',
    section: 'games',
  })
}

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/esports/[sport]/games/week/[week]'>): Promise<Metadata> {
  const { sport, week } = await params

  return await generateCachedMetadata(sport, week)
}

async function renderCachedPage(sport: string, week: string) {
  'use cache'
  cacheTag(cacheTags.eventsList, cacheTags.sportsMenu)

  const result = await renderSportsVerticalSectionPageWithState({
    sport,
    week,
    vertical: 'esports',
    section: 'games',
  })
  if (result.hasEvents === false) {
    cacheLife('days')
  } else {
    cacheLife('hours')
  }

  return result.content
}

export default async function EsportsGamesBySportWeekPage({
  params,
}: PageProps<'/[locale]/esports/[sport]/games/week/[week]'>) {
  const { sport, week } = await params

  return await renderCachedPage(sport, week)
}
