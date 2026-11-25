'use client'

import { ExternalLinkIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'
import dynamic from 'next/dynamic'
import { useMemo } from 'react'

import type { SportsGamesCard } from '@/app/[locale]/(platform)/sports/_utils/sports-games-data'
import type { Market } from '@/types'

import EventRules from '@/app/[locale]/(platform)/event/[slug]/_components/EventRules'
import ResolutionTimelinePanel from '@/app/[locale]/(platform)/event/[slug]/_components/ResolutionTimelinePanel'
import { shouldDisplayResolutionTimeline } from '@/app/[locale]/(platform)/event/[slug]/_utils/resolution-timeline-builder'
import { Skeleton } from '@/components/ui/skeleton'
import { useSiteIdentity } from '@/hooks/useSiteIdentity'
import { buildUmaProposeUrl, buildUmaSettledUrl } from '@/lib/uma'
import { cn } from '@/lib/utils'

const EventMarketContext = dynamic(
  () => import('@/app/[locale]/(platform)/event/[slug]/_components/EventMarketContext'),
  { ssr: false, loading: () => <Skeleton className="h-18" /> },
)

interface SportsEventAboutPanelProps {
  event: SportsGamesCard['event']
  rulesEvent?: SportsGamesCard['event'] | null
  market: Market | null
  marketContextEnabled?: boolean
  mode?: 'inline' | 'page'
}

function useAboutPanelDerivations({
  event,
  rulesEvent,
  market,
  siteIdentityName,
}: {
  event: SportsGamesCard['event']
  rulesEvent?: SportsGamesCard['event'] | null
  market: Market | null
  siteIdentityName: string
}) {
  const aboutRulesEvent = useMemo(() => {
    const sourceEvent = rulesEvent ?? event
    if (!market) {
      return sourceEvent
    }

    const prioritizedMarket = sourceEvent.markets.find((item) => item.condition_id === market.condition_id)
    const marketRules = market.market_rules?.trim() || prioritizedMarket?.market_rules?.trim() || sourceEvent.rules
    return {
      ...sourceEvent,
      rules: marketRules || sourceEvent.rules,
      markets: [
        prioritizedMarket ?? market,
        ...sourceEvent.markets.filter((item) => item.condition_id !== market.condition_id),
      ],
    }
  }, [event, market, rulesEvent])

  const shouldShowResolution = useMemo(() => Boolean(market && shouldDisplayResolutionTimeline(market)), [market])

  const resolutionDetailsUrl = useMemo(
    () =>
      market
        ? (buildUmaSettledUrl(market.condition, siteIdentityName) ??
          buildUmaProposeUrl(market.condition, siteIdentityName))
        : null,
    [market, siteIdentityName],
  )

  return { aboutRulesEvent, shouldShowResolution, resolutionDetailsUrl }
}

export default function SportsEventAboutPanel({
  event,
  rulesEvent,
  market,
  marketContextEnabled = false,
  mode = 'inline',
}: SportsEventAboutPanelProps) {
  const t = useExtracted()
  const siteIdentity = useSiteIdentity()
  const { aboutRulesEvent, shouldShowResolution, resolutionDetailsUrl } = useAboutPanelDerivations({
    event,
    rulesEvent,
    market,
    siteIdentityName: siteIdentity.name,
  })
  const isInline = mode === 'inline'

  if (!isInline) {
    return (
      <div className="grid gap-6">
        {marketContextEnabled && <EventMarketContext event={event} marketConditionId={market?.condition_id ?? null} />}
        <EventRules event={aboutRulesEvent} marketConditionId={market?.condition_id} showEndDate />

        {market && shouldShowResolution && (
          <div className="rounded-xl border bg-background p-4">
            <div className="grid gap-3">
              <ResolutionTimelinePanel market={market} settledUrl={null} showLink={false} />
              {resolutionDetailsUrl && (
                <a
                  href={resolutionDetailsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:underline"
                >
                  <span>{t('View details')}</span>
                  <ExternalLinkIcon className="size-3.5" />
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="grid gap-3 pb-2">
      <EventRules event={aboutRulesEvent} marketConditionId={market?.condition_id} mode="inline" showEndDate />

      {market && shouldShowResolution && (
        <section className="grid gap-2">
          <h4 className="text-base font-medium text-foreground">{t('Resolution')}</h4>
          <div
            className={cn(
              'grid gap-2',
              resolutionDetailsUrl && 'sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4',
            )}
          >
            <ResolutionTimelinePanel market={market} settledUrl={null} showLink={false} className="min-w-0" />
            {resolutionDetailsUrl && (
              <a
                href={resolutionDetailsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  `inline-flex items-center gap-1.5 justify-self-start text-sm font-medium text-muted-foreground hover:underline sm:justify-self-end`,
                )}
              >
                <span>{t('View details')}</span>
                <ExternalLinkIcon className="size-3.5" />
              </a>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
