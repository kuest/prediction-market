'use client'

import type { ReactNode } from 'react'

import { ChevronDownIcon, GavelIcon, TriangleIcon } from 'lucide-react'
import { useExtracted, useLocale } from 'next-intl'
import { useMemo, useState } from 'react'

import type { EventSeriesEntry } from '@/types'

import {
  isShortLiveSeriesCadence,
  resolveLiveSeriesCountdown,
} from '@/app/[locale]/(platform)/event/[slug]/_utils/eventLiveSeriesChartUtils'
import {
  isLiveSeriesPillStackCadence,
  resolveLiveSeriesPillLabel,
  resolveLiveSeriesPillVisibility,
} from '@/app/[locale]/(platform)/event/[slug]/_utils/eventSeriesPillLabels'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNowTimestamp } from '@/hooks/useNowTimestamp'
import { Link } from '@/i18n/navigation'
import { resolveEventPagePath } from '@/lib/events-routing'
import { cn } from '@/lib/utils'

const MAX_PAST_RESULT_BADGES = 5
const DEFAULT_LIVE_TRADING_WINDOW_MS = 24 * 60 * 60 * 1000
const seriesDateFormatters = new Map<string, Intl.DateTimeFormat>()

function formatSeriesDate(date: Date, locale: string, options: Intl.DateTimeFormatOptions) {
  const key = JSON.stringify([locale, options])
  let formatter = seriesDateFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options)
    seriesDateFormatters.set(key, formatter)
  }
  return formatter.format(date)
}

function parseSeriesEventDate(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed) ? `${trimmed.replace(' ', 'T')}Z` : trimmed
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed
}

function getSeriesEventDate(event: EventSeriesEntry) {
  return (
    parseSeriesEventDate(event.end_date) ??
    parseSeriesEventDate(event.resolved_at) ??
    parseSeriesEventDate(event.created_at)
  )
}

function getSeriesEventTimestamp(event: EventSeriesEntry) {
  const date = getSeriesEventDate(event)
  return date ? date.getTime() : Number.NEGATIVE_INFINITY
}

function isSeriesEventResolved(event: EventSeriesEntry) {
  if (event.status === 'resolved') {
    return true
  }

  return parseSeriesEventDate(event.resolved_at) !== null
}

function getSeriesEventLabel(event: EventSeriesEntry, locale = 'en-US', fallback = 'Unknown date') {
  const date = getSeriesEventDate(event)
  return date
    ? formatSeriesDate(date, locale, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : fallback
}

function getSeriesEventLabelWithYear(
  event: EventSeriesEntry,
  timeZone: string,
  locale = 'en-US',
  fallback = 'Unknown date',
) {
  const date = getSeriesEventDate(event)
  return date
    ? formatSeriesDate(date, locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone,
      })
    : fallback
}

function getSeriesEventTimeLabel(event: EventSeriesEntry, timeZone: string, locale = 'en-US') {
  const date = getSeriesEventDate(event)
  return date
    ? formatSeriesDate(date, locale, {
        hour: 'numeric',
        minute: '2-digit',
        timeZone,
      })
    : '--'
}

function getSeriesEventPillTimeLabel(
  event: EventSeriesEntry,
  timeZone: string,
  showMinutes = false,
  padHour = false,
  locale = 'en-US',
) {
  const date = getSeriesEventDate(event)
  return date
    ? formatSeriesDate(date, locale, {
        hour: padHour ? '2-digit' : 'numeric',
        ...(showMinutes ? { minute: '2-digit' as const } : {}),
        timeZone,
      })
    : '--'
}

function getResolvedDirection(event: EventSeriesEntry) {
  if (event.resolved_direction === 'up' || event.resolved_direction === 'down') {
    return event.resolved_direction
  }

  return null
}

function isSeriesEventTradingNow(event: EventSeriesEntry, nowTimestamp: number, tradingWindowMs: number) {
  const eventTimestamp = getSeriesEventTimestamp(event)
  if (!Number.isFinite(eventTimestamp)) {
    return false
  }

  const tradingWindowStart = eventTimestamp - tradingWindowMs
  return nowTimestamp >= tradingWindowStart && nowTimestamp < eventTimestamp
}

function useSeriesNavigation({
  currentEventSlug,
  seriesEvents,
  nowTimestamp,
  tradingWindowMs,
}: {
  currentEventSlug: string | undefined
  seriesEvents: EventSeriesEntry[]
  nowTimestamp: number | null
  tradingWindowMs: number
}) {
  return useMemo(() => {
    const filteredSeriesEvents = seriesEvents.filter((event) => Boolean(event?.slug))
    const hasComparableSeriesEvents = filteredSeriesEvents.some((event) => event.slug !== currentEventSlug)
    const currentEvent = filteredSeriesEvents.find((event) => event.slug === currentEventSlug) ?? null

    const past = filteredSeriesEvents
      .filter((event) => isSeriesEventResolved(event))
      .sort((a, b) => getSeriesEventTimestamp(b) - getSeriesEventTimestamp(a))

    const unresolved = filteredSeriesEvents
      .filter((event) => !isSeriesEventResolved(event))
      .sort((a, b) => getSeriesEventTimestamp(a) - getSeriesEventTimestamp(b))

    const currentTradingEvent =
      nowTimestamp === null
        ? null
        : (unresolved.find((event) => isSeriesEventTradingNow(event, nowTimestamp, tradingWindowMs)) ??
          unresolved.find((event) => {
            const eventTimestamp = getSeriesEventTimestamp(event)
            return Number.isFinite(eventTimestamp) && eventTimestamp > nowTimestamp
          }) ??
          (currentEvent && !isSeriesEventResolved(currentEvent) ? currentEvent : null))
    const hasUnresolvedCurrentEvent = Boolean(currentEvent && !isSeriesEventResolved(currentEvent))

    return {
      pastResolvedEvents: past,
      unresolvedEvents: unresolved,
      currentResolvedEvent: currentEvent && isSeriesEventResolved(currentEvent) ? currentEvent : null,
      currentTradingEventId: currentTradingEvent?.id ?? null,
      hasSeriesNavigation:
        (hasComparableSeriesEvents && (past.length > 0 || unresolved.length > 0)) || hasUnresolvedCurrentEvent,
    }
  }, [currentEventSlug, nowTimestamp, seriesEvents, tradingWindowMs])
}

function isSameEtDay(leftTimestamp: number, rightTimestamp: number) {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }

  return (
    formatSeriesDate(new Date(leftTimestamp), 'en-CA', options) ===
    formatSeriesDate(new Date(rightTimestamp), 'en-CA', options)
  )
}

type EventSeriesPillsVariant = 'header' | 'live'

interface EventSeriesPillsProps {
  currentEventSlug?: string
  isDailySeries?: boolean
  seriesEvents?: EventSeriesEntry[]
  tradingWindowMs?: number
  variant?: EventSeriesPillsVariant
  rightSlot?: ReactNode
}

function ResolutionTimeTooltipRows({ event }: { event: EventSeriesEntry }) {
  const t = useExtracted()
  const locale = useLocale()
  const unknownDateLabel = t('Unknown date')
  const etDateLabel = getSeriesEventLabelWithYear(event, 'America/New_York', locale, unknownDateLabel)
  const etTimeLabel = getSeriesEventTimeLabel(event, 'America/New_York', locale)
  const utcDateLabel = getSeriesEventLabelWithYear(event, 'UTC', locale, unknownDateLabel)
  const utcTimeLabel = getSeriesEventTimeLabel(event, 'UTC', locale)

  return (
    <div className="grid gap-2 text-sm text-foreground">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            `inline-flex h-6 min-w-9 items-center justify-center rounded-md bg-muted px-2 text-xs font-semibold`,
          )}
        >
          ET
        </span>
        <span className="tabular-nums">{etDateLabel}</span>
        <span className="ml-auto tabular-nums">{etTimeLabel}</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            `inline-flex h-6 min-w-9 items-center justify-center rounded-md bg-muted px-2 text-xs font-semibold`,
          )}
        >
          UTC
        </span>
        <span className="tabular-nums">{utcDateLabel}</span>
        <span className="ml-auto tabular-nums">{utcTimeLabel}</span>
      </div>
    </div>
  )
}

function SeriesEventCountdownHoverCardContent({
  event,
  nowTimestamp,
  showLiveBadge,
}: {
  event: EventSeriesEntry
  nowTimestamp: number
  showLiveBadge: boolean
}) {
  const t = useExtracted()
  const endTimestamp = getSeriesEventTimestamp(event)
  const hasEndTimestamp = Number.isFinite(endTimestamp)
  const isEnded = hasEndTimestamp && nowTimestamp >= endTimestamp
  const countdown = hasEndTimestamp ? resolveLiveSeriesCountdown(endTimestamp, nowTimestamp) : null
  const countdownLeftLabel = countdown
    ? [
        countdown.showDays
          ? `${countdown.days} ${t('{count, plural, one {Day} other {Days}}', { count: countdown.days })}`
          : null,
        `${countdown.hours} ${t('{count, plural, one {Hour} other {Hours}}', { count: countdown.hours })}`,
        `${countdown.minutes} ${t('{count, plural, one {Minute} other {Minutes}}', { count: countdown.minutes })}`,
        ...(!countdown.showDays
          ? [`${countdown.seconds} ${t('{count, plural, one {Second} other {Seconds}}', { count: countdown.seconds })}`]
          : []),
      ]
        .filter((value): value is string => value !== null)
        .join(' ')
    : '--'

  return (
    <HoverCardContent align="center" className="w-72 rounded-xl p-3 text-left">
      <div className="grid gap-2.5">
        <div className={cn('flex items-center gap-3', showLiveBadge ? 'justify-between' : 'justify-start')}>
          {showLiveBadge && (
            <div className="inline-flex items-center gap-2 text-red-500">
              <span className="relative inline-flex size-2.5 items-center justify-center">
                <span className="absolute inset-0 m-auto inline-flex size-2.5 animate-ping rounded-full bg-red-500/45" />
                <span className="relative inline-flex size-2 rounded-full bg-red-500" />
              </span>
              <span className="text-xs font-semibold tracking-[0.08em] uppercase">{t('Live')}</span>
            </div>
          )}
          <div className="text-sm">
            <span className="font-semibold text-foreground">
              {isEnded ? t('Event ended') : t('{time} left', { time: countdownLeftLabel })}
            </span>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">{t('Resolution time')}</div>
        <ResolutionTimeTooltipRows event={event} />
      </div>
    </HoverCardContent>
  )
}

export default function EventSeriesPills({
  currentEventSlug,
  isDailySeries = false,
  seriesEvents = [],
  tradingWindowMs = DEFAULT_LIVE_TRADING_WINDOW_MS,
  variant = 'header',
  rightSlot,
}: EventSeriesPillsProps) {
  const t = useExtracted()
  const locale = useLocale()
  const unknownDateLabel = t('Unknown date')
  function eventLabel(event: EventSeriesEntry) {
    return getSeriesEventLabel(event, locale, unknownDateLabel)
  }
  function eventPillTimeLabel(event: EventSeriesEntry, timeZone: string, showMinutes = false, padHour = false) {
    return getSeriesEventPillTimeLabel(event, timeZone, showMinutes, padHour, locale)
  }
  const [isPastMenuOpen, setIsPastMenuOpen] = useState(false)
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false)
  const [hoveredPastBadgeId, setHoveredPastBadgeId] = useState<string | null>(null)
  const nowTimestamp = useNowTimestamp()

  const { pastResolvedEvents, unresolvedEvents, currentResolvedEvent, currentTradingEventId, hasSeriesNavigation } =
    useSeriesNavigation({
      currentEventSlug,
      seriesEvents,
      nowTimestamp,
      tradingWindowMs,
    })

  if (nowTimestamp === null) {
    return rightSlot ? <div className="flex justify-end">{rightSlot}</div> : null
  }

  if (!hasSeriesNavigation && !rightSlot) {
    return null
  }

  const shouldShowPastDropdown = pastResolvedEvents.length > 0
  const hasRightSlot = Boolean(rightSlot)

  if (variant === 'live') {
    const isShortCadence = isShortLiveSeriesCadence(tradingWindowMs)
    const usesIntradayPillLabels = isLiveSeriesPillStackCadence(tradingWindowMs)
    const { visibleEvents, overflowEvents } = resolveLiveSeriesPillVisibility({
      currentEventSlug,
      currentTradingEventId,
      events: unresolvedEvents,
      shouldStack: usesIntradayPillLabels,
    })
    const pastResultBadges = pastResolvedEvents
      .filter((event) => event.slug !== currentEventSlug)
      .map((event) => ({
        event,
        direction: getResolvedDirection(event),
      }))
      .filter((entry): entry is { event: EventSeriesEntry; direction: 'up' | 'down' } => entry.direction !== null)
      .slice(0, MAX_PAST_RESULT_BADGES)
      .reverse()

    return (
      <div className={cn('flex flex-wrap items-center gap-2', hasRightSlot && 'justify-between gap-3')}>
        <div className="flex flex-wrap items-center gap-2">
          {hasSeriesNavigation && shouldShowPastDropdown && (
            <DropdownMenu open={isPastMenuOpen} onOpenChange={setIsPastMenuOpen} modal={false}>
              <div
                className={cn(
                  'inline-flex h-[34px] items-center rounded-full bg-muted px-1 text-xs font-semibold',
                  'text-foreground',
                )}
              >
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className={cn(
                        'inline-flex h-[34px] items-center gap-1.5 rounded-full pr-1 pl-2.5 transition-colors',
                        'hover:bg-muted/85',
                      )}
                    />
                  }
                >
                  <span>{t('Past')}</span>
                  <ChevronDownIcon className={cn('size-4 transition-transform', isPastMenuOpen && 'rotate-180')} />
                </DropdownMenuTrigger>

                {pastResultBadges.length > 0 && (
                  <>
                    <span className="mr-2 ml-0.5 h-4 w-px bg-border" />
                    <span className="inline-flex items-center gap-1 pr-2.5">
                      {pastResultBadges.map(({ event, direction }) => {
                        const isUp = direction === 'up'
                        const shouldDim = hoveredPastBadgeId !== null && hoveredPastBadgeId !== event.id
                        const resultLabel = usesIntradayPillLabels
                          ? eventPillTimeLabel(event, 'America/New_York', isShortCadence)
                          : eventLabel(event)
                        return (
                          <Tooltip key={event.id}>
                            <TooltipTrigger
                              render={
                                <Link
                                  href={resolveEventPagePath(event)}
                                  aria-label={resultLabel}
                                  className={cn(
                                    `inline-flex size-4 items-center justify-center rounded-full transition-transform duration-150`,
                                    'hover:scale-105',
                                    shouldDim && 'opacity-55',
                                    isUp ? 'bg-emerald-500' : 'bg-red-500',
                                  )}
                                  onMouseEnter={() => setHoveredPastBadgeId(event.id)}
                                  onMouseLeave={() => setHoveredPastBadgeId(null)}
                                >
                                  <TriangleIcon
                                    className={cn('size-2.5 text-white', !isUp && 'rotate-180')}
                                    fill="currentColor"
                                    stroke="none"
                                  />
                                </Link>
                              }
                            />
                            <TooltipContent align="center" className="px-2 py-1 text-xs">
                              {resultLabel}
                            </TooltipContent>
                          </Tooltip>
                        )
                      })}
                    </span>
                  </>
                )}
              </div>

              <DropdownMenuContent
                side="top"
                align="start"
                className="z-20 max-h-80 min-w-44 overflow-y-auto rounded-lg p-0.5"
              >
                {pastResolvedEvents.map((event) => {
                  const isCurrentEvent = event.slug === currentEventSlug
                  const etTimeLabel = `${eventPillTimeLabel(event, 'America/New_York', true, true)} ET`

                  if (isCurrentEvent) {
                    return (
                      <DropdownMenuItem
                        key={event.id}
                        disabled
                        className={cn(
                          'cursor-default rounded-md py-1.5 text-xs data-disabled:opacity-100',
                          'bg-muted/35 text-muted-foreground',
                        )}
                      >
                        <span className="flex w-full items-center gap-2">
                          <GavelIcon className="size-3.5 shrink-0 text-foreground" />
                          <span className="text-xs font-semibold text-foreground">{etTimeLabel}</span>
                          <span className="size-1 rounded-full bg-foreground/70" />
                          <span className="text-xs text-muted-foreground">{eventLabel(event)}</span>
                        </span>
                      </DropdownMenuItem>
                    )
                  }

                  return (
                    <DropdownMenuLinkItem
                      key={event.id}
                      render={<Link href={resolveEventPagePath(event)} className="flex w-full items-center gap-2" />}
                      className="cursor-pointer rounded-md py-1.5 text-xs"
                    >
                      <GavelIcon className="size-3.5 shrink-0 text-foreground" />
                      <span className="text-xs font-semibold text-foreground">{etTimeLabel}</span>
                      <span className="size-1 rounded-full bg-foreground/70" />
                      <span className="text-xs text-muted-foreground">{eventLabel(event)}</span>
                    </DropdownMenuLinkItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {hasSeriesNavigation && currentResolvedEvent && (
            <span
              className={cn(
                'inline-flex h-[34px] items-center rounded-full bg-foreground px-3 text-xs leading-none font-semibold',
                'text-background',
              )}
            >
              {t('Ended {date}', { date: eventLabel(currentResolvedEvent) })}
            </span>
          )}

          {hasSeriesNavigation &&
            visibleEvents.map((event) => {
              const isCurrentEvent = event.slug === currentEventSlug
              const eventTimestamp = getSeriesEventTimestamp(event)
              const isTradingNow = event.id === currentTradingEventId
              const isTodayInEt = Number.isFinite(eventTimestamp) && isSameEtDay(eventTimestamp, nowTimestamp)
              const etTimeLabel = eventPillTimeLabel(event, 'America/New_York', isShortCadence)
              const pillLabel = resolveLiveSeriesPillLabel({
                dateLabel: eventLabel(event),
                isDailySeries,
                isToday: isTodayInEt,
                timeLabel: etTimeLabel,
              })

              return (
                <HoverCard key={event.id}>
                  <HoverCardTrigger
                    render={
                      <Link
                        href={resolveEventPagePath(event)}
                        className={cn(
                          `inline-flex h-[34px] cursor-pointer items-center rounded-full px-3 text-xs leading-none font-semibold transition-colors`,
                          isCurrentEvent
                            ? 'bg-foreground text-background hover:bg-foreground/90'
                            : 'bg-muted text-foreground hover:bg-muted/80',
                          isTradingNow && 'gap-1.5',
                        )}
                      >
                        {isTradingNow && (
                          <span className="relative inline-flex size-2 items-center justify-center">
                            <span
                              className={cn(
                                'absolute inset-0 m-auto inline-flex size-2 animate-ping rounded-full',
                                'bg-red-500/50',
                              )}
                            />
                            <span className="relative inline-flex size-1.5 rounded-full bg-red-500" />
                          </span>
                        )}
                        <span>{pillLabel}</span>
                      </Link>
                    }
                  />
                  <SeriesEventCountdownHoverCardContent
                    event={event}
                    nowTimestamp={nowTimestamp}
                    showLiveBadge={isTradingNow}
                  />
                </HoverCard>
              )
            })}

          {hasSeriesNavigation && overflowEvents.length > 0 && (
            <DropdownMenu open={isMoreMenuOpen} onOpenChange={setIsMoreMenuOpen} modal={false}>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className={cn(
                      `inline-flex h-[34px] items-center gap-1.5 rounded-full bg-muted px-3 text-xs leading-none font-semibold text-foreground transition-colors hover:bg-muted/80`,
                    )}
                  />
                }
              >
                <span>{t('More')}</span>
                <ChevronDownIcon className={cn('size-4 transition-transform', isMoreMenuOpen && 'rotate-180')} />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="end"
                className="z-20 max-h-80 min-w-fit overflow-y-auto rounded-lg p-0.5"
              >
                {overflowEvents.map((event) => {
                  const eventTimestamp = getSeriesEventTimestamp(event)
                  const isTodayInEt = Number.isFinite(eventTimestamp) && isSameEtDay(eventTimestamp, nowTimestamp)
                  const etTimeLabel = `${eventPillTimeLabel(event, 'America/New_York', true, true)} ET`

                  return (
                    <DropdownMenuLinkItem
                      key={event.id}
                      render={<Link href={resolveEventPagePath(event)} className="flex w-full items-center gap-2" />}
                      className="cursor-pointer rounded-md py-1.5 text-xs"
                    >
                      <span className="shrink-0 font-semibold text-foreground tabular-nums">{etTimeLabel}</span>
                      <span className="size-1 rounded-full bg-foreground/70" />
                      <span className="text-muted-foreground">{isTodayInEt ? t('Today') : eventLabel(event)}</span>
                    </DropdownMenuLinkItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {rightSlot && <div className="ml-auto">{rightSlot}</div>}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', hasRightSlot && 'justify-between gap-3')}>
      <div className="flex flex-wrap items-center gap-2">
        {hasSeriesNavigation && shouldShowPastDropdown && (
          <DropdownMenu open={isPastMenuOpen} onOpenChange={setIsPastMenuOpen} modal={false}>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className={cn(
                    `inline-flex h-8 items-center gap-1.5 rounded-full bg-muted px-3 text-xs leading-none font-semibold text-foreground transition-colors hover:bg-muted/80`,
                  )}
                />
              }
            >
              <span>{t('Past')}</span>
              <ChevronDownIcon className={cn('size-4 transition-transform', isPastMenuOpen && 'rotate-180')} />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className={cn(
                `z-20 max-h-80 min-w-44 scrollbar-none overflow-y-auto p-1 [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden`,
              )}
            >
              {pastResolvedEvents.map((event) => {
                const isCurrentEvent = event.slug === currentEventSlug
                const etTimeLabel = `${eventPillTimeLabel(event, 'America/New_York', true, true)} ET`

                if (isCurrentEvent) {
                  return (
                    <DropdownMenuItem
                      key={event.id}
                      disabled
                      className={cn(
                        `cursor-default bg-muted/70 py-1.5 text-xs font-medium text-muted-foreground data-disabled:opacity-100`,
                      )}
                    >
                      <span className="flex w-full items-center gap-2">
                        <GavelIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="font-semibold tabular-nums">{etTimeLabel}</span>
                        <span className="size-1 rounded-full bg-foreground/70" />
                        <span>{eventLabel(event)}</span>
                      </span>
                    </DropdownMenuItem>
                  )
                }

                return (
                  <DropdownMenuLinkItem
                    key={event.id}
                    render={<Link href={resolveEventPagePath(event)} className="flex w-full items-center gap-2" />}
                    className="cursor-pointer py-1.5 text-xs font-medium"
                  >
                    <GavelIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-semibold tabular-nums">{etTimeLabel}</span>
                    <span className="size-1 rounded-full bg-foreground/70" />
                    <span>{eventLabel(event)}</span>
                  </DropdownMenuLinkItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {hasSeriesNavigation && currentResolvedEvent && (
          <span
            className={cn(
              `inline-flex h-8 items-center rounded-full bg-foreground px-3 text-xs leading-none font-semibold text-background`,
            )}
          >
            {t('Ended {date}', { date: eventLabel(currentResolvedEvent) })}
          </span>
        )}

        {hasSeriesNavigation &&
          unresolvedEvents.map((event) => {
            const isCurrent = event.slug === currentEventSlug
            return (
              <Link
                key={event.id}
                href={resolveEventPagePath(event)}
                className={cn(
                  `inline-flex h-8 items-center rounded-full px-3 text-xs leading-none font-semibold transition-colors`,
                  isCurrent
                    ? 'bg-foreground text-background hover:bg-foreground/90'
                    : 'bg-muted text-foreground hover:bg-muted/80',
                )}
              >
                {eventLabel(event)}
              </Link>
            )
          })}
      </div>

      {rightSlot && <div className="ml-auto">{rightSlot}</div>}
    </div>
  )
}
