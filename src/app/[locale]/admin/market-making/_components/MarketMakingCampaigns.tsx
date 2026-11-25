'use client'

import { useAppKit, useAppKitAccount } from '@reown/appkit/react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangleIcon,
  ArrowDownToLineIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleDollarSignIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  SearchIcon,
  ShieldAlertIcon,
  XIcon,
} from 'lucide-react'
import Image from 'next/image'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatUnits, keccak256, stringToHex } from 'viem'
import { usePublicClient, useWalletClient } from 'wagmi'

import type {
  EscrowCampaignStatusFilter,
  MarketMakingCampaignRecord,
  MarketMakingCampaignsResponse,
} from '@/lib/market-maker-escrow'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from '@/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/useIsMobile'
import { usePublicRuntimeConfig } from '@/hooks/usePublicRuntimeConfig'
import { Link } from '@/i18n/navigation'
import { MARKET_MAKER_ESCROW_ADDRESS, ZERO_ADDRESS } from '@/lib/contracts'
import { resolveMarketAssetUrl } from '@/lib/image/asset-reference'
import {
  ESCROW_CAMPAIGN_STATUS,
  getEffectiveCampaignStatus,
  MARKET_MAKER_ESCROW_ABI,
  resolutionDecisionForHash,
  resolutionDecisionCodeForHash,
} from '@/lib/market-maker-escrow'
import { POLYGON_MAINNET_CHAIN_ID } from '@/lib/network'
import { cn } from '@/lib/utils'
import { isUserRejectedRequestError } from '@/lib/wallet'

import { resolveCampaignLookupId } from './market-making-campaign-lookup'

export interface MarketMakingCampaignsCopy {
  search: string
  all: string
  open: string
  active: string
  review: string
  disputed: string
  completed: string
  cancelled: string
  market: string
  status: string
  marketMaker: string
  terms: string
  payment: string
  marketMakerPayment: string
  total: string
  servicePeriod: string
  action: string
  view: string
  closeAndRefund: string
  waiting: string
  noCampaigns: string
  noCampaignsDescription: string
  loadError: string
  connectWallet: string
  liquidityPerSide: string
  maximumSpread: string
  availability: string
  serviceStart: string
  serviceEnd: string
  kuestFee: string
  timeline: string
  created: string
  paid: string
  amountUnderReview: string
  availableToClaim: string
  claim: string
  expired: string
  waitingForMarketMaker: string
  cancelAndRefund: string
  refundable: string
  withdrawRefund: string
  refunded: string
  campaignNumber: string
  daysLeft: string
  hoursLeft: string
  dayCount: string
  hourCount: string
  waitingForMaker: string
  cancellationHelp: string
  cancelSponsorship: string
  cancelTitle: string
  cancelConfirmation: string
  keepSponsorship: string
  confirmCancellation: string
  reviewExplanation: string
  claimableIn: string
  paymentFrozen: string
  finalOutcome: string
  paidToMaker: string
  refundedToSponsor: string
  openDispute: string
  disputeTitle: string
  disputeIntro: string
  whatWentWrong: string
  liquidityUnavailable: string
  spreadExceeded: string
  depthTooLow: string
  makerStopped: string
  other: string
  disputeWarning: string
  back: string
  transactionFailed: string
  transactionConfirmed: string
  transactionRejected: string
  refundReadyToWithdraw: string
  amoyReadOnlyNotice: string
  close: string
  seriesBadge: string
  seriesTooltip: string
  decision: string
  resolutionDecisions: Record<string, string>
  customDecision: string
}

interface Props {
  linkedCampaignId: string | null
  locale: string
  copy: MarketMakingCampaignsCopy
}

type DisputeReason = 'liquidity_unavailable' | 'spread_exceeded' | 'depth_too_low' | 'maker_stopped' | 'other'

function compactAddress(address: string) {
  return address === ZERO_ADDRESS ? null : `${address.slice(0, 6)}…${address.slice(-4)}`
}

function formatUsdc(value: string, locale: string) {
  const numeric = Number(formatUnits(BigInt(value), 6))
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    notation: numeric >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: numeric >= 100 ? 0 : 2,
  }).format(numeric)
}

function formatDateTime(timestamp: number, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp * 1000)
}

function CampaignImage({ campaign, size = 'md' }: { campaign: MarketMakingCampaignRecord; size?: 'sm' | 'md' }) {
  const imageUrl = resolveMarketAssetUrl(campaign.iconUrl)
  const sizeClass = size === 'sm' ? 'size-10 rounded-lg' : 'size-14 rounded-xl'
  if (imageUrl) {
    return (
      <span className={cn('relative shrink-0 overflow-hidden border bg-muted', sizeClass)}>
        <Image
          src={imageUrl}
          alt=""
          fill
          sizes={size === 'sm' ? '40px' : '56px'}
          className="size-full object-cover"
          unoptimized
        />
      </span>
    )
  }
  return (
    <span className={cn('flex shrink-0 items-center justify-center border bg-muted text-muted-foreground', sizeClass)}>
      <CircleDollarSignIcon className="size-5" />
    </span>
  )
}

function replaceCount(template: string, count: number, locale: string) {
  return template.replace('__COUNT__', new Intl.NumberFormat(locale).format(count))
}

function disputeEvidenceHash(campaignId: string, reason: DisputeReason) {
  return keccak256(stringToHex(JSON.stringify({ schema: 'kuest.market-making.dispute.v1', campaignId, reason })))
}

function disputeReasonLabel(campaign: MarketMakingCampaignRecord, copy: MarketMakingCampaignsCopy) {
  const labels: Array<[DisputeReason, string]> = [
    ['liquidity_unavailable', copy.liquidityUnavailable],
    ['spread_exceeded', copy.spreadExceeded],
    ['depth_too_low', copy.depthTooLow],
    ['maker_stopped', copy.makerStopped],
    ['other', copy.other],
  ]
  return labels.find(([reason]) => disputeEvidenceHash(campaign.id, reason) === campaign.evidenceHash)?.[1] ?? null
}

function durationCount(seconds: number, locale: string, copy: MarketMakingCampaignsCopy) {
  const days = Math.ceil(Math.max(0, seconds) / 86_400)
  if (days >= 1) {
    return replaceCount(copy.dayCount, days, locale)
  }
  return replaceCount(copy.hourCount, Math.max(1, Math.ceil(Math.max(0, seconds) / 3_600)), locale)
}

function statusLabel(status: number, copy: MarketMakingCampaignsCopy, expired = false) {
  if (expired) {
    return copy.expired
  }
  switch (status) {
    case ESCROW_CAMPAIGN_STATUS.open:
      return copy.open
    case ESCROW_CAMPAIGN_STATUS.active:
      return copy.active
    case ESCROW_CAMPAIGN_STATUS.review:
      return copy.review
    case ESCROW_CAMPAIGN_STATUS.disputed:
      return copy.disputed
    case ESCROW_CAMPAIGN_STATUS.paid:
    case ESCROW_CAMPAIGN_STATUS.resolved:
      return copy.completed
    case ESCROW_CAMPAIGN_STATUS.cancelled:
      return copy.cancelled
    default:
      return '—'
  }
}

function statusClass(status: number) {
  switch (status) {
    case ESCROW_CAMPAIGN_STATUS.open:
      return 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300'
    case ESCROW_CAMPAIGN_STATUS.active:
      return 'border-yes/20 bg-yes/10 text-yes-foreground'
    case ESCROW_CAMPAIGN_STATUS.review:
      return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    case ESCROW_CAMPAIGN_STATUS.disputed:
      return 'border-destructive/20 bg-destructive/10 text-destructive'
    case ESCROW_CAMPAIGN_STATUS.paid:
    case ESCROW_CAMPAIGN_STATUS.resolved:
      return 'border-primary/20 bg-primary/10 text-primary'
    default:
      return 'border-border bg-muted text-muted-foreground'
  }
}

function StatusBadge({
  status,
  copy,
  expired = false,
}: {
  status: number
  copy: MarketMakingCampaignsCopy
  expired?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2.5 py-1 text-xs font-medium',
        expired ? 'border-destructive/20 bg-destructive/10 text-destructive' : statusClass(status),
      )}
    >
      {statusLabel(status, copy, expired)}
    </span>
  )
}

function matchesStatus(status: number, filter: EscrowCampaignStatusFilter) {
  if (filter === 'all') {
    return true
  }
  if (filter === 'completed') {
    return status === ESCROW_CAMPAIGN_STATUS.paid || status === ESCROW_CAMPAIGN_STATUS.resolved
  }
  return status === ESCROW_CAMPAIGN_STATUS[filter]
}

function termsSummary(campaign: MarketMakingCampaignRecord, locale: string) {
  const depth = campaign.depthPerSideAtomic ? formatUsdc(campaign.depthPerSideAtomic, locale) : '—'
  const spread = campaign.maxSpreadBps === null ? '—' : `${campaign.maxSpreadBps / 100}¢`
  return `${depth} / ${spread}`
}

function remainingLabel(
  campaign: MarketMakingCampaignRecord,
  now: number,
  locale: string,
  copy: MarketMakingCampaignsCopy,
) {
  const status = getEffectiveCampaignStatus(campaign.status, campaign.serviceEnd, now)
  if (status === ESCROW_CAMPAIGN_STATUS.open) {
    return '—'
  }
  if (status === ESCROW_CAMPAIGN_STATUS.disputed) {
    return copy.review
  }
  if (
    status === ESCROW_CAMPAIGN_STATUS.cancelled ||
    status === ESCROW_CAMPAIGN_STATUS.paid ||
    status === ESCROW_CAMPAIGN_STATUS.resolved
  ) {
    return '—'
  }
  const target = status === ESCROW_CAMPAIGN_STATUS.review ? campaign.claimableAt : campaign.serviceEnd
  const seconds = Math.max(0, target - now)
  const days = Math.ceil(seconds / 86_400)
  if (days >= 1) {
    return replaceCount(copy.daysLeft, days, locale)
  }
  return replaceCount(copy.hoursLeft, Math.max(1, Math.ceil(seconds / 3_600)), locale)
}

function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/35 px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium break-words">{value}</div>
    </div>
  )
}

function DetailSection({
  title,
  aside,
  children,
}: {
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

interface CampaignTimelineStep {
  label: string
  timestamp: number | null
  reached: boolean
  current: boolean
}

function CampaignTimeline({ steps, locale }: { steps: CampaignTimelineStep[]; locale: string }) {
  return (
    <div className="flex w-full items-start">
      {steps.map((step, index) => (
        <div key={step.label} className="relative min-w-0 flex-1 text-center">
          {index > 0 && (
            <span
              className={cn(
                'absolute top-2.5 right-1/2 h-0.5 w-full -translate-y-1/2',
                step.reached ? 'bg-primary' : 'bg-border',
              )}
            />
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className={cn(
                    'relative z-10 mx-auto block size-5 rounded-full border-2 bg-background',
                    step.reached ? 'border-primary bg-primary' : 'border-border',
                    step.current && 'ring-4 ring-primary/15',
                  )}
                />
              }
            />
            <TooltipContent className="text-sm">
              <div className="font-medium">{step.label}</div>
              {step.timestamp && <div className="mt-0.5">{formatDateTime(step.timestamp, locale)}</div>}
            </TooltipContent>
          </Tooltip>
          <div className={cn('mt-2 truncate px-1 text-xs', step.current ? 'font-semibold' : 'text-muted-foreground')}>
            {step.label}
          </div>
        </div>
      ))}
    </div>
  )
}

function CampaignDetail({
  campaign,
  locale,
  copy,
  now,
  open,
  onOpenChange,
  onCancel,
  onDispute,
  onWithdraw,
  pendingWithdrawalAtomic,
  isMutating,
  escrowReadOnly,
}: {
  campaign: MarketMakingCampaignRecord
  locale: string
  copy: MarketMakingCampaignsCopy
  now: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onCancel: () => void
  onDispute: () => void
  onWithdraw: () => void
  pendingWithdrawalAtomic: string | null
  isMutating: boolean
  escrowReadOnly: boolean
}) {
  const isMobile = useIsMobile()
  const effectiveStatus = getEffectiveCampaignStatus(campaign.status, campaign.serviceEnd, now)
  const isExpired =
    campaign.status === ESCROW_CAMPAIGN_STATUS.open &&
    campaign.marketMaker === ZERO_ADDRESS &&
    now >= campaign.acceptDeadline
  const canDispute =
    (campaign.status === ESCROW_CAMPAIGN_STATUS.active || campaign.status === ESCROW_CAMPAIGN_STATUS.review) &&
    now >= campaign.serviceStart &&
    now < campaign.claimableAt
  const reward = BigInt(campaign.rewardAtomic)
  const rewardToMaker = BigInt(campaign.rewardToMakerAtomic)
  const protocolFee = BigInt(campaign.protocolFeeAtomic)
  const rewardRefund = reward - rewardToMaker
  const earnedProtocolFee = reward === 0n ? 0n : (protocolFee * rewardToMaker) / reward
  const sponsorRefund = rewardRefund + BigInt(campaign.bondToSponsorAtomic) + (protocolFee - earnedProtocolFee)
  const submittedReason = disputeReasonLabel(campaign, copy)
  const resolutionCode = resolutionDecisionCodeForHash(campaign.decisionHash)
  const resolutionCanonical = resolutionDecisionForHash(campaign.decisionHash)
  const resolutionDecision = resolutionCode ? (copy.resolutionDecisions[resolutionCode] ?? resolutionCanonical) : null
  const hasDecision = !!campaign.decisionHash && !/^0x0{64}$/i.test(campaign.decisionHash)
  const cancelledRefund = BigInt(campaign.refundableAtomic)
  const hasPendingWithdrawal = pendingWithdrawalAtomic !== null && BigInt(pendingWithdrawalAtomic) > 0n
  const isCompleted =
    effectiveStatus === ESCROW_CAMPAIGN_STATUS.paid || effectiveStatus === ESCROW_CAMPAIGN_STATUS.resolved
  const isDisputed = effectiveStatus === ESCROW_CAMPAIGN_STATUS.disputed
  const totalPayment = reward + protocolFee
  const paidAmount = rewardToMaker + earnedProtocolFee
  const timelineSteps: CampaignTimelineStep[] = (() => {
    if (isExpired) {
      return [
        { label: copy.created, timestamp: campaign.createdAt, reached: true, current: false },
        { label: copy.open, timestamp: campaign.createdAt, reached: true, current: false },
        { label: copy.expired, timestamp: campaign.acceptDeadline, reached: true, current: true },
      ]
    }
    if (campaign.status === ESCROW_CAMPAIGN_STATUS.cancelled) {
      return [
        { label: copy.created, timestamp: campaign.createdAt, reached: true, current: false },
        { label: copy.open, timestamp: campaign.createdAt, reached: true, current: false },
        { label: copy.cancelled, timestamp: campaign.cancelledAt, reached: true, current: true },
      ]
    }
    if (isDisputed) {
      return [
        { label: copy.created, timestamp: campaign.createdAt, reached: true, current: false },
        { label: copy.open, timestamp: campaign.createdAt, reached: true, current: false },
        { label: copy.active, timestamp: campaign.acceptedAt ?? campaign.serviceStart, reached: true, current: false },
        { label: copy.disputed, timestamp: campaign.disputedAt, reached: true, current: true },
      ]
    }
    const currentIndex =
      effectiveStatus === ESCROW_CAMPAIGN_STATUS.open
        ? 1
        : effectiveStatus === ESCROW_CAMPAIGN_STATUS.active
          ? 2
          : effectiveStatus === ESCROW_CAMPAIGN_STATUS.review
            ? 3
            : isCompleted
              ? 4
              : 0
    return [
      { label: copy.created, timestamp: campaign.createdAt, reached: currentIndex >= 0, current: currentIndex === 0 },
      { label: copy.open, timestamp: campaign.createdAt, reached: currentIndex >= 1, current: currentIndex === 1 },
      {
        label: copy.active,
        timestamp: campaign.acceptedAt ?? campaign.serviceStart,
        reached: currentIndex >= 2,
        current: currentIndex === 2,
      },
      {
        label: copy.review,
        timestamp: campaign.reviewStartedAt ?? campaign.serviceEnd,
        reached: currentIndex >= 3,
        current: currentIndex === 3,
      },
      {
        label: copy.completed,
        timestamp: campaign.completedAt ?? campaign.claimableAt,
        reached: currentIndex >= 4,
        current: currentIndex === 4,
      },
    ]
  })()
  const paymentSummary =
    campaign.status === ESCROW_CAMPAIGN_STATUS.cancelled
      ? {
          label: copy.refundable,
          value: (
            <span className="inline-flex items-center gap-2">
              {formatUsdc(cancelledRefund.toString(), locale)}
              {pendingWithdrawalAtomic !== null && !hasPendingWithdrawal && (
                <span className="text-xs font-medium text-primary">{copy.refunded}</span>
              )}
            </span>
          ),
        }
      : isCompleted
        ? { label: copy.paid, value: formatUsdc(paidAmount.toString(), locale) }
        : isDisputed
          ? { label: copy.amountUnderReview, value: formatUsdc(totalPayment.toString(), locale) }
          : { label: copy.total, value: formatUsdc(totalPayment.toString(), locale) }

  const content = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b px-5 py-4 pr-14">
        <div className="flex items-center gap-3">
          <CampaignImage campaign={campaign} />
          <div className="min-w-0">
            <div className="flex items-start gap-1.5">
              <h2 className="line-clamp-2 text-sm leading-5 font-semibold">{campaign.title}</h2>
              {campaign.eventSlug && (
                <Link
                  href={`/event/${campaign.eventSlug}`}
                  className="mt-0.5 inline-flex shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ExternalLinkIcon className="size-3.5" />
                  <span className="sr-only">{campaign.title}</span>
                </Link>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <StatusBadge status={effectiveStatus} copy={copy} expired={isExpired} />
              <span className="font-mono">#{campaign.id}</span>
            </div>
            {campaign.scopeKind === 'series' && (
              <div className="mt-1.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <Tooltip>
                  <TooltipTrigger render={<span className="cursor-help font-medium text-primary" />}>
                    {copy.seriesBadge}
                  </TooltipTrigger>
                  <TooltipContent className="max-w-72 text-sm">{copy.seriesTooltip}</TooltipContent>
                </Tooltip>
                {campaign.seriesSlug && (
                  <>
                    <span>·</span>
                    <span className="truncate font-mono" title={campaign.seriesSlug}>
                      {campaign.seriesSlug}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {effectiveStatus === ESCROW_CAMPAIGN_STATUS.review && (
          <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <p className="text-sm">{copy.reviewExplanation}</p>
            <div className="mt-2 font-medium">
              {copy.claimableIn.replace('__TIME__', durationCount(campaign.claimableAt - now, locale, copy))}
            </div>
          </div>
        )}
        {effectiveStatus === ESCROW_CAMPAIGN_STATUS.disputed && (
          <div className="mb-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4">
            <div className="flex items-start gap-3">
              <ShieldAlertIcon className="mt-0.5 size-5 text-destructive" />
              <div>
                <div className="font-medium">{copy.paymentFrozen}</div>
                {submittedReason && <div className="mt-2 text-sm">{submittedReason}</div>}
              </div>
            </div>
          </div>
        )}
        {(effectiveStatus === ESCROW_CAMPAIGN_STATUS.paid || effectiveStatus === ESCROW_CAMPAIGN_STATUS.resolved) && (
          <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2Icon className="size-5 text-primary" />
              {copy.finalOutcome}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-muted-foreground">{copy.paidToMaker}</div>
                <div className="mt-1 font-semibold">{formatUsdc(campaign.rewardToMakerAtomic, locale)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{copy.refundedToSponsor}</div>
                <div className="mt-1 font-semibold">{formatUsdc(sponsorRefund.toString(), locale)}</div>
              </div>
            </div>
            {hasDecision && (
              <div className="mt-3 text-sm">
                <div className="text-muted-foreground">{copy.decision}</div>
                <div className="mt-1 font-medium">{resolutionDecision ?? copy.customDecision}</div>
                {!resolutionCode && (
                  <code className="mt-1 block text-xs break-all text-muted-foreground">{campaign.decisionHash}</code>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          <DetailSection title={copy.terms}>
            <div className="grid gap-2 sm:grid-cols-3">
              <DetailItem
                label={copy.liquidityPerSide}
                value={campaign.depthPerSideAtomic ? formatUsdc(campaign.depthPerSideAtomic, locale) : '—'}
              />
              <DetailItem
                label={copy.maximumSpread}
                value={campaign.maxSpreadBps === null ? '—' : `${campaign.maxSpreadBps / 100}¢`}
              />
              <DetailItem
                label={copy.availability}
                value={campaign.availabilityBps === null ? '—' : `${campaign.availabilityBps / 100}%`}
              />
            </div>
          </DetailSection>

          <DetailSection
            title={copy.timeline}
            aside={
              effectiveStatus === ESCROW_CAMPAIGN_STATUS.active
                ? remainingLabel(campaign, now, locale, copy)
                : undefined
            }
          >
            <CampaignTimeline steps={timelineSteps} locale={locale} />
          </DetailSection>

          <DetailSection title={copy.payment}>
            <div className="grid gap-2 sm:grid-cols-3">
              <DetailItem label={copy.marketMakerPayment} value={formatUsdc(campaign.rewardAtomic, locale)} />
              <DetailItem label={copy.kuestFee} value={formatUsdc(campaign.protocolFeeAtomic, locale)} />
              <DetailItem label={paymentSummary.label} value={paymentSummary.value} />
            </div>
          </DetailSection>
        </div>
      </div>

      {(campaign.status === ESCROW_CAMPAIGN_STATUS.open ||
        canDispute ||
        (campaign.status === ESCROW_CAMPAIGN_STATUS.cancelled && hasPendingWithdrawal)) && (
        <div className="flex shrink-0 gap-2 border-t bg-background p-4">
          {campaign.status === ESCROW_CAMPAIGN_STATUS.open && isExpired && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={isMutating || escrowReadOnly}
              onClick={onCancel}
            >
              {copy.cancelAndRefund}
            </Button>
          )}
          {campaign.status === ESCROW_CAMPAIGN_STATUS.open && !isExpired && (
            <>
              <Button type="button" variant="secondary" className="min-w-0 flex-1" disabled>
                {copy.waitingForMarketMaker}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="shrink-0" />}>
                  <EllipsisIcon className="size-5" />
                  <span className="sr-only">{copy.cancelSponsorship}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem variant="destructive" onClick={onCancel}>
                    {copy.cancelSponsorship}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          {canDispute && (
            <Button
              type="button"
              variant="destructive"
              className="w-full"
              disabled={isMutating || escrowReadOnly}
              onClick={onDispute}
            >
              {copy.openDispute}
            </Button>
          )}
          {campaign.status === ESCROW_CAMPAIGN_STATUS.cancelled && hasPendingWithdrawal && (
            <Button type="button" className="w-full" disabled={escrowReadOnly || isMutating} onClick={onWithdraw}>
              {isMutating && <LoaderCircleIcon className="size-4 animate-spin" />}
              {copy.withdrawRefund}
            </Button>
          )}
        </div>
      )}
    </div>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="flex max-h-[92dvh] flex-col overflow-hidden bg-background">
          <DrawerHeader className="sr-only">
            <DrawerTitle>{campaign.title}</DrawerTitle>
            <DrawerDescription>{statusLabel(effectiveStatus, copy)}</DrawerDescription>
          </DrawerHeader>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute top-3 right-3 z-10"
            onClick={() => onOpenChange(false)}
          >
            <XIcon className="size-5" />
            <span className="sr-only">{copy.close}</span>
          </Button>
          {content}
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{campaign.title}</DialogTitle>
          <DialogDescription>{statusLabel(effectiveStatus, copy)}</DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  )
}

export default function MarketMakingCampaigns({ linkedCampaignId, locale, copy }: Props) {
  const { open: openAppKit } = useAppKit()
  const { address, isConnected } = useAppKitAccount()
  const { chainId } = usePublicRuntimeConfig()
  const escrowReadOnly = chainId !== POLYGON_MAINNET_CHAIN_ID
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient({ chainId })
  const [filter, setFilter] = useState<EscrowCampaignStatusFilter>('all')
  const [search, setSearch] = useState(linkedCampaignId ?? '')
  const [lookupId, setLookupId] = useState<string | null>(null)
  const [dismissedLinkedCampaignId, setDismissedLinkedCampaignId] = useState<string | null>(null)
  const [selected, setSelected] = useState<MarketMakingCampaignRecord | null>(null)
  const [cancelCampaign, setCancelCampaign] = useState<MarketMakingCampaignRecord | null>(null)
  const [disputeCampaign, setDisputeCampaign] = useState<MarketMakingCampaignRecord | null>(null)
  const [disputeReason, setDisputeReason] = useState<DisputeReason | null>(null)
  const [isMutating, setIsMutating] = useState(false)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const lookupCampaignId = resolveCampaignLookupId({ dismissedLinkedCampaignId, linkedCampaignId, lookupId })
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000)
    return () => window.clearInterval(interval)
  }, [])
  const campaignsQuery = useQuery({
    queryKey: ['market-making-campaigns'],
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const response = await fetch('/admin/api/market-making/campaigns', { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(copy.loadError)
      }
      return (await response.json()) as MarketMakingCampaignsResponse
    },
  })
  const campaignLookupQuery = useQuery({
    queryKey: ['market-making-campaign', lookupCampaignId],
    enabled: Boolean(lookupCampaignId),
    queryFn: async () => {
      const params = new URLSearchParams({ campaign: lookupCampaignId! })
      const response = await fetch(`/admin/api/market-making/campaigns?${params}`, { cache: 'no-store' })
      if (response.status === 404) {
        return { data: [] } satisfies MarketMakingCampaignsResponse
      }
      if (!response.ok) {
        throw new Error(copy.loadError)
      }
      return (await response.json()) as MarketMakingCampaignsResponse
    },
  })
  const handledCampaignId = useRef<string | null>(null)
  useLayoutEffect(() => {
    const latestCampaigns = [...(campaignLookupQuery.data?.data ?? []), ...(campaignsQuery.data?.data ?? [])]
    const latestById = new Map(latestCampaigns.map((campaign) => [campaign.id, campaign]))
    if (lookupCampaignId && handledCampaignId.current !== lookupCampaignId) {
      const linkedCampaign = latestById.get(lookupCampaignId)
      if (linkedCampaign) {
        handledCampaignId.current = lookupCampaignId
        queueMicrotask(() => {
          setSelected(linkedCampaign)
        })
      }
    }
    queueMicrotask(() => {
      setSelected((current) => (current ? (latestById.get(current.id) ?? null) : current))
      setCancelCampaign((current) => (current ? (latestById.get(current.id) ?? null) : current))
      setDisputeCampaign((current) => (current ? (latestById.get(current.id) ?? null) : current))
    })
  }, [campaignLookupQuery.data?.data, campaignsQuery.data?.data, lookupCampaignId])
  const pendingWithdrawalsQuery = useQuery({
    queryKey: ['market-making-pending-withdrawals', address?.toLowerCase()],
    enabled: Boolean(address && publicClient),
    staleTime: 5_000,
    queryFn: async () => {
      if (!address || !publicClient) {
        return '0'
      }
      const amount = await publicClient.readContract({
        address: MARKET_MAKER_ESCROW_ADDRESS,
        abi: MARKET_MAKER_ESCROW_ABI,
        functionName: 'pendingWithdrawals',
        args: [address as `0x${string}`],
      })
      return amount.toString()
    },
  })
  const campaigns = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    const allCampaigns = new Map<string, MarketMakingCampaignRecord>()
    for (const campaign of [...(campaignLookupQuery.data?.data ?? []), ...(campaignsQuery.data?.data ?? [])]) {
      allCampaigns.set(campaign.id, campaign)
    }
    return [...allCampaigns.values()].filter((campaign) => {
      const effectiveStatus = getEffectiveCampaignStatus(campaign.status, campaign.serviceEnd, now)
      if (!matchesStatus(effectiveStatus, filter)) {
        return false
      }
      if (!normalizedSearch) {
        return true
      }
      return (
        campaign.id.toLowerCase().includes(normalizedSearch) ||
        campaign.title.toLowerCase().includes(normalizedSearch) ||
        campaign.markets.some((market) => market.title?.toLowerCase().includes(normalizedSearch))
      )
    })
  }, [campaignLookupQuery.data?.data, campaignsQuery.data?.data, filter, now, search])
  const filters: Array<{ id: EscrowCampaignStatusFilter; label: string }> = [
    { id: 'all', label: copy.all },
    { id: 'open', label: copy.open },
    { id: 'active', label: copy.active },
    { id: 'review', label: copy.review },
    { id: 'disputed', label: copy.disputed },
    { id: 'completed', label: copy.completed },
    { id: 'cancelled', label: copy.cancelled },
  ]
  const pendingWithdrawalAtomic = pendingWithdrawalsQuery.data ?? '0'
  const hasPendingWithdrawal = BigInt(pendingWithdrawalAtomic) > 0n
  const hasBulkCampaignData = (campaignsQuery.data?.data.length ?? 0) > 0
  const hasLookupCampaignData = (campaignLookupQuery.data?.data.length ?? 0) > 0
  const isLoading = campaignsQuery.isLoading || (campaignLookupQuery.isLoading && !hasBulkCampaignData)
  const isError =
    (campaignsQuery.isError && !hasLookupCampaignData) || (campaignLookupQuery.isError && !hasBulkCampaignData)
  const reasons: Array<{ id: DisputeReason; label: string }> = [
    { id: 'liquidity_unavailable', label: copy.liquidityUnavailable },
    { id: 'spread_exceeded', label: copy.spreadExceeded },
    { id: 'depth_too_low', label: copy.depthTooLow },
    { id: 'maker_stopped', label: copy.makerStopped },
    { id: 'other', label: copy.other },
  ]

  function resetCampaignLookup() {
    handledCampaignId.current = null
    setDismissedLinkedCampaignId(linkedCampaignId)
    setLookupId(null)
  }

  function closeCampaignDetail() {
    setSelected(null)
    resetCampaignLookup()
  }

  async function refreshCampaignData() {
    await Promise.all([
      campaignsQuery.refetch(),
      pendingWithdrawalsQuery.refetch(),
      ...(lookupCampaignId ? [campaignLookupQuery.refetch()] : []),
    ])
  }

  async function writeCampaign(functionName: 'cancelCampaign' | 'openDispute', campaign: MarketMakingCampaignRecord) {
    if (escrowReadOnly) {
      toast.error(copy.amoyReadOnlyNotice)
      return false
    }
    if (!isConnected || !address || !walletClient) {
      await openAppKit()
      return false
    }
    if (address.toLowerCase() !== campaign.sponsor.toLowerCase()) {
      toast.error(copy.connectWallet)
      return false
    }
    if (walletClient.chain?.id && walletClient.chain.id !== chainId) {
      toast.error(copy.transactionFailed)
      return false
    }
    if (!publicClient) {
      toast.error(copy.transactionFailed)
      return false
    }
    setIsMutating(true)
    try {
      const args =
        functionName === 'cancelCampaign'
          ? ([BigInt(campaign.id)] as const)
          : ([BigInt(campaign.id), disputeEvidenceHash(campaign.id, disputeReason!)] as const)
      const hash = await walletClient.writeContract({
        account: address as `0x${string}`,
        address: MARKET_MAKER_ESCROW_ADDRESS,
        abi: MARKET_MAKER_ESCROW_ABI,
        functionName,
        args,
        chain: walletClient.chain,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') {
        throw new Error(copy.transactionFailed)
      }
      await refreshCampaignData()
      toast.success(functionName === 'cancelCampaign' ? copy.refundReadyToWithdraw : copy.transactionConfirmed)
      return true
    } catch (error) {
      if (isUserRejectedRequestError(error)) {
        toast.info(copy.transactionRejected)
      } else {
        console.error(`Failed to ${functionName}.`, error)
        toast.error(copy.transactionFailed)
      }
      return false
    } finally {
      setIsMutating(false)
    }
  }

  async function withdrawRefund() {
    if (escrowReadOnly) {
      toast.error(copy.amoyReadOnlyNotice)
      return
    }
    if (!isConnected || !address || !walletClient) {
      await openAppKit()
      return
    }
    if (walletClient.chain?.id && walletClient.chain.id !== chainId) {
      toast.error(copy.transactionFailed)
      return
    }
    if (!publicClient) {
      toast.error(copy.transactionFailed)
      return
    }
    setIsMutating(true)
    try {
      const hash = await walletClient.writeContract({
        account: address as `0x${string}`,
        address: MARKET_MAKER_ESCROW_ADDRESS,
        abi: MARKET_MAKER_ESCROW_ABI,
        functionName: 'withdraw',
        chain: walletClient.chain,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') {
        throw new Error(copy.transactionFailed)
      }
      await refreshCampaignData()
      toast.success(copy.transactionConfirmed)
    } catch (error) {
      if (isUserRejectedRequestError(error)) {
        toast.info(copy.transactionRejected)
      } else {
        console.error('Failed to withdraw market-making refund.', error)
        toast.error(copy.transactionFailed)
      }
    } finally {
      setIsMutating(false)
    }
  }

  return (
    <div className="mt-6">
      <div className="flex flex-col justify-between gap-3 border-b pb-4 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-80">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              const value = event.target.value
              setSearch(value)
              if (!/^(0|[1-9][0-9]*)$/.test(value.trim())) {
                resetCampaignLookup()
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                const value = search.trim()
                if (/^(0|[1-9][0-9]*)$/.test(value)) {
                  if (lookupCampaignId === value) {
                    void campaignLookupQuery.refetch()
                  } else {
                    setLookupId(value)
                  }
                }
              }
            }}
            placeholder={copy.search}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{copy.availableToClaim}:</span>
            <span className="font-semibold">{formatUsdc(pendingWithdrawalAtomic, locale)}</span>
            <Button
              type="button"
              size="sm"
              className="gap-1"
              disabled={escrowReadOnly || !hasPendingWithdrawal || isMutating}
              onClick={withdrawRefund}
            >
              {isMutating && <LoaderCircleIcon className="size-4 animate-spin" />}
              {!isMutating && <ArrowDownToLineIcon className="size-4" />}
              {copy.claim}
            </Button>
          </div>
          <Select value={filter} onValueChange={(value) => value && setFilter(value as EscrowCampaignStatusFilter)}>
            <SelectTrigger className="w-36 sm:w-44">
              <SelectValue>{filters.find((item) => item.id === filter)?.label ?? copy.all}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              {filters.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" />
          {copy.waiting}
        </div>
      )}
      {isError && <div className="py-20 text-center text-sm text-destructive">{copy.loadError}</div>}
      {!isLoading && !isError && campaigns.length === 0 && (
        <div className="py-20 text-center">
          <CircleDollarSignIcon className="mx-auto size-7 text-muted-foreground" />
          <h2 className="mt-4 font-semibold">{copy.noCampaigns}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{copy.noCampaignsDescription}</p>
        </div>
      )}
      {!isLoading && !isError && campaigns.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.market}</TableHead>
              <TableHead>{copy.status}</TableHead>
              <TableHead>{copy.marketMaker}</TableHead>
              <TableHead>{copy.terms}</TableHead>
              <TableHead>{copy.payment}</TableHead>
              <TableHead>{copy.servicePeriod}</TableHead>
              <TableHead className="text-right">{copy.action}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((campaign) => {
              const effectiveStatus = getEffectiveCampaignStatus(campaign.status, campaign.serviceEnd, now)
              const isExpired =
                campaign.status === ESCROW_CAMPAIGN_STATUS.open &&
                campaign.marketMaker === ZERO_ADDRESS &&
                now >= campaign.acceptDeadline
              const marketMakerLabel =
                compactAddress(campaign.marketMaker) ??
                (effectiveStatus === ESCROW_CAMPAIGN_STATUS.open && !isExpired ? copy.waiting : '—')
              return (
                <TableRow key={campaign.id} className="cursor-pointer" onClick={() => setSelected(campaign)}>
                  <TableCell className="max-w-64 whitespace-normal">
                    <div className="flex items-center gap-3">
                      <CampaignImage campaign={campaign} size="sm" />
                      <div className="min-w-0">
                        <div className="line-clamp-2 font-medium">{campaign.title}</div>
                        {(campaign.marketCount > 1 || campaign.scopeKind === 'series') && (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            {campaign.marketCount > 1 && (
                              <span>{replaceCount(copy.campaignNumber, campaign.marketCount, locale)}</span>
                            )}
                            {campaign.marketCount > 1 && campaign.scopeKind === 'series' && <span>·</span>}
                            {campaign.scopeKind === 'series' && (
                              <span className="font-semibold text-primary">{copy.seriesBadge}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={effectiveStatus} copy={copy} expired={isExpired} />
                  </TableCell>
                  <TableCell>{marketMakerLabel}</TableCell>
                  <TableCell>{termsSummary(campaign, locale)}</TableCell>
                  <TableCell className="font-medium">{formatUsdc(campaign.rewardAtomic, locale)}</TableCell>
                  <TableCell>{remainingLabel(campaign, now, locale, copy)}</TableCell>
                  <TableCell className="text-right">
                    <Button type="button" variant="ghost" size="sm" className="gap-1">
                      {isExpired ? copy.closeAndRefund : copy.view}
                      <ChevronRightIcon className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      {selected && (
        <CampaignDetail
          campaign={selected}
          locale={locale}
          copy={copy}
          now={now}
          open
          onOpenChange={(open) => !open && closeCampaignDetail()}
          onCancel={() => setCancelCampaign(selected)}
          onDispute={() => {
            setDisputeReason(null)
            setDisputeCampaign(selected)
          }}
          onWithdraw={withdrawRefund}
          pendingWithdrawalAtomic={pendingWithdrawalsQuery.data ?? null}
          isMutating={isMutating}
          escrowReadOnly={escrowReadOnly}
        />
      )}

      <Dialog open={Boolean(cancelCampaign)} onOpenChange={(open) => !open && setCancelCampaign(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy.cancelTitle}</DialogTitle>
            <DialogDescription>{copy.cancelConfirmation}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCancelCampaign(null)}>
              {copy.keepSponsorship}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={escrowReadOnly || isMutating}
              onClick={async () => {
                if (cancelCampaign && (await writeCampaign('cancelCampaign', cancelCampaign))) {
                  setCancelCampaign(null)
                  closeCampaignDetail()
                }
              }}
            >
              {isMutating && <LoaderCircleIcon className="size-4 animate-spin" />}
              {copy.confirmCancellation}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(disputeCampaign)} onOpenChange={(open) => !open && setDisputeCampaign(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{copy.disputeTitle}</DialogTitle>
            <DialogDescription>{copy.disputeIntro}</DialogDescription>
          </DialogHeader>
          <div>
            <div className="mb-2 text-sm font-medium">{copy.whatWentWrong}</div>
            <div className="grid gap-2">
              {reasons.map((reason) => (
                <button
                  key={reason.id}
                  type="button"
                  className={cn(
                    'rounded-lg border px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted',
                    disputeReason === reason.id && 'border-primary bg-primary/5 ring-1 ring-primary',
                  )}
                  disabled={escrowReadOnly || isMutating}
                  onClick={() => setDisputeReason(reason.id)}
                >
                  {reason.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span>{copy.disputeWarning}</span>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDisputeCampaign(null)}>
              {copy.back}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={escrowReadOnly || !disputeReason || isMutating}
              onClick={async () => {
                if (disputeCampaign && disputeReason && (await writeCampaign('openDispute', disputeCampaign))) {
                  setDisputeCampaign(null)
                  closeCampaignDetail()
                }
              }}
            >
              {isMutating && <LoaderCircleIcon className="size-4 animate-spin" />}
              {copy.openDispute}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
