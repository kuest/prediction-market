import { and, eq } from 'drizzle-orm'
import { connection, NextResponse } from 'next/server'

import { EventRepository } from '@/lib/db/queries/event'
import { events } from '@/lib/db/schema/events/tables'
import { db } from '@/lib/drizzle'

export async function GET(request: Request) {
  await connection()
  const eventSlug = new URL(request.url).searchParams.get('eventSlug')?.trim() ?? ''
  if (!eventSlug || eventSlug.length > 512) {
    return NextResponse.json({ error: 'A valid eventSlug is required' }, { status: 400 })
  }

  try {
    const [event] = await db
      .select({ series_slug: events.series_slug })
      .from(events)
      .where(and(eq(events.slug, eventSlug), eq(events.is_hidden, false)))
      .limit(1)

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const seriesSlug = event.series_slug?.trim()
    if (!seriesSlug) {
      return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } })
    }

    const { data, error } = await EventRepository.getSeriesEventsBySeriesSlug(seriesSlug)
    if (error) {
      throw error
    }

    return NextResponse.json(data ?? [], { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('Failed to load event series history', error)
    return NextResponse.json({ error: 'Failed to load event series history' }, { status: 500 })
  }
}
