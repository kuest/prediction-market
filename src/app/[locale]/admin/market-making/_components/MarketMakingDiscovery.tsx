'use client'

import type { Address, Hex } from 'viem'

import { useAppKit, useAppKitAccount, useAppKitNetwork, useAppKitProvider } from '@reown/appkit/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangleIcon,
  ArrowLeftRightIcon,
  BellIcon,
  CalendarClockIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleHelpIcon,
  CircleDollarSignIcon,
  GaugeIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react'
import Image from 'next/image'
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createWalletClient, custom, encodeFunctionData, erc20Abi } from 'viem'
import { usePublicClient, useWalletClient } from 'wagmi'

import type { MarketMakingCampaignsCopy } from '@/app/[locale]/admin/market-making/_components/MarketMakingCampaigns'
import type { MarketMakingHowItWorksCopy } from '@/app/[locale]/admin/market-making/_components/MarketMakingHowItWorks'
import type {
  MarketMakingDiscoveryItem,
  MarketMakingDiscoveryResponse,
  MarketMakingSourceFilter,
} from '@/lib/admin-market-making'

import { resolveCampaignsInstanceKey } from '@/app/[locale]/admin/market-making/_components/market-making-campaign-lookup'
import MarketMakingCampaigns from '@/app/[locale]/admin/market-making/_components/MarketMakingCampaigns'
import MarketMakingHowItWorks from '@/app/[locale]/admin/market-making/_components/MarketMakingHowItWorks'
import AlertBanner from '@/components/AlertBanner'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/useIsMobile'
import { usePublicRuntimeConfig } from '@/hooks/usePublicRuntimeConfig'
import { useSignaturePromptRunner } from '@/hooks/useSignaturePromptRunner'
import { Link } from '@/i18n/navigation'
import { COLLATERAL_TOKEN_ADDRESS, MARKET_MAKER_ESCROW_ADDRESS, POLY_SYNCER_CREATOR_ADDRESS } from '@/lib/contracts'
import {
  linkSponsorEmail,
  NotificationApiError,
  type NotificationPreference,
  readNotificationSettings,
  updateNotificationSettings,
} from '@/lib/kuest-notifications'
import { MARKET_MAKER_ESCROW_ABI } from '@/lib/market-maker-escrow'
import {
  isSponsorPremiumValid,
  shouldAutoCompleteDeployment,
  shouldCloseExistingDeployment,
  shouldResetImportActions,
} from '@/lib/market-making-discovery'
import {
  DEFAULT_SPONSORSHIP_OPTIONS,
  multiMarketDiscountBps,
  resolveSponsorshipSelection,
  type SponsorshipOptions,
} from '@/lib/market-making-pricing'
import {
  buildMarketMakerQuoteInput,
  displayedCostAtomic,
  marketImportStorageKey,
  requiredSponsorBalanceAtomic,
  sponsorshipDurationSubtitle,
} from '@/lib/market-making-series'
import { POLYGON_MAINNET_CHAIN_ID } from '@/lib/network'
import { hasUsableUserEmail } from '@/lib/user-email'
import { cn } from '@/lib/utils'
import { resolveViemNetworkByChainId } from '@/lib/viem-network'
import { isRecoverableWalletConnectorError, isUserRejectedRequestError } from '@/lib/wallet'
import {
  buildRpcWalletTransactionRequest,
  isEmbeddedWalletProvider,
  isRpcWalletProvider,
  readWalletTransactionHash,
  resolveWalletChainId,
  type RpcWalletProvider,
} from '@/lib/wallet/eoa-transaction'
import { useUser } from '@/stores/useUser'

interface MarketMakingCopy {
  eyebrow: string
  title: string
  description: string
  searchPlaceholder: string
  all: string
  mine: string
  kuest: string
  polymarket: string
  polymarketSource: string
  emptyTitle: string
  emptyDescription: string
  loading: string
  loadError: string
  sponsor: string
  marketCount: string
  yourMarket: string
  globalMarket: string
  onKuest: string
  importRequired: string
  hedgeAvailable: string
  liquidity: string
  ends: string
  markets: string
  campaignDescription: string
  depth: string
  depthHelp: string
  spread: string
  spreadHelp: string
  buyOrders: string
  sellOrders: string
  coverage: string
  duration: string
  dayCount: string
  untilDate: string
  multiMarketDiscount: string
  makerReward: string
  sponsorPremium: string
  sponsorPremiumHelp: string
  importEvent: string
  kuestFee: string
  total: string
  estimated: string
  continue: string
  connectWallet: string
  calculating: string
  quoteUnavailable: string
  escrowNotice: string
  funding: string
  campaignCreated: string
  transactionRejected: string
  transactionConfirmed: string
  insufficientBalance: string
  balanceUnavailable: string
  retry: string
  walletNotReady: string
  transactionFailed: string
  approveUsdc: string
  payImportFee: string
  reserveDeployment: string
  fundMarketMakerCampaign: string
  confirmNetworkSwitch: string
  transactionPrompt: string
  marketClosesTooSoon: string
  marketDataUnavailable: string
  close: string
  sponsorTab: string
  campaignsTab: string
  howItWorks: string
  max: string
  importTitle: string
  importDescription: string
  paymentConfirmed: string
  preparingEvent: string
  deployingMarkets: string
  publishingEvent: string
  readyToSponsor: string
  importRetry: string
  importRetrying: string
  importFailed: string
  importRefundable: string
  refundReadyToWithdraw: string
  cancelImport: string
  cancellingImport: string
  deploymentRelayerPending: string
  withdrawRefund: string
  importPaymentPending: string
  notificationSettings: string
  emailAddress: string
  emailDescription: string
  continueToSign: string
  verify: string
  verifying: string
  verificationUnavailable: string
  saveChanges: string
  marketMaking: string
  operatorVerificationPending: string
  accountEmailRequired: string
  accountSettings: string
  amoyReadOnlyNotice: string
  mainnetOnly: string
  seriesBadge: string
  seriesTooltip: string
  sponsorSeries: string
  sponsorSeriesDescription: string
  allRenewals: string
}

interface MarketMakingDiscoveryProps {
  linkedCampaignId: string | null
  locale: string
  copy: MarketMakingCopy
  campaignsCopy: MarketMakingCampaignsCopy
  howItWorksCopy: MarketMakingHowItWorksCopy
}

interface EscrowPricingBreakdown {
  multiMarketDiscountBps?: number
  marketMakerReward: string
  protocolFee: string
  total: string
  totalAtomic: string
}

interface EscrowCostBreakdown {
  status: 'estimate' | 'partial' | 'final'
  marketMakerPaymentAtomic: string | null
  kuestFeeAtomic: string | null
  campaignFundingTotalAtomic: string | null
  initialDeploymentFeeAtomic: string | null
  totalCostAtomic: string | null
  initialDeploymentFeePaid: boolean
  initialDeploymentFeeStatus: 'estimate' | 'final'
  campaignFundingStatus: 'pending' | 'final'
  totalCostStatus: 'pending' | 'estimate' | 'final'
}

interface EscrowPreviewResponse {
  status: 'priced'
  serviceStart: number
  serviceEnd: number
  claimableAt: number
  breakdown: EscrowPricingBreakdown
  costs: EscrowCostBreakdown
}

interface EscrowConfigResponse {
  sponsorshipOptions?: SponsorshipOptions
  pricingConfig: {
    acceptDeadlineLeadSeconds?: number
    baseCoverageBps?: number
    defaultServiceStartDelaySeconds?: number
    minimumServiceDurationSeconds?: number
    terms?: { minimumTwoSidedCoverageBps?: number }
  }
  importConfig: {
    minimumEventLeadTimeSeconds: number
  }
  importPayment: {
    chainId: number
    tokenAddress: string
    receiverAddress: string
  }
}

interface EscrowIssuedQuoteResponse {
  status: 'issued'
  quote: {
    quoteId: string
    sponsor: string
    scopeHash: string
    termsHash: string
    reward: string
    bond: string
    protocolFeeBps: number
    acceptDeadline: number
    serviceStart: number
    serviceEnd: number
    claimableAt: number
    validUntil: number
  }
  signature: string
  typedData: {
    domain: {
      chainId: number
      verifyingContract: string
    }
  }
  breakdown: EscrowPricingBreakdown
  costs: EscrowCostBreakdown
}

interface EscrowDeploymentReservationResponse {
  status: 'issued'
  reservation: {
    importId: string
    sponsor: string
    reward: string
    bond: string
    protocolFeeBps: number
    acceptDeadline: number
    serviceStart: number
    serviceEnd: number
    claimableAt: number
    validUntil: number
    nonce: string
  }
  signature: string
}

interface EscrowDeploymentCancellationResponse {
  status: 'issued'
  cancellation: {
    importId: string
    sponsor: string
    nonce: string
  }
  signature: string
  typedData: {
    primaryType: 'DeploymentCancellation'
    domain: {
      chainId: number
      verifyingContract: string
    }
    message: {
      importId: string
      sponsor: string
      nonce: string
    }
  }
}

type ImportState =
  | 'awaiting_payment'
  | 'payment_confirming'
  | 'paid'
  | 'queued'
  | 'syncing'
  | 'deploying'
  | 'publishing'
  | 'ready'
  | 'failed_retryable'
  | 'failed_refundable'
  | 'expired'
  | 'activation_queued'
  | 'activating'
  | 'activated'

interface EscrowImportResponse {
  importId: string
  state: ImportState
  sponsor: string
  eventSlug: string
  sourceConditionIds: string[]
  kuestMappings: Array<{
    sourceConditionId: string
    sourceTokenIds: string[]
    sourceTokens: { yes: string; no: string }
    kuestConditionId: string
    kuestTokenIds: string[]
    kuestTokens: { yes: string; no: string }
    collateralToken: string
    indexSets: string[]
    deploymentTxHash: string | null
  }>
  marketCount: number
  payment: {
    amountAtomic: string
    tokenAddress: string
    receiverAddress: string
    chainId: number
    expiresAt: number
    txHash: string | null
    confirmations: number | null
    rejected: boolean
  }
  costs: EscrowCostBreakdown
  progress: { current: number; total: number }
  reusable: boolean
  canRetry: boolean
  refundable: boolean
  message: string | null
}

const USDC_ATOMIC_SCALE = 1_000_000n
const MAX_USDC_ALLOWANCE = (1n << 256n) - 1n

function formatCompactCurrency(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)
}

function formatUsdcString(value: string | undefined, locale: string) {
  const numeric = Number(value ?? 0)
  return formatCompactCurrency(Number.isFinite(numeric) ? numeric : 0, locale)
}

function formatUsdcAtomic(value: string | null | undefined, locale: string) {
  try {
    return formatCompactCurrency(Number(BigInt(value ?? '0')) / Number(USDC_ATOMIC_SCALE), locale)
  } catch {
    return formatCompactCurrency(0, locale)
  }
}

function formatEndDate(value: string | Date | null, locale: string) {
  if (!value) {
    return '—'
  }
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return '—'
  }
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function formatCountTemplate(template: string, count: number, locale: string) {
  return template.replace('__COUNT__', new Intl.NumberFormat(locale).format(count))
}

function formatDateTemplate(template: string, date: string) {
  return template.replace('__DATE__', date)
}

function readErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message.toLowerCase()
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    return typeof message === 'string' ? message.toLowerCase() : ''
  }
  return ''
}

function fundingErrorMessage(error: unknown, copy: MarketMakingCopy) {
  if (isUserRejectedRequestError(error)) {
    return copy.transactionRejected
  }
  if (isRecoverableWalletConnectorError(error)) {
    return copy.walletNotReady
  }

  const message = readErrorMessage(error)
  if (
    message.includes('erc20insufficientbalance') ||
    message.includes('transfer amount exceeds balance') ||
    message.includes('exceeds available balance')
  ) {
    return copy.insufficientBalance
  }
  if (
    message.includes('quoteexpired') ||
    message.includes('quotealreadyused') ||
    message.includes('invalidquotesignature') ||
    message.includes('quotesponsormismatch') ||
    message.includes('protocolfeebpsexceedsmaximum') ||
    message.includes('invalidtimeline') ||
    message.includes('quote expired') ||
    message.includes('quote already used')
  ) {
    return copy.quoteUnavailable
  }

  return copy.transactionFailed
}

function normalizeImageUrl(value: string | null) {
  const normalized = value?.trim()
  if (!normalized) {
    return null
  }
  if (normalized.startsWith('/') && !normalized.startsWith('//')) {
    return normalized
  }
  try {
    const parsed = new URL(normalized)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
  } catch {
    return null
  }
}

function getMarketEndDate(item: MarketMakingDiscoveryItem) {
  const parsed = item.endDate ? new Date(item.endDate) : null
  if (parsed && Number.isFinite(parsed.getTime())) {
    return parsed
  }
  const fallback = new Date()
  fallback.setDate(fallback.getDate() + 30)
  fallback.setHours(23, 59, 59, 0)
  return fallback
}

function getMinimumServiceEndDate(config: EscrowConfigResponse | undefined, recurringAnchor: boolean) {
  const pricing = config?.pricingConfig
  const minimumSeconds = recurringAnchor
    ? (pricing?.acceptDeadlineLeadSeconds ?? 3_600) * 3
    : (pricing?.defaultServiceStartDelaySeconds ?? 86_400) + (pricing?.minimumServiceDurationSeconds ?? 86_400)
  return new Date(Date.now() + minimumSeconds * 1_000)
}

function isSameCalendarDay(first: Date, second: Date) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  )
}

function normalizeServiceEndDate(selected: Date, marketEnd: Date) {
  if (isSameCalendarDay(selected, marketEnd)) {
    return new Date(marketEnd)
  }
  const endOfDay = new Date(selected)
  endOfDay.setHours(23, 59, 59, 0)
  return endOfDay > marketEnd ? new Date(marketEnd) : endOfDay
}

function getMarketLabel(item: MarketMakingDiscoveryItem, copy: MarketMakingCopy) {
  if (item.isMine) {
    return copy.yourMarket
  }
  if (item.source === 'polymarket') {
    return item.isOnKuest ? copy.onKuest : copy.polymarketSource
  }
  return copy.globalMarket
}

function MarketAvatar({ item }: { item: MarketMakingDiscoveryItem }) {
  const imageUrl = normalizeImageUrl(item.iconUrl)
  if (imageUrl) {
    return (
      <div className="relative size-12 shrink-0 overflow-hidden rounded-xl border bg-muted sm:size-14">
        <Image
          src={imageUrl}
          alt=""
          fill
          sizes="56px"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          unoptimized
        />
      </div>
    )
  }

  if (item.source === 'polymarket') {
    return (
      <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border bg-white p-2.5 sm:size-14">
        <Image
          src="/images/logos/polymarket-icon-black.svg"
          alt="Polymarket"
          width={40}
          height={40}
          className="size-full object-contain"
          unoptimized
        />
      </div>
    )
  }

  return (
    <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border bg-muted text-muted-foreground sm:size-14">
      <CircleDollarSignIcon className="size-6" />
    </div>
  )
}

function LoadingRows({ label }: { label: string }) {
  return (
    <div className="divide-y" aria-label={label} aria-busy="true">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="flex animate-pulse items-center gap-4 py-5">
          <div className="size-14 shrink-0 rounded-xl bg-muted" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="h-5 w-3/4 rounded bg-muted" />
          </div>
          <div className="hidden h-9 w-24 rounded bg-muted sm:block" />
        </div>
      ))}
    </div>
  )
}

function MarketRow({
  item,
  locale,
  copy,
  onSelect,
}: {
  item: MarketMakingDiscoveryItem
  locale: string
  copy: MarketMakingCopy
  onSelect: (item: MarketMakingDiscoveryItem) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const label = getMarketLabel(item, copy)
  const marketCountLabel =
    item.markets.length > 1 ? formatCountTemplate(copy.marketCount, item.markets.length, locale) : null
  const accentClass = item.isMine
    ? 'text-primary'
    : item.source === 'polymarket'
      ? 'text-[#4f6cf7] dark:text-[#8fa1ff]'
      : 'text-muted-foreground'

  return (
    <article className="border-b py-4 last:border-b-0 sm:py-5">
      <div
        role="button"
        tabIndex={0}
        className="group relative z-0 flex min-w-0 cursor-pointer items-center gap-3 rounded-lg outline-none before:pointer-events-none before:absolute before:-inset-x-3 before:inset-y-[-0.75rem] before:-z-10 before:rounded-lg before:bg-black/5 before:opacity-0 before:transition-opacity before:duration-200 before:content-[''] hover:before:opacity-100 focus-visible:ring-2 focus-visible:ring-ring sm:gap-4 dark:before:bg-white/5"
        onClick={() => onSelect(item)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) {
            return
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelect(item)
          }
        }}
      >
        <MarketAvatar item={item} />
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 text-base leading-snug font-semibold sm:text-lg">{item.title}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className={cn('font-medium', accentClass)}>{label}</span>
            {item.needsDeployment && (
              <>
                <span className="size-1 rounded-full bg-border" />
                <span>{copy.importRequired}</span>
              </>
            )}
            {marketCountLabel && (
              <>
                <span className="size-1 rounded-full bg-border" />
                <button
                  type="button"
                  className="inline-flex items-center gap-1 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={(event) => {
                    event.stopPropagation()
                    setExpanded((current) => !current)
                  }}
                  aria-expanded={expanded}
                >
                  {marketCountLabel}
                  <ChevronDownIcon className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
                </button>
              </>
            )}
            {item.hedgeAvailable && item.source === 'kuest' && (
              <>
                <span className="size-1 rounded-full bg-border" />
                <span>{copy.hedgeAvailable}</span>
              </>
            )}
            {item.seriesSlug && (
              <>
                <span className="size-1 rounded-full bg-border" />
                <Tooltip>
                  <TooltipTrigger render={<span className="cursor-help font-medium" />}>
                    {copy.seriesBadge}
                  </TooltipTrigger>
                  <TooltipContent className="max-w-72 text-sm">{copy.seriesTooltip}</TooltipContent>
                </Tooltip>
              </>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <GaugeIcon className="size-4" />
              {copy.liquidity} {formatCompactCurrency(item.liquidity, locale)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarClockIcon className="size-4" />
              {copy.ends} {formatEndDate(item.endDate, locale)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
          <Button
            type="button"
            variant="ghost"
            className="pointer-events-none gap-1"
            tabIndex={-1}
            aria-label={copy.sponsor}
          >
            <span className="hidden sm:inline">{copy.sponsor}</span>
            <ChevronRightIcon className="size-5 transition-transform group-hover:translate-x-0.5" />
          </Button>
        </div>
      </div>

      {item.markets.length > 1 && expanded && (
        <div className="mt-4 divide-y rounded-xl border bg-muted/20 px-4">
          {item.markets.map((market) => {
            const marketImageUrl = item.showMarketIcons ? normalizeImageUrl(market.iconUrl) : null
            return (
              <div key={market.id} className="flex min-w-0 items-center justify-between gap-4 py-3 text-sm">
                <span className="flex min-w-0 items-center gap-3">
                  {marketImageUrl && (
                    <span className="relative size-9 shrink-0 overflow-hidden rounded-md bg-muted">
                      <Image
                        src={marketImageUrl}
                        alt=""
                        fill
                        sizes="36px"
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="size-full object-cover"
                        unoptimized
                      />
                    </span>
                  )}
                  <span className="min-w-0 truncate">{market.title}</span>
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {formatCompactCurrency(market.liquidity, locale)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </article>
  )
}

function DepthPreview({
  depth,
  spread,
  buyOrders,
  sellOrders,
  maxLabel,
  maximumDepth,
  maximumSpread,
}: {
  depth: number
  spread: number
  buyOrders: string
  sellOrders: string
  maxLabel: string
  maximumDepth: number
  maximumSpread: number
}) {
  const width = 18 + (depth / maximumDepth) * 82
  const gap = 4 + (spread / maximumSpread) * 18
  return (
    <div className="mt-3" aria-hidden="true">
      <div
        className="grid grid-cols-[1fr_auto_1fr] items-end overflow-hidden rounded-md border border-border/50 bg-background/40 transition-[column-gap] duration-300"
        style={{ columnGap: `${gap}px` }}
      >
        <div className="relative flex h-7 items-center overflow-hidden rounded-l-md bg-background/80 px-2">
          <div
            className="absolute inset-y-0 right-0 rounded-l-md bg-yes/25 transition-[width] duration-300"
            style={{ width: `${width}%` }}
          />
          <span className="relative z-10 text-left text-xs font-medium text-foreground">{buyOrders}</span>
        </div>
        <div className="flex h-7 items-center text-xs font-medium whitespace-nowrap text-muted-foreground">
          {spread / 100}¢ {maxLabel}
        </div>
        <div className="relative flex h-7 items-center overflow-hidden rounded-r-md bg-background/80 px-2">
          <div
            className="absolute inset-y-0 left-0 rounded-r-md bg-no/25 transition-[width] duration-300"
            style={{ width: `${width}%` }}
          />
          <span className="relative z-10 ml-auto text-right text-xs font-medium text-foreground">{sellOrders}</span>
        </div>
      </div>
    </div>
  )
}

class EscrowApiError extends Error {
  constructor(
    readonly code: string | null,
    readonly details: unknown,
    message: string,
  ) {
    super(message)
  }
}

async function fetchEscrowJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string; message?: string; details?: unknown })
    | null
  if (!response.ok || !payload) {
    throw new EscrowApiError(
      payload?.error ?? null,
      payload?.details,
      payload?.message || `Escrow request failed with status ${response.status}.`,
    )
  }
  return payload
}

function quoteErrorMessage(error: unknown, copy: MarketMakingCopy) {
  if (error instanceof EscrowApiError) {
    if (error.code === 'market_closes_too_soon' || error.code === 'service_start_too_soon') {
      return copy.marketClosesTooSoon
    }
    if (
      error.code === 'market_metadata_unavailable' ||
      error.code === 'invalid_market_metadata' ||
      error.code === 'market_condition_mismatch' ||
      error.code === 'invalid_polymarket_event'
    ) {
      return copy.marketDataUnavailable
    }
  }
  return copy.quoteUnavailable
}

function formatDeployingMarkets(template: string, current: number, total: number) {
  return template.replace('__CURRENT__', String(current)).replace('__TOTAL__', String(total))
}

function isZeroAddress(value: string | undefined) {
  return value?.toLowerCase() === `0x${'0'.repeat(40)}`
}

function ImportProgressModal({
  copy,
  value,
  open,
  retrying,
  cancelling,
  withdrawing,
  canCancel,
  refundReady,
  relayerPending,
  onOpenChange,
  onRetry,
  onCancel,
  onWithdraw,
}: {
  copy: MarketMakingCopy
  value: EscrowImportResponse | null
  open: boolean
  retrying: boolean
  cancelling: boolean
  withdrawing: boolean
  canCancel: boolean
  refundReady: boolean
  relayerPending: boolean
  onOpenChange: (open: boolean) => void
  onRetry: () => void
  onCancel: () => void
  onWithdraw: () => void
}) {
  const isMobile = useIsMobile()
  const state = value?.state ?? 'payment_confirming'
  const rank: Record<ImportState, number> = {
    awaiting_payment: 0,
    payment_confirming: 0,
    paid: 1,
    queued: 1,
    syncing: 1,
    deploying: 2,
    publishing: 3,
    ready: 4,
    failed_retryable: 1,
    failed_refundable: 1,
    expired: 0,
    activation_queued: 4,
    activating: 4,
    activated: 4,
  }
  const currentRank = rank[state]
  const ready = state === 'ready' || state === 'activated'
  const steps = [
    copy.paymentConfirmed,
    copy.preparingEvent,
    formatDeployingMarkets(copy.deployingMarkets, value?.progress.current ?? 0, value?.progress.total ?? 0),
    copy.publishingEvent,
    copy.readyToSponsor,
  ]
  const failed = state === 'failed_retryable' || state === 'failed_refundable'
  const content = (
    <div className="relative px-5 pt-6 pb-5 sm:px-6">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-3 right-3"
        onClick={() => onOpenChange(false)}
      >
        <XIcon className="size-5" />
        <span className="sr-only">{copy.close}</span>
      </Button>
      <div className="pr-10">
        <h2 className="text-xl font-semibold">{copy.importTitle}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {state === 'awaiting_payment'
            ? copy.importPaymentPending
            : relayerPending
              ? copy.deploymentRelayerPending
              : copy.importDescription}
        </p>
      </div>
      <ol className="mt-6 space-y-4">
        {steps.map((label, index) => {
          const complete = !failed && (currentRank > index || (ready && index === steps.length - 1))
          const current = !failed && !ready && currentRank === index
          return (
            <li key={label} className="flex items-center gap-3 text-sm">
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border',
                  complete && 'border-primary bg-primary text-primary-foreground',
                  current && 'border-primary text-primary',
                  !complete && !current && 'text-muted-foreground',
                )}
              >
                {complete ? (
                  <CheckCircle2Icon className="size-4" />
                ) : current ? (
                  <LoaderCircleIcon className="size-4 animate-spin" />
                ) : (
                  index + 1
                )}
              </span>
              <span className={cn((complete || current) && 'font-medium')}>{label}</span>
            </li>
          )
        })}
      </ol>
      {failed && (
        <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="flex gap-2 font-medium text-destructive">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            {state === 'failed_refundable' ? copy.importRefundable : copy.importFailed}
          </div>
          {state === 'failed_retryable' && (
            <Button type="button" variant="outline" className="mt-4 w-full" disabled={retrying} onClick={onRetry}>
              {retrying ? <LoaderCircleIcon className="size-4 animate-spin" /> : <RotateCcwIcon className="size-4" />}
              {retrying ? copy.importRetrying : copy.importRetry}
            </Button>
          )}
          {state === 'failed_refundable' && canCancel && (
            <Button type="button" variant="outline" className="mt-4 w-full" disabled={cancelling} onClick={onCancel}>
              {cancelling ? <LoaderCircleIcon className="size-4 animate-spin" /> : <RotateCcwIcon className="size-4" />}
              {cancelling ? copy.cancellingImport : copy.cancelImport}
            </Button>
          )}
          {state === 'failed_refundable' && refundReady && (
            <Button type="button" className="mt-4 w-full" disabled={withdrawing} onClick={onWithdraw}>
              {withdrawing ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : (
                <CircleDollarSignIcon className="size-4" />
              )}
              {copy.withdrawRefund}
            </Button>
          )}
        </div>
      )}
      {ready && (
        <Button type="button" className="mt-6 w-full" onClick={() => onOpenChange(false)}>
          {copy.continue}
        </Button>
      )}
    </div>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="bg-background">
          <DrawerHeader className="sr-only">
            <DrawerTitle>{copy.importTitle}</DrawerTitle>
            <DrawerDescription>{copy.importDescription}</DrawerDescription>
          </DrawerHeader>
          {content}
        </DrawerContent>
      </Drawer>
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 bg-background p-0 sm:max-w-md" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>{copy.importTitle}</DialogTitle>
          <DialogDescription>{copy.importDescription}</DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  )
}

function SponsorEmailDialog({
  copy,
  open,
  email,
  pending,
  verificationPending,
  error,
  onEmailChange,
  onOpenChange,
  onSubmit,
  onVerified,
}: {
  copy: MarketMakingCopy
  open: boolean
  email: string
  pending: boolean
  verificationPending: boolean
  error: string | null
  onEmailChange: (email: string) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
  onVerified: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.emailAddress}</DialogTitle>
          <DialogDescription>{copy.emailDescription}</DialogDescription>
        </DialogHeader>
        {!verificationPending ? (
          <div className="space-y-2">
            <Label htmlFor="market-making-sponsor-email">{copy.emailAddress}</Label>
            <Input
              id="market-making-sponsor-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              disabled={pending}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{copy.verify}</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            type="button"
            disabled={pending || (!verificationPending && !email.trim())}
            onClick={verificationPending ? onVerified : onSubmit}
          >
            {pending ? (
              <>
                <LoaderCircleIcon className="size-4 animate-spin" />
                {copy.verifying}
              </>
            ) : verificationPending ? (
              copy.verify
            ) : (
              copy.continueToSign
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CampaignDialog({
  item,
  locale,
  copy,
  open,
  onOpenChange,
}: {
  item: MarketMakingDiscoveryItem
  locale: string
  copy: MarketMakingCopy
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const { open: openAppKit } = useAppKit()
  const appKitAccount = useAppKitAccount()
  const { address, isConnected } = appKitAccount
  const { walletProvider, walletProviderType } = useAppKitProvider<RpcWalletProvider>('eip155')
  const { chainId: appKitChainId, switchNetwork } = useAppKitNetwork()
  const { chainId, escrowUrl, notificationsUrl } = usePublicRuntimeConfig()
  const escrowReadOnly = chainId !== POLYGON_MAINNET_CHAIN_ID
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient({ chainId })
  const queryClient = useQueryClient()
  const { runWithSignaturePrompt } = useSignaturePromptRunner()
  const escrowBaseUrl = escrowUrl.replace(/\/+$/, '')
  const isEmbeddedWallet =
    Boolean(appKitAccount.embeddedWalletInfo) ||
    walletProviderType === 'AUTH' ||
    isEmbeddedWalletProvider(walletProvider)
  const transactionWalletClient = useMemo(() => {
    if (!address) {
      return null
    }
    if (walletClient?.account?.address?.toLowerCase() === address.toLowerCase()) {
      return walletClient
    }
    const chain = resolveViemNetworkByChainId(chainId)
    if (!chain || !isRpcWalletProvider(walletProvider)) {
      return null
    }
    return createWalletClient({
      account: address as `0x${string}`,
      chain,
      transport: custom(walletProvider),
    })
  }, [address, chainId, walletClient, walletProvider])

  async function ensureWalletNetwork() {
    if (!transactionWalletClient) {
      throw new Error(copy.walletNotReady)
    }
    const chain = resolveViemNetworkByChainId(chainId)
    if (!chain) {
      throw new Error(copy.walletNotReady)
    }
    const selectedChainId = resolveWalletChainId(appKitChainId)
    if (selectedChainId !== null && selectedChainId !== chainId) {
      await runWithSignaturePrompt(() => switchNetwork(chain), {
        title: copy.confirmNetworkSwitch,
        description: copy.transactionPrompt,
      })
    }
    if ((await transactionWalletClient.getChainId()) !== chainId) {
      throw new Error(copy.walletNotReady)
    }
  }

  async function sendSponsorTransaction(input: { to: Address; data: Hex; title: string }): Promise<Hex> {
    if (!address || !transactionWalletClient || !publicClient) {
      throw new Error(copy.walletNotReady)
    }
    await ensureWalletNetwork()
    const account = address as Address
    const prompt = { title: input.title, description: copy.transactionPrompt }

    if (isEmbeddedWallet) {
      if (!isRpcWalletProvider(walletProvider)) {
        throw new Error(copy.walletNotReady)
      }
      let gas: bigint | undefined
      try {
        gas = ((await publicClient.estimateGas({ account, to: input.to, data: input.data, value: 0n })) * 12n) / 10n
      } catch {
        gas = undefined
      }
      const result = await runWithSignaturePrompt(
        () =>
          walletProvider.request({
            method: 'eth_sendTransaction',
            params: [buildRpcWalletTransactionRequest({ from: account, to: input.to, data: input.data, gas })],
          }),
        prompt,
      )
      return readWalletTransactionHash(result)
    }

    return runWithSignaturePrompt(
      () =>
        transactionWalletClient.sendTransaction({
          account,
          chain: transactionWalletClient.chain,
          to: input.to,
          data: input.data,
          value: 0n,
        }),
      prompt,
    )
  }
  const marketEndDate = getMarketEndDate(item)
  const initialServiceEnd = marketEndDate
  const [sponsorSeries, setSponsorSeries] = useState(false)
  const polymarketConditionIds = useMemo(
    () => item.markets.flatMap((market) => (market.polymarketConditionId ? [market.polymarketConditionId] : [])),
    [item.markets],
  )
  const seriesUsesPolymarketDeployments =
    sponsorSeries &&
    item.hedgeAvailable &&
    item.creatorFilter?.toLowerCase() === POLY_SYNCER_CREATOR_ADDRESS.toLowerCase() &&
    polymarketConditionIds.length === item.markets.length
  const usesImportFlow = item.needsDeployment || seriesUsesPolymarketDeployments
  const quoteConditionIds = useMemo(
    () =>
      item.markets.flatMap((market) => {
        const conditionId = usesImportFlow ? market.polymarketConditionId : market.kuestConditionId
        return conditionId ? [conditionId] : []
      }),
    [item.markets, usesImportFlow],
  )
  const [requestedDepth, setDepth] = useState(1000)
  const [requestedSpread, setSpread] = useState(300)
  const [sponsorPremiumPercent, setSponsorPremiumPercent] = useState('0')
  const [serviceEnd, setServiceEnd] = useState(initialServiceEnd)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [issuedQuote, setIssuedQuote] = useState<EscrowIssuedQuoteResponse | null>(null)
  const [issuedQuoteInput, setIssuedQuoteInput] = useState<string | null>(null)
  const [issueError, setIssueError] = useState<string | null>(null)
  const [isIssuing, setIsIssuing] = useState(false)
  const [importId, setImportId] = useState<string | null>(null)
  const [importValue, setImportValue] = useState<EscrowImportResponse | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [isRetryingImport, setIsRetryingImport] = useState(false)
  const [isCancellingImport, setIsCancellingImport] = useState(false)
  const [isWithdrawingImport, setIsWithdrawingImport] = useState(false)
  const [importCancellationCompleted, setImportCancellationCompleted] = useState(false)
  const [importWithdrawalCompleted, setImportWithdrawalCompleted] = useState(false)
  const awaitingDeploymentFinalization = useRef(false)
  const currentImportId = useRef<string | null>(null)
  const [readyNotified, setReadyNotified] = useState(false)
  const [emailDialogOpen, setEmailDialogOpen] = useState(false)
  const [notificationEmail, setNotificationEmail] = useState('')
  const [emailLinkPending, setEmailLinkPending] = useState(false)
  const [emailVerificationPending, setEmailVerificationPending] = useState(false)
  const [emailLinkError, setEmailLinkError] = useState<string | null>(null)
  const emailLinkRequestId = useRef(0)
  const activeEmailWallet = useRef(address)
  const importStorageKey =
    address && item.slug
      ? marketImportStorageKey({
          chainId,
          wallet: address,
          eventSlug: item.slug,
          sponsorSeries,
        })
      : null
  const importPaymentStorageKey = importStorageKey ? `${importStorageKey}:payment` : null
  const [pendingImportPaymentHash, setPendingImportPaymentHash] = useState<string | null>(null)
  const sponsorPremiumValid = isSponsorPremiumValid(sponsorPremiumPercent)
  const sponsorPremiumBps = sponsorPremiumValid ? Number(sponsorPremiumPercent || 0) * 100 : undefined

  useEffect(() => {
    activeEmailWallet.current = address
    emailLinkRequestId.current += 1
    queueMicrotask(() => {
      setEmailLinkPending(false)
      setEmailVerificationPending(false)
    })
    return () => {
      emailLinkRequestId.current += 1
    }
  }, [address])

  const configQuery = useQuery({
    queryKey: ['market-making-escrow-config', escrowBaseUrl],
    enabled: open,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => fetchEscrowJson<EscrowConfigResponse>(`${escrowBaseUrl}/api/config`),
  })
  const selection = resolveSponsorshipSelection(configQuery.data, requestedDepth, requestedSpread)
  const sponsorshipOptions = selection?.options ?? DEFAULT_SPONSORSHIP_OPTIONS
  const depth = selection?.depth ?? 1000
  const spread = selection?.spread ?? 300
  const pricingConfigReady = configQuery.isSuccess && selection !== null

  const quoteInput = useMemo(
    () =>
      buildMarketMakerQuoteInput({
        sponsor: address ?? '',
        importId,
        marketSource: usesImportFlow ? 'polymarket' : 'kuest',
        conditionIds: quoteConditionIds,
        depthPerSideAtomic: (BigInt(depth) * USDC_ATOMIC_SCALE).toString(),
        maxSpreadBps: spread,
        sponsorPremiumBps,
        serviceEnd: Math.floor(serviceEnd.getTime() / 1000),
        sponsorSeries,
        seriesSlug: item.seriesSlug,
        creatorFilter: item.creatorFilter,
      }),
    [
      address,
      depth,
      item.creatorFilter,
      importId,
      item.seriesSlug,
      quoteConditionIds,
      serviceEnd,
      sponsorSeries,
      spread,
      sponsorPremiumBps,
      usesImportFlow,
    ],
  )
  const minimumServiceEndDate = getMinimumServiceEndDate(configQuery.data, Boolean(item.seriesSlug))
  const hasSelectableServiceWindow = sponsorSeries
    ? Boolean(item.seriesSlug && item.creatorFilter)
    : marketEndDate >= minimumServiceEndDate
  const canRequestQuote =
    pricingConfigReady &&
    open &&
    isConnected &&
    Boolean(address) &&
    hasSelectableServiceWindow &&
    quoteConditionIds.length === item.markets.length &&
    sponsorPremiumValid
  const previewQuery = useQuery({
    queryKey: ['market-making-escrow-preview', escrowBaseUrl, quoteInput],
    enabled: canRequestQuote,
    staleTime: 15_000,
    retry: false,
    queryFn: () => {
      if (!pricingConfigReady) {
        throw new Error(copy.quoteUnavailable)
      }
      return fetchEscrowJson<EscrowPreviewResponse>(`${escrowBaseUrl}/api/quote/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quoteInput),
      })
    },
  })
  const refetchPreview = previewQuery.refetch
  const preview = previewQuery.data
  const breakdown = preview?.status === 'priced' ? preview.breakdown : null
  const coverageBps =
    configQuery.data?.pricingConfig.terms?.minimumTwoSidedCoverageBps ??
    configQuery.data?.pricingConfig.baseCoverageBps ??
    null
  const fallbackServiceStart =
    Math.floor(Date.now() / 1_000) +
    (item.seriesSlug
      ? (configQuery.data?.pricingConfig.acceptDeadlineLeadSeconds ?? 3_600) * 2
      : (configQuery.data?.pricingConfig.defaultServiceStartDelaySeconds ?? 86_400))
  const serviceDurationDays = preview
    ? Math.max(1, Math.ceil((preview.serviceEnd - preview.serviceStart) / (24 * 60 * 60)))
    : Math.max(1, Math.ceil((Math.floor(serviceEnd.getTime() / 1_000) - fallbackServiceStart) / (24 * 60 * 60)))
  const marketCountLabel =
    item.markets.length > 1 ? formatCountTemplate(copy.marketCount, item.markets.length, locale) : null
  const importReady = importValue !== null && ['ready', 'activated'].includes(importValue.state)
  const balanceCheckRequired = !(usesImportFlow && importValue !== null && !importValue.reusable)
  const costs = preview?.costs ?? null
  const initialDeploymentFeeAtomic = importValue?.costs.initialDeploymentFeeAtomic ?? costs?.initialDeploymentFeeAtomic
  const initialDeploymentFeePaid =
    importValue?.costs.initialDeploymentFeePaid ?? costs?.initialDeploymentFeePaid ?? false
  const deploymentFeePending = usesImportFlow && !initialDeploymentFeePaid
  const importPaymentRequired =
    usesImportFlow &&
    !pendingImportPaymentHash &&
    (!importValue || importValue.state === 'awaiting_payment' || importValue.state === 'expired')
  const requiredBalanceAtomic = costs
    ? requiredSponsorBalanceAtomic(costs, importPaymentRequired && deploymentFeePending)
    : null
  const displayedTotalAtomic = costs ? displayedCostAtomic({ ...costs, initialDeploymentFeePaid }) : null
  const sponsorBalanceQuery = useQuery({
    queryKey: ['market-making-sponsor-usdc-balance', chainId, address?.toLowerCase()],
    enabled: !escrowReadOnly && open && Boolean(address && publicClient),
    staleTime: 5_000,
    refetchInterval: 10_000,
    retry: false,
    queryFn: async () => {
      if (!address || !publicClient) {
        throw new Error('Sponsor wallet is not available.')
      }
      return publicClient.readContract({
        address: COLLATERAL_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address as `0x${string}`],
      })
    },
  })
  const isSponsorBalanceLoading =
    Boolean(address && publicClient) &&
    (sponsorBalanceQuery.isLoading || (sponsorBalanceQuery.data === undefined && sponsorBalanceQuery.isFetching))
  const hasInsufficientSponsorBalance =
    requiredBalanceAtomic !== null &&
    sponsorBalanceQuery.data !== undefined &&
    sponsorBalanceQuery.data < requiredBalanceAtomic

  useLayoutEffect(() => {
    if (!open || !usesImportFlow || !importStorageKey) {
      return
    }
    const stored = window.localStorage.getItem(importStorageKey)
    const storedPayment = importPaymentStorageKey ? window.localStorage.getItem(importPaymentStorageKey) : null
    queueMicrotask(() => {
      if (stored?.startsWith('0x')) {
        setActiveImportId(stored)
      }
      if (storedPayment?.startsWith('0x')) {
        setPendingImportPaymentHash(storedPayment)
      }
    })
  }, [importPaymentStorageKey, importStorageKey, open, usesImportFlow])

  const importQuery = useQuery({
    queryKey: ['market-making-import', escrowBaseUrl, importId],
    enabled: Boolean(importId),
    retry: false,
    refetchInterval: (query) => {
      const state = (query.state.data as EscrowImportResponse | undefined)?.state
      if (state && ['failed_refundable', 'expired'].includes(state)) {
        return false
      }
      if (state && ['ready', 'activated'].includes(state)) {
        const reusable = (query.state.data as EscrowImportResponse | undefined)?.reusable
        return item.needsDeployment && reusable === false ? 4_000 : false
      }
      return 4_000
    },
    queryFn: () => fetchEscrowJson<EscrowImportResponse>(`${escrowBaseUrl}/api/imports/${importId}`),
  })

  const deploymentCampaignQuery = useQuery({
    queryKey: ['market-making-deployment-campaign', chainId, importId],
    enabled: Boolean(
      !escrowReadOnly && open && item.needsDeployment && importId && publicClient && importValue?.reusable !== true,
    ),
    retry: false,
    refetchInterval: (query) => (query.state.data && query.state.data > 0n ? false : 4_000),
    queryFn: async () => {
      if (!publicClient || !importId) {
        throw new Error(copy.walletNotReady)
      }
      return publicClient.readContract({
        address: MARKET_MAKER_ESCROW_ADDRESS,
        abi: MARKET_MAKER_ESCROW_ABI,
        functionName: 'deploymentCampaignId',
        args: [importId as `0x${string}`],
      })
    },
  })

  const deploymentReservationSponsorQuery = useQuery({
    queryKey: ['market-making-deployment-reservation-sponsor', chainId, importId],
    enabled: Boolean(
      !escrowReadOnly && open && item.needsDeployment && importId && publicClient && importValue?.reusable !== true,
    ),
    retry: false,
    refetchInterval: () => (importValue?.state === 'failed_refundable' ? 4_000 : false),
    queryFn: async () => {
      if (!publicClient || !importId) {
        throw new Error(copy.walletNotReady)
      }
      return publicClient.readContract({
        address: MARKET_MAKER_ESCROW_ADDRESS,
        abi: MARKET_MAKER_ESCROW_ABI,
        functionName: 'deploymentReservationSponsor',
        args: [importId as `0x${string}`],
      })
    },
  })

  const pendingImportWithdrawalQuery = useQuery({
    queryKey: ['market-making-import-pending-withdrawal', chainId, address?.toLowerCase(), importId],
    enabled: Boolean(
      !escrowReadOnly &&
      open &&
      item.needsDeployment &&
      importId &&
      address &&
      publicClient &&
      importValue?.state === 'failed_refundable',
    ),
    retry: false,
    refetchInterval: 4_000,
    queryFn: async () => {
      if (!publicClient || !address) {
        throw new Error(copy.walletNotReady)
      }
      return publicClient.readContract({
        address: MARKET_MAKER_ESCROW_ADDRESS,
        abi: MARKET_MAKER_ESCROW_ABI,
        functionName: 'pendingWithdrawals',
        args: [address as Address],
      })
    },
  })

  useEffect(() => {
    if (!shouldAutoCompleteDeployment(awaitingDeploymentFinalization.current, deploymentCampaignQuery.data)) {
      return
    }
    void queryClient.invalidateQueries({ queryKey: ['market-making-campaigns'] })
    awaitingDeploymentFinalization.current = false
    toast.success(copy.campaignCreated)
    onOpenChange(false)
  }, [copy.campaignCreated, deploymentCampaignQuery.data, onOpenChange, queryClient])

  const deploymentImport = item.needsDeployment && importValue?.reusable === false
  const reservationSponsor = deploymentReservationSponsorQuery.data
  const sponsorHasDeploymentReservation = Boolean(
    address && reservationSponsor?.toLowerCase() === address.toLowerCase(),
  )
  const importCanCancel = Boolean(
    deploymentImport &&
    importValue?.state === 'failed_refundable' &&
    sponsorHasDeploymentReservation &&
    !importCancellationCompleted,
  )
  const importRefundReady = Boolean(
    deploymentImport &&
    importValue?.state === 'failed_refundable' &&
    !importWithdrawalCompleted &&
    (importCancellationCompleted ||
      (pendingImportWithdrawalQuery.data !== undefined &&
        pendingImportWithdrawalQuery.data > 0n &&
        isZeroAddress(reservationSponsor))),
  )
  const deploymentRelayerPending = Boolean(
    deploymentImport &&
    importReady &&
    (deploymentCampaignQuery.data === undefined || deploymentCampaignQuery.data === 0n),
  )

  useEffect(() => {
    if (!importQuery.data) {
      return
    }
    queueMicrotask(() => {
      setImportValue(importQuery.data)
      if (importPaymentStorageKey) {
        if (importQuery.data.payment.rejected) {
          window.localStorage.removeItem(importPaymentStorageKey)
          setPendingImportPaymentHash(null)
        } else if (
          importQuery.data.payment.txHash &&
          ['awaiting_payment', 'payment_confirming'].includes(importQuery.data.state)
        ) {
          window.localStorage.setItem(importPaymentStorageKey, importQuery.data.payment.txHash)
          setPendingImportPaymentHash(importQuery.data.payment.txHash)
        } else if (!['awaiting_payment', 'payment_confirming'].includes(importQuery.data.state)) {
          window.localStorage.removeItem(importPaymentStorageKey)
          setPendingImportPaymentHash(null)
        }
      }
      if (!readyNotified && ['ready', 'activated'].includes(importQuery.data.state)) {
        toast.success(copy.readyToSponsor)
        setReadyNotified(true)
        void refetchPreview()
      }
    })
  }, [copy.readyToSponsor, importPaymentStorageKey, importQuery.data, readyNotified, refetchPreview])

  function clearIssuedQuote() {
    setIssuedQuote(null)
    setIssuedQuoteInput(null)
    setIssueError(null)
  }

  function setActiveImportId(nextImportId: string | null) {
    if (shouldResetImportActions(currentImportId.current, nextImportId)) {
      setImportCancellationCompleted(false)
      setImportWithdrawalCompleted(false)
      awaitingDeploymentFinalization.current = false
    }
    currentImportId.current = nextImportId
    setImportId(nextImportId)
  }

  function handleCampaignOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      awaitingDeploymentFinalization.current = false
    }
    onOpenChange(nextOpen)
  }

  function notifyMainnetOnly() {
    if (!escrowReadOnly) {
      return false
    }
    setIssueError(copy.amoyReadOnlyNotice)
    toast.error(copy.amoyReadOnlyNotice)
    return true
  }

  async function handleRetryImport() {
    if (notifyMainnetOnly()) {
      return
    }
    if (!importValue?.canRetry) {
      return
    }
    setIsRetryingImport(true)
    try {
      const retried = await fetchEscrowJson<EscrowImportResponse>(
        `${escrowBaseUrl}/api/imports/${importValue.importId}/retry`,
        { method: 'POST' },
      )
      setImportValue(retried)
      await queryClient.invalidateQueries({ queryKey: ['market-making-import', escrowBaseUrl, importValue.importId] })
    } catch (error) {
      setIssueError(error instanceof EscrowApiError ? quoteErrorMessage(error, copy) : copy.transactionFailed)
    } finally {
      setIsRetryingImport(false)
    }
  }

  async function handleCancelImport() {
    if (notifyMainnetOnly()) {
      return
    }
    if (
      !address ||
      !publicClient ||
      !transactionWalletClient ||
      !importValue ||
      importValue.state !== 'failed_refundable'
    ) {
      return
    }
    setIsCancellingImport(true)
    setIssueError(null)
    try {
      await ensureWalletNetwork()
      const issued = await fetchEscrowJson<EscrowDeploymentCancellationResponse>(
        `${escrowBaseUrl}/api/imports/${importValue.importId}/cancellation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sponsor: address }),
        },
      )
      const cancellation = issued.cancellation
      if (
        issued.status !== 'issued' ||
        !issued.signature.startsWith('0x') ||
        cancellation.importId.toLowerCase() !== importValue.importId.toLowerCase() ||
        cancellation.sponsor.toLowerCase() !== address.toLowerCase() ||
        issued.typedData.primaryType !== 'DeploymentCancellation' ||
        issued.typedData.domain.verifyingContract.toLowerCase() !== MARKET_MAKER_ESCROW_ADDRESS.toLowerCase() ||
        Number(issued.typedData.domain.chainId) !== chainId ||
        issued.typedData.message.importId.toLowerCase() !== cancellation.importId.toLowerCase() ||
        issued.typedData.message.sponsor.toLowerCase() !== cancellation.sponsor.toLowerCase() ||
        issued.typedData.message.nonce !== cancellation.nonce
      ) {
        throw new Error('Signed cancellation does not match the expected sponsor, chain, escrow, import, or nonce.')
      }
      const reservationSponsor = await publicClient.readContract({
        address: MARKET_MAKER_ESCROW_ADDRESS,
        abi: MARKET_MAKER_ESCROW_ABI,
        functionName: 'deploymentReservationSponsor',
        args: [cancellation.importId as `0x${string}`],
      })
      const reservationNonce = await publicClient.readContract({
        address: MARKET_MAKER_ESCROW_ADDRESS,
        abi: MARKET_MAKER_ESCROW_ABI,
        functionName: 'deploymentReservationNonce',
        args: [cancellation.importId as `0x${string}`],
      })
      if (
        reservationSponsor.toLowerCase() !== address.toLowerCase() ||
        reservationNonce !== BigInt(cancellation.nonce)
      ) {
        throw new Error('The deployment sponsorship changed. Please refresh and try again.')
      }
      const cancellationHash = await sendSponsorTransaction({
        to: MARKET_MAKER_ESCROW_ADDRESS,
        data: encodeFunctionData({
          abi: MARKET_MAKER_ESCROW_ABI,
          functionName: 'cancelDeploymentReservation',
          args: [
            {
              importId: cancellation.importId as `0x${string}`,
              sponsor: cancellation.sponsor as Address,
              nonce: BigInt(cancellation.nonce),
            },
            issued.signature as `0x${string}`,
          ],
        }),
        title: copy.cancelImport,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash: cancellationHash })
      if (receipt.status !== 'success') {
        throw new Error(copy.transactionFailed)
      }
      setImportCancellationCompleted(true)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['market-making-import', escrowBaseUrl, importValue.importId] }),
        deploymentReservationSponsorQuery.refetch(),
        pendingImportWithdrawalQuery.refetch(),
      ])
      toast.success(copy.refundReadyToWithdraw)
    } catch (error) {
      setIssueError(error instanceof EscrowApiError ? quoteErrorMessage(error, copy) : fundingErrorMessage(error, copy))
      if (!isUserRejectedRequestError(error)) {
        console.error('Failed to cancel import sponsorship.', error)
      }
    } finally {
      setIsCancellingImport(false)
    }
  }

  async function handleWithdrawImport() {
    if (notifyMainnetOnly()) {
      return
    }
    if (!address || !publicClient) {
      setIssueError(copy.walletNotReady)
      return
    }
    setIsWithdrawingImport(true)
    setIssueError(null)
    try {
      const withdrawalHash = await sendSponsorTransaction({
        to: MARKET_MAKER_ESCROW_ADDRESS,
        data: encodeFunctionData({ abi: MARKET_MAKER_ESCROW_ABI, functionName: 'withdraw', args: [] }),
        title: copy.withdrawRefund,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash: withdrawalHash })
      if (receipt.status !== 'success') {
        throw new Error(copy.transactionFailed)
      }
      setImportWithdrawalCompleted(true)
      await pendingImportWithdrawalQuery.refetch()
      toast.success(copy.transactionConfirmed)
    } catch (error) {
      setIssueError(error instanceof EscrowApiError ? quoteErrorMessage(error, copy) : fundingErrorMessage(error, copy))
      if (!isUserRejectedRequestError(error)) {
        console.error('Failed to withdraw import refund.', error)
      }
    } finally {
      setIsWithdrawingImport(false)
    }
  }

  async function handleLinkSponsorEmail() {
    if (!address || !transactionWalletClient) {
      setEmailLinkError(copy.walletNotReady)
      return
    }
    const requestId = ++emailLinkRequestId.current
    const requestWallet = address.toLowerCase()
    setEmailLinkPending(true)
    setEmailLinkError(null)
    try {
      await ensureWalletNetwork()
      if (emailLinkRequestId.current !== requestId || activeEmailWallet.current?.toLowerCase() !== requestWallet) {
        return
      }
      const result = await runWithSignaturePrompt(
        () =>
          linkSponsorEmail({
            notificationsUrl,
            wallet: address as `0x${string}`,
            walletClient: transactionWalletClient,
            email: notificationEmail,
            locale,
            siteDomain: window.location.hostname.toLowerCase(),
          }),
        { title: copy.emailAddress, description: copy.transactionPrompt },
      )
      if (emailLinkRequestId.current !== requestId || activeEmailWallet.current?.toLowerCase() !== requestWallet) {
        return
      }
      if (result.alreadyVerified) {
        setEmailDialogOpen(false)
        setEmailVerificationPending(false)
        await handleFundCampaign()
        return
      }
      setEmailVerificationPending(true)
    } catch (error) {
      if (emailLinkRequestId.current !== requestId || activeEmailWallet.current?.toLowerCase() !== requestWallet) {
        return
      }
      setEmailLinkError(
        error instanceof NotificationApiError ? copy.verificationUnavailable : fundingErrorMessage(error, copy),
      )
    } finally {
      if (emailLinkRequestId.current === requestId) {
        setEmailLinkPending(false)
      }
    }
  }

  async function handleEmailVerified() {
    setEmailDialogOpen(false)
    setEmailVerificationPending(false)
    await handleFundCampaign()
  }

  function handleEmailDialogOpenChange(nextOpen: boolean) {
    setEmailDialogOpen(nextOpen)
    if (!nextOpen) {
      emailLinkRequestId.current += 1
      setEmailLinkPending(false)
      setEmailVerificationPending(false)
      setEmailLinkError(null)
    }
  }

  async function ensureEscrowAllowance(amount: bigint) {
    if (!address || !publicClient) {
      throw new Error(copy.walletNotReady)
    }
    const allowance = await publicClient.readContract({
      address: COLLATERAL_TOKEN_ADDRESS,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [address as Address, MARKET_MAKER_ESCROW_ADDRESS],
    })
    if (allowance >= amount) {
      return
    }
    const approvalHash = await sendSponsorTransaction({
      to: COLLATERAL_TOKEN_ADDRESS,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [MARKET_MAKER_ESCROW_ADDRESS, MAX_USDC_ALLOWANCE],
      }),
      title: copy.approveUsdc,
    })
    const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash })
    if (approvalReceipt.status !== 'success') {
      throw new Error(copy.transactionFailed)
    }
  }

  async function handleFundCampaign() {
    if (notifyMainnetOnly()) {
      return
    }
    if (!sponsorPremiumValid) {
      return
    }
    if (!isConnected || !address) {
      try {
        await openAppKit()
      } catch (error) {
        setIssueError(fundingErrorMessage(error, copy))
      }
      return
    }
    if (!canRequestQuote || preview?.status !== 'priced') {
      return
    }
    if (!transactionWalletClient || !publicClient) {
      setIssueError(copy.walletNotReady)
      return
    }
    if (
      balanceCheckRequired &&
      (isSponsorBalanceLoading || sponsorBalanceQuery.isError || hasInsufficientSponsorBalance)
    ) {
      return
    }

    setIsIssuing(true)
    setIssueError(null)
    try {
      let activeImport = importValue
      let hasDeploymentReservation = false
      if (usesImportFlow) {
        if (!item.slug) {
          throw new Error(copy.marketDataUnavailable)
        }
        if (!activeImport && importId) {
          activeImport = await fetchEscrowJson<EscrowImportResponse>(`${escrowBaseUrl}/api/imports/${importId}`)
          setImportValue(activeImport)
        }
        if (activeImport?.state === 'expired') {
          if (importStorageKey) {
            window.localStorage.removeItem(importStorageKey)
          }
          if (importPaymentStorageKey) {
            window.localStorage.removeItem(importPaymentStorageKey)
          }
          activeImport = null
          setActiveImportId(null)
          setImportValue(null)
          setPendingImportPaymentHash(null)
        }
        if (activeImport && !['ready', 'activated'].includes(activeImport.state)) {
          setImportOpen(true)
        }
        if (!activeImport) {
          activeImport = await fetchEscrowJson<EscrowImportResponse>(`${escrowBaseUrl}/api/imports`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sponsor: address,
              eventSlug: item.slug,
              conditionIds: quoteConditionIds,
              ...('series' in quoteInput ? { series: quoteInput.series } : {}),
            }),
          })
          setActiveImportId(activeImport.importId)
          setImportValue(activeImport)
          setImportOpen(true)
          if (importStorageKey) {
            window.localStorage.setItem(importStorageKey, activeImport.importId)
          }
        }

        const finalizedCampaignId = await publicClient.readContract({
          address: MARKET_MAKER_ESCROW_ADDRESS,
          abi: MARKET_MAKER_ESCROW_ABI,
          functionName: 'deploymentCampaignId',
          args: [activeImport.importId as `0x${string}`],
        })
        if (shouldCloseExistingDeployment(finalizedCampaignId)) {
          handleCampaignOpenChange(false)
          return
        }

        if (activeImport.state === 'awaiting_payment') {
          const configuredPayment = configQuery.data?.importPayment
          if (
            !configuredPayment ||
            configuredPayment.chainId !== chainId ||
            activeImport.payment.chainId !== chainId ||
            activeImport.payment.tokenAddress.toLowerCase() !== configuredPayment.tokenAddress.toLowerCase() ||
            activeImport.payment.receiverAddress.toLowerCase() !== configuredPayment.receiverAddress.toLowerCase() ||
            configuredPayment.tokenAddress.toLowerCase() !== COLLATERAL_TOKEN_ADDRESS.toLowerCase() ||
            configuredPayment.receiverAddress.toLowerCase() !== POLY_SYNCER_CREATOR_ADDRESS.toLowerCase() ||
            activeImport.sponsor.toLowerCase() !== address.toLowerCase()
          ) {
            throw new Error(copy.quoteUnavailable)
          }
          const paymentHash =
            pendingImportPaymentHash ??
            (await sendSponsorTransaction({
              to: activeImport.payment.tokenAddress as Address,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: 'transfer',
                args: [activeImport.payment.receiverAddress as Address, BigInt(activeImport.payment.amountAtomic)],
              }),
              title: copy.payImportFee,
            }))
          setPendingImportPaymentHash(paymentHash)
          if (importPaymentStorageKey) {
            window.localStorage.setItem(importPaymentStorageKey, paymentHash)
          }
          activeImport = await fetchEscrowJson<EscrowImportResponse>(
            `${escrowBaseUrl}/api/imports/${activeImport.importId}/payment`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ txHash: paymentHash }),
            },
          )
          setImportValue(activeImport)
          if (!['awaiting_payment', 'payment_confirming'].includes(activeImport.state) && importPaymentStorageKey) {
            window.localStorage.removeItem(importPaymentStorageKey)
            setPendingImportPaymentHash(null)
          }
          void queryClient.invalidateQueries({
            queryKey: ['market-making-import', escrowBaseUrl, activeImport.importId],
          })
        }

        if (
          item.needsDeployment &&
          !activeImport.reusable &&
          (activeImport.state === 'paid' || ['ready', 'activated'].includes(activeImport.state))
        ) {
          const reservationSponsor = await publicClient.readContract({
            address: MARKET_MAKER_ESCROW_ADDRESS,
            abi: MARKET_MAKER_ESCROW_ABI,
            functionName: 'deploymentReservationSponsor',
            args: [activeImport.importId as `0x${string}`],
          })
          hasDeploymentReservation = reservationSponsor.toLowerCase() === address.toLowerCase()
          if (!hasDeploymentReservation) {
            const reservation = await fetchEscrowJson<EscrowDeploymentReservationResponse>(
              `${escrowBaseUrl}/api/imports/${activeImport.importId}/reservation`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  sponsor: address,
                  depthPerSideAtomic: quoteInput.depthPerSideAtomic,
                  maxSpreadBps: quoteInput.maxSpreadBps,
                  sponsorPremiumBps: quoteInput.sponsorPremiumBps,
                  ...('serviceEnd' in quoteInput ? { serviceEnd: quoteInput.serviceEnd } : {}),
                  ...('series' in quoteInput ? { series: quoteInput.series } : {}),
                }),
              },
            )
            const reservationValue = reservation.reservation
            const requiredAllowance =
              BigInt(reservationValue.reward) +
              (BigInt(reservationValue.reward) * BigInt(reservationValue.protocolFeeBps)) / 10_000n
            await ensureEscrowAllowance(requiredAllowance)
            const reservationHash = await sendSponsorTransaction({
              to: MARKET_MAKER_ESCROW_ADDRESS,
              data: encodeFunctionData({
                abi: MARKET_MAKER_ESCROW_ABI,
                functionName: 'reserveDeployment',
                args: [
                  {
                    importId: reservationValue.importId as `0x${string}`,
                    sponsor: reservationValue.sponsor as Address,
                    reward: BigInt(reservationValue.reward),
                    bond: BigInt(reservationValue.bond),
                    protocolFeeBps: reservationValue.protocolFeeBps,
                    acceptDeadline: BigInt(reservationValue.acceptDeadline),
                    serviceStart: BigInt(reservationValue.serviceStart),
                    serviceEnd: BigInt(reservationValue.serviceEnd),
                    claimableAt: BigInt(reservationValue.claimableAt),
                    validUntil: BigInt(reservationValue.validUntil),
                    nonce: BigInt(reservationValue.nonce),
                  },
                  reservation.signature as `0x${string}`,
                ],
              }),
              title: copy.reserveDeployment,
            })
            const reservationReceipt = await publicClient.waitForTransactionReceipt({ hash: reservationHash })
            if (reservationReceipt.status !== 'success') {
              throw new Error(copy.transactionFailed)
            }
            hasDeploymentReservation = true
          }
        }
        if (item.needsDeployment && !activeImport.reusable && hasDeploymentReservation) {
          const currentCampaignId = await publicClient.readContract({
            address: MARKET_MAKER_ESCROW_ADDRESS,
            abi: MARKET_MAKER_ESCROW_ABI,
            functionName: 'deploymentCampaignId',
            args: [activeImport.importId as `0x${string}`],
          })
          if (currentCampaignId === 0n) {
            awaitingDeploymentFinalization.current = true
          }
        }
        if (!['ready', 'activated'].includes(activeImport.state)) {
          return
        }
        if (item.needsDeployment && !activeImport.reusable) {
          setImportOpen(true)
          return
        }
      }

      if (usesImportFlow && !activeImport) {
        throw new Error(copy.quoteUnavailable)
      }

      const currentQuoteInput = JSON.stringify(quoteInput)
      const canReuseIssuedQuote =
        issuedQuote &&
        issuedQuoteInput === currentQuoteInput &&
        issuedQuote.quote.validUntil > Math.floor(Date.now() / 1000) + 15
      const issued = canReuseIssuedQuote
        ? issuedQuote
        : await fetchEscrowJson<EscrowIssuedQuoteResponse>(
            usesImportFlow
              ? `${escrowBaseUrl}/api/imports/${activeImport?.importId}/quote`
              : `${escrowBaseUrl}/api/quote`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(
                usesImportFlow
                  ? {
                      sponsor: address,
                      depthPerSideAtomic: quoteInput.depthPerSideAtomic,
                      maxSpreadBps: quoteInput.maxSpreadBps,
                      sponsorPremiumBps: quoteInput.sponsorPremiumBps,
                      ...('serviceEnd' in quoteInput ? { serviceEnd: quoteInput.serviceEnd } : {}),
                      ...('series' in quoteInput ? { series: quoteInput.series } : {}),
                    }
                  : quoteInput,
              ),
            },
          )
      if (
        issued.status !== 'issued' ||
        !issued.signature.startsWith('0x') ||
        issued.quote.sponsor.toLowerCase() !== address.toLowerCase() ||
        issued.typedData.domain.verifyingContract.toLowerCase() !== MARKET_MAKER_ESCROW_ADDRESS.toLowerCase() ||
        Number(issued.typedData.domain.chainId) !== chainId
      ) {
        throw new Error('Signed quote does not match the expected sponsor, chain, or escrow proxy.')
      }
      setIssuedQuote(issued)
      setIssuedQuoteInput(currentQuoteInput)

      const sponsor = address as `0x${string}`
      const reward = BigInt(issued.quote.reward)
      const requiredAllowance = reward + (reward * BigInt(issued.quote.protocolFeeBps)) / 10_000n
      await ensureEscrowAllowance(requiredAllowance)

      const quote = issued.quote
      const campaignArguments = [
        {
          quoteId: quote.quoteId as `0x${string}`,
          sponsor,
          scopeHash: quote.scopeHash as `0x${string}`,
          termsHash: quote.termsHash as `0x${string}`,
          reward: BigInt(quote.reward),
          bond: BigInt(quote.bond),
          protocolFeeBps: quote.protocolFeeBps,
          acceptDeadline: BigInt(quote.acceptDeadline),
          serviceStart: BigInt(quote.serviceStart),
          serviceEnd: BigInt(quote.serviceEnd),
          claimableAt: BigInt(quote.claimableAt),
          validUntil: BigInt(quote.validUntil),
        },
        issued.signature as `0x${string}`,
      ] as const
      const campaignHash = await sendSponsorTransaction({
        to: MARKET_MAKER_ESCROW_ADDRESS,
        data: encodeFunctionData({
          abi: MARKET_MAKER_ESCROW_ABI,
          functionName: 'createCampaign',
          args: campaignArguments,
        }),
        title: copy.fundMarketMakerCampaign,
      })
      const campaignReceipt = await publicClient.waitForTransactionReceipt({ hash: campaignHash })
      if (campaignReceipt.status !== 'success') {
        throw new Error(copy.quoteUnavailable)
      }
      await queryClient.invalidateQueries({ queryKey: ['market-making-campaigns'] })
      toast.success(copy.campaignCreated)
      handleCampaignOpenChange(false)
    } catch (error) {
      if (error instanceof EscrowApiError && error.code === 'verified_email_required') {
        setIssueError(null)
        setEmailLinkError(null)
        setEmailDialogOpen(true)
        return
      }
      const friendlyMessage =
        error instanceof EscrowApiError && error.code === 'notifications_unavailable'
          ? copy.verificationUnavailable
          : error instanceof EscrowApiError
            ? quoteErrorMessage(error, copy)
            : fundingErrorMessage(error, copy)
      setIssueError(friendlyMessage)
      if (usesImportFlow && isUserRejectedRequestError(error)) {
        setImportOpen(false)
      }
      if (!isUserRejectedRequestError(error)) {
        console.error('Failed to fund market-making campaign.', error)
      }
    } finally {
      setIsIssuing(false)
    }
  }

  const controls = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b py-3 pr-12 pl-4 sm:pl-5">
        <MarketAvatar item={item} />
        <div className="min-w-0">
          <div className="line-clamp-2 font-semibold">{item.title}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{getMarketLabel(item, copy)}</span>
            {item.needsDeployment && !importReady && (
              <>
                <span className="size-1 rounded-full bg-border" />
                <span>{copy.importRequired}</span>
              </>
            )}
            {item.needsDeployment && importReady && (
              <>
                <span className="size-1 rounded-full bg-border" />
                <span>{copy.onKuest}</span>
              </>
            )}
            {marketCountLabel && (
              <>
                <span className="size-1 rounded-full bg-border" />
                <span>{marketCountLabel}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3 sm:px-5 sm:py-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] lg:grid-rows-[minmax(0,1fr)_auto] lg:gap-5">
        <div className="min-h-0 flex-1 overflow-y-auto lg:contents">
          <div className="space-y-3 pb-3 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            <section className="rounded-xl border p-3">
              <div className="grid gap-3">
                <div>
                  <div className="mb-2 flex items-center gap-1.5">
                    <h3 className="font-semibold">{copy.depth}</h3>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            className="text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            aria-label={copy.depthHelp}
                          />
                        }
                      >
                        <CircleHelpIcon className="size-4" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-72 text-sm">{copy.depthHelp}</TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-1.5">
                    {sponsorshipOptions.depthPerSideUsdc.map((option) => (
                      <Button
                        key={option}
                        type="button"
                        variant={depth === option ? 'default' : 'outline'}
                        className="h-9 min-w-0 px-1.5 text-sm"
                        onClick={() => {
                          setDepth(option)
                          clearIssuedQuote()
                        }}
                      >
                        {formatCompactCurrency(option, locale)}
                      </Button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center gap-1.5">
                    <h3 className="font-semibold">{copy.spread}</h3>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            className="text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            aria-label={copy.spreadHelp}
                          />
                        }
                      >
                        <CircleHelpIcon className="size-4" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-72 text-sm">{copy.spreadHelp}</TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {sponsorshipOptions.maxSpreadBps.map((option) => (
                      <Button
                        key={option}
                        type="button"
                        variant={spread === option ? 'default' : 'outline'}
                        className="h-9 min-w-0 px-1.5 text-sm"
                        onClick={() => {
                          setSpread(option)
                          clearIssuedQuote()
                        }}
                      >
                        {option / 100}¢
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-3 w-full opacity-80">
                <DepthPreview
                  depth={depth}
                  spread={spread}
                  buyOrders={copy.buyOrders}
                  sellOrders={copy.sellOrders}
                  maxLabel={copy.max}
                  maximumDepth={selection?.maximumDepth ?? depth}
                  maximumSpread={selection?.maximumSpread ?? spread}
                />
              </div>
            </section>

            <section className="grid gap-2.5 sm:grid-cols-2">
              <div className="flex items-center gap-2.5 rounded-xl border p-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                  <ArrowLeftRightIcon className="size-4 text-muted-foreground" />
                </span>
                <div>
                  <div className="text-xs text-muted-foreground">{copy.coverage}</div>
                  <div className="mt-0.5 text-base font-semibold">
                    {coverageBps === null ? '—' : `${coverageBps / 100}%`}
                  </div>
                </div>
              </div>
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      disabled={usesImportFlow || sponsorSeries || !hasSelectableServiceWindow}
                      className="flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    />
                  }
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <CalendarIcon className="size-4 text-muted-foreground" />
                  </span>
                  <span>
                    <span className="block text-sm">
                      <span className="text-muted-foreground">{copy.duration}: </span>
                      <span className="font-semibold">
                        {serviceDurationDays === null
                          ? '—'
                          : formatCountTemplate(copy.dayCount, serviceDurationDays, locale)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {sponsorshipDurationSubtitle({
                        sponsorSeries,
                        allRenewals: copy.allRenewals,
                        dateLabel: formatDateTemplate(
                          copy.untilDate,
                          formatEndDate(preview ? new Date(preview.serviceEnd * 1000) : serviceEnd, locale),
                        ),
                      })}
                    </span>
                  </span>
                </PopoverTrigger>
                <PopoverContent align="end" collisionPadding={16} className="w-auto p-2">
                  <Calendar
                    mode="single"
                    selected={serviceEnd}
                    startMonth={hasSelectableServiceWindow ? minimumServiceEndDate : marketEndDate}
                    endMonth={marketEndDate}
                    disabled={
                      usesImportFlow || sponsorSeries || !hasSelectableServiceWindow
                        ? true
                        : { before: minimumServiceEndDate, after: marketEndDate }
                    }
                    onSelect={(date) => {
                      if (!date) {
                        return
                      }
                      setServiceEnd(normalizeServiceEndDate(date, marketEndDate))
                      setCalendarOpen(false)
                      clearIssuedQuote()
                    }}
                    className="bg-transparent p-0"
                  />
                </PopoverContent>
              </Popover>
            </section>

            {item.seriesSlug && item.creatorFilter && (
              <section className="flex items-center justify-between gap-3 rounded-xl border p-2.5">
                <div className="min-w-0">
                  <Label htmlFor="sponsor-series" className="text-sm font-semibold">
                    {copy.sponsorSeries}
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">{copy.sponsorSeriesDescription}</p>
                </div>
                <Switch
                  id="sponsor-series"
                  checked={sponsorSeries}
                  onCheckedChange={(checked) => {
                    setSponsorSeries(checked)
                    if (!checked) {
                      setServiceEnd(marketEndDate)
                    }
                    setActiveImportId(null)
                    setImportValue(null)
                    setPendingImportPaymentHash(null)
                    clearIssuedQuote()
                  }}
                />
              </section>
            )}
          </div>

          <aside className="mt-4 flex flex-col gap-3 lg:sticky lg:top-0 lg:col-start-2 lg:row-start-1 lg:mt-0 lg:min-h-0 lg:overflow-y-auto">
            <section className="relative rounded-xl border bg-muted/60 p-3.5 sm:p-4">
              <div className="space-y-3 text-sm">
                {item.markets.length > 1 && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{copy.multiMarketDiscount}</span>
                    <span className="shrink-0 font-medium">
                      {breakdown
                        ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(
                            multiMarketDiscountBps(breakdown) / 10_000,
                          )
                        : '—'}
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 border-b pb-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{copy.makerReward}</span>
                    </div>
                  </div>
                  <span className="shrink-0 font-medium">
                    {breakdown ? formatUsdcString(breakdown.marketMakerReward, locale) : '—'}
                  </span>
                  <div className="flex w-full items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <Label htmlFor="sponsor-premium" className="text-xs text-muted-foreground">
                        {copy.sponsorPremium}
                      </Label>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              className="text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                              aria-label={copy.sponsorPremiumHelp}
                            />
                          }
                        >
                          <CircleHelpIcon className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-72 text-sm">{copy.sponsorPremiumHelp}</TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="relative w-20 shrink-0">
                      <Input
                        id="sponsor-premium"
                        type="number"
                        min={0}
                        max={1000}
                        step={1}
                        inputMode="numeric"
                        value={sponsorPremiumPercent}
                        aria-invalid={!sponsorPremiumValid}
                        onChange={(event) => {
                          const value = event.target.value
                          if (isSponsorPremiumValid(value)) {
                            setSponsorPremiumPercent(value)
                            clearIssuedQuote()
                          }
                        }}
                        className="h-8 pr-6 text-right text-xs"
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">
                        %
                      </span>
                    </div>
                  </div>
                </div>

                {!isConnected ? (
                  <div className="flex min-h-[96px] items-center rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                    {copy.connectWallet}
                  </div>
                ) : !hasSelectableServiceWindow ? (
                  <div className="flex min-h-[96px] items-center rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {previewQuery.isError ? quoteErrorMessage(previewQuery.error, copy) : copy.quoteUnavailable}
                  </div>
                ) : configQuery.isError || (configQuery.isSuccess && selection === null) ? (
                  <p className="text-muted-foreground">{copy.quoteUnavailable}</p>
                ) : (!canRequestQuote || previewQuery.isLoading) && !breakdown ? (
                  <div className="flex min-h-[96px] items-center justify-center gap-2 rounded-lg bg-background/60 p-3 text-sm text-muted-foreground">
                    <LoaderCircleIcon className="size-4 animate-spin" />
                    {copy.calculating}
                  </div>
                ) : previewQuery.isError || !breakdown || !costs || displayedTotalAtomic === null ? (
                  <div className="flex min-h-[96px] items-center rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {copy.quoteUnavailable}
                  </div>
                ) : (
                  <div className="relative space-y-2.5">
                    {previewQuery.isFetching && (
                      <LoaderCircleIcon className="absolute top-0 right-0 size-4 animate-spin text-muted-foreground" />
                    )}
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">{copy.kuestFee}</span>
                      <span className="font-medium">{formatUsdcString(breakdown.protocolFee, locale)}</span>
                    </div>
                    {deploymentFeePending && (
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground">{copy.importEvent}</span>
                        <span className="font-medium">{formatUsdcAtomic(initialDeploymentFeeAtomic, locale)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-4 border-t pt-3 text-base font-semibold">
                      <span>
                        {costs.totalCostStatus === 'estimate' || costs.totalCostStatus === 'pending'
                          ? copy.estimated
                          : copy.total}
                      </span>
                      <span>{formatUsdcAtomic(displayedTotalAtomic, locale)}</span>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </aside>
        </div>

        <div className="shrink-0 border-t bg-background/95 pt-3 pb-1 backdrop-blur lg:col-start-2 lg:row-start-2">
          {issueError && (
            <div className="mb-2 flex items-center justify-center gap-2 text-center text-sm font-semibold text-destructive">
              <AlertTriangleIcon className="size-4 shrink-0" aria-hidden />
              <span>{issueError}</span>
            </div>
          )}
          {balanceCheckRequired && sponsorBalanceQuery.isError && (
            <div className="mb-2 flex items-center justify-center gap-2 text-center text-sm font-semibold text-orange-500">
              <AlertTriangleIcon className="size-4 shrink-0" aria-hidden />
              <span>{copy.balanceUnavailable}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={sponsorBalanceQuery.isFetching}
                onClick={() => void sponsorBalanceQuery.refetch()}
              >
                {copy.retry}
              </Button>
            </div>
          )}
          {!issueError && balanceCheckRequired && !sponsorBalanceQuery.isError && hasInsufficientSponsorBalance && (
            <div className="mb-2 flex items-center justify-center gap-2 text-center text-sm font-semibold text-orange-500">
              <AlertTriangleIcon className="size-4 shrink-0" aria-hidden />
              <span>{copy.insufficientBalance}</span>
            </div>
          )}
          {!issueError && !(balanceCheckRequired && (hasInsufficientSponsorBalance || sponsorBalanceQuery.isError)) && (
            <p className="mb-2 hidden overflow-hidden text-center text-xs text-ellipsis whitespace-nowrap text-muted-foreground sm:block">
              {copy.escrowNotice}
            </p>
          )}
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={
              isIssuing ||
              !sponsorPremiumValid ||
              (isConnected &&
                (!canRequestQuote ||
                  preview?.status !== 'priced' ||
                  previewQuery.isLoading ||
                  previewQuery.isFetching ||
                  !transactionWalletClient ||
                  (balanceCheckRequired &&
                    (isSponsorBalanceLoading || sponsorBalanceQuery.isError || hasInsufficientSponsorBalance))))
            }
            onClick={handleFundCampaign}
          >
            {isIssuing ? (
              <>
                <LoaderCircleIcon className="size-4 animate-spin" />
                {copy.funding}
              </>
            ) : isConnected ? (
              copy.continue
            ) : (
              copy.connectWallet
            )}
          </Button>
        </div>
      </div>
    </div>
  )

  if (isMobile) {
    return (
      <>
        <Drawer open={open} onOpenChange={handleCampaignOpenChange}>
          <DrawerContent className="flex max-h-[90dvh] w-full flex-col overflow-hidden bg-background">
            <DrawerHeader className="sr-only">
              <DrawerTitle>{copy.sponsor}</DrawerTitle>
              <DrawerDescription>{copy.campaignDescription}</DrawerDescription>
            </DrawerHeader>
            <div className="absolute top-3 right-3 z-10">
              <Button type="button" variant="ghost" size="icon" onClick={() => handleCampaignOpenChange(false)}>
                <XIcon className="size-5" />
                <span className="sr-only">{copy.close}</span>
              </Button>
            </div>
            {controls}
          </DrawerContent>
        </Drawer>
        <ImportProgressModal
          copy={copy}
          value={importValue}
          open={importOpen}
          retrying={isRetryingImport}
          cancelling={isCancellingImport}
          withdrawing={isWithdrawingImport}
          canCancel={importCanCancel}
          refundReady={importRefundReady}
          relayerPending={deploymentRelayerPending}
          onOpenChange={setImportOpen}
          onRetry={handleRetryImport}
          onCancel={() => void handleCancelImport()}
          onWithdraw={() => void handleWithdrawImport()}
        />
        <SponsorEmailDialog
          copy={copy}
          open={emailDialogOpen}
          email={notificationEmail}
          pending={emailLinkPending}
          verificationPending={emailVerificationPending}
          error={emailLinkError}
          onEmailChange={setNotificationEmail}
          onOpenChange={handleEmailDialogOpenChange}
          onSubmit={() => void handleLinkSponsorEmail()}
          onVerified={() => void handleEmailVerified()}
        />
      </>
    )
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleCampaignOpenChange}>
        <DialogContent className="flex max-h-[90dvh] max-w-5xl flex-col gap-0 overflow-hidden bg-background p-0 sm:max-w-5xl">
          <DialogHeader className="sr-only">
            <DialogTitle>{copy.sponsor}</DialogTitle>
            <DialogDescription>{copy.campaignDescription}</DialogDescription>
          </DialogHeader>
          {controls}
        </DialogContent>
      </Dialog>
      <ImportProgressModal
        copy={copy}
        value={importValue}
        open={importOpen}
        retrying={isRetryingImport}
        cancelling={isCancellingImport}
        withdrawing={isWithdrawingImport}
        canCancel={importCanCancel}
        refundReady={importRefundReady}
        relayerPending={deploymentRelayerPending}
        onOpenChange={setImportOpen}
        onRetry={handleRetryImport}
        onCancel={() => void handleCancelImport()}
        onWithdraw={() => void handleWithdrawImport()}
      />
      <SponsorEmailDialog
        copy={copy}
        open={emailDialogOpen}
        email={notificationEmail}
        pending={emailLinkPending}
        verificationPending={emailVerificationPending}
        error={emailLinkError}
        onEmailChange={setNotificationEmail}
        onOpenChange={handleEmailDialogOpenChange}
        onSubmit={() => void handleLinkSponsorEmail()}
        onVerified={() => void handleEmailVerified()}
      />
    </>
  )
}

function NotificationSettingsButton({ copy, locale }: { copy: MarketMakingCopy; locale: string }) {
  const user = useUser()
  const { address, isConnected } = useAppKitAccount()
  const { walletProvider } = useAppKitProvider<RpcWalletProvider>('eip155')
  const { data: walletClient } = useWalletClient()
  const { chainId, notificationsUrl } = usePublicRuntimeConfig()
  const { runWithSignaturePrompt } = useSignaturePromptRunner()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null)
  const [campaignStatus, setCampaignStatus] = useState(true)
  const [newOpportunities, setNewOpportunities] = useState(true)
  const [nonEmailPreferences, setNonEmailPreferences] = useState<NotificationPreference[]>([])
  const [settingsWallet, setSettingsWallet] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const settingsRequestId = useRef(0)
  const activeAddress = useRef(address)

  useEffect(() => {
    activeAddress.current = address
    settingsRequestId.current += 1
    queueMicrotask(() => {
      setLoading(false)
      setSettingsWallet(null)
    })
    return () => {
      settingsRequestId.current += 1
    }
  }, [address])

  const signingWalletClient = useMemo(() => {
    if (!address) {
      return null
    }
    if (walletClient?.account?.address?.toLowerCase() === address.toLowerCase()) {
      return walletClient
    }
    const chain = resolveViemNetworkByChainId(chainId)
    if (!chain || !isRpcWalletProvider(walletProvider)) {
      return null
    }
    return createWalletClient({
      account: address as `0x${string}`,
      chain,
      transport: custom(walletProvider),
    })
  }, [address, chainId, walletClient, walletProvider])
  const hasLoadedSettings = Boolean(address) && settingsWallet === address?.toLowerCase()
  const operatorDomain = typeof window === 'undefined' ? '' : window.location.hostname.toLowerCase()
  const accountEmail = user?.email?.trim() ?? ''
  const hasAccountEmail = hasUsableUserEmail(accountEmail)
  const hasCurrentSettings = hasLoadedSettings && hasAccountEmail

  async function loadSettings() {
    const requestId = ++settingsRequestId.current
    const requestWallet = address?.toLowerCase() ?? null
    setOpen(true)
    setError(null)
    setMaskedEmail(null)
    setNonEmailPreferences([])
    setSettingsWallet(null)
    setLoading(false)
    if (!hasAccountEmail) {
      setSettingsWallet(requestWallet)
      return
    }
    if (!isConnected || !address || !signingWalletClient) {
      setError(copy.walletNotReady)
      return
    }
    setLoading(true)
    try {
      const settings = await runWithSignaturePrompt(
        () =>
          readNotificationSettings({
            notificationsUrl,
            chainId,
            wallet: address as `0x${string}`,
            walletClient: signingWalletClient,
          }),
        { title: copy.notificationSettings, description: copy.transactionPrompt },
      )
      if (settingsRequestId.current !== requestId || activeAddress.current?.toLowerCase() !== requestWallet) {
        return
      }
      setMaskedEmail(settings.maskedEmail ?? null)
      const campaignPreference = settings.preferences?.find(
        (preference) => preference.channel === 'email' && preference.topic === 'campaign_status',
      )
      const opportunityPreference = settings.preferences?.find(
        (preference) => preference.channel === 'email' && preference.topic === 'new_opportunities',
      )
      setNonEmailPreferences(settings.preferences?.filter((preference) => preference.channel !== 'email') ?? [])
      setSettingsWallet(requestWallet)
      setCampaignStatus(campaignPreference?.enabled ?? true)
      setNewOpportunities(opportunityPreference?.enabled ?? true)
    } catch {
      if (settingsRequestId.current === requestId && activeAddress.current?.toLowerCase() === requestWallet) {
        setError(copy.verificationUnavailable)
      }
    } finally {
      if (settingsRequestId.current === requestId) {
        setLoading(false)
      }
    }
  }

  async function saveSettings() {
    if (!address || !signingWalletClient || !hasCurrentSettings) {
      setError(copy.walletNotReady)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const linkResult = await runWithSignaturePrompt(
        () =>
          linkSponsorEmail({
            notificationsUrl,
            wallet: address as `0x${string}`,
            walletClient: signingWalletClient,
            email: accountEmail,
            locale,
            siteDomain: operatorDomain,
          }),
        { title: copy.notificationSettings, description: copy.transactionPrompt },
      )
      if (!linkResult.alreadyVerified) {
        setError(copy.operatorVerificationPending)
        return
      }
      await runWithSignaturePrompt(
        () =>
          updateNotificationSettings({
            notificationsUrl,
            chainId,
            wallet: address as `0x${string}`,
            walletClient: signingWalletClient,
            preferences: [
              ...nonEmailPreferences,
              { channel: 'email', topic: 'campaign_status', enabled: campaignStatus },
              { channel: 'email', topic: 'new_opportunities', enabled: newOpportunities },
            ],
          }),
        { title: copy.notificationSettings, description: copy.transactionPrompt },
      )
      setOpen(false)
    } catch {
      setError(copy.verificationUnavailable)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={copy.notificationSettings}
        onClick={() => void loadSettings()}
      >
        <BellIcon className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.notificationSettings}</DialogTitle>
            <DialogDescription>{maskedEmail ?? copy.emailDescription}</DialogDescription>
          </DialogHeader>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" />
              {copy.verifying}
            </div>
          ) : hasCurrentSettings ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="campaign-status-notifications">{copy.campaignsTab}</Label>
                <Switch
                  id="campaign-status-notifications"
                  checked={campaignStatus}
                  onCheckedChange={setCampaignStatus}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="opportunity-notifications">{copy.marketMaking}</Label>
                <Switch
                  id="opportunity-notifications"
                  checked={newOpportunities}
                  onCheckedChange={setNewOpportunities}
                />
              </div>
            </div>
          ) : null}
          {!hasAccountEmail ? (
            <p className="text-sm text-destructive">
              {copy.accountEmailRequired}{' '}
              <Link href="/settings" className="underline underline-offset-4">
                {copy.accountSettings}
              </Link>
            </p>
          ) : null}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              disabled={!hasCurrentSettings || loading || saving}
              onClick={() => void saveSettings()}
            >
              {saving ? <LoaderCircleIcon className="size-4 animate-spin" /> : null}
              {copy.saveChanges}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default function MarketMakingDiscovery({
  linkedCampaignId,
  locale,
  copy,
  campaignsCopy,
  howItWorksCopy,
}: MarketMakingDiscoveryProps) {
  const { chainId } = usePublicRuntimeConfig()
  const escrowReadOnly = chainId !== POLYGON_MAINNET_CHAIN_ID
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<MarketMakingSourceFilter>('all')
  const [activeTab, setActiveTab] = useState<'sponsor' | 'campaigns'>(() =>
    linkedCampaignId ? 'campaigns' : 'sponsor',
  )
  const [selectedMarket, setSelectedMarket] = useState<MarketMakingDiscoveryItem | null>(null)
  const [howItWorksOpen, setHowItWorksOpen] = useState(false)
  const deferredQuery = useDeferredValue(query.trim())
  const filters = useMemo(
    () => [
      { id: 'all' as const, label: copy.all },
      { id: 'mine' as const, label: copy.mine },
      { id: 'kuest' as const, label: copy.kuest },
      { id: 'polymarket' as const, label: copy.polymarket },
    ],
    [copy.all, copy.kuest, copy.mine, copy.polymarket],
  )
  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ['admin-market-making', source, deferredQuery],
    enabled: activeTab === 'sponsor',
    staleTime: 60_000,
    queryFn: async () => {
      const params = new URLSearchParams({ source, limit: '18' })
      if (deferredQuery) {
        params.set('q', deferredQuery)
      }
      const response = await fetch(`/admin/api/market-making?${params}`)
      if (!response.ok) {
        throw new Error(`Market-making discovery failed with status ${response.status}.`)
      }
      return (await response.json()) as MarketMakingDiscoveryResponse
    },
  })

  return (
    <section className="min-h-[calc(100dvh-6rem)] min-w-0">
      {escrowReadOnly && (
        <AlertBanner
          title={copy.mainnetOnly}
          description={copy.amoyReadOnlyNotice}
          className="mb-4"
          variant="default"
        />
      )}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'sponsor' | 'campaigns')}>
        <div className="flex items-center justify-between gap-3">
          <TabsList className="h-10">
            <TabsTrigger value="sponsor" className="h-8 px-5">
              {copy.sponsorTab}
            </TabsTrigger>
            <TabsTrigger value="campaigns" className="h-8 px-5">
              {copy.campaignsTab}
            </TabsTrigger>
          </TabsList>
          <NotificationSettingsButton copy={copy} locale={locale} />
        </div>

        <TabsContent value="sponsor" className="mt-5">
          <div className="relative rounded-3xl border bg-card px-5 py-10 sm:px-10 sm:py-14">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute top-3 right-3 gap-1.5 text-muted-foreground sm:top-5 sm:right-5"
              onClick={() => setHowItWorksOpen(true)}
            >
              <CircleHelpIcon className="size-4" />
              {copy.howItWorks}
            </Button>
            <div className="mx-auto max-w-3xl pt-5 text-center sm:pt-0">
              <div className="mb-3 text-sm font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                {copy.eyebrow}
              </div>
              <h1 className="text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">{copy.title}</h1>
              <p className="mx-auto mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:whitespace-nowrap">
                {copy.description}
              </p>
              <div className="relative mx-auto mt-7 max-w-2xl">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={copy.searchPlaceholder}
                  className="h-14 rounded-2xl border-border/80 bg-background pr-12 pl-12 text-base shadow-sm focus-visible:ring-primary/25 md:text-base"
                />
                {isFetching && !isLoading && (
                  <span className="absolute top-1/2 right-4 size-4 -translate-y-1/2 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
                )}
              </div>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {filters.map((filter) => (
                  <Button
                    key={filter.id}
                    type="button"
                    variant={source === filter.id ? 'secondary' : 'ghost'}
                    size="sm"
                    className={cn('rounded-full px-4', source === filter.id && 'ring-1 ring-border')}
                    onClick={() => setSource(filter.id)}
                  >
                    {filter.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="mx-auto mt-3 max-w-5xl px-1 sm:px-3">
            {isLoading && <LoadingRows label={copy.loading} />}
            {isError && (
              <div className="py-16 text-center">
                <p className="text-base font-semibold">{copy.loadError}</p>
              </div>
            )}
            {!isLoading && !isError && data?.data.length === 0 && (
              <div className="py-16 text-center">
                <SearchIcon className="mx-auto size-6 text-muted-foreground" />
                <h2 className="mt-4 text-lg font-semibold">{copy.emptyTitle}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{copy.emptyDescription}</p>
              </div>
            )}
            {!isLoading &&
              !isError &&
              data?.data.map((item) => (
                <MarketRow key={item.id} item={item} locale={locale} copy={copy} onSelect={setSelectedMarket} />
              ))}
          </div>
        </TabsContent>

        <TabsContent value="campaigns" className="mt-5">
          <MarketMakingCampaigns
            key={resolveCampaignsInstanceKey(linkedCampaignId)}
            linkedCampaignId={linkedCampaignId}
            locale={locale}
            copy={campaignsCopy}
          />
        </TabsContent>
      </Tabs>

      {selectedMarket && (
        <CampaignDialog
          key={selectedMarket.id}
          item={selectedMarket}
          locale={locale}
          copy={copy}
          open
          onOpenChange={(open) => {
            if (!open) {
              setSelectedMarket(null)
            }
          }}
        />
      )}
      <MarketMakingHowItWorks open={howItWorksOpen} onOpenChange={setHowItWorksOpen} copy={howItWorksCopy} />
    </section>
  )
}
