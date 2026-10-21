'use client'

import { useQuery } from '@tanstack/react-query'
import { useExtracted, useLocale } from 'next-intl'
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'

import type { Event } from '@/types'

import EventRelatedSkeleton from '@/app/[locale]/(platform)/event/[slug]/_components/EventRelatedSkeleton'
import { useEventLastTrades } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventLastTrades'
import { useEventMarketQuotes } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventMidPrices'
import EventIconImage from '@/components/EventIconImage'
import { Button } from '@/components/ui/button'
import { useCurrentTimestamp } from '@/hooks/useCurrentTimestamp'
import {
  resolveHorizontalScrollMaskClass,
  scrollElementIntoHorizontalView,
  useHorizontalScrollShadows,
} from '@/hooks/useHorizontalScrollState'
import { useOutcomeLabel } from '@/hooks/useOutcomeLabel'
import { Link } from '@/i18n/navigation'
import {
  CRYPTO_CADENCE_ROUTES,
  isCryptoEvent,
  resolveCryptoCadenceRelatedLabel,
  resolveCryptoCadenceRouteSlug,
} from '@/lib/crypto-cadence-event'
import { resolveRelatedRoundRefreshDelay, resolveRelatedServerClockOffset } from '@/lib/event-related'
import { resolveEventPagePath } from '@/lib/events-routing'
import { resolveHomeCardDisplayPrice } from '@/lib/market-chance'
import { cn } from '@/lib/utils'

interface EventRelatedProps {
  event: Event
}

interface BackgroundStyle {
  left: number
  width: number
  height: number
  top: number
  isInitialized: boolean
}

interface RelatedEvent {
  has_live_chart: boolean
  id: string
  slug: string
  title: string
  icon_url: string
  outcome_label: string
  sports_event_slug?: string | null
  sports_sport_slug?: string | null
  sports_league_slug?: string | null
  sports_section?: 'games' | 'props' | null
  condition_id: string | null
  token_id: string | null
  end_date: string | null
}

interface RelatedEventsResult {
  events: RelatedEvent[]
  receivedAt: number
  serverClockOffsetMs: number
}

interface UseRelatedEventsParams {
  cadence?: string
  eventSlug: string
  tag?: string
  locale?: string
  enabled?: boolean
}

const INITIAL_BACKGROUND_STYLE: BackgroundStyle = {
  left: 0,
  width: 0,
  height: 0,
  top: 0,
  isInitialized: false,
}
const EMPTY_RELATED_EVENTS: RelatedEvent[] = []

async function fetchRelatedEvents(params: UseRelatedEventsParams): Promise<RelatedEventsResult> {
  const { cadence, eventSlug, tag, locale } = params

  const url = new URL(`/api/events/${eventSlug}/related`, window.location.origin)
  if (cadence) {
    url.searchParams.set('cadence', cadence)
  }
  if (tag && tag !== 'all') {
    url.searchParams.set('tag', tag)
  }
  if (locale) {
    url.searchParams.set('locale', locale)
  }

  const response = await fetch(url.toString(), { cache: 'no-store' })

  if (!response.ok) {
    throw new Error('Failed to fetch related events.')
  }

  const events = (await response.json()) as RelatedEvent[]
  const receivedAt = Date.now()
  return {
    events,
    receivedAt,
    serverClockOffsetMs: resolveRelatedServerClockOffset(response.headers.get('X-Related-Server-Time'), receivedAt),
  }
}

function useRelatedEvents(params: UseRelatedEventsParams) {
  const { cadence, eventSlug, tag = 'all', locale, enabled = true } = params

  const queryKey = ['related-events', eventSlug, cadence, tag, locale] as const

  return useQuery({
    queryKey,
    queryFn: () => fetchRelatedEvents({ cadence, eventSlug, tag, locale }),
    enabled,
    staleTime: cadence ? 0 : 30_000,
    gcTime: 300_000,
    refetchOnWindowFocus: Boolean(cadence),
    refetchInterval: cadence ? (query) => (query.state.data?.events.length ? 60_000 : 15_000) : false,
    retry: 3,
  })
}

function useTabIndicator({
  activeIndex,
  tagItemsLength,
  buttonsWrapperRef,
  buttonRef,
}: {
  activeIndex: number
  tagItemsLength: number
  buttonsWrapperRef: React.RefObject<HTMLDivElement | null>
  buttonRef: React.RefObject<(HTMLButtonElement | null)[]>
}) {
  const [backgroundStyle, dispatchBackgroundStyle] = useReducer(
    (_current: BackgroundStyle, next: BackgroundStyle) => next,
    INITIAL_BACKGROUND_STYLE,
  )

  const updateBackgroundPosition = useCallback(() => {
    if (activeIndex === -1) {
      dispatchBackgroundStyle({ ...INITIAL_BACKGROUND_STYLE })
      return
    }

    const activeButton = buttonRef.current[activeIndex]
    const container = buttonsWrapperRef.current

    if (!activeButton || !container) {
      return
    }

    requestAnimationFrame(function applyButtonRect() {
      const buttonRect = activeButton.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()

      dispatchBackgroundStyle({
        left: buttonRect.left - containerRect.left,
        width: buttonRect.width,
        height: buttonRect.height,
        top: buttonRect.top - containerRect.top,
        isInitialized: true,
      })
    })
  }, [activeIndex, buttonRef, buttonsWrapperRef])

  useEffect(
    function syncButtonRefArrayLength() {
      buttonRef.current = Array.from({ length: tagItemsLength }).map((_, index) => buttonRef.current[index] ?? null)
    },
    [buttonRef, tagItemsLength],
  )

  useLayoutEffect(
    function repositionTabIndicatorOnChange() {
      updateBackgroundPosition()
    },
    [updateBackgroundPosition, tagItemsLength, activeIndex],
  )

  return { backgroundStyle, updateBackgroundPosition }
}

export default function EventRelated({ event }: EventRelatedProps) {
  const t = useExtracted()
  const locale = useLocale()
  const normalizeOutcomeLabel = useOutcomeLabel()
  const [activeTagByEvent, setActiveTagByEvent] = useState<Record<string, string>>({})
  const cryptoCadenceRouteSlug = isCryptoEvent(event) ? resolveCryptoCadenceRouteSlug(event) : null
  const defaultActiveTag = cryptoCadenceRouteSlug ?? 'all'
  const activeTag = activeTagByEvent[event.slug] ?? defaultActiveTag

  const {
    data: relatedEventsResult,
    isLoading: loading,
    error,
    refetch,
  } = useRelatedEvents({
    cadence: cryptoCadenceRouteSlug ? activeTag : undefined,
    eventSlug: event.slug,
    tag: cryptoCadenceRouteSlug ? undefined : activeTag,
    locale,
  })
  const events = relatedEventsResult?.events ?? EMPTY_RELATED_EVENTS
  const relatedEventsReceivedAt = relatedEventsResult?.receivedAt ?? null
  const serverClockOffsetMs = relatedEventsResult?.serverClockOffsetMs ?? 0
  const currentTimestamp = useCurrentTimestamp({ intervalMs: cryptoCadenceRouteSlug ? 1_000 : false })
  const visibleEvents = useMemo(
    () =>
      cryptoCadenceRouteSlug && currentTimestamp != null
        ? events.filter(
            (candidate) =>
              candidate.end_date && Date.parse(candidate.end_date) > currentTimestamp + serverClockOffsetMs,
          )
        : events,
    [cryptoCadenceRouteSlug, currentTimestamp, events, serverClockOffsetMs],
  )
  const marketTargets = useMemo(
    () =>
      visibleEvents.flatMap((candidate) =>
        candidate.condition_id && candidate.token_id
          ? [{ conditionId: candidate.condition_id, tokenId: candidate.token_id }]
          : [],
      ),
    [visibleEvents],
  )
  const quotesByMarket = useEventMarketQuotes(marketTargets, {
    refetchIntervalMs: cryptoCadenceRouteSlug ? undefined : false,
  })
  const lastTradesByMarket = useEventLastTrades(marketTargets, cryptoCadenceRouteSlug ? undefined : false)
  const lastKnownExpiryRef = useRef<{ key: string; expiry: number } | null>(null)

  useEffect(() => {
    if (!cryptoCadenceRouteSlug) {
      lastKnownExpiryRef.current = null
      return
    }

    const refreshKey = `${event.slug}:${activeTag}`
    if (lastKnownExpiryRef.current?.key !== refreshKey) {
      lastKnownExpiryRef.current = null
    }
    const serverNow = Date.now() + serverClockOffsetMs
    const nextExpiry = Math.min(
      ...events
        .map((candidate) => (candidate.end_date ? Date.parse(candidate.end_date) : Number.POSITIVE_INFINITY))
        .filter((timestamp) => timestamp > serverNow),
    )
    if (Number.isFinite(nextExpiry)) {
      lastKnownExpiryRef.current = { key: refreshKey, expiry: nextExpiry }
    }
    const delay = resolveRelatedRoundRefreshDelay(
      events.map((candidate) => candidate.end_date),
      serverNow,
      lastKnownExpiryRef.current?.expiry ?? null,
    )
    if (delay == null) {
      return
    }

    const timeout = window.setTimeout(() => {
      void refetch()
    }, delay)
    return () => window.clearTimeout(timeout)
  }, [activeTag, cryptoCadenceRouteSlug, event.slug, events, refetch, relatedEventsReceivedAt, serverClockOffsetMs])

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const buttonsWrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<(HTMLButtonElement | null)[]>([])

  const tagItems = useMemo(() => {
    if (cryptoCadenceRouteSlug) {
      return CRYPTO_CADENCE_ROUTES.map((route) => ({
        slug: route.routeSlug,
        label: resolveCryptoCadenceRelatedLabel(route, locale),
      }))
    }

    const uniqueTags = new Map<string, string>()

    if (event.tags && event.tags.length > 0) {
      for (const tag of event.tags) {
        if (!tag.slug || uniqueTags.has(tag.slug)) {
          continue
        }

        if (tag.slug === 'hide-from-new') {
          continue
        }

        if (tag.slug === 'rewards-automation-50-4-5-50') {
          continue
        }

        const label = tag.name?.trim() || tag.slug
        uniqueTags.set(tag.slug, label)
      }
    }

    return [
      { slug: 'all', label: t('All') },
      ...Array.from(uniqueTags.entries()).map(([slug, label]) => ({
        slug,
        label,
      })),
    ]
  }, [cryptoCadenceRouteSlug, event.tags, locale, t])

  const activeIndex = useMemo(() => tagItems.findIndex((item) => item.slug === activeTag), [activeTag, tagItems])

  const { backgroundStyle, updateBackgroundPosition } = useTabIndicator({
    activeIndex,
    tagItemsLength: tagItems.length,
    buttonsWrapperRef,
    buttonRef,
  })

  const { showLeftShadow, showRightShadow } = useHorizontalScrollShadows({
    containerRef: scrollContainerRef,
    onResize: updateBackgroundPosition,
    onScroll: updateBackgroundPosition,
  })

  function handleTagClick(slug: string, index: number) {
    setActiveTagByEvent((current) => {
      const currentTag = current[event.slug] ?? defaultActiveTag
      if (currentTag === slug) {
        return current
      }

      return {
        ...current,
        [event.slug]: slug,
      }
    })

    const container = scrollContainerRef.current
    const activeButton = buttonRef.current[index]
    if (!container || !activeButton) {
      return
    }

    scrollElementIntoHorizontalView(container, activeButton)
  }

  return (
    <div className="grid w-full max-w-full gap-3">
      <div className="relative min-w-0">
        <div
          ref={scrollContainerRef}
          className={cn(
            `relative min-w-0 overflow-x-auto overflow-y-hidden px-2 pb-1 lg:w-85 lg:max-w-85`,
            resolveHorizontalScrollMaskClass({ showLeftShadow, showRightShadow }),
          )}
        >
          <div ref={buttonsWrapperRef} className="relative flex flex-nowrap items-center gap-2">
            {backgroundStyle.isInitialized && (
              <div
                className={cn(
                  `pointer-events-none absolute z-0 rounded-md bg-muted shadow-sm transition-all duration-300 ease-out`,
                )}
                style={{
                  left: `${backgroundStyle.left}px`,
                  width: `${backgroundStyle.width}px`,
                  height: `${backgroundStyle.height}px`,
                  top: `${backgroundStyle.top}px`,
                }}
              />
            )}

            {tagItems.map((item, index) => (
              <Button
                key={item.slug}
                ref={(el: HTMLButtonElement | null) => {
                  buttonRef.current[index] = el
                }}
                variant="ghost"
                size="sm"
                className={cn(
                  'relative shrink-0 px-3 whitespace-nowrap transition-none hover:bg-transparent',
                  activeTag === item.slug
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => handleTagClick(item.slug, index)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-2">
          {Array.from({ length: 3 }, (_, index) => (
            <EventRelatedSkeleton key={`skeleton-${event.slug}-${activeTag}-${index}`} />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border p-4 text-sm text-muted-foreground">
          {t('Failed to fetch related events.')}
        </div>
      ) : visibleEvents.length > 0 ? (
        <ul className="grid gap-2 lg:w-85">
          {visibleEvents.map((relatedEvent) => {
            const price = relatedEvent.condition_id
              ? resolveHomeCardDisplayPrice(
                  quotesByMarket[relatedEvent.condition_id],
                  lastTradesByMarket[relatedEvent.condition_id],
                )
              : null
            const chance = price == null ? null : price * 100
            return (
              <li key={relatedEvent.id}>
                <Link
                  href={resolveEventPagePath(relatedEvent)}
                  className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted/80"
                >
                  <EventIconImage
                    src={relatedEvent.icon_url}
                    alt={relatedEvent.title}
                    sizes="42px"
                    containerClassName="size-[42px] shrink-0 rounded-sm"
                  />
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                    <strong className="line-clamp-2 text-[13px] font-medium text-foreground">
                      {relatedEvent.title}
                    </strong>
                    <div className="flex shrink-0 items-start gap-0">
                      {relatedEvent.has_live_chart && (
                        <span className="relative mt-1.5 flex size-2">
                          <span className="sr-only">{t('Live')}</span>
                          <span
                            aria-hidden
                            className={`absolute inline-flex size-2 animate-ping rounded-full bg-red-500 opacity-75`}
                          />
                          <span aria-hidden className="relative inline-flex size-2 rounded-full bg-red-500" />
                        </span>
                      )}
                      <span className="flex min-w-13 flex-col items-end">
                        <span
                          className={cn(`text-right text-xl leading-none font-semibold text-foreground tabular-nums`)}
                        >
                          {Number.isFinite(chance) ? `${Math.round(chance ?? 0)}%` : t('—')}
                        </span>
                        {relatedEvent.outcome_label && (
                          <span className="mt-1 text-sm leading-none text-muted-foreground">
                            {normalizeOutcomeLabel(relatedEvent.outcome_label)}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="rounded-xl border p-4 text-sm text-muted-foreground">
          {t('No related events for this tag yet.')}
        </div>
      )}
    </div>
  )
}
