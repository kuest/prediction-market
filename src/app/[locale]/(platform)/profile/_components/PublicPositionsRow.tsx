import type { Route } from 'next'

import { ArrowRightIcon, ShareIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'

import {
  formatCurrencyValue,
  getOutcomeBadgeColorClassName,
  getLatestPrice,
  getValue,
} from '@/app/[locale]/(platform)/profile/_utils/PublicPositionsUtils'
import EventIconImage from '@/components/EventIconImage'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Link } from '@/i18n/navigation'
import { formatCentsLabel, formatCurrency, formatSharesLabel } from '@/lib/formatters'
import { resolveMarketAssetUrl } from '@/lib/image/asset-reference'
import { cn } from '@/lib/utils'

import type { PublicPosition } from './PublicPositionItem'

interface PublicPositionsRowProps {
  position: PublicPosition
  onShareClick: (position: PublicPosition) => void
  onSellClick?: (position: PublicPosition) => void
}

export default function PublicPositionsRow({ position, onShareClick, onSellClick }: PublicPositionsRowProps) {
  const t = useExtracted()
  const imageSrc = resolveMarketAssetUrl(position.icon)
  const avgPrice = position.avgPrice ?? 0
  const nowPrice = getLatestPrice(position)
  const shares = position.size ?? 0
  const tradeValue = shares * avgPrice
  const currentValue = getValue(position)
  const toWinValue = shares
  const pnlDiff = currentValue - tradeValue
  const pnlPct = tradeValue > 0 ? (pnlDiff / tradeValue) * 100 : 0
  const outcomeLabel = position.outcome ?? '—'
  const outcomeColor = getOutcomeBadgeColorClassName(position)
  const eventSlug = position.eventSlug || position.slug
  const marketSlug = position.eventSlug && position.slug ? position.slug : null
  const eventHref = (marketSlug ? `/event/${eventSlug}/${marketSlug}` : `/event/${eventSlug}`) as Route

  return (
    <tr className="transition-colors hover:bg-muted/50">
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
                {outcomeLabel} {formatCentsLabel(avgPrice, { fallback: '—' })}
              </span>
              {Number.isFinite(position.size) && (
                <span className="text-muted-foreground">
                  {formatSharesLabel(position.size ?? 0)} {t('shares')}
                </span>
              )}
            </div>
          </div>
        </div>
      </td>

      <td className="px-2 py-3 text-center align-middle text-sm text-foreground sm:px-3">
        <div className="flex items-center justify-center gap-1">
          <span className="text-muted-foreground">{formatCentsLabel(avgPrice, { fallback: '—' })}</span>
          <ArrowRightIcon className="size-3 text-muted-foreground" />
          <span className="text-foreground">{formatCentsLabel(nowPrice, { fallback: '—' })}</span>
        </div>
      </td>

      <td
        className={cn(
          `px-2 py-3 text-center align-middle text-sm font-semibold text-muted-foreground tabular-nums sm:px-3`,
        )}
      >
        {formatCurrencyValue(tradeValue)}
      </td>

      <td
        className={cn(
          `px-2 py-3 text-center align-middle text-sm font-semibold text-muted-foreground tabular-nums sm:px-3`,
        )}
      >
        {formatCurrencyValue(toWinValue)}
      </td>

      <td className="px-2 py-3 text-right align-middle text-sm font-semibold text-foreground tabular-nums sm:px-3">
        {formatCurrencyValue(currentValue)}
        <div className={cn('text-xs', pnlDiff >= 0 ? 'text-yes' : 'text-no')}>
          {`${pnlDiff >= 0 ? '+' : '-'}${formatCurrency(Math.abs(pnlDiff))}`} (
          {Math.abs(pnlPct).toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          })}
          %)
        </div>
      </td>

      <td className="px-2 py-3 align-middle sm:px-3">
        <div className="flex justify-end gap-1.5 whitespace-nowrap">
          {onSellClick && (
            <Button size="sm" className="w-18 shrink-0" onClick={() => onSellClick(position)}>
              {t('Sell')}
            </Button>
          )}
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
