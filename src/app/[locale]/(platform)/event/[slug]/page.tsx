import type { Metadata } from 'next'

import { cacheLife, cacheTag } from 'next/cache'
import { notFound } from 'next/navigation'

import EventContent from '@/app/[locale]/(platform)/event/[slug]/_components/EventContent'
import EventStructuredData from '@/components/seo/EventStructuredData'
import { redirect } from '@/i18n/navigation'
import { getRootLocale } from '@/i18n/root-locale'
import { cacheTags } from '@/lib/cache-tags'
import { buildTranslatedEventFaqItems } from '@/lib/event-faq-server'
import { buildEventPageMetadata } from '@/lib/event-open-graph'
import { PUBLIC_EVENT_PAGE_CACHE_LIFE } from '@/lib/event-page-cache'
import { getEventRouteBySlug, loadEventPagePublicContentData } from '@/lib/event-page-data'
import { resolveEventBasePath, resolveEventPagePath } from '@/lib/events-routing'
import {
  getPublicShellStaticParams,
  shouldBypassPublicShellPlaceholder,
  STATIC_PARAMS_PLACEHOLDER,
} from '@/lib/static-params'
import { loadRuntimeThemeState } from '@/lib/theme-settings'

export const instant = false

export async function generateStaticParams() {
  return getPublicShellStaticParams({ slug: STATIC_PARAMS_PLACEHOLDER })
}

export async function generateMetadata({ params }: PageProps<'/[locale]/event/[slug]'>): Promise<Metadata> {
  const { slug } = await params
  const locale = await getRootLocale()
  if (slug === STATIC_PARAMS_PLACEHOLDER) {
    if (shouldBypassPublicShellPlaceholder(slug)) {
      return {}
    }
    notFound()
  }
  return await buildEventPageMetadata({
    eventSlug: slug,
    locale,
  })
}

async function CachedEventPageContent({ slug }: { slug: string }) {
  'use cache'
  cacheLife(PUBLIC_EVENT_PAGE_CACHE_LIFE)

  const locale = await getRootLocale()
  cacheTag(cacheTags.event(slug))

  const eventRoute = await getEventRouteBySlug(slug)
  if (!eventRoute) {
    notFound()
  }

  const sportsPath = resolveEventBasePath(eventRoute)
  if (sportsPath) {
    redirect({
      href: sportsPath,
      locale,
    })
  }

  const [eventPageData, runtimeTheme] = await Promise.all([
    loadEventPagePublicContentData(slug, locale),
    loadRuntimeThemeState(),
  ])
  if (!eventPageData) {
    notFound()
  }
  const seriesSlug = eventPageData.event.series_slug?.trim() ?? ''
  if (seriesSlug) {
    cacheTag(cacheTags.seriesEvents(seriesSlug))
  }

  const faqItems = await buildTranslatedEventFaqItems({
    event: eventPageData.event,
    siteName: runtimeTheme.site.name,
    locale,
  })

  return (
    <>
      <EventStructuredData
        event={eventPageData.event}
        pagePath={resolveEventPagePath(eventPageData.event)}
        site={runtimeTheme.site}
        faqItems={faqItems}
      />
      <EventContent
        event={eventPageData.event}
        faqItems={faqItems}
        marketContextEnabled={eventPageData.marketContextEnabled}
        seriesEvents={eventPageData.seriesEvents}
        liveChartConfig={eventPageData.liveChartConfig}
        key={`is-bookmarked-${eventPageData.event.is_bookmarked}`}
      />
    </>
  )
}

export default async function EventPage({ params }: PageProps<'/[locale]/event/[slug]'>) {
  const { slug } = await params
  if (slug === STATIC_PARAMS_PLACEHOLDER) {
    if (shouldBypassPublicShellPlaceholder(slug)) {
      return null
    }
    notFound()
  }

  return <CachedEventPageContent slug={slug} />
}
