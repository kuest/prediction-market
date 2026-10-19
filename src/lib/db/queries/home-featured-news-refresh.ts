import { and, eq, gt, sql } from 'drizzle-orm'

import { home_featured_event_context_items } from '@/lib/db/schema/events/tables'
import { settings } from '@/lib/db/schema/settings/tables'
import { db } from '@/lib/drizzle'
import { HOME_FEATURED_NEWS_TTL_MS } from '@/lib/home-featured-settings'

const REFRESH_MARKER_GROUP = 'cache'
const REFRESH_MARKER_KEY = 'home_featured_news_refreshes'

function parseRefreshExpirations(value: string | undefined): Record<string, number> {
  try {
    return Object.fromEntries(
      Object.entries(JSON.parse(value ?? '{}') ?? {}).filter(
        ([, expiresAt]) => typeof expiresAt === 'number' && Number.isFinite(expiresAt),
      ),
    ) as Record<string, number>
  } catch {
    return {}
  }
}

export async function claimHomeFeaturedNewsRefresh(featuredEventId: string, eventId: string, locale: string) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`home-featured-news-event:${eventId}`}, 0))`,
    )

    const [existing] = await tx
      .select({ id: home_featured_event_context_items.id })
      .from(home_featured_event_context_items)
      .where(
        and(
          eq(home_featured_event_context_items.featured_event_id, featuredEventId),
          eq(home_featured_event_context_items.event_id, eventId),
          eq(home_featured_event_context_items.locale, locale),
          eq(home_featured_event_context_items.item_type, 'news'),
          gt(home_featured_event_context_items.expires_at, new Date()),
        ),
      )
      .limit(1)
    if (existing) {
      return false
    }

    // The marker is shared across events, so serialize its read-modify-write separately.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${REFRESH_MARKER_KEY}, 0))`)

    const markerFilter = and(
      eq(settings.group, REFRESH_MARKER_GROUP),
      eq(settings.key, REFRESH_MARKER_KEY),
    )
    const [marker] = await tx.select({ value: settings.value }).from(settings).where(markerFilter).limit(1)
    const now = Date.now()
    const expirations = parseRefreshExpirations(marker?.value)
    const eventRefreshKey = `rollover-event:${eventId}`
    const hasRecentLocaleRefresh = Object.entries(expirations).some(
      ([key, expiresAt]) => key.includes(`:${eventId}:`) && expiresAt > now,
    )

    if ((expirations[eventRefreshKey] ?? 0) > now || hasRecentLocaleRefresh) {
      return false
    }

    const nextExpirations = Object.fromEntries(
      Object.entries(expirations).filter(([, expiresAt]) => expiresAt > now),
    )
    const expiresAt = now + HOME_FEATURED_NEWS_TTL_MS
    nextExpirations[eventRefreshKey] = expiresAt
    nextExpirations[`${featuredEventId}:${eventId}:${locale}`] = expiresAt
    const value = JSON.stringify(nextExpirations)

    if (marker) {
      await tx.update(settings).set({ value }).where(markerFilter)
    } else {
      await tx.insert(settings).values({ group: REFRESH_MARKER_GROUP, key: REFRESH_MARKER_KEY, value })
    }

    return true
  })
}
