'use client'

import type { ComponentProps, CSSProperties, MouseEvent } from 'react'

import { ChevronLeftIcon, ChevronRightIcon, FlameIcon } from 'lucide-react'
import { useExtracted, useLocale } from 'next-intl'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import { forwardRef, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import type {
  LinePickerMarketType,
  SportsLinePickerOption,
} from '@/app/[locale]/(platform)/sports/_components/_sports-games-center/sports-games-center-types'
import type { SportsGamesButton, SportsGamesCard } from '@/app/[locale]/(platform)/sports/_utils/sports-games-data'
import type { HomeFeaturedRolloverQueueState } from '@/lib/home-featured-rollover'
import type {
  HomeFeaturedContextItem,
  HomeFeaturedEventCard,
  HomeFeaturedHotTopic,
  HomeFeaturedOutcomeSummary,
  HomeFeaturedRolloverEvent,
  HomeFeaturedSideCardSettings,
  Market,
} from '@/types'

import IntentPrefetchLink from '@/app/[locale]/(platform)/_components/IntentPrefetchLink'
import EventBookmark from '@/app/[locale]/(platform)/event/[slug]/_components/EventBookmark'
import EventMarketChannelProvider from '@/app/[locale]/(platform)/event/[slug]/_components/EventMarketChannelProvider'
import EventShare from '@/app/[locale]/(platform)/event/[slug]/_components/EventShare'
import { getFeaturedChartEvent } from '@/app/[locale]/(platform)/event/[slug]/_utils/EventChartUtils'
import { shouldUseLiveSeriesChart } from '@/app/[locale]/(platform)/event/[slug]/_utils/eventLiveSeriesChartEligibility'
import {
  buildLinePickerOptions,
  resolveSportsGraphSelection,
} from '@/app/[locale]/(platform)/sports/_components/_sports-games-center/sports-games-center-utils'
import {
  formatSportsEventLocalStartLabels,
  formatSportsEventStartLabels,
} from '@/app/[locale]/(platform)/sports/_components/sports-event-center-utils'
import { buildSportsGamesCards } from '@/app/[locale]/(platform)/sports/_utils/sports-games-data'
import EventIconImage from '@/components/EventIconImage'
import HomeFeaturedSideCardIcon from '@/components/HomeFeaturedSideCardIcon'
import SiteLogoIcon from '@/components/SiteLogoIcon'
import { Button } from '@/components/ui/button'
import { useHasHydrated } from '@/hooks/useHasHydrated'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useOutcomeLabel } from '@/hooks/useOutcomeLabel'
import { useSiteIdentity } from '@/hooks/useSiteIdentity'
import { Link } from '@/i18n/navigation'
import { getAvatarPlaceholderStyle, shouldUseAvatarPlaceholder } from '@/lib/avatar'
import { ensureReadableTextColorOnDark } from '@/lib/color-contrast'
import { resolveCryptoCadenceEventPresentation } from '@/lib/crypto-cadence-event'
import { resolveEventOutcomePath, resolveEventPagePath } from '@/lib/events-routing'
import { formatDollarValueLabel, formatVolume } from '@/lib/formatters'
import {
  localizeHomeEventCardTitle,
  localizeHomeFeaturedMarketDates,
  resolveHomeFeaturedFullLidTitleValues,
} from '@/lib/home-featured-localization'
import {
  applyHomeFeaturedRolloverResponse,
  canActivateHomeFeaturedSuccessor,
  getHomeFeaturedRolloverPreloadDelay,
  isHomeFeaturedEventHref,
  isHomeFeaturedEventEnded,
  isHomeFeaturedEventCurrent,
  resolveHomeFeaturedLiveLinkFallbackHref,
  resolveHomeFeaturedSuccessorHref,
  resolveHomeFeaturedRolloverWakeTimestamp,
  resolveHomeFeaturedRolloverContextItems,
  resolveHomeFeaturedRolloverAction,
  resolveHomeFeaturedEventEndTimestamp,
  shouldPreloadHomeFeaturedRollover,
} from '@/lib/home-featured-rollover'
import {
  DEFAULT_HOME_FEATURED_SIDE_CARD_TEXT,
  DEFAULT_HOME_FEATURED_SIDE_CARD_TITLE,
} from '@/lib/home-featured-settings'
import { resolveHomeFeaturedSportsScoreboardContent } from '@/lib/home-featured-sports-score'
import { resolveSportsTeamFallbackClassName } from '@/lib/sports-team-colors'
import {
  preserveSportsButtonPeriodSuffix,
  resolveCompactSportsTeamNames,
  resolveSportsButtonPeriodSuffix,
} from '@/lib/sports-team-label'
import { cn } from '@/lib/utils'

interface HomeFeaturedEventsCarouselProps {
  items: HomeFeaturedEventCard[]
  hotTopics: HomeFeaturedHotTopic[]
  currentTimestamp: number | null
  sideCard: HomeFeaturedSideCardSettings
}

const HOME_FEATURED_CHART_HEIGHT = 292
const HOME_FEATURED_CHART_HEIGHT_OFFSET = 20
const HOME_FEATURED_LIVE_CHART_WIDTH_OFFSET = 24
const HOME_FEATURED_ROLLOVER_RETRY_MS = 60_000
const FEATURED_SPORTS_BUTTON_DARK_TEXT_VAR = '--featured-sports-button-dark-text'

function subscribeToFeaturedVisibility(listener: () => void) {
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}

function getFeaturedVisibilitySnapshot() {
  return document.visibilityState === 'visible'
}

function getFeaturedVisibilityServerSnapshot() {
  return true
}

const HomeEventChart = dynamic(() => import('@/app/[locale]/(platform)/event/[slug]/_components/EventChart'), {
  ssr: false,
  loading: () => <div className="h-full min-h-60 w-full animate-pulse rounded-md bg-muted/20" aria-hidden="true" />,
})

interface FeaturedViewportStore {
  getServerSnapshot: () => boolean
  getSnapshot: () => boolean
  setNode: (node: HTMLElement | null) => void
  subscribe: (listener: () => void) => () => void
}

function createFeaturedViewportStore(): FeaturedViewportStore {
  let node: HTMLElement | null = null
  let snapshot = false
  let observer: IntersectionObserver | null = null
  let mediaQuery: MediaQueryList | null = null
  const listeners = new Set<() => void>()

  function notify() {
    listeners.forEach((listener) => listener())
  }

  function setSnapshot(nextSnapshot: boolean) {
    if (snapshot === nextSnapshot) {
      return
    }

    snapshot = nextSnapshot
    notify()
  }

  function disconnect() {
    observer?.disconnect()
    observer = null
    mediaQuery?.removeEventListener('change', observe)
    mediaQuery = null
  }

  function observe() {
    disconnect()

    if (!node || typeof window === 'undefined') {
      setSnapshot(false)
      return
    }

    mediaQuery = window.matchMedia?.('(min-width: 768px)') ?? null
    if (mediaQuery && !mediaQuery.matches) {
      setSnapshot(false)
      mediaQuery.addEventListener('change', observe)
      return
    }

    if (typeof IntersectionObserver === 'undefined') {
      setSnapshot(true)
      mediaQuery?.addEventListener('change', observe)
      return
    }

    setSnapshot(false)
    observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) {
          return
        }

        setSnapshot(true)
        observer?.disconnect()
        observer = null
      },
      { rootMargin: '480px 0px' },
    )
    observer.observe(node)
    mediaQuery?.addEventListener('change', observe)
  }

  function subscribe(listener: () => void) {
    listeners.add(listener)
    if (listeners.size === 1) {
      observe()
    }

    return function unsubscribe() {
      listeners.delete(listener)
      if (listeners.size === 0) {
        disconnect()
      }
    }
  }

  function setNode(nextNode: HTMLElement | null) {
    node = nextNode
    if (listeners.size > 0) {
      observe()
    }
  }

  function getSnapshot() {
    return snapshot
  }

  function getServerSnapshot() {
    return false
  }

  return { getServerSnapshot, getSnapshot, setNode, subscribe }
}

type FeaturedSportsButtonTone = 'home' | 'away' | 'draw' | 'neutral'
interface FeaturedSportsButtonMarket {
  key: string
  conditionId: string
  label: string
  tone: FeaturedSportsButtonTone
  color: string | null
}

const HomeSportsGameGraph = dynamic(
  () => import('@/app/[locale]/(platform)/sports/_components/_sports-games-center/SportsGameGraph'),
  { ssr: false, loading: () => <div className="min-h-60 w-full md:min-h-[260px] lg:min-h-[280px]" /> },
)

const HomeEventLiveSeriesChart = dynamic(
  () => import('@/app/[locale]/(platform)/event/[slug]/_components/EventLiveSeriesChart'),
  { ssr: false, loading: () => <div className="min-h-60 w-full md:min-h-[260px] lg:min-h-[280px]" /> },
)

function preloadFeaturedChunk(loader: () => Promise<unknown>) {
  void loader().catch(() => undefined)
}

function useElementWidth<T extends HTMLElement>(enabled = true) {
  const [element, setElement] = useState<T | null>(null)

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!enabled || !element) {
        return function noopElementWidthSubscription() {}
      }

      function notifyElementWidthChange() {
        onStoreChange()
      }

      if (typeof ResizeObserver === 'undefined') {
        window.addEventListener('resize', notifyElementWidthChange)

        return function removeElementWidthResizeListener() {
          window.removeEventListener('resize', notifyElementWidthChange)
        }
      }

      const observer = new ResizeObserver(notifyElementWidthChange)
      observer.observe(element)

      return function disconnectElementWidthObserver() {
        observer.disconnect()
      }
    },
    [enabled, element],
  )

  const getSnapshot = useCallback(() => {
    if (!enabled || !element) {
      return undefined
    }

    const nextWidth = Math.round(element.getBoundingClientRect().width)
    if (!Number.isFinite(nextWidth) || nextWidth <= 0) {
      return undefined
    }

    return nextWidth
  }, [enabled, element])

  const width = useSyncExternalStore(subscribe, getSnapshot, () => undefined)

  const ref = useCallback(
    (node: T | null) => {
      if (!enabled) {
        setElement((currentElement) => (currentElement === null ? currentElement : null))
        return
      }

      setElement((currentElement) => (currentElement === node ? currentElement : node))
    },
    [enabled],
  )

  return [ref, width] as const
}

function formatChancePercent(chance: number) {
  return `${Math.round(chance)}%`
}

function normalizeText(value: string | null | undefined) {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ') ?? ''
  )
}

function isNegativeOutcomeLabel(label: string) {
  const normalized = normalizeText(label)
  return /\b(?:no|down|below|lower|under)\b/.test(normalized)
}

function shouldUseLiveFeaturedOutcomeColors(item: HomeFeaturedEventCard) {
  if (!item.liveChartConfig || !shouldUseLiveSeriesChart(item.event, item.liveChartConfig)) {
    return false
  }

  const [upOutcome, downOutcome] = item.topOutcomes
  return Boolean(
    upOutcome && downOutcome && !isNegativeOutcomeLabel(upOutcome.label) && isNegativeOutcomeLabel(downOutcome.label),
  )
}

function resolveNeutralSportsButtonAppearance() {
  return {
    className: `
      border border-button-outline-border bg-transparent text-muted-foreground
      hover:bg-secondary/80 hover:text-foreground
    `,
    style: undefined,
    backgroundClassName: undefined,
    backgroundStyle: undefined,
  }
}

function resolveFilledNeutralSportsButtonAppearance() {
  return {
    className: `
      border border-border bg-border text-foreground
      hover:brightness-95
    `,
    style: undefined,
    backgroundClassName: undefined,
    backgroundStyle: undefined,
  }
}

function resolveSportsButtonAppearance(market: FeaturedSportsButtonMarket) {
  if (market.tone === 'draw') {
    return resolveNeutralSportsButtonAppearance()
  }

  if (market.tone === 'neutral') {
    const normalizedLabel = normalizeText(market.label)
    if (normalizedLabel.startsWith('u ') || normalizedLabel.includes(' under')) {
      return {
        className: 'group/team-button text-no hover:bg-transparent hover:text-white',
        style: undefined,
        backgroundClassName: 'bg-no',
        backgroundStyle: undefined,
      }
    }
    if (normalizedLabel.startsWith('o ') || normalizedLabel.includes(' over')) {
      return {
        className: 'group/team-button text-yes hover:bg-transparent hover:text-white',
        style: undefined,
        backgroundClassName: 'bg-yes',
        backgroundStyle: undefined,
      }
    }

    return resolveNeutralSportsButtonAppearance()
  }

  if (market.color) {
    const darkTextColor = ensureReadableTextColorOnDark(market.color)

    return {
      className: `
        group/team-button hover:bg-transparent hover:!text-white
        dark:!text-[var(--featured-sports-button-dark-text)] dark:hover:!text-white
      `,
      style: {
        color: market.color,
        [FEATURED_SPORTS_BUTTON_DARK_TEXT_VAR]: darkTextColor ?? market.color,
      } as CSSProperties,
      backgroundClassName: undefined,
      backgroundStyle: { backgroundColor: market.color },
    }
  }

  return {
    className: 'group/team-button text-foreground hover:bg-transparent hover:text-primary-foreground',
    style: undefined,
    backgroundClassName: resolveSportsTeamFallbackClassName(market.tone === 'home' ? 'team1' : 'team2'),
    backgroundStyle: undefined,
  }
}

function resolveLiveFeaturedOutcomeAppearance(item: HomeFeaturedEventCard, index: number) {
  if (!shouldUseLiveFeaturedOutcomeColors(item)) {
    return null
  }

  if (index === 0) {
    const color = item.liveChartConfig?.line_color?.trim()
    if (!color) {
      return null
    }

    const appearance = resolveSportsButtonAppearance({
      key: 'featured-live-up',
      conditionId: '',
      label: 'Up',
      tone: 'home',
      color,
    })

    return {
      ...appearance,
      className: `!border-0 ${appearance.className}`,
    }
  }

  if (index === 1) {
    return {
      className: '!border-0 !bg-secondary/75 text-muted-foreground hover:!bg-[#7A828C] hover:!text-foreground',
      style: undefined,
      backgroundClassName: undefined,
      backgroundStyle: undefined,
    }
  }

  return null
}

function toTitleCase(value: string) {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

function normalizePathSlug(value: string | null | undefined) {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-') || null
  )
}

function isExternalHref(href: string) {
  return /^https?:\/\//i.test(href)
}

function requiresDocumentNavigation(href: string) {
  return /^\/docs(?:[/?#]|$)/i.test(href)
}

function resolveFeaturedBreadcrumbItems(item: HomeFeaturedEventCard) {
  const event = item.event
  const mainCategory = event.tags.find((tag) => tag.isMainCategory) ?? null
  const mainSlug =
    normalizePathSlug(mainCategory?.slug ?? null) ??
    normalizePathSlug(event.main_tag) ??
    (item.kind === 'sports' ? 'sports' : null)

  if (item.kind === 'sports') {
    const sportsBasePath = mainSlug === 'esports' ? '/esports' : '/sports'
    const sportsSlug = normalizePathSlug(event.sports_sport_slug)
    const sportHref = sportsSlug ? `${sportsBasePath}/${sportsSlug}/games` : sportsBasePath

    return [
      {
        label: mainCategory?.name || event.main_tag || (mainSlug === 'esports' ? 'Esports' : 'Sports'),
        href: sportsBasePath,
      },
      ...(sportsSlug ? [{ label: toTitleCase(sportsSlug), href: sportHref }] : []),
    ]
  }

  if (!mainSlug) {
    return []
  }

  const secondaryTag = event.tags.find((tag) => !tag.isMainCategory && normalizePathSlug(tag.slug) !== mainSlug) ?? null
  const recurrence = normalizePathSlug(event.series_recurrence)
  const secondarySlug = normalizePathSlug(secondaryTag?.slug ?? null) ?? recurrence
  const secondaryLabel = secondaryTag?.name || (recurrence ? toTitleCase(recurrence) : null)

  return [
    {
      label: mainCategory?.name || event.main_tag || toTitleCase(mainSlug),
      href: `/${mainSlug}`,
    },
    ...(secondarySlug && secondaryLabel ? [{ label: secondaryLabel, href: `/${mainSlug}/${secondarySlug}` }] : []),
  ]
}

function FeaturedBreadcrumb({ items }: { items: Array<{ label: string; href: string }> }) {
  if (items.length === 0) {
    return null
  }

  return (
    <nav className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-muted-foreground">
      {items.map((breadcrumbItem, index) => (
        <span key={`${breadcrumbItem.href}:${breadcrumbItem.label}`} className="flex min-w-0 items-center gap-1.5">
          {index > 0 && <span className="shrink-0 text-muted-foreground/60">·</span>}
          <IntentPrefetchLink
            href={breadcrumbItem.href}
            className="truncate underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            {breadcrumbItem.label}
          </IntentPrefetchLink>
        </span>
      ))}
    </nav>
  )
}

function normalizeFeaturedSportsTitle(value: string) {
  return value
    .replace(/\s+-\s+more markets\s*$/i, '')
    .replace(/\bvs\.\s*/i, 'vs ')
    .replace(/\s+/g, ' ')
    .trim()
}

function resolveFeaturedDisplayTitle(item: HomeFeaturedEventCard) {
  if (item.kind === 'sports') {
    const teams = item.event.sports_teams ?? []
    const [homeTeam, awayTeam] = teams
    if (homeTeam?.name && awayTeam?.name) {
      return `${homeTeam.name} vs ${awayTeam.name}`
    }

    return normalizeFeaturedSportsTitle(item.event.title)
  }

  return item.event.title
}

function FeaturedHeaderActions({ event, className }: { event: HomeFeaturedEventCard['event']; className?: string }) {
  return (
    <div className={cn('flex shrink-0 items-center gap-2', className)}>
      <EventShare event={event} />
      <EventBookmark event={event} refreshStatusOnMount={false} />
    </div>
  )
}

function resolveFeaturedDestinationHref(item: HomeFeaturedEventCard, locale: string, hasHydrated: boolean) {
  const seriesSlug = item.targetType === 'series' ? item.resolvedSeriesSlug || item.event.series_slug : null
  if (!hasHydrated && seriesSlug) {
    return `/api/home-featured/live-link?seriesSlug=${encodeURIComponent(seriesSlug)}&locale=${encodeURIComponent(locale)}`
  }
  return resolveEventPagePath(item.event)
}

const FeaturedMarketLink = forwardRef<HTMLAnchorElement, ComponentProps<'a'> & { href: string }>(
  function FeaturedMarketLink({ href, ...props }, ref) {
    return href.startsWith('/api/home-featured/live-link?') ? (
      <a {...props} href={href} ref={ref} />
    ) : (
      <Link {...props} href={href} ref={ref} />
    )
  },
)

function FeaturedHeader({ item, showActions = true }: { item: HomeFeaturedEventCard; showActions?: boolean }) {
  const t = useExtracted()
  const locale = useLocale()
  const hasHydrated = useHasHydrated()
  const event = item.event
  const eventHref = resolveFeaturedDestinationHref(item, locale, hasHydrated)
  const cryptoCadencePresentation = resolveCryptoCadenceEventPresentation(event, locale)
  const breadcrumbItems = resolveFeaturedBreadcrumbItems(item).map((breadcrumbItem) => ({
    ...breadcrumbItem,
    label:
      breadcrumbItem.label === 'Daily'
        ? t('Daily')
        : breadcrumbItem.label === 'Weekly'
          ? t('Weekly')
          : breadcrumbItem.label === 'Monthly'
            ? t('Monthly')
            : breadcrumbItem.label === 'Sports'
              ? t('Sports')
              : breadcrumbItem.label === 'Esports'
                ? t('Esports')
                : breadcrumbItem.label,
  }))
  const featuredTitle = localizeHomeEventCardTitle(resolveFeaturedDisplayTitle(item), locale)
  const fullLidTitleValues = resolveHomeFeaturedFullLidTitleValues(featuredTitle, locale)
  const displayTitle =
    cryptoCadencePresentation?.title ??
    (fullLidTitleValues
      ? t('Will the White House call a full lid by {time}? ({startDate}–{endDate})', fullLidTitleValues)
      : featuredTitle)

  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="group/header flex min-w-0 flex-1 items-start gap-3">
        {item.kind !== 'sports' && (
          <FeaturedMarketLink
            href={eventHref}
            className="size-11 shrink-0 overflow-hidden rounded-lg bg-muted md:size-12"
          >
            <EventIconImage
              src={event.icon_url || item.primaryMarkets[0]?.icon_url || '/images/pwa/default-icon-192.png'}
              alt={displayTitle}
              sizes="48px"
              containerClassName="size-full rounded-lg"
            />
          </FeaturedMarketLink>
        )}
        <div className="grid min-w-0 gap-1">
          {!cryptoCadencePresentation && <FeaturedBreadcrumb items={breadcrumbItems} />}
          <FeaturedMarketLink
            href={eventHref}
            className={cn(
              `line-clamp-2 text-lg font-semibold tracking-tight underline-offset-4 group-hover/header:underline md:text-xl`,
            )}
          >
            {displayTitle}
          </FeaturedMarketLink>
          {cryptoCadencePresentation?.subtitle && (
            <span className="truncate text-xs text-muted-foreground md:text-sm">
              {cryptoCadencePresentation.subtitle}
            </span>
          )}
        </div>
      </div>

      {showActions && <FeaturedHeaderActions event={event} />}
    </div>
  )
}

function resolveFeaturedOutcomeHref(
  event: HomeFeaturedEventCard['event'],
  outcome: HomeFeaturedOutcomeSummary,
  fallbackHref: string,
) {
  if (fallbackHref.startsWith('/api/home-featured/live-link?')) {
    return `${fallbackHref}&outcomeIndex=${outcome.outcomeIndex}&marketSlug=${encodeURIComponent(outcome.marketSlug ?? '')}&conditionId=${encodeURIComponent(outcome.conditionId)}`
  }

  return (
    resolveEventOutcomePath(event, {
      marketSlug: outcome.marketSlug,
      conditionId: outcome.conditionId,
      outcomeIndex: outcome.outcomeIndex,
    }) || fallbackHref
  )
}

function OutcomeRows({ item, linkedHref }: { item: HomeFeaturedEventCard; linkedHref: string }) {
  const normalizeOutcomeLabel = useOutcomeLabel()
  const outcomes = item.topOutcomes
  const shouldShowOutcomeImages = item.event.show_market_icons !== false

  if (outcomes.length === 0) {
    return null
  }

  return (
    <div className="grid gap-0">
      {outcomes.map((outcome) => {
        const label = normalizeOutcomeLabel(outcome.label)

        return (
          <FeaturedMarketLink
            key={outcome.key}
            href={resolveFeaturedOutcomeHref(item.event, outcome, linkedHref)}
            className={cn(
              `group/outcome grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/50 py-2 last:border-b-0`,
            )}
          >
            <span className="flex min-w-0 items-center gap-3">
              {shouldShowOutcomeImages && outcome.imageUrl && (
                <span className="size-9 shrink-0 overflow-hidden rounded-md bg-muted">
                  <EventIconImage
                    src={outcome.imageUrl}
                    alt={label}
                    sizes="36px"
                    containerClassName="size-full rounded-md"
                  />
                </span>
              )}
              <span className="truncate text-base font-medium underline-offset-2 group-hover/outcome:underline">
                {label}
              </span>
            </span>
            <span className="text-xl font-semibold tabular-nums">{formatChancePercent(outcome.chance)}</span>
          </FeaturedMarketLink>
        )
      })}
    </div>
  )
}

function StandardActions({
  item,
  linkedHref,
  stacked = false,
}: {
  item: HomeFeaturedEventCard
  linkedHref: string
  stacked?: boolean
}) {
  const normalizeOutcomeLabel = useOutcomeLabel()
  const primaryMarket = item.primaryMarkets[0]
  const outcomes = item.topOutcomes

  if (!primaryMarket || outcomes.length === 0) {
    return null
  }

  const shouldUseLiveOutcomeColors = shouldUseLiveFeaturedOutcomeColors(item)

  return (
    <div className={cn('grid gap-2', stacked ? 'grid-cols-1' : 'grid-cols-2')}>
      {outcomes.slice(0, 2).map((outcome, index) => {
        const isNegative = isNegativeOutcomeLabel(outcome.label) || index === 1
        const liveOutcomeAppearance = resolveLiveFeaturedOutcomeAppearance(item, index)

        return (
          <Button
            key={`featured-action-${index}`}
            variant={liveOutcomeAppearance ? 'outline' : isNegative ? 'no' : 'yes'}
            className={cn(
              `inline-flex h-16 min-w-0 items-center justify-center rounded-lg px-4 text-center text-base font-semibold transition duration-150 active:scale-[98%] md:h-14 md:px-4 md:text-base`,
              shouldUseLiveOutcomeColors && 'shadow-none',
              shouldUseLiveOutcomeColors && 'uppercase',
              liveOutcomeAppearance?.className,
            )}
            style={liveOutcomeAppearance?.style}
            nativeButton={false}
            render={
              <FeaturedMarketLink
                href={resolveFeaturedOutcomeHref(item.event, outcome, linkedHref)}
                className="relative inline-flex size-full items-center justify-center"
              >
                {liveOutcomeAppearance?.backgroundClassName || liveOutcomeAppearance?.backgroundStyle ? (
                  <span
                    className={cn(
                      'pointer-events-none absolute inset-0 z-0 rounded-lg opacity-[0.15] transition-opacity group-hover/team-button:opacity-100',
                      liveOutcomeAppearance.backgroundClassName,
                    )}
                    style={liveOutcomeAppearance.backgroundStyle}
                  />
                ) : null}
                <span className="relative z-1 truncate">{normalizeOutcomeLabel(outcome.label)}</span>
              </FeaturedMarketLink>
            }
          />
        )
      })}
    </div>
  )
}

function SportsMarketButton({
  groupLabel,
  market,
  href,
  className,
  forceNeutral = false,
}: {
  groupLabel: string
  market: FeaturedSportsButtonMarket
  href: string
  className?: string
  forceNeutral?: boolean
}) {
  const appearance = forceNeutral ? resolveFilledNeutralSportsButtonAppearance() : resolveSportsButtonAppearance(market)

  return (
    <Link
      key={`${groupLabel}:${market.key}`}
      href={href}
      className={cn(
        `group/sports-market-button relative inline-flex min-w-0 items-center justify-center overflow-hidden rounded-lg px-3 text-center font-semibold transition duration-150 active:scale-[98%]`,
        appearance.className,
        className,
      )}
      style={appearance.style}
    >
      <span className={cn('relative z-1', market.tone === 'draw' ? 'whitespace-nowrap' : 'truncate')}>
        {market.label}
      </span>
      {appearance.backgroundClassName || appearance.backgroundStyle ? (
        <span
          className={cn(
            'absolute inset-0 z-0 rounded-lg opacity-[0.15] transition-opacity group-hover/team-button:opacity-100',
            appearance.backgroundClassName,
          )}
          style={appearance.backgroundStyle}
        />
      ) : null}
    </Link>
  )
}

function resolveFeaturedSportsButtonHref(card: SportsGamesCard, button: SportsGamesButton, fallbackHref: string) {
  const market =
    card.detailMarkets.find((market) => market.condition_id === button.conditionId) ??
    card.event.markets.find((market) => market.condition_id === button.conditionId)
  const href = resolveEventOutcomePath(card.event, {
    marketSlug: market?.slug,
    conditionId: button.conditionId,
    outcomeIndex: button.outcomeIndex,
  })

  return href || fallbackHref
}

function SportsMoneylineButtons({ card, linkedHref }: { card: SportsGamesCard; linkedHref: string }) {
  const t = useExtracted()
  const moneylineButtons = card.buttons
    .filter((button) => button.marketType === 'moneyline')
    .sort(compareSportsButtonsByTone)

  if (moneylineButtons.length === 0) {
    return null
  }

  return (
    <div className="flex items-center gap-2">
      {moneylineButtons.slice(0, 3).map((button) => {
        const isDraw = button.tone === 'draw'

        return (
          <SportsMarketButton
            key={button.key}
            groupLabel={t('Moneyline')}
            market={toFeaturedSportsButtonMarket(
              button,
              isDraw
                ? preserveSportsButtonPeriodSuffix(t('Draw'), button.label)
                : resolveMoneylineButtonLabel(card, moneylineButtons, button),
            )}
            href={resolveFeaturedSportsButtonHref(card, button, linkedHref)}
            className={cn(
              'h-14',
              isDraw ? 'mx-1 w-20 shrink-0 px-3 text-sm tracking-wide' : 'min-w-0 flex-1 text-sm md:text-base',
            )}
          />
        )
      })}
    </div>
  )
}

const SPORTS_BUTTON_TONE_ORDER: Record<SportsGamesButton['tone'], number> = {
  team1: 0,
  draw: 1,
  team2: 2,
  over: 3,
  under: 4,
  neutral: 5,
}

function compareSportsButtonsByTone(left: SportsGamesButton, right: SportsGamesButton) {
  const toneComparison = SPORTS_BUTTON_TONE_ORDER[left.tone] - SPORTS_BUTTON_TONE_ORDER[right.tone]
  if (toneComparison !== 0) {
    return toneComparison
  }

  return left.key.localeCompare(right.key)
}

function resolveMoneylineButtonLabel(card: SportsGamesCard, buttons: SportsGamesButton[], button: SportsGamesButton) {
  if (button.tone !== 'team1' && button.tone !== 'team2') {
    return button.label
  }

  const periodSuffix = resolveSportsButtonPeriodSuffix(button.label)
  const team1Button = buttons.find(
    (candidate) => candidate.tone === 'team1' && resolveSportsButtonPeriodSuffix(candidate.label) === periodSuffix,
  )
  const team2Button = buttons.find(
    (candidate) => candidate.tone === 'team2' && resolveSportsButtonPeriodSuffix(candidate.label) === periodSuffix,
  )
  const labels = resolveCompactSportsTeamNames(
    { name: card.teams[0]?.name, fallback: team1Button?.label ?? button.label },
    { name: card.teams[1]?.name, fallback: team2Button?.label ?? button.label },
  )

  return button.tone === 'team1' ? labels[0] : labels[1]
}

function resolveFeaturedSportsButtonTone(button: SportsGamesButton): FeaturedSportsButtonTone {
  if (button.tone === 'team1') {
    return 'home'
  }
  if (button.tone === 'team2') {
    return 'away'
  }
  if (button.tone === 'draw') {
    return 'draw'
  }

  return 'neutral'
}

function toFeaturedSportsButtonMarket(button: SportsGamesButton, label = button.label): FeaturedSportsButtonMarket {
  return {
    key: button.key,
    conditionId: button.conditionId,
    label,
    tone: resolveFeaturedSportsButtonTone(button),
    color: button.color,
  }
}

function extractSignedLineValue(value: string | null | undefined) {
  const match = value?.replace(/[\u2212\u2013\u2014]/g, '-').match(/([+-]\s*\d+(?:\.\d+)?)/)
  const rawValue = match?.[1]?.replace(/\s+/g, '')
  if (!rawValue) {
    return null
  }

  const numericValue = Number(rawValue)
  return Number.isFinite(numericValue) ? numericValue : null
}

function formatSignedSportsLine(value: number) {
  const rounded = Math.round(value * 10) / 10
  const display = Number.isInteger(rounded) ? `${rounded.toFixed(1)}` : `${rounded}`
  return value > 0 ? `+${display}` : display
}

function doesLineMarketTextMatchTeam(
  market: Market | null | undefined,
  team: SportsGamesCard['teams'][number] | null | undefined,
) {
  if (!market || !team) {
    return false
  }

  const marketText = normalizeText(
    [market.sports_group_item_title, market.short_title, market.title, market.slug].filter(Boolean).join(' '),
  )
  const teamName = normalizeText(team.name)
  const teamAbbreviation = normalizeText(team.abbreviation)

  return Boolean(
    (teamName && marketText.includes(teamName)) ||
    (teamAbbreviation && new Set(marketText.split(' ')).has(teamAbbreviation)),
  )
}

function resolveMarketSignedLine(market: Market | null | undefined) {
  return extractSignedLineValue(
    [market?.sports_group_item_title, market?.short_title, market?.title].filter(Boolean).join(' '),
  )
}

function resolveSpreadLineForButton(
  card: SportsGamesCard,
  option: SportsLinePickerOption,
  button: SportsGamesButton,
  market: Market | null | undefined,
) {
  const marketLine = resolveMarketSignedLine(market)
  const team1 = card.teams[0]
  const team2 = card.teams[1]
  const marketMatchesTeam1 = doesLineMarketTextMatchTeam(market, team1)
  const marketMatchesTeam2 = doesLineMarketTextMatchTeam(market, team2)
  const marketMatchesSingleTeam = marketMatchesTeam1 !== marketMatchesTeam2

  if (marketLine !== null && marketMatchesSingleTeam) {
    if (button.tone === 'team1') {
      return marketMatchesTeam1 ? marketLine : -marketLine
    }
    if (button.tone === 'team2') {
      return marketMatchesTeam2 ? marketLine : -marketLine
    }
  }

  const buttonLine = extractSignedLineValue(button.label)
  if (buttonLine !== null) {
    return buttonLine
  }

  if (button.tone === 'team1') {
    return -option.lineValue
  }
  if (button.tone === 'team2') {
    return option.lineValue
  }

  return option.lineValue
}

function resolveLineButtonLabel(
  card: SportsGamesCard,
  option: SportsLinePickerOption,
  button: SportsGamesButton,
  market: Market | null | undefined,
  marketType: LinePickerMarketType,
) {
  if (marketType === 'total') {
    return button.tone === 'under' ? `U ${option.label}` : `O ${option.label}`
  }

  const teamName = button.tone === 'team1' ? card.teams[0]?.name : button.tone === 'team2' ? card.teams[1]?.name : null
  const line = resolveSpreadLineForButton(card, option, button, market)

  return teamName ? `${teamName} ${formatSignedSportsLine(line)}` : button.label
}

function isFeaturedLineMarket(market: Market | null | undefined, marketType: LinePickerMarketType) {
  if (!market) {
    return false
  }

  const normalizedType = normalizeText(market.sports_market_type)
  const normalizedText = normalizeText(
    [market.sports_group_item_title, market.short_title, market.title].filter(Boolean).join(' '),
  )

  if (marketType === 'spread') {
    return normalizedType.includes('spread') || normalizedType.includes('handicap')
  }

  const isTeamOrSegmentTotal =
    normalizedType.includes('team') ||
    normalizedText.includes('team total') ||
    normalizedText.includes('half') ||
    normalizedText.includes('quarter') ||
    normalizedText.includes('period')

  return (
    !isTeamOrSegmentTotal &&
    (normalizedType === 'totals' || normalizedType.includes(' total') || normalizedType.includes('over under'))
  )
}

function scoreSpreadLineOption(
  card: SportsGamesCard,
  option: SportsLinePickerOption,
  market: Market | null | undefined,
) {
  const team1 = card.teams[0]
  const marketLine = resolveMarketSignedLine(market)
  if (marketLine !== null && doesLineMarketTextMatchTeam(market, team1) && marketLine < 0) {
    return 3
  }

  const team1ButtonLine = option.buttons
    .filter((button) => button.tone === 'team1')
    .map((button) => extractSignedLineValue(button.label))
    .find((line): line is number => line !== null)
  if (team1ButtonLine != null && team1ButtonLine < 0) {
    return 2
  }

  return 1
}

function resolveFeaturedLinePickerOptions(card: SportsGamesCard, marketType: LinePickerMarketType) {
  const marketByConditionId = new Map(card.detailMarkets.map((market) => [market.condition_id, market] as const))
  const filteredOptions = buildLinePickerOptions(card, marketType).filter((option) =>
    isFeaturedLineMarket(marketByConditionId.get(option.conditionId), marketType),
  )

  const byLineValue = new Map<number, SportsLinePickerOption>()
  for (const option of filteredOptions) {
    const existing = byLineValue.get(option.lineValue)
    if (!existing) {
      byLineValue.set(option.lineValue, option)
      continue
    }

    const optionScore = scoreSpreadLineOption(card, option, marketByConditionId.get(option.conditionId))
    const existingScore = scoreSpreadLineOption(card, existing, marketByConditionId.get(existing.conditionId))
    if (marketType === 'spread' && optionScore > existingScore) {
      byLineValue.set(option.lineValue, option)
    }
  }

  return Array.from(byLineValue.values()).sort((left, right) => left.lineValue - right.lineValue)
}

function LinePickerArrowButton({
  direction,
  disabled,
  onClick,
}: {
  direction: 'previous' | 'next'
  disabled: boolean
  onClick: () => void
}) {
  const Icon = direction === 'previous' ? ChevronLeftIcon : ChevronRightIcon
  const t = useExtracted()

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        `inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none`,
        disabled ? 'cursor-not-allowed opacity-35' : 'cursor-pointer hover:bg-muted/70 hover:text-foreground',
      )}
      aria-label={direction === 'previous' ? t('Previous line') : t('Next line')}
    >
      <Icon className="size-4.5" />
    </button>
  )
}

function SportsFeaturedLineMarketCarousel({
  card,
  marketType,
  label,
  linkedHref,
}: {
  card: SportsGamesCard
  marketType: LinePickerMarketType
  label: string
  linkedHref: string
}) {
  const options = useMemo(() => resolveFeaturedLinePickerOptions(card, marketType), [card, marketType])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const activeIndex = options.length === 0 ? 0 : Math.min(selectedIndex, options.length - 1)
  const activeOption = options[activeIndex]
  const marketByConditionId = useMemo(
    () => new Map(card.detailMarkets.map((market) => [market.condition_id, market] as const)),
    [card.detailMarkets],
  )

  if (!activeOption) {
    return null
  }

  const canPickPrevious = activeIndex > 0
  const canPickNext = activeIndex < options.length - 1
  const visibleOptions = [
    activeIndex > 0 ? options[activeIndex - 1] : null,
    activeOption,
    activeIndex < options.length - 1 ? options[activeIndex + 1] : null,
  ]
  const activeMarket = marketByConditionId.get(activeOption.conditionId) ?? null
  const visibleButtons = [...activeOption.buttons].sort(compareSportsButtonsByTone).slice(0, 2)

  return (
    <div className="grid gap-2.5">
      <div className="grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <span className="min-w-0 truncate text-base font-semibold">{label}</span>
        <div
          className={cn(
            `grid grid-cols-[1.75rem_2.5rem_2.5rem_2.5rem_1.75rem] items-center gap-1 text-sm font-semibold tabular-nums`,
          )}
        >
          <LinePickerArrowButton
            direction="previous"
            disabled={!canPickPrevious}
            onClick={() => setSelectedIndex(Math.max(0, activeIndex - 1))}
          />
          {visibleOptions.map((option, index) => (
            <span
              key={option ? `${marketType}:${option.conditionId}` : `${marketType}:empty:${index}`}
              aria-hidden={!option}
              className={cn(
                'inline-flex h-7 min-w-0 items-center justify-center text-center',
                index === 1 ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {option?.label ?? ''}
            </span>
          ))}
          <LinePickerArrowButton
            direction="next"
            disabled={!canPickNext}
            onClick={() => setSelectedIndex(Math.min(options.length - 1, activeIndex + 1))}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {visibleButtons.map((button) => (
          <SportsMarketButton
            key={button.key}
            groupLabel={label}
            market={toFeaturedSportsButtonMarket(
              button,
              resolveLineButtonLabel(card, activeOption, button, activeMarket, marketType),
            )}
            href={resolveFeaturedSportsButtonHref(card, button, linkedHref)}
            className="h-10 text-sm"
            forceNeutral
          />
        ))}
      </div>
    </div>
  )
}

function SportsFeaturedControls({ card, linkedHref }: { card: SportsGamesCard; linkedHref: string }) {
  const t = useExtracted()
  const hasMoneyline = card.buttons.some((button) => button.marketType === 'moneyline')
  const hasSpread = resolveFeaturedLinePickerOptions(card, 'spread').length > 0
  const hasTotal = resolveFeaturedLinePickerOptions(card, 'total').length > 0
  const hasSecondaryMarkets = hasSpread || hasTotal

  if (!hasMoneyline && !hasSecondaryMarkets) {
    return null
  }

  return (
    <div className="grid gap-4">
      {hasMoneyline && <SportsMoneylineButtons card={card} linkedHref={linkedHref} />}
      {hasMoneyline && hasSecondaryMarkets && <div className="border-t border-border/60" />}
      {hasSpread && (
        <SportsFeaturedLineMarketCarousel card={card} marketType="spread" label={t('Spread')} linkedHref={linkedHref} />
      )}
      {hasTotal && (
        <SportsFeaturedLineMarketCarousel card={card} marketType="total" label={t('Total')} linkedHref={linkedHref} />
      )}
    </div>
  )
}

function ContextAvatar({ contextItem }: { contextItem: HomeFeaturedContextItem }) {
  if (contextItem.type === 'news' && contextItem.faviconUrl) {
    return (
      <EventIconImage
        src={contextItem.faviconUrl}
        alt={contextItem.source}
        sizes="28px"
        containerClassName="size-7 shrink-0 rounded-full bg-muted"
        imageClassName="rounded-full"
      />
    )
  }

  if (contextItem.type === 'comment') {
    const avatarUrl = contextItem.avatarUrl?.trim() ?? ''

    if (!shouldUseAvatarPlaceholder(avatarUrl)) {
      return (
        <EventIconImage
          src={avatarUrl}
          alt={contextItem.source}
          sizes="28px"
          containerClassName="size-7 shrink-0 rounded-full bg-muted"
          imageClassName="rounded-full"
        />
      )
    }

    return (
      <span
        aria-hidden="true"
        className="size-7 shrink-0 rounded-full border border-border/80"
        style={getAvatarPlaceholderStyle(contextItem.avatarSeed?.trim() || contextItem.source.trim() || 'user')}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
    >
      {contextItem.source.trim().charAt(0).toUpperCase() || 'U'}
    </span>
  )
}

function formatContextRelativeTime(value: string | null, currentTimestamp: number | null, locale: string) {
  if (!value || currentTimestamp === null) {
    return null
  }

  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp) || !Number.isFinite(currentTimestamp)) {
    return null
  }

  const diffSeconds = Math.round((timestamp - currentTimestamp) / 1000)
  const divisions = [
    { amount: 60, unit: 'second' },
    { amount: 60, unit: 'minute' },
    { amount: 24, unit: 'hour' },
    { amount: 7, unit: 'day' },
    { amount: 4.34524, unit: 'week' },
    { amount: 12, unit: 'month' },
    { amount: Number.POSITIVE_INFINITY, unit: 'year' },
  ] as const
  let duration = diffSeconds

  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(duration), division.unit)
    }

    duration /= division.amount
  }

  return null
}

function ContextTickerItem({
  contextItem,
  currentTimestamp,
  index,
  linkedHref,
  omitCommentTime,
}: {
  contextItem: HomeFeaturedContextItem
  currentTimestamp: number | null
  index: number
  linkedHref: string
  omitCommentTime: boolean
}) {
  const locale = useLocale()
  const isNews = contextItem.type === 'news'
  const timeLabel =
    !isNews && omitCommentTime
      ? null
      : formatContextRelativeTime(contextItem.publishedAt ?? contextItem.selectedAt, currentTimestamp, locale)

  return (
    <FeaturedMarketLink
      key={`${contextItem.id}:${index}`}
      href={linkedHref}
      className="flex h-14 min-w-0 items-center gap-2"
    >
      {(!isNews || !contextItem.faviconUrl) && <ContextAvatar contextItem={contextItem} />}
      <span className="grid min-w-0 gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground/60">
          {isNews && contextItem.faviconUrl && (
            <EventIconImage
              src={contextItem.faviconUrl}
              alt={contextItem.source}
              sizes="14px"
              containerClassName="size-3.5 shrink-0 rounded-[3px] bg-muted"
              imageClassName="rounded-[3px]"
            />
          )}
          <span className="truncate">{contextItem.source}</span>
          {timeLabel && (
            <>
              <span className="shrink-0 text-muted-foreground/50">·</span>
              <span className="shrink-0">{timeLabel}</span>
            </>
          )}
        </span>
        <span className="line-clamp-2 text-xs/snug text-muted-foreground/75">{contextItem.title}</span>
      </span>
    </FeaturedMarketLink>
  )
}

function ContextTicker({
  currentTimestamp,
  item,
  linkedHref,
}: {
  currentTimestamp: number | null
  item: HomeFeaturedEventCard
  linkedHref: string
}) {
  const omitCommentTime = resolveCryptoCadenceEventPresentation(item.event) !== null

  if (item.contextItems.length === 0) {
    return null
  }

  const tickerItems = item.contextItems.length === 1 ? item.contextItems : [...item.contextItems, ...item.contextItems]
  const tickerDistance = item.contextItems.length * 64
  const tickerStyle =
    item.contextItems.length > 1
      ? ({
          '--home-featured-context-distance': `${tickerDistance}px`,
          animationDuration: `${Math.max(14, item.contextItems.length * 3.8)}s`,
        } as CSSProperties)
      : undefined

  return (
    <div className="group/context relative min-h-0 flex-1 overflow-hidden border-t border-border/50 pt-3">
      <div
        className={cn(
          item.contextItems.length > 1 &&
            `grid animate-[home-featured-context-ticker_16s_linear_infinite] gap-2 group-focus-within/context:paused group-hover/context:paused motion-reduce:animate-none`,
        )}
        style={tickerStyle}
      >
        {tickerItems.map((contextItem, index) => (
          <ContextTickerItem
            key={`${contextItem.id}:${index}`}
            contextItem={contextItem}
            currentTimestamp={currentTimestamp}
            index={index}
            linkedHref={linkedHref}
            omitCommentTime={omitCommentTime}
          />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-linear-to-b from-card to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-b from-transparent to-card" />
    </div>
  )
}

function useFeaturedTemporalLabel(item: HomeFeaturedEventCard) {
  const locale = useLocale()
  const t = useExtracted()

  if (item.temporalStatus === 'live') {
    return t('Live')
  }
  if (item.temporalStatus === 'daily') {
    return t('Daily')
  }
  if (item.temporalStatus === 'monthly') {
    return t('Monthly')
  }

  if (!item.event.end_date) {
    return t('Ends later')
  }

  const endDate = new Date(item.event.end_date)
  if (!Number.isFinite(endDate.getTime())) {
    return t('Ends later')
  }

  const dateLabel = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(endDate)
  return t('Ends {date}', { date: dateLabel })
}

function SportsScoreboard({
  card,
  item,
  linkedHref,
}: {
  card: SportsGamesCard | null
  item: HomeFeaturedEventCard
  linkedHref: string
}) {
  const hasHydrated = useHasHydrated()
  const locale = useLocale()
  const t = useExtracted()
  const temporalLabel = useFeaturedTemporalLabel(item)
  const teams = card?.teams.length
    ? card.teams.map((team) => ({
        name: team.name,
        logoUrl: team.logoUrl,
      }))
    : (item.event.sports_teams ?? []).map((team, index) => ({
        name: team.name,
        logoUrl: team.logo_url ?? item.event.sports_team_logo_urls?.[index] ?? null,
      }))
  const liveMeta = [item.event.sports_period, item.event.sports_elapsed].filter(Boolean).join(' · ')
  const scoreboardContent = resolveHomeFeaturedSportsScoreboardContent({
    score: item.event.sports_score,
    temporalStatus: item.temporalStatus,
    liveMeta,
  })
  const parsedStartTimestamp = item.event.sports_start_time
    ? Date.parse(item.event.sports_start_time)
    : item.event.start_date
      ? Date.parse(item.event.start_date)
      : Number.NaN
  const startTimestamp = Number.isFinite(parsedStartTimestamp) ? parsedStartTimestamp : null
  const startLabels =
    startTimestamp !== null
      ? hasHydrated
        ? (formatSportsEventLocalStartLabels(startTimestamp, locale) ??
          formatSportsEventStartLabels(startTimestamp, locale))
        : formatSportsEventStartLabels(startTimestamp, locale)
      : null
  if (item.kind !== 'sports' || teams.length < 2) {
    return null
  }

  const [homeTeam, awayTeam] = teams
  const homeLogo = homeTeam?.logoUrl ?? null
  const awayLogo = awayTeam?.logoUrl ?? null
  const homeButton =
    card?.buttons.find((button) => button.marketType === 'moneyline' && button.tone === 'team1') ?? null
  const awayButton =
    card?.buttons.find((button) => button.marketType === 'moneyline' && button.tone === 'team2') ?? null
  const homeHref = card && homeButton ? resolveFeaturedSportsButtonHref(card, homeButton, linkedHref) : null
  const awayHref = card && awayButton ? resolveFeaturedSportsButtonHref(card, awayButton, linkedHref) : null
  const teamNameClassName = `
    inline-block max-w-full truncate text-base font-medium text-muted-foreground/75 underline-offset-2
    transition-colors hover:text-muted-foreground hover:underline
  `
  const shouldShowScheduledStart = !scoreboardContent.scoreLabel && !scoreboardContent.showLiveStatus

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-1 py-2">
      <div className="min-w-0 justify-self-center text-center">
        {homeLogo && (
          <EventIconImage
            src={homeLogo}
            alt={homeTeam?.name ?? ''}
            sizes="48px"
            containerClassName="mx-auto mb-1.5 size-12 rounded-lg"
          />
        )}
        {homeHref ? (
          <Link href={homeHref} className={teamNameClassName}>
            {homeTeam?.name}
          </Link>
        ) : (
          <p className="truncate text-base font-medium text-foreground/90">{homeTeam?.name}</p>
        )}
      </div>
      <div className="text-center">
        {scoreboardContent.scoreLabel ? (
          <p className="text-3xl font-semibold tabular-nums">{scoreboardContent.scoreLabel}</p>
        ) : shouldShowScheduledStart && startLabels ? (
          <>
            <p className="text-sm font-semibold text-foreground tabular-nums">{startLabels.timeLabel}</p>
            <p className="mt-2 text-sm font-medium text-muted-foreground">{startLabels.dayLabel}</p>
          </>
        ) : shouldShowScheduledStart ? (
          <p className="text-sm font-semibold text-muted-foreground">{temporalLabel}</p>
        ) : null}
        {scoreboardContent.showLiveStatus && (
          <p
            className={cn(
              'text-xs font-semibold tracking-wide text-red-500 uppercase',
              scoreboardContent.scoreLabel ? 'mt-1' : undefined,
            )}
          >
            {t('Live')}
          </p>
        )}
        {scoreboardContent.liveMeta && <p className="text-sm font-medium text-red-500">{scoreboardContent.liveMeta}</p>}
      </div>
      <div className="min-w-0 justify-self-center text-center">
        {awayLogo && (
          <EventIconImage
            src={awayLogo}
            alt={awayTeam?.name ?? ''}
            sizes="48px"
            containerClassName="mx-auto mb-1.5 size-12 rounded-lg"
          />
        )}
        {awayHref ? (
          <Link href={awayHref} className={teamNameClassName}>
            {awayTeam?.name}
          </Link>
        ) : (
          <p className="truncate text-base font-medium text-foreground/90">{awayTeam?.name}</p>
        )}
      </div>
    </div>
  )
}

function FeaturedFooter({ item }: { item: HomeFeaturedEventCard }) {
  const site = useSiteIdentity()
  const t = useExtracted()
  const temporalLabel = useFeaturedTemporalLabel(item)

  return (
    <div
      className={`absolute inset-x-4 bottom-2 z-20 flex h-8 shrink-0 items-center justify-between gap-3 bg-card/95 text-[13px] leading-none font-normal text-muted-foreground/60 md:inset-x-5 md:text-sm`}
    >
      {item.event.volume > 0 && (
        <span className="shrink-0">{t('{amount} Vol.', { amount: formatVolume(item.event.volume) })}</span>
      )}
      <span className="ml-auto flex min-w-0 items-center justify-end gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 whitespace-nowrap',
            item.temporalStatus === 'live' && 'text-red-500/70',
          )}
        >
          {item.temporalStatus === 'live' && (
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-2 animate-ping rounded-full bg-red-500 opacity-50" />
              <span className="relative inline-flex size-2 rounded-full bg-red-500/70" />
            </span>
          )}
          {temporalLabel}
        </span>
        <span className="text-muted-foreground/35">·</span>
        <span className="flex min-w-0 items-center gap-1 leading-none">
          <SiteLogoIcon
            logoSvg={site.logoSvg}
            logoImageUrl={site.logoImageUrl}
            alt={`${site.name} logo`}
            className={cn(
              `pointer-events-none size-4 shrink-0 text-current opacity-65 select-none [&_svg]:size-4 [&_svg_*]:fill-current [&_svg_*]:stroke-current`,
            )}
            imageClassName="pointer-events-none size-4 object-contain opacity-65 select-none"
            size={16}
          />
          <span className="truncate select-none">{site.name}</span>
        </span>
      </span>
    </div>
  )
}

function FeaturedRightRailSingle({
  hotTopics,
  sideCard,
  hideSideCard = false,
}: {
  hotTopics: HomeFeaturedHotTopic[]
  sideCard: HomeFeaturedSideCardSettings
  hideSideCard?: boolean
}) {
  const t = useExtracted()
  const sideCardTitle = sideCard.title === DEFAULT_HOME_FEATURED_SIDE_CARD_TITLE ? t('Market pulse') : sideCard.title
  const sideCardText =
    sideCard.text === DEFAULT_HOME_FEATURED_SIDE_CARD_TEXT ? t('Fast movers across active markets.') : sideCard.text
  const hasCta = Boolean(sideCard.ctaLabel.trim() && sideCard.ctaHref.trim())
  const sideCardHref = sideCard.ctaHref.trim()
  const shouldUseDocumentNavigation = requiresDocumentNavigation(sideCardHref)
  const useImage = Boolean(sideCard.useImage && sideCard.imageUrl.trim())
  const isClickable = useImage ? Boolean(sideCardHref) : hasCta
  const sideCardClassName = cn(
    `group/side-card relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground shadow-md shadow-black/4 transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-black/8 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none`,
    !useImage && 'p-5',
  )
  const sideCardContent = useImage ? (
    <>
      <Image
        src={sideCard.imageUrl}
        alt={sideCard.ctaLabel.trim()}
        fill
        loading="eager"
        fetchPriority="high"
        sizes="(min-width: 1024px) 32vw, 280px"
        className="object-cover transition-transform duration-300 group-hover/side-card:scale-[1.02]"
      />
      {sideCard.ctaLabel.trim() && (
        <span
          className={cn(
            `absolute inset-0 z-1 flex items-end bg-linear-to-t from-black/75 via-black/20 to-transparent p-5 text-white opacity-0 transition-opacity duration-200 group-hover/side-card:opacity-100 group-focus-visible/side-card:opacity-100`,
          )}
        >
          <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold">
            <span className="line-clamp-2">{sideCard.ctaLabel}</span>
            {sideCardHref && <ChevronRightIcon className="size-4 shrink-0 text-white/75" />}
          </span>
        </span>
      )}
    </>
  ) : (
    <>
      <span
        className={cn(
          `pointer-events-none absolute bottom-0 left-[30%] h-px w-[40%] bg-linear-to-r from-transparent via-primary/60 to-transparent`,
        )}
      />
      <HomeFeaturedSideCardIcon
        name={sideCard.icon}
        aria-hidden
        className={cn(
          `pointer-events-none absolute -top-6 -right-7 size-36 rotate-6 text-primary/8 transition-transform duration-300 group-hover/side-card:scale-105 motion-safe:animate-pulse`,
        )}
      />

      <div className="relative z-1 flex min-h-0 flex-1 flex-col pt-7 pb-4">
        <span
          className={cn(
            `mb-3 h-1 w-10 rounded-full bg-primary/70 shadow-[0_0_18px_color-mix(in_oklab,var(--primary)_32%,transparent)]`,
          )}
        />
        <span className="line-clamp-2 max-w-[16rem] text-xl/tight font-semibold tracking-tight">{sideCardTitle}</span>
        <span className={cn('mt-5 text-sm/relaxed text-muted-foreground', hasCta ? 'line-clamp-4' : 'line-clamp-5')}>
          {sideCardText}
        </span>

        {hasCta && (
          <span
            className={cn(
              `mt-auto ml-auto inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-3 text-sm font-medium text-foreground shadow-sm shadow-black/4 transition-colors group-hover/side-card:border-primary/35 group-hover/side-card:text-primary`,
            )}
          >
            <span className="truncate">{sideCard.ctaLabel}</span>
            <ChevronRightIcon className="size-4 shrink-0" />
          </span>
        )}
      </div>
    </>
  )

  return (
    <aside
      className={cn(
        'hidden h-[clamp(430px,38vw,480px)] min-w-0 gap-4 lg:grid',
        hideSideCard ? 'grid-rows-[minmax(0,1fr)]' : 'grid-rows-[minmax(0,1fr)_minmax(0,1fr)]',
      )}
    >
      {!hideSideCard &&
        (isClickable ? (
          isExternalHref(sideCardHref) ? (
            <a href={sideCardHref} target="_blank" rel="noreferrer" className={sideCardClassName}>
              {sideCardContent}
            </a>
          ) : shouldUseDocumentNavigation ? (
            <a href={sideCardHref} className={sideCardClassName}>
              {sideCardContent}
            </a>
          ) : (
            <Link href={sideCardHref} className={sideCardClassName}>
              {sideCardContent}
            </Link>
          )
        ) : (
          <div className={sideCardClassName}>{sideCardContent}</div>
        ))}

      <div className="min-h-0 overflow-hidden p-1">
        <Link
          href="/predictions?_sort=volume"
          className="group/hot-topics mb-3 inline-flex items-center gap-2 text-foreground"
        >
          <FlameIcon className="size-4 text-no/85" />
          <span className="text-lg font-semibold tracking-tight underline-offset-2 group-hover/hot-topics:underline">
            {t('Hot topics')}
          </span>
          <ChevronRightIcon className="size-4 text-muted-foreground/50" />
        </Link>
        <div className="grid gap-2.5">
          {hotTopics.map((topic, index) => (
            <Link
              key={topic.slug}
              href={topic.href}
              className="group/topic grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md py-0.5"
            >
              <span className="w-3.5 text-xs font-medium text-muted-foreground/65 tabular-nums">{index + 1}</span>
              <span
                className={cn(
                  `truncate text-sm font-medium text-foreground/90 underline-offset-2 transition-colors group-hover/topic:text-foreground group-hover/topic:underline`,
                )}
              >
                {topic.label}
              </span>
              {topic.volume24h > 0 && (
                <span className="text-xs text-muted-foreground/70 tabular-nums">
                  {t('{amount} Vol.', {
                    amount: formatDollarValueLabel(topic.volume24h, { maximumFractionDigits: 0 }),
                  })}
                </span>
              )}
              <ChevronRightIcon
                className={cn(
                  `col-start-4 size-3.5 text-muted-foreground/60 transition-transform group-hover/topic:translate-x-0.5`,
                )}
              />
            </Link>
          ))}
        </div>
      </div>
    </aside>
  )
}

function FeaturedSideCardSlide({
  slide,
  isActive,
}: {
  slide: HomeFeaturedSideCardSettings['slides'][number]
  isActive: boolean
}) {
  const t = useExtracted()
  const href = slide.ctaHref.trim()
  const hasCta = Boolean(slide.ctaLabel.trim() && href)
  const isClickable = slide.type === 'image' ? Boolean(href) : slide.type === 'text' && hasCta
  const title = slide.title === DEFAULT_HOME_FEATURED_SIDE_CARD_TITLE ? t('Market pulse') : slide.title
  const text =
    slide.text === DEFAULT_HOME_FEATURED_SIDE_CARD_TEXT ? t('Fast movers across active markets.') : slide.text
  const className = cn(
    `group/side-card relative flex h-full min-w-full flex-col overflow-hidden bg-card text-card-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none`,
    slide.type === 'text' && 'p-5',
  )

  const content =
    slide.type === 'video' ? (
      <iframe
        src={isActive ? slide.videoEmbedUrl : undefined}
        title={slide.title || 'Featured video'}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        className="size-full border-0 bg-black"
      />
    ) : slide.type === 'image' ? (
      <>
        <Image
          src={slide.imageUrl}
          alt={slide.ctaLabel.trim()}
          fill
          loading={isActive ? 'eager' : 'lazy'}
          fetchPriority={isActive ? 'high' : 'low'}
          sizes="(min-width: 1024px) 32vw, 280px"
          className="object-cover transition-transform duration-300 group-hover/side-card:scale-[1.02]"
        />
        {slide.ctaLabel.trim() && (
          <span
            className={cn(
              `absolute inset-0 z-1 flex items-end bg-linear-to-t from-black/75 via-black/20 to-transparent p-5 pb-9 text-white opacity-0 transition-opacity duration-200 group-hover/side-card:opacity-100 group-focus-visible/side-card:opacity-100`,
            )}
          >
            <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold">
              <span className="line-clamp-2">{slide.ctaLabel}</span>
              {href && <ChevronRightIcon className="size-4 shrink-0 text-white/75" />}
            </span>
          </span>
        )}
      </>
    ) : (
      <>
        <span className="pointer-events-none absolute bottom-0 left-[30%] h-px w-[40%] bg-linear-to-r from-transparent via-primary/60 to-transparent" />
        <HomeFeaturedSideCardIcon
          name={slide.icon}
          aria-hidden
          className="pointer-events-none absolute -top-6 -right-7 size-36 rotate-6 text-primary/8 transition-transform duration-300 group-hover/side-card:scale-105 motion-safe:animate-pulse"
        />
        <div className="relative z-1 flex min-h-0 flex-1 flex-col py-7">
          <span className="mb-3 h-1 w-10 rounded-full bg-primary/70 shadow-[0_0_18px_color-mix(in_oklab,var(--primary)_32%,transparent)]" />
          <span className="line-clamp-2 max-w-[16rem] text-xl/tight font-semibold tracking-tight">{title}</span>
          <span className={cn('mt-5 text-sm/relaxed text-muted-foreground', hasCta ? 'line-clamp-3' : 'line-clamp-4')}>
            {text}
          </span>
          {hasCta && (
            <span className="mt-auto ml-auto inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-3 text-sm font-medium shadow-sm">
              <span className="truncate">{slide.ctaLabel}</span>
              <ChevronRightIcon className="size-4 shrink-0" />
            </span>
          )}
        </div>
      </>
    )

  if (!isClickable) {
    return <div className={className}>{content}</div>
  }

  return isExternalHref(href) ? (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {content}
    </a>
  ) : requiresDocumentNavigation(href) ? (
    <a href={href} className={className}>
      {content}
    </a>
  ) : (
    <Link href={href} className={className}>
      {content}
    </Link>
  )
}

function FeaturedRightRail({
  hotTopics,
  sideCard,
}: {
  hotTopics: HomeFeaturedHotTopic[]
  sideCard: HomeFeaturedSideCardSettings
}) {
  const t = useExtracted()
  const activeSlides = sideCard.slides.filter((slide) => slide.enabled)
  const [activeIndex, setActiveIndex] = useState(0)
  const [isPaused, setIsPaused] = useState(false)

  if (activeSlides.length === 0) {
    return <FeaturedRightRailSingle hotTopics={hotTopics} sideCard={sideCard} hideSideCard />
  }

  if (activeSlides.length <= 1 && (activeSlides[0]?.type ?? sideCard.type) !== 'video') {
    const slide = activeSlides[0] ?? sideCard
    return <FeaturedRightRailSingle hotTopics={hotTopics} sideCard={{ ...slide, slides: activeSlides }} />
  }

  const safeActiveIndex = activeIndex % activeSlides.length

  return (
    <aside className="hidden h-[clamp(430px,38vw,480px)] min-w-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-4 lg:grid">
      <div
        className="relative min-h-0 overflow-hidden rounded-xl border border-border/70 bg-card shadow-md shadow-black/4"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onFocusCapture={() => setIsPaused(true)}
        onBlurCapture={() => setIsPaused(false)}
      >
        <div
          className="flex size-full transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          style={{ transform: `translateX(-${safeActiveIndex * 100}%)` }}
        >
          {activeSlides.map((slide, index) => (
            <FeaturedSideCardSlide key={slide.id} slide={slide} isActive={index === safeActiveIndex} />
          ))}
        </div>
        {activeSlides.length > 1 && (
          <div
            className="absolute inset-x-0 bottom-2 z-3 flex items-center justify-center gap-1.5"
            role="tablist"
            aria-label={t('Side card slides')}
          >
            {activeSlides.map((slide, index) => (
              <button
                key={slide.id}
                type="button"
                role="tab"
                aria-selected={index === safeActiveIndex}
                aria-label={t('Show slide {number}', { number: String(index + 1) })}
                onClick={() => setActiveIndex(index)}
                className={cn(
                  'relative h-1.5 overflow-hidden rounded-full bg-white/55 shadow-sm ring-1 ring-black/10',
                  index === safeActiveIndex ? `w-8` : `w-1.5 hover:bg-white/80`,
                )}
              >
                {index === safeActiveIndex && (
                  <span
                    key={`${slide.id}-${safeActiveIndex}`}
                    className="absolute inset-y-0 left-0 w-full origin-left animate-[home-featured-pagination-progress_7000ms_linear_forwards] rounded-full bg-primary motion-reduce:animate-none"
                    style={{ animationPlayState: isPaused ? 'paused' : 'running' }}
                    onAnimationEnd={() => {
                      if (!isPaused) {
                        setActiveIndex((current) => (current + 1) % activeSlides.length)
                      }
                    }}
                  />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 overflow-hidden p-1">
        <Link
          href="/predictions?_sort=volume"
          className="group/hot-topics mb-3 inline-flex items-center gap-2 text-foreground"
        >
          <FlameIcon className="size-4 text-no/85" />
          <span className="text-lg font-semibold tracking-tight underline-offset-2 group-hover/hot-topics:underline">
            {t('Hot topics')}
          </span>
          <ChevronRightIcon className="size-4 text-muted-foreground/50" />
        </Link>
        <div className="grid gap-2.5">
          {hotTopics.map((topic, index) => (
            <Link
              key={topic.slug}
              href={topic.href}
              className="group/topic grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md py-0.5"
            >
              <span className="w-3.5 text-xs font-medium text-muted-foreground/65 tabular-nums">{index + 1}</span>
              <span className="truncate text-sm font-medium text-foreground/90 underline-offset-2 group-hover/topic:underline">
                {topic.label}
              </span>
              {topic.volume24h > 0 && (
                <span className="text-xs text-muted-foreground/70 tabular-nums">
                  {t('{amount} Vol.', {
                    amount: formatDollarValueLabel(topic.volume24h, { maximumFractionDigits: 0 }),
                  })}
                </span>
              )}
              <ChevronRightIcon className="col-start-4 size-3.5 text-muted-foreground/60 transition-transform group-hover/topic:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </div>
    </aside>
  )
}

function FeaturedRightRailAction() {
  const t = useExtracted()

  return (
    <div className="hidden lg:block">
      <Button
        variant="outline"
        className={cn(
          `h-10 w-full rounded-full bg-transparent text-muted-foreground shadow-none transition-colors hover:bg-secondary/80 hover:text-foreground dark:bg-transparent dark:hover:bg-secondary/80`,
        )}
        nativeButton={false}
        render={<Link href="/predictions">{t('Expand all')}</Link>}
      />
    </div>
  )
}

function buildHomeFeaturedRolloverQueueState(item: HomeFeaturedEventCard): HomeFeaturedRolloverQueueState {
  return {
    contextItems: item.contextItems,
    sourceContextItems: item.contextItems,
    activeIndex: -1,
    events: item.targetType === 'series' && item.nextSeriesEvent ? [item.nextSeriesEvent] : [],
  }
}

function isTimedLiveFeaturedSeries(item: HomeFeaturedEventCard, event = item.event) {
  return (
    item.targetType === 'series' &&
    shouldUseLiveSeriesChart(item.event, item.liveChartConfig) &&
    resolveHomeFeaturedEventEndTimestamp(event) != null
  )
}

function useHomeFeaturedRolloverItem(item: HomeFeaturedEventCard) {
  const locale = useLocale()
  const isPageVisible = useSyncExternalStore(
    subscribeToFeaturedVisibility,
    getFeaturedVisibilitySnapshot,
    getFeaturedVisibilityServerSnapshot,
  )
  const [queueState, setQueueState] = useState<HomeFeaturedRolloverQueueState>(() =>
    buildHomeFeaturedRolloverQueueState(item),
  )
  const [observedNow, setObservedNow] = useState<number | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const activeIndex = queueState.activeIndex
  const rolloverEvents = queueState.events
  const activeRolloverEvent = activeIndex >= 0 ? (rolloverEvents[activeIndex] ?? null) : null
  const activeEvent = activeRolloverEvent?.event ?? item.event
  const nextRolloverEvent = rolloverEvents[activeIndex + 1] ?? null

  const promoteSuccessor = useCallback(
    (now: number) => {
      setQueueState((current) => {
        const currentEvent = current.events[current.activeIndex]?.event ?? item.event
        const successor = current.events[current.activeIndex + 1]
        if (!successor || !canActivateHomeFeaturedSuccessor(currentEvent, successor.event, now)) {
          return current
        }

        const promotedIndex = current.activeIndex + 1
        return {
          ...current,
          activeIndex: 0,
          contextItems: successor.contextItems,
          events: current.events.slice(promotedIndex),
        }
      })
    },
    [item.event],
  )

  useEffect(
    function preloadFutureFeaturedSeriesEvents() {
      if (
        !shouldPreloadHomeFeaturedRollover(
          item.targetType === 'series',
          isPageVisible && getFeaturedVisibilitySnapshot(),
          nextRolloverEvent?.event ?? null,
          Date.now(),
        )
      ) {
        return
      }

      const controller = new AbortController()
      let preloadTimeoutId: number | null = null
      let retryTimeoutId: number | null = null
      let isActive = true

      function scheduleRolloverRetry() {
        if (isActive && getFeaturedVisibilitySnapshot()) {
          retryTimeoutId = window.setTimeout(loadNextRolloverEvent, HOME_FEATURED_ROLLOVER_RETRY_MS)
        }
      }

      async function loadNextRolloverEvent() {
        if (!isActive || !getFeaturedVisibilitySnapshot()) {
          return
        }
        try {
          const query = new URLSearchParams({
            currentEventSlug: activeEvent.slug,
            featuredId: item.featuredId,
            locale,
          })
          const response = await fetch(`/api/home-featured/series-rollover?${query.toString()}`, {
            cache: 'no-store',
            signal: controller.signal,
          })
          if (!response.ok) {
            throw new Error(`Featured rollover request failed with ${response.status}`)
          }

          const payload = (await response.json()) as {
            currentEventId?: string
            contextItems?: HomeFeaturedContextItem[]
            nextEvent?: HomeFeaturedRolloverEvent | null
          }
          if (!isActive || !getFeaturedVisibilitySnapshot()) {
            return
          }

          setQueueState((current) =>
            applyHomeFeaturedRolloverResponse(current, item.event.id, item.contextItems, payload),
          )
          const now = Date.now()
          setObservedNow(now)
          if (payload.nextEvent && isHomeFeaturedEventCurrent(payload.nextEvent.event, now)) {
            promoteSuccessor(now)
          } else if (!payload.nextEvent || isHomeFeaturedEventEnded(payload.nextEvent.event, now)) {
            scheduleRolloverRetry()
          }
        } catch {
          if (isActive && !controller.signal.aborted) {
            scheduleRolloverRetry()
          }
        }
      }

      function schedulePreload() {
        const preloadDelay = getHomeFeaturedRolloverPreloadDelay(activeEvent, Date.now())
        if (preloadDelay > 0) {
          preloadTimeoutId = window.setTimeout(schedulePreload, Math.min(preloadDelay, 2_147_483_647))
        } else {
          void loadNextRolloverEvent()
        }
      }
      schedulePreload()

      return function cancelFutureFeaturedSeriesEventPreload() {
        isActive = false
        controller.abort()
        if (preloadTimeoutId != null) {
          window.clearTimeout(preloadTimeoutId)
        }
        if (retryTimeoutId != null) {
          window.clearTimeout(retryTimeoutId)
        }
      }
    },
    [
      activeEvent,
      item.contextItems,
      item.event.id,
      item.featuredId,
      item.targetType,
      isPageVisible,
      locale,
      nextRolloverEvent,
      promoteSuccessor,
      refreshToken,
    ],
  )

  useEffect(
    function scheduleFeaturedSeriesRollover() {
      if (item.targetType !== 'series' || !isPageVisible) {
        return
      }

      let timeoutId: number | null = null
      function reconcileTime(refreshIfMissing: boolean) {
        if (timeoutId != null) {
          window.clearTimeout(timeoutId)
          timeoutId = null
        }
        if (!getFeaturedVisibilitySnapshot()) {
          return
        }
        const now = Date.now()
        setObservedNow(now)
        const action = resolveHomeFeaturedRolloverAction(activeEvent, nextRolloverEvent?.event ?? null, now)
        if (action === 'promote') {
          promoteSuccessor(now)
        } else if (action === 'refresh' && refreshIfMissing) {
          setRefreshToken((current) => current + 1)
        }

        const wakeTimestamp = resolveHomeFeaturedRolloverWakeTimestamp(
          activeEvent,
          nextRolloverEvent?.event ?? null,
          now,
        )
        if (wakeTimestamp != null) {
          timeoutId = window.setTimeout(() => reconcileTime(true), Math.max(0, wakeTimestamp - now))
        }
      }
      reconcileTime(false)

      return function cancelFeaturedSeriesRollover() {
        if (timeoutId != null) {
          window.clearTimeout(timeoutId)
        }
      }
    },
    [activeEvent, isPageVisible, item.targetType, nextRolloverEvent, promoteSuccessor],
  )

  const displayedItem = useMemo<HomeFeaturedEventCard>(() => {
    return {
      ...item,
      ...activeRolloverEvent,
      contextItems: resolveHomeFeaturedRolloverContextItems(queueState, item.contextItems),
      nextSeriesEvent: nextRolloverEvent,
    }
  }, [activeRolloverEvent, item, nextRolloverEvent, queueState])

  return {
    item: displayedItem,
    unavailable:
      isTimedLiveFeaturedSeries(item, activeEvent) &&
      observedNow != null &&
      !isHomeFeaturedEventCurrent(activeEvent, observedNow),
    refreshAtClick: (now: number) => {
      setObservedNow(now)
      if (nextRolloverEvent && canActivateHomeFeaturedSuccessor(activeEvent, nextRolloverEvent.event, now)) {
        promoteSuccessor(now)
        return nextRolloverEvent.event
      }
      return null
    },
  }
}

function FeaturedSlide({
  item: sourceItem,
  currentTimestamp,
  isActive,
  isPrevious,
  isNext,
  isChartEnabled,
}: {
  item: HomeFeaturedEventCard
  currentTimestamp: number | null
  isActive: boolean
  isPrevious: boolean
  isNext: boolean
  isChartEnabled: boolean
}) {
  const { item: rolloverItem, unavailable, refreshAtClick } = useHomeFeaturedRolloverItem(sourceItem)
  const t = useExtracted()
  const locale = useLocale()
  const hasHydrated = useHasHydrated()
  const item = useMemo(() => localizeHomeFeaturedMarketDates(rolloverItem, locale), [locale, rolloverItem])
  const isMobile = useIsMobile()
  const linkedHref = resolveFeaturedDestinationHref(item, locale, hasHydrated)
  const shouldRenderChart = isChartEnabled && (isPrevious || isActive || isNext)
  const [chartContainerRef, chartContainerWidth] = useElementWidth<HTMLDivElement>(shouldRenderChart)
  const isSingleMarket = item.event.total_markets_count === 1 || item.event.markets.length === 1
  const chartEvent = useMemo(() => getFeaturedChartEvent(item.event, isSingleMarket), [isSingleMarket, item.event])
  const shouldRenderLiveSeriesChart = Boolean(
    item.liveChartConfig && shouldUseLiveSeriesChart(item.event, item.liveChartConfig),
  )
  const sportsGraphCard = useMemo(
    () => (item.kind === 'sports' ? (buildSportsGamesCards([chartEvent])[0] ?? null) : null),
    [chartEvent, item.kind],
  )
  const sportsGraphSelection = useMemo(
    () => (sportsGraphCard ? resolveSportsGraphSelection(sportsGraphCard) : null),
    [sportsGraphCard],
  )
  const liveChartWidth =
    typeof chartContainerWidth === 'number' && Number.isFinite(chartContainerWidth)
      ? Math.max(1, chartContainerWidth - HOME_FEATURED_LIVE_CHART_WIDTH_OFFSET)
      : undefined
  const hasContextItems = item.contextItems.length > 0
  const featuredDetailsClassName = cn(
    'flex min-h-0 min-w-0 flex-col gap-3',
    !hasContextItems && item.kind !== 'sports' && shouldRenderLiveSeriesChart && 'justify-center',
  )

  const chartNode = (
    <div
      ref={shouldRenderChart ? chartContainerRef : undefined}
      className={cn(
        item.kind === 'sports'
          ? 'relative min-h-[190px] min-w-0 overflow-hidden md:min-h-[210px] lg:min-h-[230px]'
          : 'relative min-h-60 min-w-0 overflow-hidden md:min-h-[260px] lg:min-h-[280px]',
        shouldRenderLiveSeriesChart && 'mt-4 md:mt-5 lg:mt-6',
      )}
    >
      {shouldRenderChart && (
        <EventMarketChannelProvider markets={chartEvent.markets}>
          {shouldRenderLiveSeriesChart && item.liveChartConfig ? (
            <HomeEventLiveSeriesChart
              event={chartEvent}
              isMobile={isMobile}
              seriesEvents={item.seriesEvents}
              config={item.liveChartConfig}
              chartWidth={liveChartWidth}
              chartHeightOffset={HOME_FEATURED_CHART_HEIGHT_OFFSET}
              showSeriesControls={false}
              showAreaFill={false}
              showCurrentPriceGuide={false}
              compactBitcoinHeaderPrices
              preserveSeriesContinuity
              showLiveMarketLink={false}
              featuredChartLayout
            />
          ) : item.kind === 'sports' && sportsGraphCard && sportsGraphSelection ? (
            <HomeSportsGameGraph
              card={sportsGraphCard}
              selectedMarketType={sportsGraphSelection.selectedMarketType}
              selectedConditionId={sportsGraphSelection.selectedConditionId}
              defaultTimeRange="ALL"
              chartHeightOffset={HOME_FEATURED_CHART_HEIGHT_OFFSET}
              variant="sportsEventHero"
              showControls={false}
            />
          ) : (
            <HomeEventChart
              event={chartEvent}
              isMobile={isMobile}
              showControls={false}
              showSeriesNavigation={false}
              showWatermark={false}
              legendVariant="card"
              chartWidth={chartContainerWidth}
              chartHeight={HOME_FEATURED_CHART_HEIGHT}
              isSingleMarketOverride={isSingleMarket}
              forceVisible
            />
          )}
        </EventMarketChannelProvider>
      )}
    </div>
  )
  const chartColumnNode =
    item.kind === 'sports' ? (
      <div className="grid min-h-0 content-start gap-3">
        <SportsScoreboard card={sportsGraphCard} item={item} linkedHref={linkedHref} />
        {chartNode}
      </div>
    ) : (
      chartNode
    )

  function handleFeaturedClickCapture(event: MouseEvent<HTMLElement>) {
    if (!isTimedLiveFeaturedSeries(sourceItem)) {
      return
    }
    const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href]')
    if (!anchor || !isHomeFeaturedEventHref(item.event, anchor.href)) {
      return
    }
    const now = Date.now()
    if (isHomeFeaturedEventCurrent(item.event, now)) {
      return
    }
    const successor = refreshAtClick(now)
    const successorHref = successor && resolveHomeFeaturedSuccessorHref(item.event, successor, anchor.href)
    const destinationHref =
      successorHref ||
      resolveHomeFeaturedLiveLinkFallbackHref(
        item.event,
        anchor.href,
        sourceItem.resolvedSeriesSlug || item.event.series_slug || '',
        locale,
      )
    if (destinationHref) {
      anchor.href = destinationHref
      event.stopPropagation()
      return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  if (unavailable) {
    return (
      <article className="flex h-full min-w-full items-center justify-center p-5 text-center text-sm text-muted-foreground">
        {t('No markets found')}
      </article>
    )
  }

  if (item.kind === 'sports') {
    return (
      <article
        onClickCapture={handleFeaturedClickCapture}
        className={cn(
          `relative flex h-full min-w-full flex-col gap-4 overflow-hidden p-4 pb-[52px] md:p-5 md:pb-[56px]`,
        )}
      >
        <div
          className={cn(
            `grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[minmax(260px,0.8fr)_minmax(320px,1fr)] md:gap-5 lg:grid-cols-[minmax(320px,0.8fr)_minmax(420px,1fr)] lg:gap-6`,
          )}
        >
          <div className={featuredDetailsClassName}>
            <FeaturedHeader item={item} showActions={false} />
            {sportsGraphCard && <SportsFeaturedControls card={sportsGraphCard} linkedHref={linkedHref} />}
            <ContextTicker item={item} currentTimestamp={currentTimestamp} linkedHref={linkedHref} />
          </div>

          {chartColumnNode}
        </div>
        <FeaturedFooter item={item} />
      </article>
    )
  }

  if (shouldRenderLiveSeriesChart) {
    return (
      <article
        onClickCapture={handleFeaturedClickCapture}
        className={cn(
          `relative flex h-full min-w-full flex-col gap-4 overflow-hidden p-4 pb-[52px] md:p-5 md:pb-[56px]`,
        )}
      >
        <div
          className={cn(
            `grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[minmax(240px,0.68fr)_minmax(320px,1fr)] md:gap-5 lg:grid-cols-[minmax(280px,0.68fr)_minmax(420px,1fr)] lg:gap-6`,
          )}
        >
          <div className={featuredDetailsClassName}>
            <FeaturedHeader item={item} showActions={false} />

            {item.kind === 'standard' ? (
              <StandardActions item={item} linkedHref={linkedHref} stacked={!hasContextItems} />
            ) : (
              <OutcomeRows item={item} linkedHref={linkedHref} />
            )}

            <ContextTicker item={item} currentTimestamp={currentTimestamp} linkedHref={linkedHref} />
          </div>

          {chartColumnNode}
        </div>
        <FeaturedFooter item={item} />
      </article>
    )
  }

  return (
    <article
      onClickCapture={handleFeaturedClickCapture}
      className={cn(`relative flex h-full min-w-full flex-col gap-4 overflow-hidden p-4 pb-[52px] md:p-5 md:pb-[56px]`)}
    >
      <FeaturedHeader item={item} />
      <div
        className={cn(
          `grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[minmax(260px,0.8fr)_minmax(320px,1fr)] md:gap-5 lg:grid-cols-[minmax(320px,0.8fr)_minmax(420px,1fr)] lg:gap-6`,
        )}
      >
        <div className={featuredDetailsClassName}>
          {item.kind === 'standard' ? (
            <StandardActions item={item} linkedHref={linkedHref} />
          ) : (
            <OutcomeRows item={item} linkedHref={linkedHref} />
          )}

          <ContextTicker item={item} currentTimestamp={currentTimestamp} linkedHref={linkedHref} />
        </div>

        {chartColumnNode}
      </div>
      <FeaturedFooter item={item} />
    </article>
  )
}

export default function HomeFeaturedEventsCarousel({
  currentTimestamp,
  hotTopics,
  items,
  sideCard,
}: HomeFeaturedEventsCarouselProps) {
  const t = useExtracted()
  const locale = useLocale()
  const [featuredViewportStore] = useState(createFeaturedViewportStore)
  const sectionRef = useCallback(
    (node: HTMLElement | null) => featuredViewportStore.setNode(node),
    [featuredViewportStore],
  )
  const [activeIndex, setActiveIndex] = useState(0)
  const isChartNearViewport = useSyncExternalStore(
    featuredViewportStore.subscribe,
    featuredViewportStore.getSnapshot,
    featuredViewportStore.getServerSnapshot,
  )
  const [isAutoAdvancePaused, setIsAutoAdvancePaused] = useState(false)
  const hasMultipleItems = items.length > 1
  const activeItem = items[activeIndex]
  const previousIndex = items.length === 0 ? 0 : (activeIndex - 1 + items.length) % items.length
  const nextIndex = items.length === 0 ? 0 : (activeIndex + 1) % items.length

  useEffect(
    function preloadFeaturedCharts() {
      if (typeof window === 'undefined') {
        return
      }

      const mediaQuery = window.matchMedia?.('(min-width: 768px)')

      function preloadCharts() {
        if (mediaQuery && !mediaQuery.matches) {
          return
        }

        if (items.some((item) => item.kind === 'sports')) {
          preloadFeaturedChunk(
            () => import('@/app/[locale]/(platform)/sports/_components/_sports-games-center/SportsGameGraph'),
          )
        }

        if (items.some((item) => item.liveChartConfig && shouldUseLiveSeriesChart(item.event, item.liveChartConfig))) {
          preloadFeaturedChunk(() => import('@/app/[locale]/(platform)/event/[slug]/_components/EventLiveSeriesChart'))
        }
      }

      preloadCharts()

      if (!mediaQuery) {
        return
      }

      mediaQuery.addEventListener('change', preloadCharts)
      return () => mediaQuery.removeEventListener('change', preloadCharts)
    },
    [items],
  )

  if (!activeItem) {
    return null
  }

  function goToIndex(nextIndex: number) {
    if (items.length === 0) {
      return
    }

    setActiveIndex((nextIndex + items.length) % items.length)
  }

  function resolveNavigationTitle(title: string | null) {
    if (!title) {
      return null
    }

    const localizedTitle = localizeHomeEventCardTitle(title, locale)
    const fullLidTitleValues = resolveHomeFeaturedFullLidTitleValues(localizedTitle, locale)
    return fullLidTitleValues
      ? t('Will the White House call a full lid by {time}? ({startDate}–{endDate})', fullLidTitleValues)
      : localizedTitle
  }

  const previousTitle = resolveNavigationTitle(activeItem.previousTitle)
  const nextTitle = resolveNavigationTitle(activeItem.nextTitle)

  return (
    <section ref={sectionRef} className="hidden gap-3 md:grid [&_img]:pointer-events-none [&_img]:select-none">
      <div className="grid gap-x-8 gap-y-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.4fr)]">
        <div
          className="h-[clamp(430px,38vw,480px)] overflow-hidden rounded-xl border bg-card shadow-md shadow-black/4"
          onMouseEnter={() => setIsAutoAdvancePaused(true)}
          onMouseLeave={() => setIsAutoAdvancePaused(false)}
          onFocusCapture={() => setIsAutoAdvancePaused(true)}
          onBlurCapture={() => setIsAutoAdvancePaused(false)}
        >
          <div
            className={cn(
              `flex h-full transition-transform duration-420 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none`,
            )}
            style={{ transform: `translateX(-${activeIndex * 100}%)` }}
          >
            {items.map((item, index) => (
              <FeaturedSlide
                key={`${item.featuredId}:${item.event.id}`}
                item={item}
                currentTimestamp={currentTimestamp}
                isActive={index === activeIndex}
                isPrevious={index === previousIndex}
                isNext={index === nextIndex}
                isChartEnabled={isChartNearViewport}
              />
            ))}
          </div>
        </div>

        <FeaturedRightRail hotTopics={hotTopics} sideCard={sideCard} />

        {hasMultipleItems ? (
          <div className="flex items-center justify-between gap-4 px-4 md:px-5 lg:px-6">
            <div className="flex min-w-0 items-center gap-2">
              {items.map((item, index) => (
                <button
                  key={`dot-${item.featuredId}`}
                  type="button"
                  aria-label={t('Show featured market')}
                  aria-current={index === activeIndex ? 'true' : undefined}
                  onClick={() => goToIndex(index)}
                  className={cn(
                    'relative h-2 rounded-full transition-all',
                    index === activeIndex
                      ? 'w-12 overflow-hidden bg-muted-foreground/30'
                      : 'w-2 bg-muted-foreground/35 hover:bg-muted-foreground/60',
                  )}
                >
                  {index === activeIndex && (
                    <span
                      key={`progress-${item.featuredId}-${activeIndex}`}
                      className={cn(
                        `absolute inset-y-0 left-0 w-full origin-left animate-[home-featured-pagination-progress_7000ms_linear_forwards] rounded-full bg-foreground/80 motion-reduce:scale-x-100 motion-reduce:animate-none`,
                      )}
                      style={{ animationPlayState: isAutoAdvancePaused ? 'paused' : 'running' }}
                      onAnimationEnd={() => {
                        if (!isAutoAdvancePaused) {
                          goToIndex(activeIndex + 1)
                        }
                      }}
                    />
                  )}
                </button>
              ))}
            </div>

            <div
              className="flex min-w-0 items-center gap-2"
              onMouseEnter={() => setIsAutoAdvancePaused(true)}
              onMouseLeave={() => setIsAutoAdvancePaused(false)}
              onFocusCapture={() => setIsAutoAdvancePaused(true)}
              onBlurCapture={() => setIsAutoAdvancePaused(false)}
            >
              <Button
                type="button"
                variant="secondary"
                className="group h-10 overflow-visible rounded-full bg-transparent p-0 text-muted-foreground shadow-none hover:bg-transparent hover:text-muted-foreground"
                onClick={() => goToIndex(activeIndex - 1)}
              >
                <span className="relative inline-flex h-10 max-w-60 min-w-10 items-center overflow-hidden rounded-full bg-secondary text-muted-foreground shadow-xs group-hover:bg-secondary/80">
                  <span className="inline-flex h-10 min-w-10 items-center gap-2 px-3 md:px-4">
                    <ChevronLeftIcon className="size-4" />
                    <span className="hidden max-w-44 truncate text-xs md:block">{previousTitle}</span>
                  </span>
                </span>
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="group h-10 overflow-visible rounded-full bg-transparent p-0 text-muted-foreground shadow-none hover:bg-transparent hover:text-muted-foreground"
                onClick={() => goToIndex(activeIndex + 1)}
              >
                <span className="relative inline-flex h-10 max-w-60 min-w-10 items-center overflow-hidden rounded-full bg-secondary text-muted-foreground shadow-xs group-hover:bg-secondary/80">
                  <span className="inline-flex h-10 min-w-10 items-center gap-2 px-3 md:px-4">
                    <span className="hidden max-w-44 truncate text-xs md:block">{nextTitle}</span>
                    <ChevronRightIcon className="size-4" />
                  </span>
                </span>
              </Button>
            </div>
          </div>
        ) : (
          <div />
        )}

        <FeaturedRightRailAction />
      </div>
    </section>
  )
}
