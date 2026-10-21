'use client'

import type { Address, Hex } from 'viem'

import { useAppKitAccount } from '@reown/appkit/react'
import {
  CheckIcon,
  ChevronDownIcon,
  CircleXIcon,
  ExternalLinkIcon,
  GiftIcon,
  LockKeyholeIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useExtracted } from 'next-intl'
import Image from 'next/image'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { encodeFunctionData, erc20Abi, formatUnits, getAddress, isAddress } from 'viem'
import { usePublicClient, useSignTypedData, useWalletClient } from 'wagmi'

import type { DirectResolutionOutcome } from '@/lib/direct-resolution'
import type { FeeOverrides } from '@/lib/transaction-fees'
import type { Event } from '@/types'

import EventIconImage from '@/components/EventIconImage'
import ResolutionReporterHistoryBadges from '@/components/ResolutionReporterHistoryBadges'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useBalance } from '@/hooks/useBalance'
import { usePublicRuntimeConfig } from '@/hooks/usePublicRuntimeConfig'
import { useSignaturePromptRunner } from '@/hooks/useSignaturePromptRunner'
import { Link } from '@/i18n/navigation'
import { getAvatarPlaceholderStyle, shouldUseAvatarPlaceholder } from '@/lib/avatar'
import { OUTCOME_INDEX } from '@/lib/constants'
import { COLLATERAL_TOKEN_ADDRESS, RESOLUTION_REWARDS_ADDRESS } from '@/lib/contracts'
import {
  CTF_ADAPTER_QUESTION_ABI,
  DIRECT_RESOLUTION_ORACLE_ABI,
  getDirectResolutionAdapterAddress,
  getDirectResolutionNegRiskOperatorAddress,
  getDirectResolutionOracleAddress,
  getDirectResolutionPrice,
  getDirectResolutionQuestionIds,
  isDirectResolutionMarket,
  readDirectResolutionError,
  resolveResolutionActorAddress,
  YES_OR_NO_IDENTIFIER,
} from '@/lib/direct-resolution'
import { DEFAULT_CHAIN_ID } from '@/lib/network'
import { buildPublicProfilePath } from '@/lib/platform-routing'
import { readCreatorProposerWhitelistStatus } from '@/lib/proposer-whitelist'
import { getResolutionRewardMarketId, RESOLUTION_REWARDS_ABI, RESOLUTION_REWARD_SIDE } from '@/lib/resolution-rewards'
import { sendWithEstimatedFeeRetry } from '@/lib/transaction-fees'
import { cn } from '@/lib/utils'
import { resolveViemRpcUrls } from '@/lib/viem-network'
import { WALLET_CONNECTOR_NOT_CONNECTED_MESSAGE, WalletConnectorNotConnectedError } from '@/lib/wallet'
import { signAndSubmitDepositWalletCalls } from '@/lib/wallet/client'
import { useOutcomeTopOfBookPrice } from '@/stores/useOrder'
import { useUser } from '@/stores/useUser'

import { resolveWinningOutcomeIndex } from '../_utils/eventMarketUtils'
import { isUnknownFiftyFiftyResolvedMarket } from '../_utils/resolved-order-panel-market'

interface DirectResolutionButtonProps {
  market: Event['markets'][number]
  event: Event
  resolutionSourceLabel?: string | null
  onResolutionRewardAmountChange?: (amount: string | null) => void
}

interface AdapterQuestionData {
  requestTimestamp: bigint
  resolved: boolean
  ancillaryData: Hex
}

type DirectResolutionState =
  | 'idle'
  | 'checking'
  | 'permission_check_error'
  | 'not_whitelisted'
  | 'missing_request'
  | 'pending'
  | 'submitted'
  | 'resolved'
  | 'error'

type ResolutionReportEligibility = 'signed_out' | 'eligible' | 'ineligible' | 'unavailable'

interface ResolutionReportSummary {
  marketId: Hex | null
  bond: string
  rewardPool: string
  lockDuration: string
  withdrawalDelay: string
  rewardEnabled: boolean
  outcomeCounts: Record<DirectResolutionOutcome, number>
  reporters: Array<{
    seed: string
    wallet?: string
    username?: string
    image: string
    outcome: DirectResolutionOutcome
    rewardAmount: string
    historyCorrectCount: number
    historyIncorrectCount: number
  }>
  currentOutcome: DirectResolutionOutcome | null
  currentReporterHistory?: {
    correctCount: number
    incorrectCount: number
  }
  eligibility: ResolutionReportEligibility
}

type ResolutionReporter = ResolutionReportSummary['reporters'][number]

interface ResolutionReportSummaryRequest {
  id: number
  scopeKey: string
  controller: AbortController
  promise: Promise<void>
}

interface ResolutionReportSummaryCache {
  scopeKey: string
  loadedAt: number
}

interface PendingResolutionReport {
  savedAt: number
  outcome: Exclude<DirectResolutionOutcome, 'unknown'>
  reporter: ResolutionReporter
}

const WALLET_TRANSACTION_GAS_BUFFER_NUMERATOR = 3n
const WALLET_TRANSACTION_GAS_BUFFER_DENOMINATOR = 2n
const RESOLUTION_REPORT_SUMMARY_FRESHNESS_MS = 15_000
const PENDING_RESOLUTION_REPORT_TTL_MS = 60 * 60 * 1000
const PENDING_RESOLUTION_REPORT_STORAGE_PREFIX = 'kuest:pending-resolution-report:'

function createEmptyResolutionReportSummary(): ResolutionReportSummary {
  return {
    marketId: null,
    bond: '0',
    rewardPool: '0',
    lockDuration: '0',
    withdrawalDelay: '0',
    rewardEnabled: false,
    outcomeCounts: { yes: 0, no: 0, unknown: 0 },
    reporters: [],
    currentOutcome: null,
    currentReporterHistory: { correctCount: 0, incorrectCount: 0 },
    eligibility: 'unavailable',
  }
}

function getPendingResolutionReportStorageKey(scopeKey: string) {
  return `${PENDING_RESOLUTION_REPORT_STORAGE_PREFIX}${scopeKey}`
}

function readPendingResolutionReport(scopeKey: string): PendingResolutionReport | null {
  try {
    const raw = window.localStorage.getItem(getPendingResolutionReportStorageKey(scopeKey))
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<PendingResolutionReport>
    if (
      !Number.isFinite(parsed.savedAt) ||
      Date.now() - Number(parsed.savedAt) > PENDING_RESOLUTION_REPORT_TTL_MS ||
      (parsed.outcome !== 'yes' && parsed.outcome !== 'no') ||
      !parsed.reporter ||
      typeof parsed.reporter.seed !== 'string' ||
      parsed.reporter.outcome !== parsed.outcome
    ) {
      window.localStorage.removeItem(getPendingResolutionReportStorageKey(scopeKey))
      return null
    }
    return parsed as PendingResolutionReport
  } catch {
    return null
  }
}

function writePendingResolutionReport(scopeKey: string, pendingReport: PendingResolutionReport) {
  try {
    window.localStorage.setItem(getPendingResolutionReportStorageKey(scopeKey), JSON.stringify(pendingReport))
  } catch {
    // Persistence is best-effort; the in-memory optimistic state still applies.
  }
}

function clearPendingResolutionReport(scopeKey: string) {
  try {
    window.localStorage.removeItem(getPendingResolutionReportStorageKey(scopeKey))
  } catch {
    // Ignore unavailable browser storage.
  }
}

function mergePendingResolutionReport(
  summary: ResolutionReportSummary,
  pendingReport: PendingResolutionReport,
): ResolutionReportSummary {
  const { outcome, reporter } = pendingReport
  return {
    ...summary,
    currentOutcome: outcome,
    outcomeCounts: { ...summary.outcomeCounts, [outcome]: 1 },
    reporters: [...summary.reporters.filter((currentReporter) => currentReporter.outcome !== outcome), reporter],
  }
}

function addWalletTransactionGasBuffer(gas: bigint) {
  return (
    (gas * WALLET_TRANSACTION_GAS_BUFFER_NUMERATOR + WALLET_TRANSACTION_GAS_BUFFER_DENOMINATOR - 1n) /
    WALLET_TRANSACTION_GAS_BUFFER_DENOMINATOR
  )
}

function normalizeQuestionData(value: unknown): AdapterQuestionData | null {
  if (Array.isArray(value)) {
    const requestTimestamp = value[0]
    const resolved = value[5]
    const ancillaryData = value[11]
    if (typeof requestTimestamp !== 'bigint' || typeof resolved !== 'boolean' || typeof ancillaryData !== 'string') {
      return null
    }
    return {
      requestTimestamp,
      resolved,
      ancillaryData: ancillaryData as Hex,
    }
  }

  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const requestTimestamp = record.requestTimestamp
  const resolved = record.resolved
  const ancillaryData = record.ancillaryData

  if (typeof requestTimestamp !== 'bigint' || typeof resolved !== 'boolean' || typeof ancillaryData !== 'string') {
    return null
  }

  return {
    requestTimestamp,
    resolved,
    ancillaryData: ancillaryData as Hex,
  }
}

function getOutcomeLabel(market: Event['markets'][number], outcomeIndex: number, fallback: string) {
  return market.outcomes.find((outcome) => outcome.outcome_index === outcomeIndex)?.outcome_text || fallback
}

function getResolutionSource(market: Event['markets'][number]) {
  return market.resolution_source_url?.trim() || market.resolution_source?.trim() || ''
}

function getResolutionSourceUrl(market: Event['markets'][number]) {
  const value = market.resolution_source_url?.trim()
  if (!value) {
    return null
  }

  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function normalizeLabel(value: string | null | undefined) {
  return (
    value
      ?.trim()
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim() ?? ''
  )
}

function normalizeAccentColor(value: string | null | undefined) {
  const normalized = value?.trim() ?? ''
  return /^#[\da-f]{6}$/i.test(normalized) ? normalized : null
}

function formatUsdcAmount(value: string) {
  try {
    const formatted = Number(formatUnits(BigInt(value), 6))
    return `$${formatted.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  } catch {
    return '$0'
  }
}

function parseUsdcAmount(value: string) {
  try {
    const amount = Number(formatUnits(BigInt(value), 6))
    return Number.isFinite(amount) ? amount : null
  } catch {
    return null
  }
}

function formatResolutionRewardAmount(rewardPool: string) {
  try {
    return BigInt(rewardPool) > 0n ? formatUsdcAmount(rewardPool) : null
  } catch {
    return null
  }
}

function formatUsdcTotal(...values: string[]) {
  try {
    return formatUsdcAmount(values.reduce((total, value) => total + BigInt(value), 0n).toString())
  } catch {
    return '$0'
  }
}

function formatOutcomePercentage(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return '—'
  }

  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return '—'
  }

  const percentage = numeric <= 1 ? numeric * 100 : numeric
  return `${percentage.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}

function ResolutionReporterHistory({
  reporters,
  showHistory,
  correctLabel,
  incorrectLabel,
}: {
  reporters: ResolutionReportSummary['reporters']
  showHistory: boolean
  correctLabel: string
  incorrectLabel: string
}) {
  if (!showHistory) {
    return null
  }

  const reportersWithHistory = reporters.filter(
    (reporter) => reporter.historyCorrectCount + reporter.historyIncorrectCount > 0,
  )
  if (reportersWithHistory.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {reportersWithHistory.map((reporter) => (
        <ResolutionReporterHistoryBadges
          key={`${reporter.seed}-history`}
          correctCount={reporter.historyCorrectCount}
          incorrectCount={reporter.historyIncorrectCount}
          correctLabel={correctLabel}
          incorrectLabel={incorrectLabel}
          historyLabel={`${reporter.historyCorrectCount} ${correctLabel}, ${reporter.historyIncorrectCount} ${incorrectLabel}`}
        />
      ))}
    </div>
  )
}

function ResolutionReporterStack({
  reporters,
  totalCount,
  showHistory,
  correctLabel,
  incorrectLabel,
}: {
  reporters: ResolutionReportSummary['reporters']
  totalCount: number
  showHistory: boolean
  correctLabel: string
  incorrectLabel: string
}) {
  if (totalCount <= 0) {
    return null
  }

  const overflowCount = Math.max(0, totalCount - reporters.length)

  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
      <div className="flex -space-x-2" aria-hidden>
        {reporters.map((reporter) => {
          const showPlaceholder = shouldUseAvatarPlaceholder(reporter.image)
          return showPlaceholder ? (
            <span
              key={reporter.seed}
              className="size-7 rounded-full border-2 border-background"
              style={getAvatarPlaceholderStyle(reporter.seed)}
              aria-hidden
            />
          ) : (
            <Image
              key={reporter.seed}
              src={reporter.image}
              alt=""
              width={28}
              height={28}
              className="size-7 rounded-full border-2 border-background object-cover"
            />
          )
        })}
        {overflowCount > 0 && (
          <span className="grid size-7 place-items-center rounded-full border-2 border-background bg-muted text-[10px] font-semibold text-muted-foreground">
            +{overflowCount}
          </span>
        )}
      </div>
      <ResolutionReporterHistory
        reporters={reporters}
        showHistory={showHistory}
        correctLabel={correctLabel}
        incorrectLabel={incorrectLabel}
      />
    </div>
  )
}

function ResolutionReporterAvatar({
  reporter,
  muted = false,
  rewardAmount = null,
  rewardLabel,
  rewardPlacement = 'bottom-right',
}: {
  reporter: ResolutionReporter | null
  muted?: boolean
  rewardAmount?: string | null
  rewardLabel: string
  rewardPlacement?: 'bottom-left' | 'bottom-right'
}) {
  if (!reporter) {
    return (
      <span
        className="block size-12 shrink-0 rounded-full border border-dashed border-muted-foreground/50 bg-transparent"
        aria-hidden
      />
    )
  }

  const showPlaceholder = shouldUseAvatarPlaceholder(reporter.image)
  const displayName = getResolutionReporterDisplayName(reporter)

  const avatar = showPlaceholder ? (
    <span
      className={cn('block size-12 rounded-full border border-border/80', muted && 'opacity-50 grayscale')}
      style={getAvatarPlaceholderStyle(reporter.seed)}
    />
  ) : (
    <Image
      src={reporter.image}
      alt={displayName}
      width={48}
      height={48}
      className={cn('block size-12 rounded-full border border-border/80 object-cover', muted && 'opacity-50 grayscale')}
    />
  )

  const avatarWithReward = (
    <span className="relative block size-12 shrink-0">
      {avatar}
      {rewardAmount && (
        <span
          aria-label={`${rewardLabel}: ${rewardAmount}`}
          className={cn(
            'absolute -bottom-2 z-10 inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-background px-1.5 py-1 text-xs leading-none font-semibold whitespace-nowrap text-violet-500 shadow-sm',
            rewardPlacement === 'bottom-right' ? '-right-6' : '-left-6',
          )}
        >
          <GiftIcon className="size-3.5" aria-hidden />
          <span className="tabular-nums">{rewardAmount}</span>
        </span>
      )}
    </span>
  )

  return avatarWithReward
}

function getResolutionReporterDisplayName(reporter: ResolutionReporter) {
  return reporter.username?.trim() || reporter.wallet?.trim() || reporter.seed
}

function ResolutionReporterCapsule({
  reporter,
  side,
  muted,
  rewardAmount,
  rewardLabel,
  correctLabel,
  incorrectLabel,
  historyLabel,
}: {
  reporter: ResolutionReporter | null
  side: 'first' | 'second'
  muted: boolean
  rewardAmount: string | null
  rewardLabel: string
  correctLabel: string
  incorrectLabel: string
  historyLabel: (reporter: ResolutionReporter) => string
}) {
  const resolvedHistoryLabel = reporter ? historyLabel(reporter) : ''
  const displayName = reporter ? getResolutionReporterDisplayName(reporter) : ''
  const profileHref = reporter ? buildPublicProfilePath(displayName) : null
  const history = (
    <span className="flex min-w-0 flex-1 justify-center">
      {reporter && (
        <ResolutionReporterHistoryBadges
          correctCount={reporter.historyCorrectCount}
          incorrectCount={reporter.historyIncorrectCount}
          correctLabel={correctLabel}
          incorrectLabel={incorrectLabel}
          historyLabel={resolvedHistoryLabel}
          className="gap-1 [&_svg]:size-3.5 [&>span]:px-1.5 [&>span]:py-0.5 [&>span]:text-xs"
          withTooltip={false}
        />
      )}
    </span>
  )
  const avatar = (
    <span className={cn('relative flex size-12 shrink-0', side === 'first' ? '-mr-1' : '-ml-1')}>
      <ResolutionReporterAvatar
        reporter={reporter}
        muted={muted}
        rewardAmount={rewardAmount}
        rewardLabel={rewardLabel}
        rewardPlacement={side === 'first' ? 'bottom-right' : 'bottom-left'}
      />
    </span>
  )

  const capsuleClassName = cn(
    'flex h-12 w-full max-w-36 min-w-0 items-center gap-1 rounded-full border border-border/80 p-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
    side === 'first' ? 'pl-2' : 'pr-2',
    !reporter && 'border-dashed border-muted-foreground/40',
  )
  const capsuleContent = (
    <>
      {side === 'first' ? (
        <>
          {history}
          {avatar}
        </>
      ) : (
        <>
          {avatar}
          {history}
        </>
      )}
    </>
  )

  if (!reporter || !profileHref) {
    return <div className={capsuleClassName}>{capsuleContent}</div>
  }

  const capsule = (
    <Link
      href={profileHref as any}
      aria-label={displayName}
      title={displayName}
      className={cn(capsuleClassName, 'transition-opacity hover:opacity-80')}
    >
      {capsuleContent}
    </Link>
  )

  return (
    <Tooltip>
      <TooltipTrigger render={capsule} />
      <TooltipContent>{resolvedHistoryLabel}</TooltipContent>
    </Tooltip>
  )
}

function ResolutionReporterComparison({
  firstReporter,
  secondReporter,
  correctLabel,
  incorrectLabel,
  historyLabel,
  firstReporterMuted = false,
  secondReporterMuted = false,
  firstReporterRewardAmount = null,
  secondReporterRewardAmount = null,
  rewardLabel,
}: {
  firstReporter: ResolutionReporter | null
  secondReporter: ResolutionReporter | null
  correctLabel: string
  incorrectLabel: string
  historyLabel: (reporter: ResolutionReporter) => string
  firstReporterMuted?: boolean
  secondReporterMuted?: boolean
  firstReporterRewardAmount?: string | null
  secondReporterRewardAmount?: string | null
  rewardLabel: string
}) {
  return (
    <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-4 sm:gap-x-6">
      <div className="flex min-w-0 justify-end">
        <ResolutionReporterCapsule
          reporter={firstReporter}
          side="first"
          muted={firstReporterMuted}
          rewardAmount={firstReporterRewardAmount}
          rewardLabel={rewardLabel}
          correctLabel={correctLabel}
          incorrectLabel={incorrectLabel}
          historyLabel={historyLabel}
        />
      </div>
      <span className="pointer-events-none text-xl leading-none font-medium text-muted-foreground" aria-hidden>
        ×
      </span>
      <div className="flex min-w-0 justify-start">
        <ResolutionReporterCapsule
          reporter={secondReporter}
          side="second"
          muted={secondReporterMuted}
          rewardAmount={secondReporterRewardAmount}
          rewardLabel={rewardLabel}
          correctLabel={correctLabel}
          incorrectLabel={incorrectLabel}
          historyLabel={historyLabel}
        />
      </div>
    </div>
  )
}

export default function DirectResolutionButton({
  market,
  event,
  resolutionSourceLabel = null,
  onResolutionRewardAmountChange,
}: DirectResolutionButtonProps) {
  const t = useExtracted()
  const user = useUser()
  const { address } = useAppKitAccount({ namespace: 'eip155' })
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const { signTypedDataAsync } = useSignTypedData()
  const { polygonRpcUrl } = usePublicRuntimeConfig()
  const { runWithSignaturePrompt } = useSignaturePromptRunner()
  const isDirect = isDirectResolutionMarket(market)
  const reportSummaryAdapterAddress = getDirectResolutionAdapterAddress(market)
  const { adapterQuestionId: reportSummaryAdapterQuestionId } = getDirectResolutionQuestionIds(market)
  const reportSummaryIdentityKey = [
    user?.id,
    user?.address?.toLowerCase(),
    user?.deposit_wallet_address?.toLowerCase(),
    user?.deposit_wallet_status,
  ].join(':')
  const reportSummaryScopeKey = `${market.condition_id}:${reportSummaryAdapterAddress ?? ''}:${reportSummaryAdapterQuestionId ?? ''}:${reportSummaryIdentityKey}`
  const viemRpcUrls = useMemo(() => resolveViemRpcUrls(polygonRpcUrl), [polygonRpcUrl])
  const unknownCheckboxId = useId()
  const rulesCheckboxId = useId()
  const sourceCheckboxId = useId()
  const rulesConfirmationRef = useRef<HTMLLabelElement>(null)
  const sourceConfirmationRef = useRef<HTMLLabelElement>(null)
  const resolutionRewardAmountChangeRef = useRef(onResolutionRewardAmountChange)
  const activeReportSummaryScopeKeyRef = useRef(reportSummaryScopeKey)
  const reportSummaryRequestRef = useRef<ResolutionReportSummaryRequest | null>(null)
  const reportSummaryRequestIdRef = useRef(0)
  const reportSummaryCacheRef = useRef<ResolutionReportSummaryCache | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [selectedOutcome, setSelectedOutcome] = useState<DirectResolutionOutcome | null>(null)
  const [rulesConfirmed, setRulesConfirmed] = useState(false)
  const [rulesAcceptancePrompted, setRulesAcceptancePrompted] = useState(false)
  const [sourceConfirmed, setSourceConfirmed] = useState(false)
  const [state, setState] = useState<DirectResolutionState>('idle')
  const [message, setMessage] = useState('')
  const [reportSummaryLoading, setReportSummaryLoading] = useState(false)
  const [reportSummaryState, setReportSummary] = useState<ResolutionReportSummary>(createEmptyResolutionReportSummary)
  const [reportSummaryStateScopeKey, setReportSummaryStateScopeKey] = useState(reportSummaryScopeKey)
  const reportSummary =
    reportSummaryStateScopeKey === reportSummaryScopeKey ? reportSummaryState : createEmptyResolutionReportSummary()
  const reportSummaryRef = useRef(reportSummary)

  const resolutionSource = getResolutionSource(market)
  const resolutionSourceUrl = getResolutionSourceUrl(market)
  const resolutionQuestion = market.question?.trim() || market.title
  const normalizedEventTitle = normalizeLabel(event.title)
  const reviewMarketLabel = [market.short_title, market.title, market.question]
    .map((label) => label?.trim())
    .find((label) => label && normalizeLabel(label) !== normalizedEventTitle)
  const shouldShowReviewMarket = Boolean(
    (market.neg_risk ||
      event.enable_neg_risk ||
      event.neg_risk ||
      event.neg_risk_augmented ||
      event.neg_risk_market_id) &&
    reviewMarketLabel,
  )
  const normalizedResolutionQuestion = normalizeLabel(resolutionQuestion)
  const shouldShowResolutionQuestion =
    Boolean(normalizedResolutionQuestion) &&
    normalizedResolutionQuestion !== normalizeLabel(event.title) &&
    normalizedResolutionQuestion !== normalizeLabel(market.title)
  const requiresSourceConfirmation = Boolean(resolutionSource)
  const connectedAddress = address && isAddress(address) ? (getAddress(address) as Address) : null
  const authenticatedAddress = user?.address && isAddress(user.address) ? getAddress(user.address) : null
  const resolutionActorAddress = resolveResolutionActorAddress(connectedAddress, authenticatedAddress)
  const resolutionAccessScopeKey = `${reportSummaryScopeKey}:${connectedAddress ?? ''}:${event.creator}`
  const activeResolutionAccessScopeKeyRef = useRef(resolutionAccessScopeKey)
  const checkedResolutionAccessScopeKeyRef = useRef<string | null>(null)
  const [resolutionAccessState, setResolutionAccessState] = useState<{
    scopeKey: string | null
    value: boolean | null
  }>({ scopeKey: null, value: null })

  useEffect(
    function syncResolutionRewardAmountChangeRef() {
      resolutionRewardAmountChangeRef.current = onResolutionRewardAmountChange
    },
    [onResolutionRewardAmountChange],
  )
  useEffect(
    function syncActiveResolutionAccessScopeKeyRef() {
      activeResolutionAccessScopeKeyRef.current = resolutionAccessScopeKey
    },
    [resolutionAccessScopeKey],
  )
  const hasDeployedDepositWallet = Boolean(user?.deposit_wallet_address && user.deposit_wallet_status === 'deployed')
  const isResolved = Boolean(market.is_resolved || market.condition?.resolved)
  const liveYesPrice = useOutcomeTopOfBookPrice(OUTCOME_INDEX.YES, undefined, {
    market,
    enabled: isDirect && !isResolved,
  })
  const liveNoPrice = useOutcomeTopOfBookPrice(OUTCOME_INDEX.NO, undefined, {
    market,
    enabled: isDirect && !isResolved,
  })
  const resolvedWinningOutcomeIndex = isResolved ? resolveWinningOutcomeIndex(market) : null
  const resolvedWinningOutcome =
    resolvedWinningOutcomeIndex === OUTCOME_INDEX.YES
      ? ('yes' as const)
      : resolvedWinningOutcomeIndex === OUTCOME_INDEX.NO
        ? ('no' as const)
        : null
  const isResolvedInconclusive = isResolved && isUnknownFiftyFiftyResolvedMarket(market)
  const scopedResolutionAccess =
    resolutionAccessState.scopeKey === resolutionAccessScopeKey ? resolutionAccessState.value : null
  const isProposalOnly = scopedResolutionAccess === false
  const {
    balance: depositWalletBalance,
    isLoadingBalance: isLoadingDepositWalletBalance,
    isBalanceError: isDepositWalletBalanceError,
    refetchBalance: refetchDepositWalletBalance,
  } = useBalance({ enabled: isProposalOnly && hasDeployedDepositWallet })
  const hasExistingProposal = isProposalOnly && reportSummary.currentOutcome !== null
  const canAttemptSubmit = Boolean(
    isDirect &&
    selectedOutcome &&
    state !== 'checking' &&
    state !== 'pending' &&
    state !== 'submitted' &&
    state !== 'missing_request' &&
    scopedResolutionAccess !== null &&
    (scopedResolutionAccess
      ? connectedAddress && publicClient && walletClient
      : !reportSummaryLoading &&
        reportSummary.eligibility === 'eligible' &&
        reportSummary.rewardEnabled &&
        Boolean(authenticatedAddress) &&
        hasDeployedDepositWallet) &&
    !isResolved,
  )
  const canSubmit = Boolean(canAttemptSubmit && rulesConfirmed && (!requiresSourceConfirmation || sourceConfirmed))

  const outcomeOptions = useMemo(() => {
    const yesLabel = getOutcomeLabel(market, OUTCOME_INDEX.YES, t('Yes'))
    const noLabel = getOutcomeLabel(market, OUTCOME_INDEX.NO, t('No'))
    const teams = event.sports_teams ?? []
    const logoUrls = event.sports_team_logo_urls ?? []

    function resolveImageUrl(label: string) {
      const normalizedOutcomeLabel = normalizeLabel(label)
      const teamIndex = teams.findIndex((team) => {
        const normalizedName = normalizeLabel(team.name)
        const normalizedAbbreviation = normalizeLabel(team.abbreviation)
        return (
          Boolean(normalizedOutcomeLabel) &&
          (normalizedOutcomeLabel === normalizedName ||
            normalizedOutcomeLabel === normalizedAbbreviation ||
            (Boolean(normalizedName) && normalizedOutcomeLabel.includes(normalizedName)))
        )
      })
      if (teamIndex >= 0) {
        return teams[teamIndex]?.logo_url?.trim() || logoUrls[teamIndex]?.trim() || null
      }

      return null
    }

    function resolveTeamColor(label: string) {
      const normalizedOutcomeLabel = normalizeLabel(label)
      const team = teams.find((candidate) => {
        const normalizedName = normalizeLabel(candidate.name)
        const normalizedAbbreviation = normalizeLabel(candidate.abbreviation)
        return normalizedOutcomeLabel === normalizedName || normalizedOutcomeLabel === normalizedAbbreviation
      })
      return normalizeAccentColor(team?.color)
    }

    const base = [
      {
        value: 'yes' as const,
        label: yesLabel,
        outcomeIndex: OUTCOME_INDEX.YES,
        price: liveYesPrice,
        imageUrl: resolveImageUrl(yesLabel),
        accentColor: resolveTeamColor(yesLabel),
      },
      {
        value: 'no' as const,
        label: noLabel,
        outcomeIndex: OUTCOME_INDEX.NO,
        price: liveNoPrice,
        imageUrl: resolveImageUrl(noLabel),
        accentColor: resolveTeamColor(noLabel),
      },
    ]
    return base
  }, [event.sports_team_logo_urls, event.sports_teams, liveNoPrice, liveYesPrice, market, t])
  const showOutcomeImages = outcomeOptions.every((option) => Boolean(option.imageUrl))
  const selectedOutcomeOption = outcomeOptions.find((option) => option.value === selectedOutcome) ?? null
  const bondAmount = parseUsdcAmount(reportSummary.bond)
  const hasInsufficientBondBalance = Boolean(
    isProposalOnly &&
    !isLoadingDepositWalletBalance &&
    !isDepositWalletBalanceError &&
    bondAmount !== null &&
    depositWalletBalance.raw < bondAmount,
  )
  const formattedBond = formatUsdcAmount(reportSummary.bond)
  const formattedReward = formatUsdcAmount(reportSummary.rewardPool)
  const resolvedRewardPool = isResolved ? formatResolutionRewardAmount(reportSummary.rewardPool) : null
  const hasAnyResolutionProposal =
    reportSummary.reporters.length > 0 || Object.values(reportSummary.outcomeCounts).some((count) => count > 0)
  const firstOutcomeReporter =
    reportSummary.reporters.find((reporter) => reporter.outcome === outcomeOptions[0]?.value) ?? null
  const secondOutcomeReporter =
    reportSummary.reporters.find((reporter) => reporter.outcome === outcomeOptions[1]?.value) ?? null
  const formattedCorrectReturn = formatUsdcTotal(reportSummary.bond, reportSummary.rewardPool)
  const selectedOutcomeAccentColor = selectedOutcomeOption
    ? selectedOutcomeOption.accentColor || (selectedOutcomeOption.value === 'yes' ? 'var(--yes)' : 'var(--no)')
    : undefined
  const selectedOutcomeLabel =
    selectedOutcome === 'unknown' ? t('Inconclusive result') : (selectedOutcomeOption?.label ?? '')
  const selectedOutcomePercentage =
    selectedOutcome === 'unknown' ? formatOutcomePercentage(0.5) : formatOutcomePercentage(selectedOutcomeOption?.price)

  function resolutionReporterHistoryLabel(reporter: ResolutionReporter) {
    return t("{username}'s proposal history: {correct} correct and {incorrect} incorrect.", {
      username: getResolutionReporterDisplayName(reporter),
      correct: String(reporter.historyCorrectCount),
      incorrect: String(reporter.historyIncorrectCount),
    })
  }

  function handlePrimaryAction() {
    if (!canAttemptSubmit) {
      return
    }

    if (!rulesConfirmed) {
      setRulesAcceptancePrompted(true)
      rulesConfirmationRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
      return
    }

    if (requiresSourceConfirmation && !sourceConfirmed) {
      sourceConfirmationRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
      return
    }

    if (!canSubmit) {
      return
    }

    setReviewOpen(true)
  }

  function getUserFacingResolutionError(error: unknown) {
    const message = readDirectResolutionError(error)

    if (message === 'Connected proposer wallet needs POL for gas before resolving this market.') {
      return t('Connected proposer wallet needs POL for gas before resolving this market.')
    }
    if (message === 'Transaction could not be sent because the gas fee is below the current network minimum.') {
      return t('Transaction could not be sent because the gas fee is below the current network minimum.')
    }
    if (message === 'Wallet signature was rejected.') {
      return t('Wallet signature was rejected.')
    }
    if (message === 'You are not allowed to propose a result for this market.') {
      return t('You are not allowed to propose a result for this market.')
    }
    if (message === 'This market is already resolved.') {
      return t('This market is already resolved.')
    }
    if (message === 'Resolution rewards are not available for this market.') {
      return t('Resolution rewards are not available for this market.')
    }
    return t('Could not submit resolution.')
  }

  function getUserFacingResolutionReportError(error: unknown) {
    if (error instanceof Error && error.message === WALLET_CONNECTOR_NOT_CONNECTED_MESSAGE) {
      return t('Your wallet connection expired. Reconnect your wallet and try again.')
    }
    const message = readDirectResolutionError(error)
    if (message === 'Wallet signature was rejected.') {
      return t('Wallet signature was rejected.')
    }
    if (message === 'This market is already resolved.') {
      return t('This market is already resolved.')
    }
    if (message === 'Resolution rewards are not available for this market.') {
      return t('Resolution rewards are not available for this market.')
    }
    return t('Could not submit resolution proposal.')
  }

  const checkWhitelist = useCallback(async () => {
    const accessScopeKey = resolutionAccessScopeKey
    if (!resolutionActorAddress) {
      setResolutionAccessState({ scopeKey: accessScopeKey, value: false })
      setState('not_whitelisted')
      setMessage('')
      return false
    }
    if (!isAddress(event.creator)) {
      setResolutionAccessState({ scopeKey: accessScopeKey, value: false })
      setState('not_whitelisted')
      setMessage('')
      return false
    }

    setResolutionAccessState({ scopeKey: accessScopeKey, value: null })
    setState('checking')
    setMessage('')
    try {
      const status = await readCreatorProposerWhitelistStatus({
        creator: getAddress(event.creator) as Address,
        rpcUrls: viemRpcUrls,
      })
      if (activeResolutionAccessScopeKeyRef.current !== accessScopeKey) {
        return null
      }
      const isAllowed = status.proposers.some(
        (proposer) => proposer.toLowerCase() === resolutionActorAddress.toLowerCase(),
      )
      if (!status.whitelistAddress || !isAllowed) {
        setResolutionAccessState({ scopeKey: accessScopeKey, value: false })
        setState('not_whitelisted')
        setMessage('')
        return false
      }
      setResolutionAccessState({ scopeKey: accessScopeKey, value: true })
      setState('idle')
      return true
    } catch (error) {
      if (activeResolutionAccessScopeKeyRef.current !== accessScopeKey) {
        return null
      }
      console.error('Direct resolution whitelist check failed:', error)
      setResolutionAccessState({ scopeKey: accessScopeKey, value: null })
      setState('permission_check_error')
      setMessage(t('Could not check your resolution permission. Try again.'))
      return null
    }
  }, [event.creator, resolutionAccessScopeKey, resolutionActorAddress, t, viemRpcUrls])

  const loadReportSummary = useCallback(
    ({ preserveEligibilityOnError = false } = {}): Promise<void> => {
      if (activeReportSummaryScopeKeyRef.current !== reportSummaryScopeKey) {
        return Promise.resolve()
      }

      const cachedSummary = reportSummaryCacheRef.current
      if (
        cachedSummary?.scopeKey === reportSummaryScopeKey &&
        Date.now() - cachedSummary.loadedAt < RESOLUTION_REPORT_SUMMARY_FRESHNESS_MS
      ) {
        const currentSummary = reportSummaryRef.current
        resolutionRewardAmountChangeRef.current?.(
          currentSummary.rewardEnabled ? formatResolutionRewardAmount(currentSummary.rewardPool) : null,
        )
        if (currentSummary.currentOutcome) {
          setSelectedOutcome((current) => current ?? currentSummary.currentOutcome)
        }
        return Promise.resolve()
      }

      const activeRequest = reportSummaryRequestRef.current
      if (activeRequest?.scopeKey === reportSummaryScopeKey && !activeRequest.controller.signal.aborted) {
        return activeRequest.promise
      }
      activeRequest?.controller.abort()

      const requestId = ++reportSummaryRequestIdRef.current
      const controller = new AbortController()
      function isCurrentRequest() {
        return !controller.signal.aborted && activeReportSummaryScopeKeyRef.current === reportSummaryScopeKey
      }

      setReportSummaryLoading(true)
      const promise = Promise.resolve().then(async () => {
        try {
          if (!publicClient) {
            throw new Error('Public client is unavailable.')
          }
          if (!reportSummaryAdapterAddress || !reportSummaryAdapterQuestionId) {
            throw new Error('Reward request is unavailable.')
          }
          const question = normalizeQuestionData(
            await publicClient.readContract({
              address: reportSummaryAdapterAddress,
              abi: CTF_ADAPTER_QUESTION_ABI,
              functionName: 'getQuestion',
              args: [reportSummaryAdapterQuestionId],
            }),
          )
          if (!isCurrentRequest()) {
            return
          }
          if (!question?.ancillaryData || question.ancillaryData === '0x') {
            throw new Error('Reward request is unavailable.')
          }
          const marketId = getResolutionRewardMarketId(reportSummaryAdapterAddress, question.ancillaryData)
          const searchParams = new URLSearchParams({ conditionId: market.condition_id, marketId })
          const response = await fetch(`/api/resolution-reports?${searchParams.toString()}`, {
            cache: 'no-store',
            signal: controller.signal,
          })
          if (!response.ok) {
            throw new Error(`Resolution report summary failed with ${response.status}.`)
          }
          let summary = (await response.json()) as ResolutionReportSummary
          if (!isCurrentRequest()) {
            return
          }

          const pendingReport = readPendingResolutionReport(reportSummaryScopeKey)
          if (pendingReport) {
            const pendingWallet = pendingReport.reporter.wallet?.toLowerCase()
            const pendingReporterIndexed = summary.reporters.some((reporter) => {
              const reporterWallet = reporter.wallet?.toLowerCase() ?? reporter.seed.toLowerCase()
              return pendingWallet ? reporterWallet === pendingWallet : reporter.seed === pendingReport.reporter.seed
            })
            if (summary.currentOutcome && summary.currentOutcome !== pendingReport.outcome) {
              clearPendingResolutionReport(reportSummaryScopeKey)
            } else if (pendingReporterIndexed) {
              clearPendingResolutionReport(reportSummaryScopeKey)
            } else {
              summary = mergePendingResolutionReport(summary, pendingReport)
            }
          }

          reportSummaryRef.current = summary
          reportSummaryCacheRef.current = { scopeKey: reportSummaryScopeKey, loadedAt: Date.now() }
          setReportSummary(summary)
          resolutionRewardAmountChangeRef.current?.(
            summary.rewardEnabled ? formatResolutionRewardAmount(summary.rewardPool) : null,
          )
          if (summary.currentOutcome) {
            setSelectedOutcome((current) => current ?? summary.currentOutcome)
          }
        } catch (error) {
          if (!isCurrentRequest()) {
            return
          }
          console.error('Could not load resolution report summary:', error)
          resolutionRewardAmountChangeRef.current?.(null)
          if (!preserveEligibilityOnError) {
            setReportSummary((current) => ({ ...current, eligibility: 'unavailable' }))
          }
        } finally {
          if (reportSummaryRequestRef.current?.id === requestId) {
            reportSummaryRequestRef.current = null
            if (activeReportSummaryScopeKeyRef.current === reportSummaryScopeKey) {
              setReportSummaryLoading(false)
            }
          }
        }
      })

      reportSummaryRequestRef.current = {
        id: requestId,
        scopeKey: reportSummaryScopeKey,
        controller,
        promise,
      }
      return promise
    },
    [
      market.condition_id,
      publicClient,
      reportSummaryAdapterAddress,
      reportSummaryAdapterQuestionId,
      reportSummaryScopeKey,
    ],
  )

  // Market/account scope changes invalidate async external state and its in-flight request as one lifecycle.
  useEffect(() => {
    const scopeChanged = activeReportSummaryScopeKeyRef.current !== reportSummaryScopeKey
    activeReportSummaryScopeKeyRef.current = reportSummaryScopeKey
    const activeRequest = reportSummaryRequestRef.current
    if (activeRequest && (scopeChanged || activeRequest.scopeKey !== reportSummaryScopeKey)) {
      activeRequest.controller.abort()
      reportSummaryRequestRef.current = null
    }
    if (scopeChanged || reportSummaryCacheRef.current?.scopeKey !== reportSummaryScopeKey) {
      reportSummaryCacheRef.current = null
    }

    if (scopeChanged) {
      const emptySummary = createEmptyResolutionReportSummary()
      reportSummaryRef.current = emptySummary
      queueMicrotask(() => {
        setReportSummaryStateScopeKey(reportSummaryScopeKey)
        setReportSummary(emptySummary)
        setReportSummaryLoading(false)
        setSelectedOutcome(null)
        setRulesConfirmed(false)
        setRulesAcceptancePrompted(false)
        setSourceConfirmed(false)
        setReviewOpen(false)
      })
    }

    resolutionRewardAmountChangeRef.current?.(null)

    return () => {
      const currentRequest = reportSummaryRequestRef.current
      if (currentRequest?.scopeKey === reportSummaryScopeKey) {
        currentRequest.controller.abort()
        reportSummaryRequestRef.current = null
      }
    }
  }, [reportSummaryScopeKey])

  // A confirmed proposal may precede Data API indexing. Restore it across refreshes until
  // the authoritative summary includes the reporter.
  useEffect(() => {
    const pendingReport = readPendingResolutionReport(reportSummaryScopeKey)
    if (!pendingReport) {
      return
    }

    queueMicrotask(() => {
      setSelectedOutcome(pendingReport.outcome)
      setReportSummary((current) => {
        const nextSummary = mergePendingResolutionReport(current, pendingReport)
        reportSummaryRef.current = nextSummary
        return nextSummary
      })
    })
  }, [reportSummaryScopeKey])

  useEffect(() => {
    if (!isDirect || !publicClient) {
      return
    }
    if (isResolved) {
      resolutionRewardAmountChangeRef.current?.(null)
    }

    void loadReportSummary({ preserveEligibilityOnError: true })
  }, [isDirect, isResolved, loadReportSummary, publicClient])

  async function checkResolutionAccess() {
    const allowed = await checkWhitelist()
    await loadReportSummary({ preserveEligibilityOnError: allowed === true })
    return allowed
  }

  // Permission is remote state that must stay synchronized with the active wallet identity.
  useLayoutEffect(() => {
    if (!isDirect || isResolved || checkedResolutionAccessScopeKeyRef.current === resolutionAccessScopeKey) {
      return
    }
    checkedResolutionAccessScopeKeyRef.current = resolutionAccessScopeKey
    queueMicrotask(() => void checkWhitelist())
  }, [checkWhitelist, isDirect, isResolved, resolutionAccessScopeKey])

  async function submitResolutionReport() {
    if (isDepositWalletBalanceError) {
      toast.error(t('Could not validate USDC balance right now.'))
      return
    }
    if (hasInsufficientBondBalance) {
      toast.error(t('Insufficient USDC balance'))
      return
    }
    if (isLoadingDepositWalletBalance) {
      return
    }
    if (
      !authenticatedAddress ||
      !user?.address ||
      !user.deposit_wallet_address ||
      user.deposit_wallet_status !== 'deployed' ||
      !selectedOutcome ||
      selectedOutcome === 'unknown' ||
      !reportSummary.marketId
    ) {
      toast.error(t('Could not submit resolution proposal.'))
      return
    }

    setState('pending')
    setMessage('')
    try {
      const bond = BigInt(reportSummary.bond)
      const calls = [
        {
          target: COLLATERAL_TOKEN_ADDRESS,
          value: '0',
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [RESOLUTION_REWARDS_ADDRESS, bond],
          }),
        },
        {
          target: RESOLUTION_REWARDS_ADDRESS,
          value: '0',
          data: encodeFunctionData({
            abi: RESOLUTION_REWARDS_ABI,
            functionName: 'submitProposal',
            args: [reportSummary.marketId, RESOLUTION_REWARD_SIDE[selectedOutcome]],
          }),
        },
      ]
      await runWithSignaturePrompt(
        async () => {
          const result = await signAndSubmitDepositWalletCalls({
            user,
            calls,
            metadata: 'resolution_reward_proposal',
            signTypedDataAsync,
          })
          if (result.error) {
            if (result.code === 'wallet_connector_not_connected') {
              throw new WalletConnectorNotConnectedError()
            }
            throw new Error(result.error)
          }
          return result
        },
        {
          title: t('Confirm resolution proposal'),
          description: t('Sign once to deposit the bond and submit your proposal.'),
        },
      )
      setReviewOpen(false)
      setState('submitted')
      setMessage('')
      setReportSummary((current) => {
        const optimisticReporter = {
          seed: user.deposit_wallet_address!,
          wallet: user.deposit_wallet_address!,
          username: user.username,
          image: user.image ?? '',
          outcome: selectedOutcome,
          rewardAmount: '0',
          historyCorrectCount: current.currentReporterHistory?.correctCount ?? 0,
          historyIncorrectCount: current.currentReporterHistory?.incorrectCount ?? 0,
        }
        const nextSummary = {
          ...current,
          currentOutcome: selectedOutcome,
          outcomeCounts: { ...current.outcomeCounts, [selectedOutcome]: 1 },
          reporters: [
            ...current.reporters.filter((reporter) => reporter.outcome !== selectedOutcome),
            optimisticReporter,
          ],
        }
        writePendingResolutionReport(reportSummaryScopeKey, {
          savedAt: Date.now(),
          outcome: selectedOutcome,
          reporter: optimisticReporter,
        })
        reportSummaryRef.current = nextSummary
        reportSummaryCacheRef.current = { scopeKey: reportSummaryScopeKey, loadedAt: Date.now() }
        return nextSummary
      })
      toast.success(t('Resolution proposal submitted.'))
    } catch (error) {
      console.error('Could not submit resolution report:', error)
      setState('error')
      const resolutionError = readDirectResolutionError(error)
      const errorMessage = getUserFacingResolutionReportError(error)
      if (
        resolutionError === 'This market is already resolved.' ||
        resolutionError === 'Resolution rewards are not available for this market.'
      ) {
        const unavailableSummary = {
          ...reportSummaryRef.current,
          rewardEnabled: false,
          eligibility: 'ineligible' as const,
        }
        reportSummaryRef.current = unavailableSummary
        reportSummaryCacheRef.current = { scopeKey: reportSummaryScopeKey, loadedAt: Date.now() }
        setReportSummary(unavailableSummary)
        setReviewOpen(false)
        resolutionRewardAmountChangeRef.current?.(null)
      }
      setMessage(errorMessage)
      toast.error(errorMessage)
    }
  }

  async function submitResolution() {
    if (!publicClient || !walletClient || !connectedAddress || !selectedOutcome) {
      toast.error(t('Wallet connection is not ready.'))
      return
    }

    if (scopedResolutionAccess !== true) {
      const allowed = await checkWhitelist()
      if (!allowed) {
        return
      }
    }

    const adapterAddress = getDirectResolutionAdapterAddress(market)
    const { adapterQuestionId, negRiskOperatorQuestionId } = getDirectResolutionQuestionIds(market)
    if (!adapterAddress || !adapterQuestionId || (market.neg_risk && !negRiskOperatorQuestionId)) {
      setState('missing_request')
      setMessage(t('This market is not ready for direct resolution yet.'))
      return
    }

    setState('pending')
    setMessage('')
    try {
      const question = normalizeQuestionData(
        await publicClient.readContract({
          address: adapterAddress,
          abi: CTF_ADAPTER_QUESTION_ABI,
          functionName: 'getQuestion',
          args: [adapterQuestionId],
        }),
      )

      if (!question || question.requestTimestamp === 0n || question.ancillaryData === '0x') {
        setState('missing_request')
        setMessage(t('This market is not ready for direct resolution yet.'))
        return
      }

      if (question.resolved) {
        setState('resolved')
        setMessage(t('This market is already resolved.'))
        setReviewOpen(false)
        return
      }

      const proposedPrice = getDirectResolutionPrice(selectedOutcome)
      const gas = await estimateResolutionGas({
        adapterAddress,
        adapterQuestionId,
        ancillaryData: question.ancillaryData,
        connectedAddress,
        negRiskOperatorQuestionId,
        proposedPrice,
        requestTimestamp: question.requestTimestamp,
      })
      const hash = await runWithSignaturePrompt(
        () =>
          sendWithEstimatedFeeRetry({
            chainId: walletClient.chain?.id ?? DEFAULT_CHAIN_ID,
            client: publicClient,
            send: (overrides) =>
              writeResolutionTransaction({
                adapterAddress,
                adapterQuestionId,
                ancillaryData: question.ancillaryData,
                connectedAddress,
                gas,
                negRiskOperatorQuestionId,
                overrides,
                proposedPrice,
                requestTimestamp: question.requestTimestamp,
              }),
          }),
        {
          title: t('Submit final result'),
          description: t('Open your wallet and approve the final result transaction.'),
        },
      )

      setMessage(t('Confirming transaction...'))
      await publicClient.waitForTransactionReceipt({ hash })
      setReviewOpen(false)
      setState('submitted')
      setMessage(t('Result submitted. The market will update shortly.'))
      toast.success(t('Resolution submitted.'))
    } catch (error) {
      console.error('Direct resolution failed:', error)
      setState('error')
      setMessage(getUserFacingResolutionError(error))
    }
  }

  async function estimateResolutionGas(input: {
    adapterAddress: Address
    adapterQuestionId: Hex
    ancillaryData: Hex
    connectedAddress: Address
    negRiskOperatorQuestionId: Hex | null
    proposedPrice: bigint
    requestTimestamp: bigint
  }) {
    try {
      const estimatedGas = market.neg_risk
        ? await publicClient?.estimateContractGas({
            account: input.connectedAddress,
            address: getDirectResolutionOracleAddress(),
            abi: DIRECT_RESOLUTION_ORACLE_ABI,
            functionName: 'proposeAndResolveNegRisk',
            args: [
              input.adapterAddress,
              getDirectResolutionNegRiskOperatorAddress(),
              input.adapterQuestionId,
              input.negRiskOperatorQuestionId as Hex,
              YES_OR_NO_IDENTIFIER,
              input.requestTimestamp,
              input.ancillaryData,
              input.proposedPrice,
            ],
          })
        : await publicClient?.estimateContractGas({
            account: input.connectedAddress,
            address: getDirectResolutionOracleAddress(),
            abi: DIRECT_RESOLUTION_ORACLE_ABI,
            functionName: 'proposeAndResolve',
            args: [
              input.adapterAddress,
              input.adapterQuestionId,
              YES_OR_NO_IDENTIFIER,
              input.requestTimestamp,
              input.ancillaryData,
              input.proposedPrice,
            ],
          })

      return estimatedGas ? addWalletTransactionGasBuffer(estimatedGas) : undefined
    } catch (error) {
      console.warn('Could not estimate direct resolution gas:', error)
      return undefined
    }
  }

  function writeResolutionTransaction(input: {
    adapterAddress: Address
    adapterQuestionId: Hex
    ancillaryData: Hex
    connectedAddress: Address
    gas: bigint | undefined
    negRiskOperatorQuestionId: Hex | null
    overrides?: FeeOverrides
    proposedPrice: bigint
    requestTimestamp: bigint
  }) {
    return market.neg_risk
      ? walletClient!.writeContract({
          account: input.connectedAddress,
          address: getDirectResolutionOracleAddress(),
          abi: DIRECT_RESOLUTION_ORACLE_ABI,
          functionName: 'proposeAndResolveNegRisk',
          args: [
            input.adapterAddress,
            getDirectResolutionNegRiskOperatorAddress(),
            input.adapterQuestionId,
            input.negRiskOperatorQuestionId as Hex,
            YES_OR_NO_IDENTIFIER,
            input.requestTimestamp,
            input.ancillaryData,
            input.proposedPrice,
          ],
          gas: input.gas,
          ...(input.overrides ?? {}),
        })
      : walletClient!.writeContract({
          account: input.connectedAddress,
          address: getDirectResolutionOracleAddress(),
          abi: DIRECT_RESOLUTION_ORACLE_ABI,
          functionName: 'proposeAndResolve',
          args: [
            input.adapterAddress,
            input.adapterQuestionId,
            YES_OR_NO_IDENTIFIER,
            input.requestTimestamp,
            input.ancillaryData,
            input.proposedPrice,
          ],
          gas: input.gas,
          ...(input.overrides ?? {}),
        })
  }

  if (!isDirect) {
    return null
  }

  const proposalHeader = (
    <div className="grid gap-2">
      <div>
        <h4 className="text-base font-semibold text-foreground">
          {isResolved ? t('Final resolution') : t('Propose resolution')}
        </h4>
        {!isResolved && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {isProposalOnly
              ? t('Propose the outcome once it can be verified. Earn the reward if confirmed.')
              : t('The selected result is final after an approved proposer submits it.')}
          </p>
        )}
      </div>
      {!isResolved && isProposalOnly && reportSummary.rewardEnabled && (
        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1 text-xs font-medium text-foreground">
            <LockKeyholeIcon className="size-3.5" aria-hidden />
            {t('Bond at risk: {amount}', { amount: formattedBond })}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/20 bg-violet-500/5 px-2 py-1 text-xs font-medium text-violet-500">
            <GiftIcon className="size-3.5" aria-hidden />
            {t('Reward: {amount}', { amount: formattedReward })}
          </span>
        </div>
      )}
    </div>
  )

  const outcomePicker = (
    <div>
      {shouldShowResolutionQuestion && (
        <Label className="mb-3 block text-sm leading-snug font-semibold">{resolutionQuestion}</Label>
      )}

      <div className={cn(isResolved && 'mx-auto w-full max-w-xl')}>
        <div className={cn(isResolved && 'mx-auto w-fit max-w-full')}>
          <div
            className={cn(
              isResolved
                ? 'mx-auto grid w-fit max-w-full grid-cols-2 divide-x divide-border/80 overflow-hidden rounded-lg border border-border/80 bg-background'
                : 'grid grid-cols-2 gap-2',
            )}
          >
            {outcomeOptions.map((option) => {
              const selected = isResolved ? resolvedWinningOutcome === option.value : selectedOutcome === option.value
              const accentColor = option.accentColor || (option.value === 'yes' ? 'var(--yes)' : 'var(--no)')
              const outcomeContent = (
                <span className="inline-flex max-w-full min-w-0 items-center justify-center gap-1.5 sm:gap-2">
                  {isResolved && selected && <CheckIcon className="size-4 shrink-0" aria-hidden />}
                  {showOutcomeImages && (
                    <EventIconImage
                      src={option.imageUrl!}
                      alt={option.label}
                      sizes={isResolved ? '20px' : '28px'}
                      containerClassName={cn('shrink-0 rounded-md bg-muted', isResolved ? 'size-5' : 'size-7')}
                      imageClassName="object-contain"
                    />
                  )}
                  <span
                    className={cn(
                      'min-w-0 truncate leading-snug font-medium',
                      isResolved ? 'text-sm sm:text-base' : 'text-sm',
                      !isResolved && !selected && 'text-foreground',
                    )}
                    title={option.label}
                  >
                    {option.label}
                  </span>
                  {!isResolved && (
                    <span className="shrink-0 text-base font-bold tabular-nums">
                      {formatOutcomePercentage(option.price)}
                    </span>
                  )}
                </span>
              )

              if (isResolved) {
                return (
                  <div
                    key={option.value}
                    className={cn(
                      'flex min-h-10 w-36 items-center justify-center px-4 py-2 text-center sm:min-h-11 sm:w-48',
                      selected ? 'font-semibold' : 'text-muted-foreground',
                    )}
                    style={
                      selected
                        ? {
                            backgroundColor: `color-mix(in srgb, ${accentColor} 10%, transparent)`,
                            color: accentColor,
                          }
                        : undefined
                    }
                    aria-label={option.label}
                    aria-current={selected ? 'true' : undefined}
                  >
                    {outcomeContent}
                  </div>
                )
              }

              const outcomeClassName = cn(
                'flex min-h-12 w-full min-w-0 items-center justify-center rounded-lg bg-background p-2.5 text-center transition-[background-color,color,transform,filter]',
                selected ? 'border border-transparent text-white' : 'border',
                selected ? 'hover:brightness-95 active:translate-y-px' : 'hover:bg-muted/30 active:translate-y-px',
              )

              return (
                <div key={option.value} className="min-w-0">
                  <button
                    type="button"
                    className={outcomeClassName}
                    style={{ backgroundColor: selected ? accentColor : undefined }}
                    onClick={() => setSelectedOutcome(option.value)}
                    aria-pressed={selected}
                    disabled={
                      hasExistingProposal ||
                      (isProposalOnly && reportSummary.outcomeCounts[option.value] > 0 && !selected)
                    }
                  >
                    {outcomeContent}
                  </button>
                </div>
              )
            })}
          </div>

          {isResolved && !hasAnyResolutionProposal && resolvedRewardPool && resolvedWinningOutcome && (
            <div className="mt-2 grid grid-cols-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 justify-self-center rounded-md border border-violet-500/20 bg-violet-500/5 px-2 py-1 text-xs font-semibold text-violet-500',
                  resolvedWinningOutcome === outcomeOptions[0]?.value ? 'col-start-1' : 'col-start-2',
                )}
              >
                <GiftIcon className="size-3.5" aria-hidden />
                {t('{amount} not awarded', { amount: resolvedRewardPool })}
              </span>
            </div>
          )}
        </div>

        {isResolvedInconclusive && (
          <div className="mt-3 grid justify-items-center gap-3">
            <span
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2 text-sm font-semibold text-primary"
              role="status"
            >
              <CheckIcon className="size-4 shrink-0" aria-hidden />
              {t('Inconclusive result')}
            </span>
            {!hasAnyResolutionProposal && resolvedRewardPool && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/20 bg-violet-500/5 px-2 py-1 text-xs font-semibold text-violet-500">
                <GiftIcon className="size-3.5" aria-hidden />
                {t('{amount} not awarded', { amount: resolvedRewardPool })}
              </span>
            )}
          </div>
        )}

        {outcomeOptions.length >= 2 &&
          (reportSummary.outcomeCounts[outcomeOptions[0].value] > 0 ||
            reportSummary.outcomeCounts[outcomeOptions[1].value] > 0) && (
            <ResolutionReporterComparison
              firstReporter={firstOutcomeReporter}
              secondReporter={secondOutcomeReporter}
              correctLabel={t('Correct')}
              incorrectLabel={t('Incorrect')}
              historyLabel={resolutionReporterHistoryLabel}
              firstReporterMuted={Boolean(
                isResolved && resolvedWinningOutcome && outcomeOptions[0].value !== resolvedWinningOutcome,
              )}
              secondReporterMuted={Boolean(
                isResolved && resolvedWinningOutcome && outcomeOptions[1].value !== resolvedWinningOutcome,
              )}
              firstReporterRewardAmount={
                isResolved && outcomeOptions[0].value === resolvedWinningOutcome
                  ? formatResolutionRewardAmount(firstOutcomeReporter?.rewardAmount ?? '0')
                  : null
              }
              secondReporterRewardAmount={
                isResolved && outcomeOptions[1].value === resolvedWinningOutcome
                  ? formatResolutionRewardAmount(secondOutcomeReporter?.rewardAmount ?? '0')
                  : null
              }
              rewardLabel={t('Resolution reward')}
            />
          )}
      </div>

      {!isResolved && !market.neg_risk && scopedResolutionAccess === true && (
        <div>
          <details
            className={cn(
              'group mt-3 overflow-hidden rounded-lg border bg-background',
              selectedOutcome === 'unknown' && 'border-primary/50 bg-primary/5',
            )}
          >
            <summary className="flex cursor-pointer list-none items-center gap-2.5 p-3 text-sm font-medium marker:hidden">
              <span className="flex-1">{t('Inconclusive result')}</span>
              <ChevronDownIcon className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="border-t px-3 py-3">
              <p className="flex items-start gap-2 text-xs leading-relaxed text-orange-500">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  {t(
                    'Choose Inconclusive result only when the market cannot be resolved to either listed outcome. It splits the payout equally between both outcomes.',
                  )}
                </span>
              </p>
              <label htmlFor={unknownCheckboxId} className="mt-3 flex cursor-pointer items-center gap-2.5 text-sm">
                <Checkbox
                  id={unknownCheckboxId}
                  checked={selectedOutcome === 'unknown'}
                  onCheckedChange={(checked) => setSelectedOutcome(checked === true ? 'unknown' : null)}
                  disabled={hasExistingProposal}
                />
                <span>{t('Inconclusive result')}</span>
              </label>
            </div>
          </details>
          <ResolutionReporterStack
            reporters={reportSummary.reporters.filter((reporter) => reporter.outcome === 'unknown')}
            totalCount={reportSummary.outcomeCounts.unknown}
            showHistory={scopedResolutionAccess === true}
            correctLabel={t('Correct')}
            incorrectLabel={t('Incorrect')}
          />
        </div>
      )}
    </div>
  )

  const rulesConfirmation =
    !isResolved && !hasExistingProposal ? (
      <label
        ref={rulesConfirmationRef}
        htmlFor={rulesCheckboxId}
        className={cn(
          'flex cursor-pointer items-start gap-3 rounded-lg border bg-background px-4 py-3 text-sm transition-colors hover:bg-muted/20',
          rulesConfirmed && 'bg-primary/5',
        )}
      >
        <Checkbox
          id={rulesCheckboxId}
          checked={rulesConfirmed}
          onCheckedChange={(checked) => {
            const confirmed = checked === true
            setRulesConfirmed(confirmed)
            if (confirmed) {
              setRulesAcceptancePrompted(false)
            }
          }}
          className="mt-0.5"
        />
        <span className="min-w-0 flex-1 leading-relaxed">
          {t('I have read the market rules and will resolve according to them.')}
        </span>
      </label>
    ) : null

  const resolutionSourceReference = resolutionSourceUrl ? (
    <a
      href={resolutionSourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      className="inline-flex max-w-full items-center gap-1 align-baseline text-sm text-primary underline-offset-2 hover:underline"
      title={resolutionSource}
    >
      <span className="truncate">{resolutionSourceLabel || resolutionSource}</span>
      <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
    </a>
  ) : (
    <span className="text-sm text-muted-foreground" title={resolutionSource}>
      {resolutionSource}
    </span>
  )

  const sourceConfirmation =
    requiresSourceConfirmation && !isResolved && !hasExistingProposal ? (
      <label
        ref={sourceConfirmationRef}
        htmlFor={sourceCheckboxId}
        className={cn(
          'flex cursor-pointer items-start gap-3 rounded-lg border bg-background px-4 py-3 text-sm transition-colors hover:bg-muted/20',
          sourceConfirmed && 'bg-primary/5',
        )}
      >
        <Checkbox
          id={sourceCheckboxId}
          checked={sourceConfirmed}
          onCheckedChange={(checked) => setSourceConfirmed(checked === true)}
          className="mt-0.5 shrink-0"
        />
        <span className="min-w-0 flex-1 leading-relaxed">
          {t('I checked the final result at')} {resolutionSourceReference}
        </span>
      </label>
    ) : null

  const showProposalEligibilityMessage =
    !isResolved && isProposalOnly && !reportSummaryLoading && reportSummary.eligibility !== 'eligible'
  const proposalBody =
    showProposalEligibilityMessage || message ? (
      <div className="grid gap-3">
        {showProposalEligibilityMessage && (
          <p className="flex items-start gap-2 rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-sm text-orange-500">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {reportSummary.rewardEnabled
                ? t('A deployed Deposit Wallet is required to submit a proposal.')
                : t('Resolution rewards are not available for this market.')}
            </span>
          </p>
        )}

        {message && (
          <p
            className={cn(
              'rounded-lg border px-3 py-2 text-sm',
              state === 'error' || state === 'missing_request'
                ? 'border-destructive/30 bg-destructive/5 text-destructive'
                : 'text-muted-foreground',
            )}
          >
            {message}
          </p>
        )}
      </div>
    ) : null

  const proposalActions =
    !isResolved && !hasExistingProposal ? (
      <div className="grid w-full gap-3">
        {rulesAcceptancePrompted && !rulesConfirmed && (
          <p className="flex items-center justify-center gap-2 text-center text-sm text-orange-500">
            <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
            <span>{t('Accept the market rules to continue.')}</span>
          </p>
        )}
        <div className="flex w-full justify-end">
          {state === 'permission_check_error' ? (
            <Button type="button" onClick={() => void checkResolutionAccess()} className="sm:min-w-40">
              {t('Retry permission check')}
            </Button>
          ) : (
            <Button type="button" disabled={!canAttemptSubmit} onClick={handlePrimaryAction} className="sm:min-w-40">
              {state === 'pending' ? t('Submitting...') : t('Review proposal')}
            </Button>
          )}
        </div>
      </div>
    ) : null

  return (
    <>
      <section
        className={cn(
          'mt-5 grid gap-4 border-t pt-5',
          !isResolved && 'md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:items-start md:gap-6',
        )}
      >
        {proposalHeader}
        <section className="grid min-w-0 gap-3 rounded-xl border bg-muted/10 p-3 sm:p-4">
          {outcomePicker}
          {proposalBody}
          {!isResolved && selectedOutcome && !hasExistingProposal && (
            <div className="grid gap-3 border-t pt-3">
              {rulesConfirmation}
              {sourceConfirmation}
              {proposalActions}
            </div>
          )}
        </section>
      </section>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto pb-0 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('Review proposal')}</DialogTitle>
            <DialogDescription className="sr-only">
              {t('Review and confirm your resolution proposal.')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="flex min-w-0 items-center gap-3 rounded-xl border bg-muted/10 p-3 text-left">
              <div className="relative size-12 shrink-0 overflow-hidden rounded-lg border bg-background">
                {event.icon_url ? (
                  <EventIconImage src={event.icon_url} alt={event.title} sizes="48px" containerClassName="size-full" />
                ) : (
                  <div className="flex size-full items-center justify-center text-base font-semibold text-muted-foreground">
                    {event.title.slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-base leading-snug font-semibold text-foreground">{event.title}</p>
                {shouldShowReviewMarket && (
                  <div className="mt-1 flex min-w-0 items-baseline gap-1.5">
                    <span className="shrink-0 font-mono text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                      {t('Market')}
                    </span>
                    <span className="line-clamp-2 min-w-0 text-sm leading-snug font-medium text-foreground">
                      {reviewMarketLabel}
                    </span>
                  </div>
                )}
                {selectedOutcome && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      {t('Your proposal')}
                    </span>
                    <span
                      className="inline-flex shrink-0 items-center rounded-md px-2 py-1 text-xs font-semibold text-white"
                      style={{ backgroundColor: selectedOutcomeAccentColor ?? 'var(--primary)' }}
                    >
                      {selectedOutcomeLabel} {selectedOutcomePercentage}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {isProposalOnly ? (
              <>
                <div className="grid grid-cols-2 divide-x overflow-hidden rounded-lg border bg-muted/10">
                  <div className="min-w-0 px-3 py-2.5">
                    <p className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
                      {t('If correct')}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-base font-bold text-primary tabular-nums">
                      <GiftIcon className="size-4 shrink-0" aria-hidden />
                      {t('{amount} returned', { amount: formattedCorrectReturn })}
                    </p>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                      {t('{bond} bond + {reward} reward', { bond: formattedBond, reward: formattedReward })}
                    </p>
                  </div>
                  <div className="min-w-0 px-3 py-2.5">
                    <p className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
                      {t('If incorrect')}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-base font-bold text-foreground tabular-nums">
                      <CircleXIcon className="size-4 shrink-0 text-destructive" aria-hidden />
                      {t('{amount} lost', { amount: formattedBond })}
                    </p>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{t('Bond forfeited')}</p>
                  </div>
                </div>

                <p className="text-center text-xs leading-relaxed text-muted-foreground">
                  {t('You can submit only once per market and cannot change sides')}
                </p>
                {hasInsufficientBondBalance && (
                  <p className="flex items-center justify-center gap-2 rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-center text-sm font-semibold text-orange-500">
                    <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
                    {t('Insufficient USDC balance')}
                  </p>
                )}
                {isDepositWalletBalanceError && (
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-center text-sm font-semibold text-orange-500">
                    <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
                    <span>{t('Could not validate USDC balance right now.')}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isLoadingDepositWalletBalance}
                      onClick={() => void refetchDepositWalletBalance()}
                    >
                      {t('Retry')}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <p className="rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-sm leading-relaxed text-orange-500">
                {t('The selected result is final after an approved proposer submits it.')}
              </p>
            )}
          </div>
          <DialogFooter className="sticky bottom-0 z-10 -mx-6 border-t border-border/50 bg-background px-6 py-4">
            <Button type="button" variant="outline" onClick={() => setReviewOpen(false)}>
              {t('Back')}
            </Button>
            <Button
              type="button"
              onClick={() => void (isProposalOnly ? submitResolutionReport() : submitResolution())}
              disabled={
                state === 'pending' ||
                (isProposalOnly
                  ? !hasDeployedDepositWallet ||
                    isLoadingDepositWalletBalance ||
                    isDepositWalletBalanceError ||
                    hasInsufficientBondBalance
                  : !connectedAddress)
              }
            >
              {state === 'pending'
                ? t('Submitting...')
                : isProposalOnly
                  ? t('Lock {bond} and propose {outcome}', {
                      bond: formattedBond,
                      outcome: selectedOutcomeLabel,
                    })
                  : t('Submit final result')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
