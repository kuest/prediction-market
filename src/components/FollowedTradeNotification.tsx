'use client'

import { useExtracted } from 'next-intl'
import Image from 'next/image'

import EventIconImage from '@/components/EventIconImage'
import { useOutcomeLabel } from '@/hooks/useOutcomeLabel'
import { getAvatarPlaceholderStyle, shouldUseAvatarPlaceholder } from '@/lib/avatar'
import { formatDollarValueLabel, formatSharePriceLabel } from '@/lib/formatters'
import { resolveMarketAssetUrl } from '@/lib/image/asset-reference'
import { cn } from '@/lib/utils'

interface FollowedTradeSummaryProps {
  trader: string
  side: string
  outcome: string
  averagePrice?: number | null
  totalValue?: number | null
  className?: string
}

interface FollowedTradeMarketContextProps {
  eventTitle: string
  eventIcon?: string | null
  className?: string
}

interface FollowedTradeAvatarProps {
  trader: string
  wallet: string
  src?: string | null
  size?: number
  className?: string
}

function resolveTradeAlertImageUrl(value?: string | null) {
  return resolveMarketAssetUrl(value)
}

export function resolveTradeAlertOutcomeColorClass(outcome?: string | null) {
  const normalized = outcome?.trim().toLowerCase() ?? ''
  return normalized.includes('yes') || normalized.includes('up') || normalized.includes('true') ? 'text-yes' : 'text-no'
}

export function formatTradeAlertTraderLabel(trader: string) {
  const normalized = trader.trim()
  const isWalletLabel = /^0x(?:[a-f0-9]{40}|[a-f0-9]{4}…[a-f0-9]{4})$/i.test(normalized)
  return !normalized || normalized.startsWith('@') || isWalletLabel ? normalized : `@${normalized}`
}

export function FollowedTradeSummary({
  trader,
  side,
  outcome,
  averagePrice,
  totalValue,
  className,
}: FollowedTradeSummaryProps) {
  const t = useExtracted()
  const normalizeOutcomeLabel = useOutcomeLabel()
  const traderLabel = formatTradeAlertTraderLabel(trader)
  const normalizedOutcome = normalizeOutcomeLabel(outcome) || outcome
  const priceLabel =
    typeof averagePrice === 'number' && Number.isFinite(averagePrice)
      ? formatSharePriceLabel(averagePrice, { fallback: '' })
      : ''
  const totalLabel =
    typeof totalValue === 'number' && Number.isFinite(totalValue) && totalValue > 0
      ? formatDollarValueLabel(totalValue, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
      : ''

  return (
    <span className={cn('min-w-0 text-sm/tight', className)}>
      <span className="font-semibold text-foreground">{traderLabel}</span>{' '}
      <span className="text-muted-foreground">{side.toUpperCase() === 'SELL' ? t('sold') : t('bought')}</span>{' '}
      <span className={cn('font-semibold', resolveTradeAlertOutcomeColorClass(outcome))}>{normalizedOutcome}</span>
      {priceLabel && (
        <>
          {' '}
          <span className="text-muted-foreground">
            {t('at')} {priceLabel}
          </span>
        </>
      )}
      {totalLabel && <span className="text-muted-foreground"> ({totalLabel})</span>}
    </span>
  )
}

export function FollowedTradeMarketContext({ eventTitle, eventIcon, className }: FollowedTradeMarketContextProps) {
  const resolvedIcon = resolveTradeAlertImageUrl(eventIcon)
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5 text-xs/tight text-muted-foreground', className)}>
      {resolvedIcon && (
        <EventIconImage
          src={resolvedIcon}
          alt=""
          sizes="16px"
          containerClassName="size-4 shrink-0 rounded-[3px] bg-muted"
        />
      )}
      <span className="line-clamp-2 min-w-0">{eventTitle}</span>
    </span>
  )
}

export function FollowedTradeAvatar({ trader, wallet, src, size = 42, className }: FollowedTradeAvatarProps) {
  const avatarUrl = resolveTradeAlertImageUrl(src)
  const showPlaceholder = shouldUseAvatarPlaceholder(avatarUrl)
  const dimensions = { width: size, height: size }
  if (showPlaceholder) {
    return (
      <span
        aria-hidden="true"
        className={cn('block shrink-0 rounded-full border border-border/80', className)}
        style={{ ...getAvatarPlaceholderStyle(wallet || trader), ...dimensions }}
      />
    )
  }
  return (
    <Image
      src={avatarUrl!}
      alt={trader}
      width={size}
      height={size}
      className={cn('shrink-0 rounded-full border border-border/80 object-cover object-center', className)}
    />
  )
}
