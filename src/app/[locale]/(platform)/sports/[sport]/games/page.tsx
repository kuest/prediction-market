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
  return getPublicShellStaticParams({ sport: STATIC_PARAMS_PLACEHOLDER })
}

async function generateCachedMetadata(sport: string) {
  'use cache'
  cacheLife('max')
  cacheTag(cacheTags.settings, cacheTags.sportsMenu)

  return await generateSportsVerticalSectionMetadata({
    sport,
    vertical: 'sports',
    section: 'games',
  })
}

export async function generateMetadata({ params }: PageProps<'/[locale]/sports/[sport]/games'>): Promise<Metadata> {
  const { sport } = await params

  return await generateCachedMetadata(sport)
}

async function renderCachedPage(sport: string) {
  'use cache'
  cacheTag(cacheTags.eventsList, cacheTags.sportsMenu)

  const result = await renderSportsVerticalSectionPageWithState({
    sport,
    vertical: 'sports',
    section: 'games',
  })
  if (result.hasEvents === false) {
    cacheLife('days')
  } else {
    cacheLife('hours')
  }

  return result.content
}

export default async function SportsGamesBySportPage({ params }: PageProps<'/[locale]/sports/[sport]/games'>) {
  const { sport } = await params

  return await renderCachedPage(sport)
}
