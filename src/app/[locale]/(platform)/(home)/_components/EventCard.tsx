'use client'

import { useExtracted, useLocale } from 'next-intl'
import dynamic from 'next/dynamic'
import { useMemo } from 'react'

import type { EventCardSportsMoneylineProps } from '@/app/[locale]/(platform)/(home)/_components/EventCardSportsMoneyline'
import type { Event, Market } from '@/types'

import EventCardFooter from '@/app/[locale]/(platform)/(home)/_components/EventCardFooter'
import EventCardHeader from '@/app/[locale]/(platform)/(home)/_components/EventCardHeader'
import EventCardMarketsList from '@/app/[locale]/(platform)/(home)/_components/EventCardMarketsList'
import EventCardSingleMarketActions from '@/app/[locale]/(platform)/(home)/_components/EventCardSingleMarketActions'
import {
  resolveEventCardResolvedOutcomeIndex,
  shouldUseResolvedXTracker,
} from '@/app/[locale]/(platform)/(home)/_utils/eventCardResolvedOutcome'
import {
  hasHomeCardMarketChance,
  resolveHomeCardBinaryOutcome,
} from '@/app/[locale]/(platform)/(home)/_utils/homeCardMarketDisplay'
import { useXTrackerTweetCount } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useXTrackerTweetCount'
import { Card, CardContent } from '@/components/ui/card'
import { OUTCOME_INDEX } from '@/lib/constants'
import { resolveCryptoCadenceEventTitle } from '@/lib/crypto-cadence-event'
import { shouldShowEventNewBadge } from '@/lib/event-new-badge'
import { isCurrentHomeLiveSeriesEvent, isEventResolvedLike } from '@/lib/home-events'
import {
  localizeHomeEventCardTitle,
  localizeHomeEventMarketDates,
  resolveHomeFeaturedFullLidTitleValues,
} from '@/lib/home-featured-localization'
import { buildChanceByMarket } from '@/lib/market-chance'
import { buildHomeSportsMoneylineModel } from '@/lib/sports-home-card'
import { cn } from '@/lib/utils'

const EMPTY_PRICE_OVERRIDES: Record<string, number> = {}

const EventCardSportsMoneyline = dynamic<EventCardSportsMoneylineProps>(
  () => import('@/app/[locale]/(platform)/(home)/_components/EventCardSportsMoneyline'),
)

function isMarketResolved(market: Market) {
  return Boolean(market.is_resolved || market.condition?.resolved)
}

function useCanUseXTrackerResolvedOutcomes(event: EventCardProps['event']) {
  return useMemo(() => shouldUseResolvedXTracker(event), [event])
}

function useResolvedOutcomeIndexByConditionId({
  canUseXTrackerResolvedOutcomes,
  event,
  isResolvedEvent,
  totalCount,
}: {
  canUseXTrackerResolvedOutcomes: boolean
  event: EventCardProps['event']
  isResolvedEvent: boolean
  totalCount: number | null
}) {
  return useMemo<Partial<Record<string, typeof OUTCOME_INDEX.YES | typeof OUTCOME_INDEX.NO>>>(() => {
    if (!isResolvedEvent) {
      return {}
    }

    return Object.fromEntries(
      event.markets
        .map((market) => {
          const resolvedOutcomeIndex = resolveEventCardResolvedOutcomeIndex(market, {
            isTweetMarketEvent: canUseXTrackerResolvedOutcomes,
            isTweetMarketFinal: true,
            totalCount,
          })

          return resolvedOutcomeIndex == null ? null : ([market.condition_id, resolvedOutcomeIndex] as const)
        })
        .filter((entry): entry is readonly [string, 0 | 1] => entry != null),
    )
  }, [canUseXTrackerResolvedOutcomes, event.markets, isResolvedEvent, totalCount])
}

interface EventCardProps {
  event: Event
  priceOverridesByMarket?: Record<string, number>
  enableHomeSportsMoneylineLayout?: boolean
  currentTimestamp?: number | null
}

export default function EventCard({
  event: sourceEvent,
  priceOverridesByMarket = EMPTY_PRICE_OVERRIDES,
  enableHomeSportsMoneylineLayout = false,
  currentTimestamp = null,
}: EventCardProps) {
  const locale = useLocale()
  const t = useExtracted()
  const event = useMemo(() => localizeHomeEventMarketDates(sourceEvent, locale), [locale, sourceEvent])
  const isResolvedEvent = isEventResolvedLike(event)
  const canUseXTrackerResolvedOutcomes = useCanUseXTrackerResolvedOutcomes(event)
  const xtrackerTweetCountQuery = useXTrackerTweetCount(event, isResolvedEvent && canUseXTrackerResolvedOutcomes)
  const marketsToDisplay = isResolvedEvent
    ? event.markets
    : (() => {
        const activeMarkets = event.markets.filter((market) => !isMarketResolved(market))
        return activeMarkets.length > 0 ? activeMarkets : event.markets
      })()
  const isSingleMarket = marketsToDisplay.length === 1
  const primaryMarket = marketsToDisplay[0]
  const originalMarketCount = Math.max(event.total_markets_count, event.markets.length)
  const shouldUsePrimaryMarketTitle = !isResolvedEvent && isSingleMarket && originalMarketCount > 1
  const cryptoCadenceTitle = resolveCryptoCadenceEventTitle(event, locale)
  const rawCardTitle =
    cryptoCadenceTitle ??
    (shouldUsePrimaryMarketTitle
      ? primaryMarket?.question || primaryMarket?.short_title || primaryMarket?.title || event.title
      : event.title)
  const localizedCardTitle = localizeHomeEventCardTitle(rawCardTitle, locale)
  const fullLidTitleValues = resolveHomeFeaturedFullLidTitleValues(localizedCardTitle, locale)
  const cardTitle = fullLidTitleValues
    ? t('Will the White House call a full lid by {time}? ({startDate}–{endDate})', fullLidTitleValues)
    : localizedCardTitle
  const yesOutcome = primaryMarket ? resolveHomeCardBinaryOutcome(primaryMarket, OUTCOME_INDEX.YES) : null
  const noOutcome = primaryMarket ? resolveHomeCardBinaryOutcome(primaryMarket, OUTCOME_INDEX.NO) : null
  const shouldShowNewBadge = shouldShowEventNewBadge(event, currentTimestamp)
  const shouldShowLiveBadge =
    !isResolvedEvent &&
    Boolean(event.has_live_chart) &&
    (!event.series_slug?.trim() || currentTimestamp == null || isCurrentHomeLiveSeriesEvent(event, currentTimestamp))
  const chanceByMarket = buildChanceByMarket(event.markets, priceOverridesByMarket)
  const homeSportsMoneylineModel = enableHomeSportsMoneylineLayout ? buildHomeSportsMoneylineModel(event) : null
  const resolvedOutcomeIndexByConditionId = useResolvedOutcomeIndexByConditionId({
    canUseXTrackerResolvedOutcomes,
    event,
    isResolvedEvent,
    totalCount: xtrackerTweetCountQuery.data?.totalCount ?? null,
  })

  function getDisplayChance(marketId: string) {
    return chanceByMarket[marketId] ?? 0
  }

  const primaryDisplayChance =
    primaryMarket && hasHomeCardMarketChance(primaryMarket, priceOverridesByMarket[primaryMarket.condition_id])
      ? getDisplayChance(primaryMarket.condition_id)
      : null
  const roundedPrimaryDisplayChance = primaryDisplayChance == null ? null : Math.round(primaryDisplayChance)
  const endedLabel =
    !isResolvedEvent || !isSingleMarket || !event.resolved_at
      ? null
      : (() => {
          const resolvedDate = new Date(event.resolved_at)
          if (Number.isNaN(resolvedDate.getTime())) {
            return null
          }
          const dateLabel = new Intl.DateTimeFormat(locale, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'UTC',
          }).format(resolvedDate)
          return t('Ended {date}', { date: dateLabel })
        })()
  const resolvedVolume = event.volume ?? 0

  if (homeSportsMoneylineModel) {
    return (
      <EventCardSportsMoneyline
        event={event}
        model={homeSportsMoneylineModel}
        getDisplayChance={getDisplayChance}
        currentTimestamp={currentTimestamp}
      />
    )
  }

  return (
    <Card
      className={cn(
        `group flex h-45 flex-col overflow-hidden rounded-xl shadow-md shadow-black/4 transition-all hover:-translate-y-0.5 hover:shadow-black/8 dark:hover:bg-secondary [&_img]:pointer-events-none [&_img]:select-none`,
      )}
    >
      <CardContent className={cn(`flex h-full flex-col px-3 pt-3 ${isResolvedEvent ? 'pb-3' : 'pb-3 md:pb-1'}`)}>
        <EventCardHeader
          event={event}
          title={cardTitle}
          isSingleMarket={isSingleMarket}
          primaryMarket={primaryMarket}
          roundedPrimaryDisplayChance={roundedPrimaryDisplayChance}
        />

        <div className="flex flex-1 flex-col">
          <div
            className={cn(
              isResolvedEvent && isSingleMarket ? 'mt-6' : isResolvedEvent && !isSingleMarket ? 'mt-1' : 'mt-auto',
            )}
          >
            {!isSingleMarket && (
              <EventCardMarketsList
                event={event}
                markets={marketsToDisplay}
                isResolvedEvent={isResolvedEvent}
                getDisplayChance={getDisplayChance}
                priceOverridesByMarket={priceOverridesByMarket}
                resolvedOutcomeIndexByConditionId={resolvedOutcomeIndexByConditionId}
              />
            )}

            {isSingleMarket && yesOutcome && noOutcome && (
              <EventCardSingleMarketActions
                event={event}
                yesOutcome={yesOutcome}
                noOutcome={noOutcome}
                primaryMarket={primaryMarket}
                isResolvedEvent={isResolvedEvent}
                resolvedOutcomeIndexByConditionId={resolvedOutcomeIndexByConditionId}
              />
            )}
          </div>
        </div>

        <EventCardFooter
          event={event}
          shouldShowNewBadge={shouldShowNewBadge}
          showLiveBadge={shouldShowLiveBadge}
          resolvedVolume={resolvedVolume}
          endedLabel={endedLabel}
        />
      </CardContent>
    </Card>
  )
}
