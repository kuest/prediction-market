import type { Route } from 'next'

import { BadgeCheckIcon, CircleDollarSignIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'
import { createElement } from 'react'

import type { PublicActivityRowProps } from '@/app/[locale]/(platform)/profile/_types/PublicActivityTypes'

import {
  activityIcon,
  formatActivityShares,
  formatPriceCents,
  resolveVariant,
} from '@/app/[locale]/(platform)/profile/_utils/PublicActivityUtils'
import EventIconImage from '@/components/EventIconImage'
import useLocalizedTimeAgo from '@/hooks/useLocalizedTimeAgo'
import { Link } from '@/i18n/navigation'
import { MICRO_UNIT } from '@/lib/constants'
import { formatCurrency } from '@/lib/formatters'
import { resolveMarketAssetUrl } from '@/lib/image/asset-reference'
import { cn } from '@/lib/utils'

export default function PublicActivityRow({ activity }: PublicActivityRowProps) {
  const t = useExtracted()
  const { formatTimeAgo } = useLocalizedTimeAgo()
  const variant = resolveVariant(activity)
  const icon = activityIcon(variant)
  const sharesText = formatActivityShares(activity)
  const priceText = formatPriceCents(activity.price)
  const eventSlug = activity.market.event?.slug || activity.market.slug
  const marketSlug = activity.market.event?.slug ? activity.market.slug : null
  const eventHref = (marketSlug ? `/event/${eventSlug}/${marketSlug}` : `/event/${eventSlug}`) as Route
  const fallbackOutcomeLabel = t('Outcome')
  const outcomeText = activity.outcome?.text || fallbackOutcomeLabel
  const outcomeIsYes = outcomeText.toLowerCase().includes('yes') || activity.outcome?.index === 0
  const outcomeColor = outcomeIsYes ? 'bg-yes/15 text-yes' : 'bg-no/15 text-no'
  const showOutcomeBadge = (variant === 'buy' || variant === 'sell') && outcomeText !== fallbackOutcomeLabel
  const imageUrl = resolveMarketAssetUrl(activity.market.icon_url)
  const isResolutionFlow = variant === 'resolution_bond' || variant === 'resolution_reward'
  const isTradingReward = variant === 'liquidity_reward' || variant === 'maker_rebate'
  const isFundsFlow = variant === 'deposit' || variant === 'withdraw' || isResolutionFlow || isTradingReward
  const valueNumber = Number(activity.total_value) / MICRO_UNIT
  const hasValue = Number.isFinite(valueNumber)
  const isCreditVariant =
    variant === 'merge' ||
    variant === 'redeem' ||
    variant === 'deposit' ||
    variant === 'resolution_reward' ||
    variant === 'liquidity_reward' ||
    variant === 'maker_rebate' ||
    variant === 'sell'
  const isDebitVariant =
    variant === 'withdraw' ||
    variant === 'resolution_bond' ||
    variant === 'split' ||
    variant === 'buy' ||
    variant === 'convert'
  const isPositive = isCreditVariant || (!isDebitVariant && hasValue && valueNumber > 0)
  const isNegative = isDebitVariant || (!isCreditVariant && hasValue && valueNumber < 0)
  const valueDisplay = hasValue ? formatCurrency(Math.abs(valueNumber)) : '—'
  const valuePrefix = hasValue ? (isNegative ? '-' : '+') : ''
  const valueContent = variant === 'loss' ? '-' : Number.isFinite(valueNumber) ? `${valuePrefix}${valueDisplay}` : '—'
  const activityLabel =
    variant === 'resolution_bond'
      ? t('Bond')
      : variant === 'resolution_reward'
        ? t('Reward')
        : variant === 'liquidity_reward'
          ? t('Liquidity reward')
          : variant === 'maker_rebate'
            ? t('Maker rebate')
            : icon.label
  const marketContent = isFundsFlow ? (
    <div className="flex min-w-0 items-center gap-2.5 pl-1">
      <div
        className={cn(
          'grid size-12 shrink-0 place-items-center overflow-hidden rounded-sm',
          isResolutionFlow ? 'bg-blue-500/10 text-blue-500' : 'bg-primary/10 text-primary',
        )}
      >
        {isResolutionFlow ? <BadgeCheckIcon className="size-5" /> : <CircleDollarSignIcon className="size-5" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="block max-w-full truncate text-sm/tight font-semibold text-foreground">
          {variant === 'deposit'
            ? t('Deposited funds')
            : variant === 'withdraw'
              ? t('Withdrew funds')
              : variant === 'resolution_bond'
                ? t('Resolution bond')
                : variant === 'resolution_reward'
                  ? t('Resolution reward')
                  : variant === 'liquidity_reward'
                    ? t('Liquidity reward')
                    : t('Maker rebate')}
        </div>
      </div>
    </div>
  ) : (
    <div className="flex min-w-0 items-start gap-2.5 pl-1">
      <Link href={eventHref} className="relative size-12 shrink-0 overflow-hidden rounded-sm bg-muted">
        {imageUrl ? (
          <EventIconImage src={imageUrl} alt={activity.market.title} sizes="48px" containerClassName="size-full" />
        ) : variant === 'redeem' ? (
          <div className="grid size-full place-items-center text-primary/80">
            <CircleDollarSignIcon className="size-5" />
          </div>
        ) : (
          <div className="grid size-full place-items-center text-2xs text-muted-foreground">{t('No image')}</div>
        )}
      </Link>

      <div className="min-w-0 flex-1 space-y-1">
        <Link
          href={eventHref}
          className={cn(
            `block max-w-full truncate text-sm/tight font-semibold text-foreground underline-offset-2 hover:underline`,
          )}
          title={activity.market.title}
        >
          {activity.market.title}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {showOutcomeBadge && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-semibold',
                outcomeColor,
              )}
            >
              {outcomeText}
              {(variant === 'buy' || variant === 'sell') && priceText && <> {priceText}</>}
            </span>
          )}
          {sharesText && <span>{sharesText}</span>}
        </div>
      </div>
    </div>
  )

  return (
    <tr className="border-b transition-colors hover:bg-muted/50">
      <td className="px-2 py-3 text-sm font-semibold text-foreground sm:px-3">
        <div className="flex items-center gap-2">
          {createElement(icon.Icon, { className: cn('size-4 text-muted-foreground', icon.className) })}
          <span>{activityLabel}</span>
        </div>
      </td>

      <td className="max-w-0 px-2 py-3 sm:px-3">{marketContent}</td>

      <td
        className={cn(
          'px-2 py-3 text-right text-sm font-semibold sm:px-3',
          isPositive ? 'text-yes' : `text-foreground`,
        )}
      >
        {valueContent}
      </td>

      <td className="px-2 py-3 text-right text-xs text-muted-foreground sm:px-3">
        {formatTimeAgo(activity.created_at)}
      </td>
    </tr>
  )
}
