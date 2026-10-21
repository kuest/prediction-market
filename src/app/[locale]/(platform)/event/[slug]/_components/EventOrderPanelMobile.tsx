import type { ReactNode } from 'react'

import { useExtracted } from 'next-intl'

import type { EventOrderPanelOutcomeSelectedAccent } from '@/app/[locale]/(platform)/event/[slug]/_components/EventOrderPanelOutcomeButton'
import type { OddsFormat } from '@/lib/odds-format'
import type { Event, Market, Outcome } from '@/types'

import { MOBILE_BOTTOM_NAV_OFFSET } from '@/app/[locale]/(platform)/_lib/mobile-bottom-nav'
import EventOrderPanelForm from '@/app/[locale]/(platform)/event/[slug]/_components/EventOrderPanelForm'
import EventOrderPanelTermsDisclaimer from '@/app/[locale]/(platform)/event/[slug]/_components/EventOrderPanelTermsDisclaimer'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { useOutcomeLabel } from '@/hooks/useOutcomeLabel'
import { ORDER_SIDE, OUTCOME_INDEX } from '@/lib/constants'
import { formatCentsLabel } from '@/lib/formatters'
import { resolveFallbackOutcomeUnitPrice, resolveMarketOutcome } from '@/lib/market-pricing'
import { formatOddsFromPrice } from '@/lib/odds-format'
import {
  selectOrderOutcomeAtDisplayedPrice,
  useIsSingleMarket,
  useOrder,
  useOutcomeTopOfBookPrice,
} from '@/stores/useOrder'

interface EventMobileOrderPanelProps {
  event: Event
  initialMarket?: Market | null
  initialOutcome?: Outcome | null
  showDefaultTrigger?: boolean
  mobileMarketInfo?: ReactNode
  primaryOutcomeIndex?: number | null
  oddsFormat?: OddsFormat
  outcomeButtonStyleVariant?: 'default' | 'sports3d'
  outcomeLabelOverrides?: Partial<Record<number, string>>
  outcomeAccentOverrides?: Partial<Record<number, EventOrderPanelOutcomeSelectedAccent>>
  optimisticallyClaimedConditionIds?: Record<string, true>
}

export default function EventOrderPanelMobile({
  event,
  initialMarket = null,
  initialOutcome = null,
  showDefaultTrigger = true,
  mobileMarketInfo,
  primaryOutcomeIndex = null,
  oddsFormat = 'price',
  outcomeButtonStyleVariant = 'default',
  outcomeLabelOverrides = {},
  outcomeAccentOverrides = {},
  optimisticallyClaimedConditionIds,
}: EventMobileOrderPanelProps) {
  const t = useExtracted()
  const normalizeOutcomeLabel = useOutcomeLabel()
  const state = useOrder()
  const hasMatchingStoreEvent = state.event?.id === event.id
  const hasMatchingStoreMarket = Boolean(
    state.market && event.markets.some((market) => market.condition_id === state.market?.condition_id),
  )
  const activeEvent: Event = hasMatchingStoreEvent && state.event ? state.event : event
  const activeMarket = hasMatchingStoreMarket ? state.market : initialMarket
  const fallbackOutcome = initialOutcome ?? activeMarket?.outcomes[0] ?? null
  const hasMatchingStoreOutcome = Boolean(
    state.outcome && activeMarket && state.outcome.condition_id === activeMarket.condition_id,
  )
  const activeOutcome = hasMatchingStoreOutcome ? state.outcome : fallbackOutcome
  const isSingleMarket = useIsSingleMarket() || activeEvent.total_markets_count === 1
  const liveYesPrice = useOutcomeTopOfBookPrice(OUTCOME_INDEX.YES, ORDER_SIDE.BUY)
  const liveNoPrice = useOutcomeTopOfBookPrice(OUTCOME_INDEX.NO, ORDER_SIDE.BUY)
  const activeLiveYesPrice = hasMatchingStoreMarket ? liveYesPrice : null
  const activeLiveNoPrice = hasMatchingStoreMarket ? liveNoPrice : null
  const yesOutcome = resolveMarketOutcome(activeMarket, OUTCOME_INDEX.YES)
  const noOutcome = resolveMarketOutcome(activeMarket, OUTCOME_INDEX.NO)
  const yesPrice = activeLiveYesPrice ?? resolveFallbackOutcomeUnitPrice(activeMarket, yesOutcome)
  const noPrice = activeLiveNoPrice ?? resolveFallbackOutcomeUnitPrice(activeMarket, noOutcome)
  const buyYesOutcome = yesOutcome ?? activeMarket?.outcomes[0] ?? null
  const buyNoOutcome = noOutcome ?? activeMarket?.outcomes[1] ?? null
  const buyYesOutcomeLabel =
    outcomeLabelOverrides[OUTCOME_INDEX.YES]?.trim() ||
    (buyYesOutcome?.outcome_text
      ? (normalizeOutcomeLabel(buyYesOutcome.outcome_text) ?? buyYesOutcome.outcome_text)
      : t('Yes'))
  const buyNoOutcomeLabel =
    outcomeLabelOverrides[OUTCOME_INDEX.NO]?.trim() ||
    (buyNoOutcome?.outcome_text
      ? (normalizeOutcomeLabel(buyNoOutcome.outcome_text) ?? buyNoOutcome.outcome_text)
      : t('No'))
  const shouldShowDefaultTrigger = showDefaultTrigger && isSingleMarket
  const yesPriceLabel = oddsFormat === 'price' ? formatCentsLabel(yesPrice) : formatOddsFromPrice(yesPrice, oddsFormat)
  const noPriceLabel = oddsFormat === 'price' ? formatCentsLabel(noPrice) : formatOddsFromPrice(noPrice, oddsFormat)

  function handleQuickBuy(outcome: Outcome | null, displayedPrice: number | null) {
    if (!activeMarket || !outcome) {
      return
    }

    state.setSide(ORDER_SIDE.BUY)
    selectOrderOutcomeAtDisplayedPrice({
      market: activeMarket,
      outcome,
      displayedPrice,
      currentMarketConditionId: state.market?.condition_id,
      setMarket: state.setMarket,
      setOutcome: state.setOutcome,
      setLimitPrice: state.setLimitPrice,
    })
    state.setIsMobileOrderPanelOpen(true)
  }

  return (
    <Drawer open={state.isMobileOrderPanelOpen} onOpenChange={state.setIsMobileOrderPanelOpen}>
      {shouldShowDefaultTrigger && (
        <div
          className="fixed inset-x-0 z-30 border-t bg-background p-4 lg:hidden"
          style={{ bottom: MOBILE_BOTTOM_NAV_OFFSET }}
        >
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1 pb-1.25">
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-4 rounded-b-sm bg-yes-foreground/75 dark:bg-yes/75" />
              <Button
                variant="yes"
                size="outcomeLg"
                className="relative w-full translate-y-0 bg-yes-foreground text-white transition-transform duration-150 ease-out hover:translate-y-px hover:bg-yes-foreground active:translate-y-0.5 dark:bg-yes dark:hover:bg-yes"
                onClick={() => handleQuickBuy(buyYesOutcome, yesPrice)}
              >
                <span className="truncate opacity-70">
                  {t('Buy')} {buyYesOutcomeLabel}
                </span>
                <span className="shrink-0 font-bold">{yesPriceLabel}</span>
              </Button>
            </div>
            <div className="relative min-w-0 flex-1 pb-1.25">
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-4 rounded-b-sm bg-no-foreground/75 dark:bg-no/75" />
              <Button
                variant="no"
                size="outcomeLg"
                className="relative w-full translate-y-0 bg-no-foreground text-white transition-transform duration-150 ease-out hover:translate-y-px hover:bg-no-foreground active:translate-y-0.5 dark:bg-no dark:hover:bg-no"
                onClick={() => handleQuickBuy(buyNoOutcome, noPrice)}
              >
                <span className="truncate opacity-70">
                  {t('Buy')} {buyNoOutcomeLabel}
                </span>
                <span className="shrink-0 font-bold">{noPriceLabel}</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      <DrawerContent className="max-h-[95dvh] w-full">
        <DrawerTitle className="sr-only">{event.title}</DrawerTitle>

        <div className="pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <EventOrderPanelForm
            event={event}
            isMobile={true}
            initialMarket={activeMarket}
            initialOutcome={activeOutcome}
            mobileMarketInfo={mobileMarketInfo}
            primaryOutcomeIndex={primaryOutcomeIndex}
            oddsFormat={oddsFormat}
            outcomeButtonStyleVariant={outcomeButtonStyleVariant}
            outcomeLabelOverrides={outcomeLabelOverrides}
            outcomeAccentOverrides={outcomeAccentOverrides}
            optimisticallyClaimedConditionIds={optimisticallyClaimedConditionIds}
          />
          <EventOrderPanelTermsDisclaimer />
        </div>
      </DrawerContent>
    </Drawer>
  )
}
