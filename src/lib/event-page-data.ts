import { cacheTag } from 'next/cache'

import type { SupportedLocale } from '@/i18n/locales'
import type { ThemeSiteIdentity } from '@/lib/theme-site-identity'
import type { Event, EventLiveChartConfig, EventSeriesEntry } from '@/types'

import { loadMarketContextSettings } from '@/lib/ai/market-context-config'
import { cacheTags } from '@/lib/cache-tags'
import { EventRepository } from '@/lib/db/queries/event'
import { resolveSportsEventGroupPayload } from '@/lib/sports-event-group'
import { loadRuntimeThemeState } from '@/lib/theme-settings'
import 'server-only'

export interface EventPageContentData {
  event: Event
  marketContextEnabled: boolean
  seriesEvents: EventSeriesEntry[]
  liveChartConfig: EventLiveChartConfig | null
}

export interface EventPageShellData {
  route: Awaited<ReturnType<typeof getEventRouteBySlug>>
  title: string | null
  site: ThemeSiteIdentity
}

export async function resolveCanonicalEventSlugFromSportsPath(
  sportSlug: string,
  eventSlug: string,
  leagueSlug?: string | null,
) {
  const { data, error } = await EventRepository.getCanonicalEventSlugBySportsPath(sportSlug, eventSlug, leagueSlug)
  if (error || !data?.slug) {
    return null
  }

  return data.slug
}

async function getEventTitleBySlug(eventSlug: string, locale: SupportedLocale) {
  const { data } = await EventRepository.getEventTitleBySlug(eventSlug, locale)
  return data?.title ?? null
}

export async function getEventRouteBySlug(eventSlug: string) {
  const { data, error } = await EventRepository.getEventRouteBySlug(eventSlug)
  if (error || !data) {
    return null
  }

  return data
}

export async function loadEventPagePublicContentData(
  eventSlug: string,
  locale: SupportedLocale,
): Promise<EventPageContentData | null> {
  'use cache'
  cacheTag(cacheTags.event(eventSlug))

  const [marketContextSettings, eventResult] = await Promise.all([
    loadMarketContextSettings(),
    EventRepository.getEventBySlug(eventSlug, '', locale),
  ])

  const marketContextEnabled = marketContextSettings.enabled && Boolean(marketContextSettings.apiKey)

  const { data: rawEvent, error } = eventResult
  if (error || !rawEvent) {
    return null
  }

  const event = await resolveSportsEventGroupPayload(rawEvent, locale, {
    warningLabel: 'event page sports event group',
  })

  let seriesEvents: EventSeriesEntry[] = []
  let liveChartConfig: EventLiveChartConfig | null = null

  const seriesSlug = event.series_slug?.trim() ?? ''
  if (seriesSlug) {
    cacheTag(cacheTags.seriesEvents(seriesSlug))

    const [seriesEventsResult, liveChartConfigResult] = await Promise.all([
      EventRepository.getSeriesEventsBySeriesSlug(seriesSlug),
      EventRepository.getLiveChartConfigBySeriesSlug(seriesSlug),
    ])

    if (seriesEventsResult.error) {
      console.warn('Failed to load event series events:', seriesEventsResult.error)
    } else {
      seriesEvents = seriesEventsResult.data ?? []
    }

    if (liveChartConfigResult.error) {
      console.warn('Failed to load event live chart config:', liveChartConfigResult.error)
    } else {
      liveChartConfig = liveChartConfigResult.data ?? null
    }
  }

  if (seriesSlug && !seriesEvents.some((seriesEvent) => seriesEvent.slug === event.slug)) {
    seriesEvents = [
      {
        id: event.id,
        slug: event.slug,
        status: event.status,
        end_date: event.end_date,
        resolved_at: event.resolved_at ?? null,
        created_at: event.created_at,
        resolved_direction: null,
      },
      ...seriesEvents,
    ]
  }

  return {
    event,
    marketContextEnabled,
    seriesEvents,
    liveChartConfig,
  }
}

export async function loadEventPageShellData(eventSlug: string, locale: SupportedLocale): Promise<EventPageShellData> {
  const [route, title, runtimeTheme] = await Promise.all([
    getEventRouteBySlug(eventSlug),
    getEventTitleBySlug(eventSlug, locale),
    loadRuntimeThemeState(),
  ])

  return {
    route,
    title,
    site: runtimeTheme.site,
  }
}
