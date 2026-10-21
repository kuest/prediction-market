import { connection, NextResponse } from 'next/server'

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@/i18n/locales'
import { DEFAULT_ERROR_MESSAGE } from '@/lib/constants'
import { resolveCryptoCadenceRoute } from '@/lib/crypto-cadence-event'
import { EventRepository } from '@/lib/db/queries/event'
import { bucketRelatedEventsTimestamp } from '@/lib/event-related'

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  await connection()
  const { slug } = await params
  const { searchParams } = new URL(request.url)
  const cadenceSlug = searchParams.get('cadence') ?? undefined
  const tagSlug = searchParams.get('tag') ?? undefined
  const localeParam = searchParams.get('locale') ?? DEFAULT_LOCALE
  const locale = SUPPORTED_LOCALES.includes(localeParam as (typeof SUPPORTED_LOCALES)[number])
    ? (localeParam as (typeof SUPPORTED_LOCALES)[number])
    : DEFAULT_LOCALE
  const currentTimestamp = bucketRelatedEventsTimestamp(Date.now(), Boolean(resolveCryptoCadenceRoute(cadenceSlug)))

  try {
    const { data: events, error } = await EventRepository.getRelatedEventsBySlug(slug, {
      cadenceSlug,
      tagSlug: tagSlug ?? undefined,
      locale,
      currentTimestamp,
    })
    if (error) {
      return NextResponse.json({ error: DEFAULT_ERROR_MESSAGE }, { status: 500 })
    }

    const response = NextResponse.json(events)
    response.headers.set('X-Related-Server-Time', String(Date.now()))
    return response
  } catch (error) {
    console.error('API Error:', error)
    return NextResponse.json({ error: DEFAULT_ERROR_MESSAGE }, { status: 500 })
  }
}
