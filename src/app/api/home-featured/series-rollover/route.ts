import { connection, NextResponse } from 'next/server'

import { resolveSupportedLocale } from '@/i18n/locales'
import { getNextHomeFeaturedSeriesRolloverEvent } from '@/lib/home-featured-events'

export async function GET(request: Request) {
  await connection()
  const { searchParams } = new URL(request.url)
  const currentEventSlug = searchParams.get('currentEventSlug')?.trim() ?? ''
  const featuredId = searchParams.get('featuredId')?.trim() ?? ''
  const locale = resolveSupportedLocale(searchParams.get('locale'))

  if (!currentEventSlug || !featuredId) {
    return NextResponse.json({ error: 'currentEventSlug and featuredId are required' }, { status: 400 })
  }

  try {
    const result = await getNextHomeFeaturedSeriesRolloverEvent(currentEventSlug, featuredId, locale)
    return NextResponse.json(result ?? { nextEvent: null }, {
      headers: {
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Failed to load the next home featured series event', error)
    return NextResponse.json({ error: 'Failed to load the next featured event' }, { status: 500 })
  }
}
