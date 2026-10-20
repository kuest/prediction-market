import { useExtracted } from 'next-intl'

import type { Event, Market } from '@/types'

import {
  formatHomeCardChanceLabel,
  resolveHomeCardBinaryOutcome,
} from '@/app/[locale]/(platform)/(home)/_utils/homeCardMarketDisplay'
import IntentPrefetchLink from '@/app/[locale]/(platform)/_components/IntentPrefetchLink'
import EventIconImage from '@/components/EventIconImage'
import { useOutcomeLabel } from '@/hooks/useOutcomeLabel'
import { OUTCOME_INDEX } from '@/lib/constants'
import { resolveEventPagePath } from '@/lib/events-routing'
import { isEventResolvedLike } from '@/lib/home-events'
import { cn } from '@/lib/utils'

function normalizeOutcomeText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? ''
}

interface EventCardHeaderProps {
  event: Event
  title: string
  isSingleMarket: boolean
  primaryMarket?: Market
  roundedPrimaryDisplayChance: number | null
}

export default function EventCardHeader({
  event,
  title,
  isSingleMarket,
  primaryMarket,
  roundedPrimaryDisplayChance,
}: EventCardHeaderProps) {
  const t = useExtracted()
  const normalizeOutcomeLabel = useOutcomeLabel()
  const isResolvedEvent = isEventResolvedLike(event)
  const yesOutcome = primaryMarket ? resolveHomeCardBinaryOutcome(primaryMarket, OUTCOME_INDEX.YES) : null
  const noOutcome = primaryMarket ? resolveHomeCardBinaryOutcome(primaryMarket, OUTCOME_INDEX.NO) : null
  const outcomeLabels = new Set([
    normalizeOutcomeText(yesOutcome?.outcome_text),
    normalizeOutcomeText(noOutcome?.outcome_text),
  ])
  const hasStandardYesNoOutcomes = outcomeLabels.has('yes') && outcomeLabels.has('no')
  const hasPrimaryDisplayChance = roundedPrimaryDisplayChance != null
  const isTiedChance = roundedPrimaryDisplayChance === 50
  const leadingOutcomeLabel =
    hasPrimaryDisplayChance && roundedPrimaryDisplayChance > 50 ? yesOutcome?.outcome_text : noOutcome?.outcome_text
  const chanceFooterLabel =
    hasPrimaryDisplayChance && !hasStandardYesNoOutcomes && !isTiedChance
      ? normalizeOutcomeLabel(leadingOutcomeLabel) || t('chance')
      : t('chance')
  const primaryChanceLabel = formatHomeCardChanceLabel(roundedPrimaryDisplayChance)
  const eventHref = resolveEventPagePath(event)
  const isSportsEvent = Boolean(event.sports_event_id || event.sports_sport_slug || event.sports_event_slug)
  const titleNode = (
    <h3
      className={cn(
        `w-full text-sm/5 font-semibold underline-offset-2 transition-colors duration-200 hover:text-foreground hover:underline`,
        isSportsEvent || !isSingleMarket ? 'line-clamp-2' : 'line-clamp-3',
      )}
    >
      {title}
    </h3>
  )

  return (
    <div className="mb-3 flex items-start justify-between">
      <IntentPrefetchLink href={eventHref} className="flex flex-1 items-center gap-2 pr-2">
        <div className="flex size-10 shrink-0 items-center justify-center self-start rounded-sm">
          <EventIconImage
            src={event.icon_url}
            alt={title || event.creator || t('Market')}
            sizes="40px"
            containerClassName="size-full rounded-sm"
          />
        </div>

        {titleNode}
      </IntentPrefetchLink>

      {isSingleMarket && !isResolvedEvent && hasPrimaryDisplayChance && (
        <div className="relative -mt-3 flex flex-col items-center">
          <div className="relative">
            <svg width="72" height="52" viewBox="0 0 72 52" className="rotate-0 transform">
              <path
                d="M 6 46 A 30 30 0 0 1 66 46"
                fill="none"
                stroke="currentColor"
                strokeWidth="5"
                strokeLinecap="round"
                className="text-slate-200 dark:text-slate-600"
              />

              <path
                d="M 6 46 A 30 30 0 0 1 66 46"
                fill="none"
                stroke="currentColor"
                strokeWidth="5"
                strokeLinecap="round"
                className={cn(
                  'transition-all duration-300',
                  hasPrimaryDisplayChance
                    ? roundedPrimaryDisplayChance < 40
                      ? 'text-no'
                      : roundedPrimaryDisplayChance === 50
                        ? 'text-slate-400'
                        : 'text-yes'
                    : 'text-slate-400',
                )}
                strokeDasharray={`${((roundedPrimaryDisplayChance ?? 0) / 100) * 94.25} 94.25`}
                strokeDashoffset="0"
              />
            </svg>

            <div className="absolute inset-0 flex items-center justify-center pt-4">
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{primaryChanceLabel}</span>
            </div>
          </div>

          <div className="-mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">{chanceFooterLabel}</div>
        </div>
      )}
    </div>
  )
}
