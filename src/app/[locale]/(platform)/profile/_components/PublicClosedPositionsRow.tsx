import type { Route } from 'next'

import { ShareIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'

import {
  getClosedPositionMetrics,
  getOutcomeBadgeColorClassName,
  getOutcomeLabel,
} from '@/app/[locale]/(platform)/profile/_utils/PublicPositionsUtils'
import EventIconImage from '@/components/EventIconImage'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Link } from '@/i18n/navigation'
import { formatCentsLabel, formatCurrency, formatSharesLabel } from '@/lib/formatters'
import { resolveMarketAssetUrl } from '@/lib/image/asset-reference'
import { cn } from '@/lib/utils'

import type { PublicPosition } from './PublicPositionItem'

interface PublicClosedPositionsRowProps {
  position: PublicPosition
  onShareClick: (position: PublicPosition) => void
}

export default function PublicClosedPositionsRow({ position, onShareClick }: PublicClosedPositionsRowProps) {
  const t = useExtracted()
  const imageSrc = resolveMarketAssetUrl(position.icon)
  const outcomeLabel = getOutcomeLabel(position)
  const outcomeColor = getOutcomeBadgeColorClassName(position)
  const eventSlug = position.eventSlug || position.slug
  const marketSlug = position.eventSlug && position.slug ? position.slug : null
  const eventHref = (marketSlug ? `/event/${eventSlug}/${marketSlug}` : `/event/${eventSlug}`) as Route
  const { amountWon, isWon, pnlPercent, realizedPnl, totalBought, totalTraded } = getClosedPositionMetrics(position)

  return (
    <tr className="transition-colors hover:bg-muted/50">
      <td className="px-2 py-3 align-middle sm:px-3">
        <span className={cn('text-sm font-semibold', isWon ? 'text-yes' : 'text-no')}>
          {isWon ? t('Won') : t('Lost')}
        </span>
      </td>

      <td className="max-w-0 px-2 py-3 align-middle sm:px-3">
        <div className="flex min-w-0 items-start gap-3">
          <Link href={eventHref} className="relative size-12 shrink-0 overflow-hidden rounded-sm bg-muted">
            {imageSrc ? (
              <EventIconImage src={imageSrc} alt={position.title} sizes="48px" containerClassName="size-full" />
            ) : (
              <div className="grid size-full place-items-center text-sm text-muted-foreground">{t('No image')}</div>
            )}
          </Link>
          <div className="min-w-0 flex-1 space-y-1">
            <Link
              href={eventHref}
              className={cn(
                `block max-w-full truncate text-[13px] leading-tight font-semibold text-foreground underline-offset-2 hover:underline`,
              )}
              title={position.title}
            >
              {position.title}
            </Link>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span
                className={cn('inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-semibold', outcomeColor)}
              >
                {outcomeLabel} {formatCentsLabel(position.avgPrice, { fallback: '—' })}
              </span>
              <span className="text-muted-foreground">
                {formatSharesLabel(totalBought)} {t('shares')}
              </span>
            </div>
          </div>
        </div>
      </td>

      <td className="px-2 py-3 text-right align-middle text-sm font-semibold tabular-nums sm:px-3">
        {formatCurrency(totalTraded)}
      </td>

      <td className="px-2 py-3 text-right align-middle text-sm font-semibold tabular-nums sm:px-3">
        {formatCurrency(amountWon)}
        <div className={cn('text-xs', realizedPnl >= 0 ? 'text-yes' : 'text-no')}>
          {`${realizedPnl >= 0 ? '+' : '-'}${formatCurrency(Math.abs(realizedPnl))}`} (
          {Math.abs(pnlPercent).toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          })}
          %)
        </div>
      </td>

      <td className="px-2 py-3 align-middle sm:px-3">
        <div className="flex justify-end">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => onShareClick(position)}
                  aria-label={t('Share {title}', { title: position.title })}
                >
                  <ShareIcon className="size-4" />
                </Button>
              }
            />
            <TooltipContent>{t('Share')}</TooltipContent>
          </Tooltip>
        </div>
      </td>
    </tr>
  )
}
