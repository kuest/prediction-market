import { connection } from 'next/server'

import { DEFAULT_LOCALE, resolveSupportedLocale } from '@/i18n/locales'
import { HomeFeaturedEventsRepository } from '@/lib/db/queries/home-featured-events'
import { resolveEventOutcomePath } from '@/lib/events-routing'

export async function GET(request: Request) {
  await connection()

  const { searchParams } = new URL(request.url)
  const seriesSlug = searchParams.get('seriesSlug')?.trim() ?? ''
  const locale = resolveSupportedLocale(searchParams.get('locale'))
  if (!seriesSlug) {
    return new Response('seriesSlug is required', { status: 400 })
  }

  const { data: target, error } = await HomeFeaturedEventsRepository.resolveLiveSeriesDestination(
    seriesSlug,
    searchParams.get('marketSlug')?.trim() || null,
    searchParams.get('conditionId')?.trim() || null,
  )
  if (error) {
    console.error('Failed to resolve live featured series event', error)
    return new Response('Failed to resolve featured market', { status: 500 })
  }

  const localePrefix = locale === DEFAULT_LOCALE ? '' : `/${locale}`
  const outcomeIndex = searchParams.get('outcomeIndex')
  const selectedOutcomeIndex = outcomeIndex && /^\d+$/.test(outcomeIndex) ? Number(outcomeIndex) : null
  const eventPath = target
    ? target.conditionId && selectedOutcomeIndex !== null
      ? resolveEventOutcomePath(
          { slug: target.eventSlug },
          {
            marketSlug: target.marketSlug,
            conditionId: target.conditionId,
            outcomeIndex: selectedOutcomeIndex,
          },
        )
      : `/event/${encodeURIComponent(target.eventSlug)}`
    : '/predictions'
  return new Response(null, {
    status: 307,
    headers: {
      Location: `${localePrefix}${eventPath}`,
      'Cache-Control': 'no-store',
    },
  })
}
