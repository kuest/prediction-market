'use client'

import { useQuery } from '@tanstack/react-query'
import { ShareIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'
import { useCallback, useMemo, useState } from 'react'

import type { Event, UserPosition } from '@/types'

import { PositionShareDialog } from '@/app/[locale]/(platform)/_components/PositionShareDialog'
import EventConvertPositionsDialog from '@/app/[locale]/(platform)/event/[slug]/_components/EventConvertPositionsDialog'
import AlertBanner from '@/components/AlertBanner'
import EventIconImage from '@/components/EventIconImage'
import { PositionReturnSummary, PositionValueCell } from '@/components/positions/PositionValueReturnCells'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useOutcomeLabel } from '@/hooks/useOutcomeLabel'
import { ORDER_SIDE, OUTCOME_INDEX, tableHeaderClass } from '@/lib/constants'
import { fetchUserPositionsForMarket } from '@/lib/data-api/user'
import {
  formatAmountInputValue,
  formatCentsLabel,
  formatDollarValueLabel,
  formatPercent,
  formatSharesLabel,
  fromMicro,
} from '@/lib/formatters'
import {
  resolvePositionCostValue,
  resolvePositionCurrentValue,
  resolvePositionRealizedPnl,
} from '@/lib/position-values'
import { buildShareCardPayload } from '@/lib/share-card'
import { getUserPublicAddress } from '@/lib/user-address'
import { cn } from '@/lib/utils'
import { useIsSingleMarket, useOrder } from '@/stores/useOrder'
import { useUser } from '@/stores/useUser'

interface EventMarketPositionsProps {
  market: Event['markets'][number]
  isNegRiskEnabled?: boolean
  convertOptions?: Array<{ id: string; label: string; shares: number; conditionId: string }>
  eventOutcomes?: Array<{ conditionId: string; questionId?: string; label: string; iconUrl?: string | null }>
  negRiskMarketId?: string
  isNegRiskAugmented?: boolean
}

const POSITION_VISIBILITY_THRESHOLD = 0.01

function toNumber(value: unknown) {
  if (value === null || value === undefined) {
    return null
  }
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function resolvePositionShares(position: UserPosition) {
  const quantity = toNumber(position.size) ?? (typeof position.total_shares === 'number' ? position.total_shares : 0)
  return Number.isFinite(quantity) ? quantity : 0
}

function normalizePositionPrice(value: unknown) {
  const numeric = toNumber(value)
  if (numeric == null || numeric <= 0) {
    return numeric
  }

  let normalized = numeric
  while (normalized > 1) {
    normalized /= 100
  }

  return normalized
}

function resolvePositionCost(position: UserPosition) {
  const quantity = resolvePositionShares(position)
  const avgPrice =
    normalizePositionPrice(position.avgPrice) ??
    normalizePositionPrice(Number(fromMicro(String(position.average_position ?? 0), 6)))
  return resolvePositionCostValue(position, quantity, avgPrice)
}

function resolvePositionValue(position: UserPosition, marketPrice: number | null = null) {
  const quantity = resolvePositionShares(position)
  const avgPrice =
    normalizePositionPrice(position.avgPrice) ??
    normalizePositionPrice(Number(fromMicro(String(position.average_position ?? 0), 6)))
  return resolvePositionCurrentValue(position, quantity, avgPrice, marketPrice)
}

function resolvePositionOutcomeIndex(position: UserPosition) {
  const normalizedOutcome = position.outcome_text?.toLowerCase()
  const explicitOutcomeIndex = typeof position.outcome_index === 'number' ? position.outcome_index : undefined
  const resolvedOutcomeIndex =
    explicitOutcomeIndex ?? (normalizedOutcome === 'no' ? OUTCOME_INDEX.NO : OUTCOME_INDEX.YES)
  return resolvedOutcomeIndex === OUTCOME_INDEX.NO ? OUTCOME_INDEX.NO : OUTCOME_INDEX.YES
}

async function fetchAllUserPositions({
  userAddress,
  status,
  signal,
}: {
  userAddress: string
  status: 'active' | 'closed'
  signal?: AbortSignal
}) {
  const pageSize = 50
  const results: UserPosition[] = []
  let offset = 0

  while (true) {
    const page = await fetchUserPositionsForMarket({
      pageParam: offset,
      userAddress,
      status,
      signal,
    })
    results.push(...page)
    if (page.length < pageSize) {
      break
    }
    offset += page.length
    if (page.length === 0) {
      break
    }
  }

  return results
}

function useMarketPositionsQuery({
  userAddress,
  market,
  positionStatus,
}: {
  userAddress: string
  market: Event['markets'][number]
  positionStatus: 'active' | 'closed'
}) {
  const query = useQuery({
    queryKey: ['user-market-positions', userAddress, market.condition_id, positionStatus],
    queryFn: ({ signal }) =>
      fetchUserPositionsForMarket({
        pageParam: 0,
        userAddress,
        conditionId: market.condition_id,
        status: positionStatus,
        signal,
      }),
    enabled: Boolean(userAddress && market.condition_id),
    staleTime: 1000 * 60 * 5,
    refetchInterval: userAddress ? 10_000 : false,
    refetchIntervalInBackground: true,
    gcTime: 1000 * 60 * 10,
  })

  const positions = useMemo(() => query.data ?? [], [query.data])

  const visiblePositions = useMemo(
    () => positions.filter((position) => resolvePositionShares(position) >= POSITION_VISIBILITY_THRESHOLD),
    [positions],
  )

  return {
    status: query.status,
    refetch: query.refetch,
    visiblePositions,
  }
}

function useEventWidePositionsQuery({
  userAddress,
  eventOutcomeIds,
  positionStatus,
}: {
  userAddress: string
  eventOutcomeIds: string[]
  positionStatus: 'active' | 'closed'
}) {
  const shouldFetchEventPositions = Boolean(userAddress && eventOutcomeIds.length > 1)

  return useQuery({
    queryKey: ['user-event-positions', userAddress, positionStatus, eventOutcomeIds.join(',')],
    queryFn: ({ signal }) =>
      fetchAllUserPositions({
        userAddress,
        status: positionStatus,
        signal,
      }),
    enabled: shouldFetchEventPositions,
    staleTime: 1000 * 60 * 5,
    refetchInterval: shouldFetchEventPositions ? 10_000 : false,
    refetchIntervalInBackground: true,
    gcTime: 1000 * 60 * 10,
  })
}

function useResolvedEventOutcomes({
  eventOutcomes,
  market,
}: {
  eventOutcomes: EventMarketPositionsProps['eventOutcomes']
  market: Event['markets'][number]
}) {
  const resolvedEventOutcomes = useMemo(() => {
    if (eventOutcomes && eventOutcomes.length > 0) {
      return eventOutcomes
    }
    return [
      {
        conditionId: market.condition_id,
        questionId: market.question_id,
        label: market.short_title || market.title,
      },
    ]
  }, [eventOutcomes, market.condition_id, market.question_id, market.short_title, market.title])

  const eventOutcomeIds = useMemo(() => {
    return resolvedEventOutcomes.map((outcome) => outcome.conditionId).filter(Boolean)
  }, [resolvedEventOutcomes])

  return { resolvedEventOutcomes, eventOutcomeIds }
}

function useResolvedConvertOptions({
  isNegRiskEnabled,
  eventConvertOptions,
  market,
  visiblePositions,
}: {
  isNegRiskEnabled?: boolean
  eventConvertOptions: EventMarketPositionsProps['convertOptions']
  market: Event['markets'][number]
  visiblePositions: UserPosition[]
}) {
  return useMemo(() => {
    if (!isNegRiskEnabled) {
      return []
    }
    if (eventConvertOptions !== undefined) {
      return eventConvertOptions
    }

    const label = market.short_title || market.title

    return visiblePositions
      .map((positionItem, index) => {
        const explicitOutcomeIndex =
          typeof positionItem.outcome_index === 'number' ? positionItem.outcome_index : undefined
        const resolvedOutcomeIndex = resolvePositionOutcomeIndex(positionItem)
        const quantity =
          toNumber(positionItem.size) ?? (typeof positionItem.total_shares === 'number' ? positionItem.total_shares : 0)

        if (resolvedOutcomeIndex !== OUTCOME_INDEX.NO || quantity <= 0) {
          return null
        }

        return {
          id: `${explicitOutcomeIndex ?? positionItem.outcome_text ?? index}`,
          conditionId: market.condition_id,
          label,
          shares: quantity,
        }
      })
      .filter((option): option is { id: string; label: string; shares: number; conditionId: string } => Boolean(option))
  }, [eventConvertOptions, isNegRiskEnabled, market.condition_id, market.short_title, market.title, visiblePositions])
}

function useNetPositionsRows({
  market,
  resolvedEventOutcomes,
  eventOutcomeIds,
  visiblePositions,
  eventPositionsData,
}: {
  market: Event['markets'][number]
  resolvedEventOutcomes: Array<{ conditionId: string; questionId?: string; label: string; iconUrl?: string | null }>
  eventOutcomeIds: string[]
  visiblePositions: UserPosition[]
  eventPositionsData: UserPosition[] | undefined
}) {
  return useMemo(() => {
    const outcomes = market.outcomes ?? []
    const hasMultipleMarkets = resolvedEventOutcomes.length > 1
    if (!hasMultipleMarkets && outcomes.length === 0) {
      return []
    }

    if (hasMultipleMarkets && !eventPositionsData) {
      return []
    }

    const outcomeIdSet = new Set(eventOutcomeIds)
    const sourcePositions = hasMultipleMarkets ? (eventPositionsData ?? []) : visiblePositions
    const scopedPositions = hasMultipleMarkets
      ? sourcePositions.filter((positionItem) => outcomeIdSet.has(positionItem.market.condition_id))
      : sourcePositions

    if (hasMultipleMarkets && scopedPositions.length === 0) {
      return []
    }

    const totalCost = scopedPositions.reduce((sum, positionItem) => {
      const costValue = resolvePositionCost(positionItem)
      if (costValue != null && Number.isFinite(costValue)) {
        return sum + costValue
      }
      const shares = resolvePositionShares(positionItem)
      const avgPrice =
        normalizePositionPrice(positionItem.avgPrice) ??
        normalizePositionPrice(Number(fromMicro(String(positionItem.average_position ?? 0), 6)))
      if (typeof avgPrice !== 'number' || !Number.isFinite(avgPrice) || shares <= 0) {
        return sum
      }
      return sum + shares * avgPrice
    }, 0)

    if (!hasMultipleMarkets) {
      const totalValue = scopedPositions.reduce((sum, positionItem) => {
        const outcomePrice = normalizePositionPrice(
          market.outcomes.find((outcome) => outcome.outcome_index === resolvePositionOutcomeIndex(positionItem))
            ?.buy_price,
        )
        const value = resolvePositionValue(positionItem, outcomePrice)
        if (Number.isFinite(value)) {
          return sum + value
        }
        return sum
      }, 0)

      return [
        {
          id: market.condition_id,
          outcomeLabel: market.short_title || market.title,
          payout: totalValue,
          netValue: totalValue - totalCost,
          iconUrl: market.icon_url,
        },
      ]
    }

    const sharesByCondition = scopedPositions.reduce<Record<string, { yes: number; no: number }>>(
      (acc, positionItem) => {
        const conditionId = positionItem.market.condition_id
        if (!acc[conditionId]) {
          acc[conditionId] = { yes: 0, no: 0 }
        }
        const resolvedOutcomeIndex = resolvePositionOutcomeIndex(positionItem)
        const shares = resolvePositionShares(positionItem)
        if (resolvedOutcomeIndex === OUTCOME_INDEX.NO) {
          acc[conditionId].no += shares
        } else {
          acc[conditionId].yes += shares
        }
        return acc
      },
      {},
    )

    const totalNoShares = Object.values(sharesByCondition).reduce((sum, entry) => sum + entry.no, 0)

    return resolvedEventOutcomes.map((outcome) => {
      const entry = sharesByCondition[outcome.conditionId] ?? { yes: 0, no: 0 }
      const payout = entry.yes + (totalNoShares - entry.no)
      return {
        id: outcome.conditionId,
        outcomeLabel: outcome.label,
        payout,
        netValue: payout - totalCost,
        iconUrl: outcome.iconUrl ?? market.icon_url,
      }
    })
  }, [
    eventOutcomeIds,
    eventPositionsData,
    market.condition_id,
    market.icon_url,
    market.outcomes,
    market.short_title,
    market.title,
    visiblePositions,
    resolvedEventOutcomes,
  ])
}

function buildShareCardPosition(position: UserPosition) {
  const outcomeText = position.outcome_text || (position.outcome_index === 1 ? 'No' : 'Yes')
  const quantity = resolvePositionShares(position)
  const avgPrice =
    normalizePositionPrice(position.avgPrice) ??
    normalizePositionPrice(Number(fromMicro(String(position.average_position ?? 0), 6)))
  const totalValue = resolvePositionValue(position)
  const currentPrice = quantity > 0 ? totalValue / quantity : avgPrice
  const eventSlug = position.market.event?.slug || position.market.slug

  return {
    title: position.market.title,
    outcome: outcomeText,
    outcomeIndex: typeof position.outcome_index === 'number' ? position.outcome_index : undefined,
    avgPrice: Number.isFinite(avgPrice) ? avgPrice : 0,
    curPrice: Number.isFinite(currentPrice) ? currentPrice : avgPrice,
    size: Number.isFinite(quantity) ? quantity : 0,
    icon: position.market.icon_url,
    eventSlug,
  }
}

function MarketPositionRow({
  position,
  market,
  onSell,
  onShare,
  onConvert,
}: {
  position: UserPosition
  market: Event['markets'][number]
  onSell: (position: UserPosition) => void
  onShare: (position: UserPosition) => void
  onConvert?: (position: UserPosition) => void
}) {
  const t = useExtracted()
  const normalizeOutcomeLabel = useOutcomeLabel()
  const outcomeText = position.outcome_text || (position.outcome_index === 1 ? 'No' : 'Yes')
  const resolvedOutcomeIndex = resolvePositionOutcomeIndex(position)
  const isYesOutcome = resolvedOutcomeIndex === OUTCOME_INDEX.YES
  const isNoOutcome = resolvedOutcomeIndex === OUTCOME_INDEX.NO
  const quantity = toNumber(position.size) ?? resolvePositionShares(position)
  const canConvert = Boolean(onConvert) && isNoOutcome && quantity > 0
  const formattedQuantity = quantity > 0 ? formatSharesLabel(quantity) : '0'
  const averagePriceDollars =
    normalizePositionPrice(position.avgPrice) ??
    normalizePositionPrice(Number(fromMicro(String(position.average_position ?? 0), 6)))
  const averageLabel = formatCentsLabel(averagePriceDollars, { fallback: '—' })
  const outcomePrice = normalizePositionPrice(
    market.outcomes.find((outcome) => outcome.outcome_index === resolvedOutcomeIndex)?.buy_price,
  )
  const totalValue = resolvePositionValue(position, outcomePrice)
  const valueLabel = formatDollarValueLabel(Math.max(0, totalValue), { fallback: '0¢' })
  const baseCostValue = resolvePositionCost(position)
  const costLabel = baseCostValue != null ? formatDollarValueLabel(baseCostValue, { fallback: '0¢' }) : null
  const realizedPnlValue = resolvePositionRealizedPnl(position)
  const unrealizedValue = baseCostValue != null ? Number((totalValue - baseCostValue).toFixed(6)) : 0
  const totalProfitLossValue = Number((unrealizedValue + realizedPnlValue).toFixed(6))
  const derivedPercent = baseCostValue && baseCostValue > 0 ? (totalProfitLossValue / baseCostValue) * 100 : null
  const normalizedPercent = derivedPercent ?? 0
  const percentDigits = Math.abs(normalizedPercent) >= 10 ? 0 : 1
  const percentLabel = formatPercent(Math.abs(normalizedPercent), { digits: percentDigits })
  const isPositive = totalProfitLossValue >= 0
  const isNeutralReturn = Math.abs(totalProfitLossValue) < 0.005
  const neutralReturnLabel = formatDollarValueLabel(Math.abs(totalProfitLossValue), { fallback: '0¢' })
  const displayedReturnValue = isNeutralReturn ? neutralReturnLabel : `${isPositive ? '+' : '-'}${neutralReturnLabel}`
  const fallbackOutcomeLabel = normalizeOutcomeLabel(isYesOutcome ? 'Yes' : 'No') || (isYesOutcome ? 'Yes' : 'No')
  const outcomeButtonLabel = normalizeOutcomeLabel(outcomeText) || fallbackOutcomeLabel

  const returnColorClass = isPositive ? 'text-yes' : 'text-no'
  const signedPercentLabel = `${isPositive ? '+' : '-'}${percentLabel}`

  function formatSignedCurrency(value: number) {
    const abs = formatDollarValueLabel(Math.abs(value), { fallback: '0¢' })
    if (value > 0) {
      return `+${abs}`
    }
    if (value < 0) {
      return `-${abs}`
    }
    return `+${abs}`
  }

  const unrealizedLabel = formatSignedCurrency(unrealizedValue)
  const realizedLabel = formatSignedCurrency(realizedPnlValue)

  return (
    <tr className="text-2xs leading-tight text-foreground sm:text-xs">
      <td className="p-2 sm:px-3">
        <span
          className={cn(
            `inline-flex min-h-7 min-w-14 items-center justify-center rounded-sm px-4 text-xs font-semibold tracking-wide`,
            isYesOutcome ? 'bg-yes/15 text-yes-foreground' : 'bg-no/15 text-no-foreground',
          )}
        >
          {outcomeButtonLabel}
        </span>
      </td>
      <td className="p-2 text-center text-xs font-semibold sm:px-3 sm:text-sm">{formattedQuantity}</td>
      <td className="p-2 text-center text-xs font-semibold sm:px-3 sm:text-sm">{averageLabel}</td>
      <td className="p-2 sm:px-3">
        <PositionValueCell
          valueLabel={valueLabel}
          costLabel={costLabel}
          valueClassName="text-2xs font-semibold sm:text-sm"
          costClassName="text-2xs font-medium tracking-wide"
        />
      </td>
      <td className="p-2 pr-6 text-2xs font-semibold sm:px-3 sm:pr-6 sm:text-sm">
        <Tooltip>
          <TooltipTrigger
            render={
              <PositionReturnSummary
                valueLabel={displayedReturnValue}
                percentLabel={isNeutralReturn || derivedPercent == null ? null : signedPercentLabel}
                percentClassName={cn('text-2xs font-semibold sm:text-sm', returnColorClass)}
                underlineValue
              />
            }
          />
          <TooltipContent side="bottom" className="w-56 p-3">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t('Unrealized')}</span>
                <span className="font-semibold text-no">{unrealizedLabel}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>{t('Realized')}</span>
                <span className="font-semibold">{realizedLabel}</span>
              </div>
              <div className="my-1 border-t border-border" />
              <div className="flex items-center justify-between gap-3">
                <span>{t('Total')}</span>
                <span className="font-semibold">
                  {displayedReturnValue}
                  {!isNeutralReturn && derivedPercent != null && (
                    <span className={cn('ml-1 font-semibold', returnColorClass)}>({signedPercentLabel})</span>
                  )}
                </span>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </td>
      <td className="w-40 p-2 pl-6 text-right sm:px-3 sm:pl-6">
        <div className="flex items-center justify-end gap-2 sm:flex-nowrap">
          {canConvert && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={t('Convert position')}
              onClick={() => onConvert?.(position)}
            >
              {t('Convert')}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t('Sell position')}
            disabled={!market.is_active || market.is_resolved || market.condition?.resolved}
            onClick={() => onSell(position)}
          >
            {t('Sell')}
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t('Share {outcome} position', { outcome: outcomeButtonLabel })}
                  onClick={() => onShare(position)}
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

function NetPositionsDialog({
  open,
  onOpenChange,
  rows,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rows: Array<{
    id: string
    outcomeLabel: string
    payout: number
    netValue: number
    iconUrl?: string | null
  }>
}) {
  const t = useExtracted()
  const isMobile = useIsMobile()

  const body = (
    <div className="space-y-4 text-foreground">
      <div className="space-y-1 text-left">
        <div className="text-lg font-medium">{t('Net Positions')}</div>
        <div className="text-sm text-muted-foreground">
          {t('See your gains for each outcome scenario based on all your positions.')}
        </div>
      </div>

      <div className="space-y-2">
        <div
          className={cn(
            `grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 text-sm font-semibold text-muted-foreground uppercase`,
          )}
        >
          <span>{t('Outcome')}</span>
          <span className="text-right">{t('Payout')}</span>
          <span className="text-right">{t('Net Value')}</span>
        </div>
        <div className="border-t border-border" />
        <div className="max-h-[60vh] divide-y divide-border overflow-y-auto pr-2">
          {rows.map((row) => {
            const isPositive = row.netValue >= 0
            const netLabel = formatDollarValueLabel(Math.abs(row.netValue), { fallback: '0¢' })
            const payoutLabel = formatDollarValueLabel(row.payout, { fallback: '0¢' })
            return (
              <div
                key={row.id}
                className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {row.iconUrl ? (
                    <EventIconImage
                      src={row.iconUrl}
                      alt={row.outcomeLabel}
                      sizes="36px"
                      containerClassName="size-9 shrink-0 rounded-md"
                    />
                  ) : (
                    <div
                      className={cn(
                        `flex size-9 items-center justify-center rounded-md bg-muted text-sm font-semibold text-muted-foreground`,
                      )}
                    >
                      {row.outcomeLabel.slice(0, 1)}
                    </div>
                  )}
                  <div className="min-w-0 text-sm font-semibold text-foreground">
                    <span className="line-clamp-2">{row.outcomeLabel}</span>
                  </div>
                </div>
                <div className="text-right text-sm font-semibold text-foreground">{payoutLabel}</div>
                <div className={cn('text-right text-sm font-semibold', isPositive ? 'text-yes' : 'text-no')}>
                  {`${isPositive ? '+' : '-'}${netLabel}`}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[85vh] w-full bg-background px-4 pt-4 pb-6">{body}</DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-background p-6">{body}</DialogContent>
    </Dialog>
  )
}

export default function EventMarketPositions({
  market,
  isNegRiskEnabled,
  convertOptions: eventConvertOptions,
  eventOutcomes,
  negRiskMarketId,
  isNegRiskAugmented,
}: EventMarketPositionsProps) {
  const t = useExtracted()
  const user = useUser()
  const userAddress = getUserPublicAddress(user)
  const isMobile = useIsMobile()
  const isSingleMarket = useIsSingleMarket()
  const setOrderMarket = useOrder((state) => state.setMarket)
  const setOrderOutcome = useOrder((state) => state.setOutcome)
  const setOrderSide = useOrder((state) => state.setSide)
  const setOrderAmount = useOrder((state) => state.setAmount)
  const setIsMobileOrderPanelOpen = useOrder((state) => state.setIsMobileOrderPanelOpen)
  const orderInputRef = useOrder((state) => state.inputRef)

  // /positions means inventory still held, including an ended market waiting
  // for resolution or a resolved position that has not yet been redeemed.
  const positionStatus = 'active'

  const { status, refetch, visiblePositions } = useMarketPositionsQuery({
    userAddress,
    market,
    positionStatus,
  })

  const { resolvedEventOutcomes, eventOutcomeIds } = useResolvedEventOutcomes({
    eventOutcomes,
    market,
  })

  const eventPositionsQuery = useEventWidePositionsQuery({
    userAddress,
    eventOutcomeIds,
    positionStatus,
  })

  const loading = status === 'pending' && Boolean(user?.deposit_wallet_address)
  const hasInitialError = status === 'error' && Boolean(user?.deposit_wallet_address)
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false)
  const [sharePosition, setSharePosition] = useState<UserPosition | null>(null)
  const [isConvertDialogOpen, setIsConvertDialogOpen] = useState(false)
  const [isNetPositionsOpen, setIsNetPositionsOpen] = useState(false)

  const resolvedConvertOptions = useResolvedConvertOptions({
    isNegRiskEnabled,
    eventConvertOptions,
    market,
    visiblePositions,
  })

  const netPositionsRows = useNetPositionsRows({
    market,
    resolvedEventOutcomes,
    eventOutcomeIds,
    visiblePositions,
    eventPositionsData: eventPositionsQuery.data,
  })

  const handleSell = useCallback(
    (positionItem: UserPosition) => {
      if (!market) {
        return
      }

      const normalizedOutcome = positionItem.outcome_text?.toLowerCase()
      const explicitOutcomeIndex =
        typeof positionItem.outcome_index === 'number' ? positionItem.outcome_index : undefined
      const resolvedOutcomeIndex =
        explicitOutcomeIndex ?? (normalizedOutcome === 'no' ? OUTCOME_INDEX.NO : OUTCOME_INDEX.YES)
      const targetOutcome =
        market.outcomes.find((outcome) => outcome.outcome_index === resolvedOutcomeIndex) ?? market.outcomes[0]

      setOrderMarket(market)
      if (targetOutcome) {
        setOrderOutcome(targetOutcome)
      }
      setOrderSide(ORDER_SIDE.SELL)

      const shares = resolvePositionShares(positionItem)
      if (shares > 0) {
        setOrderAmount(formatAmountInputValue(shares, { roundingMode: 'floor' }))
      } else {
        setOrderAmount('')
      }

      if (isMobile) {
        setIsMobileOrderPanelOpen(true)
      } else {
        orderInputRef?.current?.focus()
      }
    },
    [
      isMobile,
      market,
      orderInputRef,
      setIsMobileOrderPanelOpen,
      setOrderAmount,
      setOrderMarket,
      setOrderOutcome,
      setOrderSide,
    ],
  )

  const shareCardPayload = useMemo(() => {
    if (!sharePosition) {
      return null
    }
    return buildShareCardPayload(buildShareCardPosition(sharePosition), {
      userName: user?.username || undefined,
      userImage: user?.image || undefined,
    })
  }, [sharePosition, user?.image, user?.username])

  const handleShareOpenChange = useCallback((open: boolean) => {
    setIsShareDialogOpen(open)
    if (!open) {
      setSharePosition(null)
    }
  }, [])

  const handleShareClick = useCallback((positionItem: UserPosition) => {
    setSharePosition(positionItem)
    setIsShareDialogOpen(true)
  }, [])

  const handleConvertClick = useCallback(() => {
    if (resolvedConvertOptions.length === 0) {
      return
    }
    setIsConvertDialogOpen(true)
  }, [resolvedConvertOptions.length])

  if (!userAddress) {
    return null
  }

  if (hasInitialError) {
    return (
      <AlertBanner
        title={t('Failed to load positions')}
        description={
          <Button type="button" onClick={() => refetch()} size="sm" variant="link" className="-ml-3">
            {t('Try again')}
          </Button>
        }
      />
    )
  }

  if (loading || visiblePositions.length === 0) {
    return null
  }

  const content = (
    <>
      {isSingleMarket && (
        <div className="p-4">
          <h3 className="text-base font-medium">{t('Positions')}</h3>
        </div>
      )}
      <div className="relative w-full overflow-x-auto">
        <table className="w-full border-collapse sm:table-auto">
          <thead>
            <tr className="border-b bg-background">
              <th className={cn(tableHeaderClass, 'text-left')}>{t('Outcome')}</th>
              <th className={cn(tableHeaderClass, 'text-center')}>{t('Qty')}</th>
              <th className={cn(tableHeaderClass, 'text-center')}>{t('Avg')}</th>
              <th className={cn(tableHeaderClass, 'text-left')}>{t('Value')}</th>
              <th className={cn(tableHeaderClass, 'text-left')}>{t('Return')}</th>
              <th className={cn(tableHeaderClass, 'w-40 text-right')}>
                <button
                  type="button"
                  onClick={() => setIsNetPositionsOpen(true)}
                  className="text-sm text-muted-foreground transition-colors hover:underline"
                >
                  {t('View net positions')}
                </button>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {visiblePositions.map((position) => (
              <MarketPositionRow
                key={`${position.outcome_text}-${position.last_activity_at}`}
                position={position}
                market={market}
                onSell={handleSell}
                onShare={handleShareClick}
                onConvert={isNegRiskEnabled && resolvedConvertOptions.length > 0 ? handleConvertClick : undefined}
              />
            ))}
          </tbody>
        </table>
      </div>
      <PositionShareDialog open={isShareDialogOpen} onOpenChange={handleShareOpenChange} payload={shareCardPayload} />
      <NetPositionsDialog open={isNetPositionsOpen} onOpenChange={setIsNetPositionsOpen} rows={netPositionsRows} />
      <EventConvertPositionsDialog
        open={isConvertDialogOpen}
        onOpenChange={setIsConvertDialogOpen}
        options={resolvedConvertOptions}
        outcomes={resolvedEventOutcomes}
        negRiskMarketId={negRiskMarketId}
        isNegRiskAugmented={isNegRiskAugmented}
      />
    </>
  )

  return isSingleMarket ? (
    <section className="min-w-0 overflow-hidden rounded-xl border">{content}</section>
  ) : (
    <div className="min-w-0 overflow-x-hidden">{content}</div>
  )
}
