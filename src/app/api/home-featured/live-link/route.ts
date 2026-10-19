import { connection, NextResponse } from 'next/server'

import { DEFAULT_LOCALE, resolveSupportedLocale } from '@/i18n/locales'
import { HomeFeaturedEventsRepository } from '@/lib/db/queries/home-featured-events'

export async function GET(request: Request) {
  await connection()

  const { searchParams } = new URL(request.url)
  const seriesSlug = searchParams.get('seriesSlug')?.trim() ?? ''
  const locale = resolveSupportedLocale(searchParams.get('locale'))
  if (!seriesSlug) {
    return new Response('seriesSlug is required', { status: 400 })
  }

  const { data: eventSlug, error } = await HomeFeaturedEventsRepository.resolveLiveSeriesEventSlug(seriesSlug)
  if (error) {
    console.error('Failed to resolve live featured series event', error)
    return new Response('Failed to resolve featured market', { status: 500 })
  }

  const localePrefix = locale === DEFAULT_LOCALE ? '' : `/${locale}`
  const destination = new URL(
    eventSlug ? `${localePrefix}/event/${encodeURIComponent(eventSlug)}` : `${localePrefix}/predictions`,
    request.url,
  )
  const outcomeIndex = searchParams.get('outcomeIndex')
  if (eventSlug && outcomeIndex && /^\d+$/.test(outcomeIndex)) {
    destination.searchParams.set('outcomeIndex', outcomeIndex)
  }

  return NextResponse.redirect(destination, {
    status: 307,
    headers: { 'Cache-Control': 'no-store' },
  })
}
