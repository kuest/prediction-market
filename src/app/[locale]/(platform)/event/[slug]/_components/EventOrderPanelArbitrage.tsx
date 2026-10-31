'use client'

import { useAppKit, useAppKitAccount, useAppKitConnection, useAppKitState } from '@reown/appkit/react'
import { InfoIcon, TriangleAlertIcon, UnplugIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'
import Image from 'next/image'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAccount, useConnections } from 'wagmi'

import type { ArbitrageQuote } from '@/lib/arbitrage-quote'
import type { Event, Market } from '@/types'

import { useOrderBookSummaries } from '@/app/[locale]/(platform)/event/[slug]/_components/EventOrderBook'
import EventOrderPanelAnimatedCents from '@/app/[locale]/(platform)/event/[slug]/_components/EventOrderPanelAnimatedCents'
import EventOrderPanelSubmitButton from '@/app/[locale]/(platform)/event/[slug]/_components/EventOrderPanelSubmitButton'
import { AnimatedCounter } from '@/components/ui/animated-counter'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useHasHydrated } from '@/hooks/useHasHydrated'
import { useKuestFeeRate } from '@/hooks/useKuestFeeRate'
import { usePolymarketBalance } from '@/hooks/usePolymarketBalance'
import { usePolymarketMarketInfo } from '@/hooks/usePolymarketMarketInfo'
import { usePolymarketOrderBooks } from '@/hooks/usePolymarketOrderBooks'
import { useSiteIdentity } from '@/hooks/useSiteIdentity'
import { formatDisplayAmount, getAmountSizeClass, sanitizeNumericInput } from '@/lib/amount-input'
import {
  calculatePolymarketUnitCost,
  constrainArbitrageQuoteForPolymarketFok,
  findMinimumExecutableArbitrageQuote,
  scaleArbitrageQuote,
  selectBestArbitrageQuote,
} from '@/lib/arbitrage-quote'
import { OUTCOME_INDEX } from '@/lib/constants'
import { formatCurrency } from '@/lib/formatters'
import { normalizeBookLevels } from '@/lib/order-panel-utils'
import { MIN_LIMIT_ORDER_SHARES, MIN_MARKET_BUY_AMOUNT } from '@/lib/orders/validation'
import { POLYMARKET_MIN_MARKETABLE_BUY_AMOUNT } from '@/lib/polymarket-orders-client'
import { PolymarketWalletUnavailableError, syncPolymarketWallet } from '@/lib/polymarket-wallet-client'
import { resolveSportsOutcomeTeamLabel } from '@/lib/sports-team-label'
import { calculateGrossedKuestUnitFee } from '@/lib/trading-fees'
import { cn } from '@/lib/utils'
import { usePolymarketWallet } from '@/stores/usePolymarketWallet'
import { useUser } from '@/stores/useUser'

const INTRO_STORAGE_KEY = 'kuest:polymarket-arbitrage-intro-seen'
const BALANCE_COMPARISON_EPSILON = 1e-8
const CURRENCY_SCALE = 100
type AmountPreset = 'min' | 'mid' | 'max'

interface EventOrderPanelArbitrageProps {
  event: Pick<Event, 'sports_teams'>
  market: Market
  multiWalletEnabled: boolean
  siteWalletReady: boolean
  kuestBalance: number
  operatorShareBps: number
  isSubmitting: boolean
  submissionStep: 0 | 1 | 2 | 3
  onRequireSiteWallet: () => void
  onSubmit: (quote: ArbitrageQuote, polymarketMinimumOrderSize: number) => void
}

interface ArbitragePricePreview {
  kuestOutcome: 'YES' | 'NO'
  polymarketOutcome: 'YES' | 'NO'
  kuestPrice: number
  polymarketPrice: number
  kuestUnitCost: number
  polymarketUnitCost: number
  edge: number
}

type AppKitSwitchConnection = ReturnType<typeof useAppKitConnection>['switchConnection']

interface WalletPermissionsProvider {
  request: (args: { method: string; params?: readonly unknown[] }) => Promise<unknown>
}

function MultiWalletConnectionBridge({
  onSwitchConnectionChange,
}: {
  onSwitchConnectionChange: (switchConnection: AppKitSwitchConnection | null) => void
}) {
  const { switchConnection } = useAppKitConnection({ namespace: 'eip155' })

  useEffect(() => {
    onSwitchConnectionChange(switchConnection)
    return () => onSwitchConnectionChange(null)
  }, [onSwitchConnectionChange, switchConnection])

  return null
}

function getConnectorIdentifiers(connector: { id: string; rdns?: string | readonly string[] }) {
  return [connector.id, ...(Array.isArray(connector.rdns) ? connector.rdns : [connector.rdns])]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase())
}

function shortAddress(address: string | null) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ''
}

function AnimatedCurrency({ value, fontSize = '20px' }: { value: number; fontSize?: string }) {
  return (
    <span className="inline-flex items-baseline">
      <span>$</span>
      <AnimatedCounter
        value={Math.max(0, value)}
        color="currentColor"
        fontSize={fontSize}
        includeCommas
        includeDecimals
        decimalPrecision={2}
        digitStyles={{ fontWeight: 600, lineHeight: '1' }}
        containerStyles={{
          display: 'inline-flex',
          alignItems: 'baseline',
          flexDirection: 'row-reverse',
          lineHeight: '1',
        }}
      />
    </span>
  )
}

function findPercentForAmount(quote: ArbitrageQuote, amount: number) {
  if (!(amount > 0) || !(quote.totalCost > 0)) {
    return 0
  }
  if (amount >= quote.totalCost) {
    return 100
  }

  let low = 0
  let high = 100
  for (let index = 0; index < 24; index += 1) {
    const middle = (low + high) / 2
    if (scaleArbitrageQuote(quote, middle).totalCost < amount) {
      low = middle
    } else {
      high = middle
    }
  }
  return (low + high) / 2
}

type EventOrderPanelPolymarketArbitrageProps = Pick<
  EventOrderPanelArbitrageProps,
  | 'market'
  | 'event'
  | 'multiWalletEnabled'
  | 'siteWalletReady'
  | 'kuestBalance'
  | 'operatorShareBps'
  | 'isSubmitting'
  | 'submissionStep'
  | 'onRequireSiteWallet'
  | 'onSubmit'
>

function EventOrderPanelPolymarketArbitrage({
  event,
  market,
  multiWalletEnabled,
  siteWalletReady,
  kuestBalance,
  operatorShareBps,
  isSubmitting,
  submissionStep,
  onRequireSiteWallet,
  onSubmit,
}: EventOrderPanelPolymarketArbitrageProps) {
  const t = useExtracted()
  const site = useSiteIdentity()
  const user = useUser()
  const { open: openAppKit, close: closeAppKit } = useAppKit()
  const { embeddedWalletInfo } = useAppKitAccount()
  const appKitState = useAppKitState()
  const connections = useConnections()
  const { address: activeAddress, connector: activeConnector } = useAccount()
  const walletStatus = usePolymarketWallet((state) => state.status)
  const funderAddress = usePolymarketWallet((state) => state.funderAddress)
  const { balance: polymarketBalance } = usePolymarketBalance()
  const hasHydrated = useHasHydrated()
  const [introDismissed, setIntroDismissed] = useState(false)
  const [amountPreset, setAmountPreset] = useState<AmountPreset | null>(null)
  const [amountDraft, setAmountDraft] = useState<string | null>(null)
  const [validationWarning, setValidationWarning] = useState<'minimum' | 'balance' | 'liquidity' | null>(null)
  const [sameWalletUnavailableAddress, setSameWalletUnavailableAddress] = useState<string | null>(null)
  const isSyncingConnectionRef = useRef(false)
  const currentWalletSyncRef = useRef<string | null>(null)
  const injectedPermissionRequestRef = useRef<string | null>(null)
  const switchConnectionRef = useRef<AppKitSwitchConnection | null>(null)
  const appKitModalWasOpenRef = useRef(false)
  const previousMarketOpportunityRef = useRef<boolean | null>(null)

  const yesOutcome = market.outcomes.find((outcome) => outcome.outcome_index === OUTCOME_INDEX.YES)
  const noOutcome = market.outcomes.find((outcome) => outcome.outcome_index === OUTCOME_INDEX.NO)
  const kuestTokenIds = [yesOutcome?.token_id, noOutcome?.token_id].filter((value): value is string => Boolean(value))
  const polymarketTokenIds = [yesOutcome?.polymarket_token_id, noOutcome?.polymarket_token_id].filter(
    (value): value is string => Boolean(value),
  )
  const canQuote = kuestTokenIds.length === 2 && polymarketTokenIds.length === 2
  const kuestBooks = useOrderBookSummaries(kuestTokenIds, { enabled: canQuote, refetchIntervalMs: 5_000 })
  const kuestYesFeeRate = useKuestFeeRate(yesOutcome?.token_id ?? null, { enabled: canQuote })
  const kuestNoFeeRate = useKuestFeeRate(noOutcome?.token_id ?? null, { enabled: canQuote })
  const polymarketBooks = usePolymarketOrderBooks(polymarketTokenIds, canQuote)
  const polymarketMarketInfo = usePolymarketMarketInfo(market.polymarket_condition_id)
  const hasSeenIntro = hasHydrated && window.localStorage.getItem(INTRO_STORAGE_KEY) === 'true'
  const introOpen = hasHydrated && !hasSeenIntro && !introDismissed
  const primaryAddress = user?.address?.toLowerCase() ?? null
  const sameWalletUnavailable = sameWalletUnavailableAddress === primaryAddress
  const isEmbeddedSiteWallet = Boolean(embeddedWalletInfo)
  const primaryConnection = connections.find(
    (connection) => primaryAddress && connection.accounts.some((account) => account.toLowerCase() === primaryAddress),
  )
  const polymarketWalletReady = walletStatus === 'connected'
  const walletsReady = siteWalletReady && polymarketWalletReady
  const handleSwitchConnectionChange = useCallback((nextSwitchConnection: AppKitSwitchConnection | null) => {
    switchConnectionRef.current = nextSwitchConnection
  }, [])

  const quotes = useMemo(() => {
    if (
      !canQuote ||
      !yesOutcome ||
      !noOutcome ||
      !polymarketMarketInfo.data ||
      kuestYesFeeRate.data == null ||
      kuestNoFeeRate.data == null
    ) {
      return null
    }

    const kuestYesAsks = normalizeBookLevels(kuestBooks.data?.[yesOutcome.token_id]?.asks, 'ask')
    const kuestNoAsks = normalizeBookLevels(kuestBooks.data?.[noOutcome.token_id]?.asks, 'ask')
    const polymarketYesAsks = normalizeBookLevels(polymarketBooks.data?.[yesOutcome.polymarket_token_id!]?.asks, 'ask')
    const polymarketNoAsks = normalizeBookLevels(polymarketBooks.data?.[noOutcome.polymarket_token_id!]?.asks, 'ask')
    const yesTokenId = yesOutcome.token_id
    const noTokenId = noOutcome.token_id
    const polymarketYesTokenId = yesOutcome.polymarket_token_id!
    const polymarketNoTokenId = noOutcome.polymarket_token_id!
    const polymarketFeeRate = polymarketMarketInfo.data.feeRate
    const polymarketFeeExponent = polymarketMarketInfo.data.feeExponent

    const preview =
      [
        {
          kuestOutcome: 'YES' as const,
          polymarketOutcome: 'NO' as const,
          kuestLevel: kuestYesAsks[0],
          polymarketLevel: polymarketNoAsks[0],
          kuestFeeSchedule: kuestYesFeeRate.data,
        },
        {
          kuestOutcome: 'NO' as const,
          polymarketOutcome: 'YES' as const,
          kuestLevel: kuestNoAsks[0],
          polymarketLevel: polymarketYesAsks[0],
          kuestFeeSchedule: kuestNoFeeRate.data,
        },
      ]
        .flatMap<ArbitragePricePreview>((direction) => {
          if (!direction.kuestLevel || !direction.polymarketLevel) {
            return []
          }

          const kuestPrice = direction.kuestLevel.priceDollars
          const polymarketPrice = direction.polymarketLevel.priceDollars
          const kuestUnitCost =
            kuestPrice + calculateGrossedKuestUnitFee(kuestPrice, direction.kuestFeeSchedule, operatorShareBps)
          const polymarketUnitCost = calculatePolymarketUnitCost(
            polymarketPrice,
            polymarketFeeRate,
            polymarketFeeExponent,
          )
          return [
            {
              kuestOutcome: direction.kuestOutcome,
              polymarketOutcome: direction.polymarketOutcome,
              kuestPrice,
              polymarketPrice,
              kuestUnitCost,
              polymarketUnitCost,
              edge: 1 - kuestUnitCost - polymarketUnitCost,
            },
          ]
        })
        .sort((left, right) => right.edge - left.edge)[0] ?? null

    function buildQuote(availableKuestCash: number, availablePolymarketCash: number) {
      return selectBestArbitrageQuote([
        {
          kuestOutcome: 'YES',
          polymarketOutcome: 'NO',
          kuestTokenId: yesTokenId,
          polymarketTokenId: polymarketNoTokenId,
          kuestAsks: kuestYesAsks,
          polymarketAsks: polymarketNoAsks,
          kuestBalance: availableKuestCash,
          polymarketBalance: availablePolymarketCash,
          kuestFeeSchedule: kuestYesFeeRate.data,
          operatorShareBps,
          polymarketFeeRate,
          polymarketFeeExponent,
        },
        {
          kuestOutcome: 'NO',
          polymarketOutcome: 'YES',
          kuestTokenId: noTokenId,
          polymarketTokenId: polymarketYesTokenId,
          kuestAsks: kuestNoAsks,
          polymarketAsks: polymarketYesAsks,
          kuestBalance: availableKuestCash,
          polymarketBalance: availablePolymarketCash,
          kuestFeeSchedule: kuestNoFeeRate.data,
          operatorShareBps,
          polymarketFeeRate,
          polymarketFeeExponent,
        },
      ])
    }

    return {
      market: buildQuote(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY),
      executable: walletsReady ? buildQuote(kuestBalance, polymarketBalance) : null,
      preview,
    }
  }, [
    canQuote,
    kuestBalance,
    kuestBooks.data,
    operatorShareBps,
    kuestNoFeeRate.data,
    kuestYesFeeRate.data,
    noOutcome,
    polymarketBalance,
    polymarketBooks.data,
    polymarketMarketInfo.data,
    walletsReady,
    yesOutcome,
  ])
  const marketQuote = quotes?.market ?? null
  const executableQuote = quotes?.executable ?? null
  const quote = walletsReady ? executableQuote : marketQuote
  const minimumOrderSize = Math.max(0, polymarketMarketInfo.data?.minimumOrderSize ?? 0)
  const minimumTickSize = polymarketMarketInfo.data?.minimumTickSize ?? '0.01'
  const minimumQuote = useMemo(
    () =>
      marketQuote
        ? findMinimumExecutableArbitrageQuote(marketQuote, {
            minimumShares: Math.max(MIN_LIMIT_ORDER_SHARES, minimumOrderSize),
            minimumKuestAmount: MIN_MARKET_BUY_AMOUNT,
            minimumPolymarketAmount: POLYMARKET_MIN_MARKETABLE_BUY_AMOUNT,
            polymarketTickSize: minimumTickSize,
          })
        : null,
    [marketQuote, minimumOrderSize, minimumTickSize],
  )
  const maximumQuote = useMemo(
    () =>
      quote
        ? constrainArbitrageQuoteForPolymarketFok(
            scaleArbitrageQuote(quote, 100),
            walletsReady ? polymarketBalance : Number.POSITIVE_INFINITY,
            minimumTickSize,
          )
        : null,
    [minimumTickSize, polymarketBalance, quote, walletsReady],
  )
  const minimumAmount = minimumQuote
    ? Math.ceil((minimumQuote.totalCost - BALANCE_COMPARISON_EPSILON) * CURRENCY_SCALE) / CURRENCY_SCALE
    : 0
  const maxAmount = maximumQuote
    ? Math.floor((maximumQuote.totalCost + BALANCE_COMPARISON_EPSILON) * CURRENCY_SCALE) / CURRENCY_SCALE
    : 0
  const midpointAmount = minimumAmount > 0 && maxAmount > 0 ? (minimumAmount + maxAmount) / 2 : 0
  const presetAmount =
    amountPreset === 'min'
      ? minimumAmount
      : amountPreset === 'mid'
        ? midpointAmount
        : amountPreset === 'max'
          ? maxAmount
          : null
  const requestedAmount = Number.parseFloat(amountDraft ?? presetAmount?.toFixed(2) ?? '')
  const effectivePercent = quote
    ? Number.isFinite(requestedAmount)
      ? findPercentForAmount(quote, requestedAmount)
      : 0
    : 0
  const selectedQuote = useMemo(() => {
    if (!quote) {
      return null
    }
    return constrainArbitrageQuoteForPolymarketFok(
      scaleArbitrageQuote(quote, effectivePercent),
      walletsReady ? polymarketBalance : Number.POSITIVE_INFINITY,
      minimumTickSize,
    )
  }, [effectivePercent, minimumTickSize, polymarketBalance, quote, walletsReady])
  const selectedKuestPrice =
    selectedQuote?.segments.reduce((total, segment) => total + segment.shares * segment.kuestPrice, 0) ?? 0
  const selectedPolymarketPrice =
    selectedQuote?.segments.reduce((total, segment) => total + segment.shares * segment.polymarketPrice, 0) ?? 0
  const displayQuote = quote ?? marketQuote
  const displaySegment = displayQuote?.segments[0] ?? null
  const displayPreview = displayQuote
    ? {
        kuestOutcome: displayQuote.kuestOutcome,
        polymarketOutcome: displayQuote.polymarketOutcome,
        kuestPrice: displaySegment?.kuestPrice ?? 0,
        polymarketPrice: displaySegment?.polymarketPrice ?? 0,
        kuestUnitCost: displaySegment?.kuestUnitCost ?? 0,
        polymarketUnitCost: displaySegment?.polymarketUnitCost ?? 0,
        edge: displaySegment ? 1 - displaySegment.kuestUnitCost - displaySegment.polymarketUnitCost : displayQuote.edge,
      }
    : (quotes?.preview ?? null)
  const executionPreview =
    selectedQuote && selectedQuote.shares > 0
      ? {
          kuestOutcome: selectedQuote.kuestOutcome,
          polymarketOutcome: selectedQuote.polymarketOutcome,
          kuestPrice: selectedKuestPrice / selectedQuote.shares,
          polymarketPrice: selectedPolymarketPrice / selectedQuote.shares,
          kuestUnitCost: selectedQuote.kuestCost / selectedQuote.shares,
          polymarketUnitCost: selectedQuote.polymarketCost / selectedQuote.shares,
          edge: selectedQuote.profit / selectedQuote.shares,
        }
      : displayPreview
  const kuestOutcomeLabel = resolveSportsOutcomeTeamLabel({
    outcomeText: executionPreview?.kuestOutcome === 'YES' ? yesOutcome?.outcome_text : noOutcome?.outcome_text,
    fallback: executionPreview?.kuestOutcome === 'YES' ? 'YES' : 'NO',
    teams: event.sports_teams,
  })
  const polymarketOutcomeLabel = resolveSportsOutcomeTeamLabel({
    outcomeText: executionPreview?.polymarketOutcome === 'YES' ? yesOutcome?.outcome_text : noOutcome?.outcome_text,
    fallback: executionPreview?.polymarketOutcome === 'YES' ? 'YES' : 'NO',
    teams: event.sports_teams,
  })
  const hasMarketOpportunity = Boolean(marketQuote)
  const shouldShakePriceDifference = hasMarketOpportunity && previousMarketOpportunityRef.current === false
  const amountInputValue = amountDraft ?? presetAmount?.toFixed(2) ?? selectedQuote?.totalCost.toFixed(2) ?? '0.00'
  const amountSizeClass = getAmountSizeClass(amountInputValue)
  const selectedKuestFee = Math.max(0, (selectedQuote?.kuestCost ?? 0) - selectedKuestPrice)
  const selectedPolymarketFee = Math.max(0, (selectedQuote?.polymarketCost ?? 0) - selectedPolymarketPrice)
  const selectedFees = selectedKuestFee + selectedPolymarketFee
  const selectedReturn =
    selectedQuote && selectedQuote.totalCost > 0 ? (selectedQuote.profit / selectedQuote.totalCost) * 100 : 0

  useEffect(() => {
    previousMarketOpportunityRef.current = hasMarketOpportunity
  }, [hasMarketOpportunity])

  useLayoutEffect(() => {
    if (!multiWalletEnabled) {
      appKitModalWasOpenRef.current = false
      return
    }
    if (walletStatus !== 'connecting') {
      appKitModalWasOpenRef.current = false
      return
    }
    if (appKitState.open) {
      appKitModalWasOpenRef.current = true
      return
    }
    if (appKitModalWasOpenRef.current && !isSyncingConnectionRef.current) {
      usePolymarketWallet.getState().disconnect()
    }
  }, [appKitState.open, multiWalletEnabled, walletStatus])

  useLayoutEffect(() => {
    if (multiWalletEnabled || isEmbeddedSiteWallet || !primaryAddress || !primaryConnection) {
      return
    }

    const wallet = usePolymarketWallet.getState()
    if (
      wallet.status === 'connected' &&
      wallet.ownerAddress?.toLowerCase() === primaryAddress &&
      (wallet.connectorUid === primaryConnection.connector.uid || wallet.connectorId === primaryConnection.connector.id)
    ) {
      currentWalletSyncRef.current = null
      return
    }

    const syncKey = `${primaryAddress}:${primaryConnection.connector.uid}`
    if (currentWalletSyncRef.current === syncKey) {
      return
    }

    currentWalletSyncRef.current = syncKey
    usePolymarketWallet.getState().setConnecting()
    void syncPolymarketWallet({
      ownerAddress: primaryAddress,
      connectorId: primaryConnection.connector.id,
      connectorUid: primaryConnection.connector.uid,
    })
      .then((wallet) => {
        if (!wallet && currentWalletSyncRef.current === syncKey) {
          currentWalletSyncRef.current = null
        }
      })
      .catch((error) => {
        console.error('Failed to use the connected wallet for Polymarket.', error)
        setSameWalletUnavailableAddress(error instanceof PolymarketWalletUnavailableError ? primaryAddress : null)
        currentWalletSyncRef.current = null
        usePolymarketWallet.getState().disconnect()
      })
  }, [isEmbeddedSiteWallet, multiWalletEnabled, primaryAddress, primaryConnection])

  useLayoutEffect(() => {
    const connectingWallet = appKitState.connectingWallet
    if (!multiWalletEnabled || walletStatus !== 'connecting' || !appKitState.open || !connectingWallet?.isInjected) {
      injectedPermissionRequestRef.current = null
      return
    }

    const selectedConnectorIds = connectingWallet.connectors
      .filter((connector) => connector.chain === 'eip155')
      .flatMap((connector) => [connector.id, connector.rdns])
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase())
    const existingConnection = connections.find((connection) =>
      getConnectorIdentifiers(connection.connector).some((identifier) => selectedConnectorIds.includes(identifier)),
    )
    if (!existingConnection) {
      return
    }

    const requestKey = `${connectingWallet.id}:${existingConnection.connector.uid}`
    if (injectedPermissionRequestRef.current === requestKey) {
      return
    }
    injectedPermissionRequestRef.current = requestKey
    isSyncingConnectionRef.current = true

    void existingConnection.connector
      .getProvider()
      .then(async (provider) => {
        const permissionsProvider = provider as WalletPermissionsProvider | undefined
        if (!permissionsProvider?.request) {
          return
        }
        try {
          await permissionsProvider.request({
            method: 'wallet_requestPermissions',
            params: [{ eth_accounts: {} }],
          })
        } catch (error) {
          const errorCode = error && typeof error === 'object' && 'code' in error ? Number(error.code) : null
          if (errorCode === 4001) {
            throw error
          }
          await permissionsProvider.request({ method: 'eth_requestAccounts' })
        }
        const accounts = await permissionsProvider.request({ method: 'eth_accounts' })
        const selectedAddress = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : null
        if (!selectedAddress) {
          throw new Error('The wallet did not return a selected account.')
        }

        const wallet = await syncPolymarketWallet({
          ownerAddress: selectedAddress,
          connectorId: existingConnection.connector.id,
          connectorUid: existingConnection.connector.uid,
        })
        if (!wallet) {
          return
        }
        if (primaryConnection && user?.address && switchConnectionRef.current) {
          await switchConnectionRef.current({
            connection: {
              connectorId: primaryConnection.connector.id,
              accounts: primaryConnection.accounts.map((address) => ({ address })),
            },
            address: user.address,
          })
        }
        await closeAppKit()
      })
      .catch((error) => {
        const errorCode = error && typeof error === 'object' && 'code' in error ? Number(error.code) : null
        if (errorCode !== 4001) {
          console.error('Failed to open the wallet account selector.', error)
          toast.error(t('Open your wallet and select the account you use on Polymarket.'))
        }
      })
      .finally(() => {
        isSyncingConnectionRef.current = false
      })
  }, [
    appKitState.connectingWallet,
    appKitState.open,
    closeAppKit,
    connections,
    multiWalletEnabled,
    primaryConnection,
    t,
    user?.address,
    walletStatus,
  ])

  useLayoutEffect(() => {
    if (
      !multiWalletEnabled ||
      walletStatus !== 'connecting' ||
      isSyncingConnectionRef.current ||
      !activeAddress ||
      !activeConnector ||
      activeAddress.toLowerCase() === primaryAddress
    ) {
      return
    }

    isSyncingConnectionRef.current = true
    void syncPolymarketWallet({
      ownerAddress: activeAddress,
      connectorId: activeConnector.id,
      connectorUid: activeConnector.uid,
    })
      .then(async (wallet) => {
        if (!wallet) {
          return
        }
        if (primaryConnection && user?.address && switchConnectionRef.current) {
          await switchConnectionRef.current({
            connection: {
              connectorId: primaryConnection.connector.id,
              accounts: primaryConnection.accounts.map((address) => ({ address })),
            },
            address: user.address,
          })
        }
        await closeAppKit()
      })
      .catch((error) => {
        console.error('Failed to connect Polymarket wallet.', error)
        usePolymarketWallet.getState().disconnect()
        toast.error(t('We could not connect your Polymarket wallet.'))
      })
      .finally(() => {
        isSyncingConnectionRef.current = false
      })
  }, [
    activeAddress,
    activeConnector,
    closeAppKit,
    multiWalletEnabled,
    primaryAddress,
    primaryConnection,
    t,
    user?.address,
    walletStatus,
  ])

  async function handleConnect() {
    dismissIntro()
    if (!appKitState.initialized || appKitState.loading) {
      toast.error(t('We could not connect your Polymarket wallet.'))
      return
    }
    if (!appKitState.multiWallet) {
      toast.error(t('Multi-wallet must be enabled for this Reown project.'))
      return
    }

    usePolymarketWallet.getState().setConnecting()
    try {
      await openAppKit({ view: 'ProfileWallets', namespace: 'eip155' })
    } catch (error) {
      console.error('Failed to connect Polymarket wallet.', error)
      usePolymarketWallet.getState().disconnect()
      toast.error(t('We could not connect your Polymarket wallet.'))
    }
  }

  async function handleSameWalletConnect() {
    if (isEmbeddedSiteWallet || !primaryAddress || !primaryConnection) {
      onRequireSiteWallet()
      return
    }

    setSameWalletUnavailableAddress(null)
    currentWalletSyncRef.current = null
    usePolymarketWallet.getState().setConnecting()
    try {
      await syncPolymarketWallet({
        ownerAddress: primaryAddress,
        connectorId: primaryConnection.connector.id,
        connectorUid: primaryConnection.connector.uid,
      })
    } catch (error) {
      console.error('Failed to use the connected wallet for Polymarket.', error)
      setSameWalletUnavailableAddress(error instanceof PolymarketWalletUnavailableError ? primaryAddress : null)
      usePolymarketWallet.getState().disconnect()
    }
  }

  function dismissIntro() {
    window.localStorage.setItem(INTRO_STORAGE_KEY, 'true')
    setIntroDismissed(true)
  }

  function handleDisconnect() {
    usePolymarketWallet.getState().disconnect()
  }

  function handleAmountChange(rawValue: string) {
    const nextAmount = sanitizeNumericInput(rawValue)
    setValidationWarning(null)
    setAmountPreset(null)
    setAmountDraft(nextAmount)
  }

  function handleAmountBlur() {
    const amount = Number.parseFloat(amountDraft ?? '')
    if (Number.isFinite(amount) && amount > maxAmount) {
      setAmountDraft(maxAmount.toFixed(2))
    }
  }

  function handleSubmit() {
    const kuestPrincipal =
      selectedQuote?.segments.reduce((total, segment) => total + segment.shares * segment.kuestPrice, 0) ?? 0
    const polymarketMaximumCost = selectedQuote?.polymarketOrder?.maximumCost ?? 0
    const minimumShares = Math.max(MIN_LIMIT_ORDER_SHARES, minimumOrderSize)
    const displayedAmount = Number.parseFloat(amountInputValue)

    if (marketQuote && !minimumQuote) {
      setValidationWarning('liquidity')
      return
    }

    if (walletsReady && Number.isFinite(displayedAmount) && displayedAmount > maxAmount + BALANCE_COMPARISON_EPSILON) {
      setValidationWarning('balance')
      return
    }

    if (
      !selectedQuote ||
      selectedQuote.shares < minimumShares ||
      kuestPrincipal < MIN_MARKET_BUY_AMOUNT ||
      polymarketMaximumCost < POLYMARKET_MIN_MARKETABLE_BUY_AMOUNT
    ) {
      setValidationWarning('minimum')
      return
    }

    if (
      selectedQuote.kuestCost > kuestBalance + BALANCE_COMPARISON_EPSILON ||
      Math.max(selectedQuote.polymarketCost, polymarketMaximumCost) > polymarketBalance + BALANCE_COMPARISON_EPSILON
    ) {
      setValidationWarning('balance')
      return
    }

    setValidationWarning(null)
    onSubmit(selectedQuote, minimumOrderSize)
  }

  const connectButton = (
    <EventOrderPanelSubmitButton
      type="button"
      isLoading={walletStatus === 'connecting'}
      isDisabled={walletStatus === 'connecting'}
      onClick={() => void handleConnect()}
      label={t.rich('Connect <polymarket>Polymarket</polymarket> wallet', {
        polymarket: () => (
          <Image
            src="/images/logos/polymarket-logo-black.svg"
            alt="Polymarket"
            width={125}
            height={20}
            className="h-4 w-auto brightness-0 invert"
          />
        ),
      })}
      loadingLabel={t('Loading...')}
    />
  )
  const submitButtonLabel =
    submissionStep === 1
      ? t('Sign {siteName} order · 1/2', { siteName: site.name })
      : submissionStep === 2
        ? t('Sign Polymarket order · 2/2')
        : submissionStep === 3
          ? t('Submitting orders…')
          : !hasMarketOpportunity
            ? t('No profitable trade right now')
            : !executableQuote
              ? t('Add funds to trade')
              : t('Sign orders · 0/2')
  const submitButton = (
    <EventOrderPanelSubmitButton
      type="button"
      className={cn(executableQuote && submissionStep === 0 && 'animate-arbitrage-glow')}
      isLoading={isSubmitting}
      isDisabled={isSubmitting || !executableQuote}
      onClick={handleSubmit}
      label={submitButtonLabel}
      loadingLabel={submitButtonLabel}
    />
  )
  const submitButtonWithStatus =
    !hasMarketOpportunity && submissionStep === 0 ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <div className="block" tabIndex={0}>
              {submitButton}
            </div>
          }
        />
        <TooltipContent side="top" className="max-w-72 text-center">
          {t('Arbitrage is available when opposite outcomes cost less than their combined $1 payout, including fees.')}
        </TooltipContent>
      </Tooltip>
    ) : (
      submitButton
    )
  const actionButton = !siteWalletReady ? (
    <EventOrderPanelSubmitButton
      type="button"
      isLoading={false}
      isDisabled={false}
      onClick={onRequireSiteWallet}
      label={t('Trade')}
    />
  ) : !polymarketWalletReady ? (
    multiWalletEnabled ? (
      connectButton
    ) : isEmbeddedSiteWallet ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <div className="block" tabIndex={0}>
              <EventOrderPanelSubmitButton
                type="button"
                isLoading={false}
                isDisabled
                onClick={() => {}}
                label={t('Polymarket wallet unavailable')}
              />
            </div>
          }
        />
        <TooltipContent side="top" className="max-w-72 text-center">
          {t('When disabled, users can only trade arbitrage when they use the same wallet on both sites.')}
        </TooltipContent>
      </Tooltip>
    ) : sameWalletUnavailable ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <div className="block" tabIndex={0}>
              <EventOrderPanelSubmitButton
                type="button"
                isLoading={false}
                isDisabled
                onClick={() => {}}
                label={t('Polymarket wallet unavailable')}
              />
            </div>
          }
        />
        <TooltipContent side="top" className="max-w-72 text-center">
          {t('This wallet does not have an active Polymarket deposit wallet. Use the same wallet on Polymarket first.')}
        </TooltipContent>
      </Tooltip>
    ) : (
      <EventOrderPanelSubmitButton
        type="button"
        isLoading={walletStatus === 'connecting'}
        isDisabled={walletStatus === 'connecting'}
        onClick={() => void handleSameWalletConnect()}
        label={t('Connect your Polymarket wallet')}
        loadingLabel={t('Loading...')}
      />
    )
  ) : (
    submitButtonWithStatus
  )
  const percentageTooltipLabel = siteWalletReady ? t('Connect your Polymarket wallet') : t('Connect wallet')
  const polymarketWalletRow = polymarketWalletReady ? (
    <div className="flex items-center justify-between gap-3 border-b pb-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#2E5CFF]">
          <Image
            src="/images/logos/polymarket-icon-black.svg"
            alt=""
            width={22}
            height={22}
            className="size-7 brightness-0 invert"
          />
        </span>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{t('Polymarket wallet')}</div>
          <div className="text-sm font-semibold text-foreground">{shortAddress(funderAddress)}</div>
        </div>
      </div>
      {multiWalletEnabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="bg-secondary/50 hover:bg-secondary"
          onClick={handleDisconnect}
        >
          <UnplugIcon className="size-4" />
          <span className="sr-only">{t('Disconnect Polymarket wallet')}</span>
        </Button>
      )}
    </div>
  ) : null

  return (
    <div className="mt-4 grid gap-4">
      {multiWalletEnabled && appKitState.multiWallet && (
        <MultiWalletConnectionBridge onSwitchConnectionChange={handleSwitchConnectionChange} />
      )}
      {!canQuote ? (
        <div className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          {t('This mirror is missing Polymarket token IDs.')}
        </div>
      ) : (
        <>
          <div>
            {polymarketWalletRow}
            <div className="mb-4 overflow-hidden rounded-2xl border border-border bg-secondary dark:bg-background">
              <div className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-secondary p-1 text-sm dark:bg-background">
                <div className="flex min-h-12 flex-col justify-start rounded-xl bg-card p-2 dark:bg-secondary">
                  <div className="text-xs font-medium text-primary">{site.name}</div>
                  <div className="mt-1 flex items-baseline justify-between gap-2 text-base font-semibold">
                    <span>{executionPreview ? kuestOutcomeLabel : '—'}</span>
                    {executionPreview ? (
                      <EventOrderPanelAnimatedCents
                        key={`kuest-${executionPreview.kuestOutcome}`}
                        value={executionPreview.kuestPrice * 100}
                        fontSize="20px"
                      />
                    ) : (
                      <span>—</span>
                    )}
                  </div>
                </div>
                <div className="flex min-h-12 flex-col justify-start rounded-xl bg-card p-2 dark:bg-secondary">
                  <div className="text-xs font-medium text-[#2E5CFF]">Polymarket</div>
                  <div className="mt-1 flex items-baseline justify-between gap-2 text-base font-semibold">
                    <span>{executionPreview ? polymarketOutcomeLabel : '—'}</span>
                    {executionPreview ? (
                      <EventOrderPanelAnimatedCents
                        key={`polymarket-${executionPreview.polymarketOutcome}`}
                        value={executionPreview.polymarketPrice * 100}
                        fontSize="20px"
                      />
                    ) : (
                      <span>—</span>
                    )}
                  </div>
                </div>
              </div>
              <div
                className={cn('flex items-center justify-between gap-3 px-4 py-3 text-sm', {
                  'animate-order-shake': shouldShakePriceDifference,
                })}
              >
                <span className="text-muted-foreground">{t('Profit per share')}</span>
                <div
                  className={cn(
                    'flex items-center gap-1.5 font-semibold',
                    !executionPreview ? 'text-muted-foreground' : executionPreview.edge > 0 ? 'text-yes' : 'text-no',
                  )}
                >
                  {executionPreview ? (
                    <>
                      <span>≈</span>
                      {executionPreview.edge < 0 && <span>−</span>}
                      <EventOrderPanelAnimatedCents value={Math.abs(executionPreview.edge) * 100} fontSize="18px" />
                    </>
                  ) : (
                    <span>—</span>
                  )}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button type="button" className="text-muted-foreground hover:text-foreground">
                          <InfoIcon className="size-4" />
                          <span className="sr-only">{t('Execution risk')}</span>
                        </button>
                      }
                    />
                    <TooltipContent side="top" align="end" className="max-w-64 text-xs">
                      {t(
                        'Estimated profit for each matched pair of shares, after fees, based on current executable prices.',
                      )}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>

            <div className="mb-2 flex items-center gap-3">
              <div className="shrink-0">
                <label htmlFor="arbitrage-amount" className="text-lg font-medium">
                  {t('Amount')}
                </label>
                <div className="text-xs text-muted-foreground">
                  {formatCurrency(minimumAmount)} {t('Min').toLocaleLowerCase()}
                  {' · '}
                  {formatCurrency(maxAmount)} {t('Max').toLocaleLowerCase()}
                </div>
              </div>
              <input
                id="arbitrage-amount"
                type="text"
                inputMode="decimal"
                value={`$${formatDisplayAmount(amountInputValue)}`}
                onChange={(event) => handleAmountChange(event.currentTarget.value)}
                onBlur={handleAmountBlur}
                className={cn(
                  `h-14 w-full [appearance:textfield] border-0 bg-transparent text-right font-semibold text-slate-700 placeholder-slate-400 outline-hidden dark:text-slate-300 dark:placeholder-slate-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`,
                  amountSizeClass,
                )}
              />
            </div>

            <div className="mb-3 flex justify-end gap-2">
              {[
                { key: 'min' as const, label: t('Min'), amount: minimumAmount },
                { key: 'mid' as const, label: t('Mid'), amount: midpointAmount },
                { key: 'max' as const, label: t('Max'), amount: maxAmount },
              ].map((preset) => {
                const button = (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!walletsReady}
                    className={cn(
                      'text-xs',
                      amountPreset === preset.key && 'border-primary bg-primary/10 text-primary',
                    )}
                    onClick={() => {
                      setValidationWarning(null)
                      if (amountPreset === preset.key) {
                        setAmountDraft(preset.amount.toFixed(2))
                        setAmountPreset(null)
                        return
                      }
                      setAmountDraft(null)
                      setAmountPreset(preset.key)
                    }}
                  >
                    {preset.label}
                  </Button>
                )

                return walletsReady ? (
                  <span key={preset.key}>{button}</span>
                ) : (
                  <Tooltip key={preset.key}>
                    <TooltipTrigger
                      render={
                        <span className="inline-flex" tabIndex={0}>
                          {button}
                        </span>
                      }
                    />
                    <TooltipContent side="top">{percentageTooltipLabel}</TooltipContent>
                  </Tooltip>
                )
              })}
            </div>

            <div className="mb-4">
              <hr className="mb-3 border" />
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-bold text-foreground">{t('Payout')}</div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span>
                      {t('Est. profit')} {selectedQuote?.profit ? '+' : ''}
                      {formatCurrency(selectedQuote?.profit ?? 0)}
                    </span>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            className="inline-flex size-4 items-center justify-center hover:text-foreground"
                          >
                            <InfoIcon className="size-3" />
                            <span className="sr-only">{t('Est. profit')}</span>
                          </button>
                        }
                      />
                      <TooltipContent
                        side="top"
                        className="w-64 overflow-hidden rounded-2xl border border-border bg-background p-0"
                      >
                        <div className="grid gap-2 rounded-2xl border border-border bg-card px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <span>{t('Payout')}</span>
                            <span className="font-semibold">{formatCurrency(selectedQuote?.payout ?? 0)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>{t('{venue} cost', { venue: site.name })}</span>
                            <span>−{formatCurrency(selectedKuestPrice)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>{t('{venue} cost', { venue: 'Polymarket' })}</span>
                            <span>−{formatCurrency(selectedPolymarketPrice)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3 text-muted-foreground">
                            <span>{t('Est. fees')}</span>
                            <span>−{formatCurrency(selectedFees)}</span>
                          </div>
                          <hr className="border-border" />
                          <div className="flex items-center justify-between gap-3 font-semibold">
                            <span>{t('Est. profit')}</span>
                            <span className="text-yes">
                              {selectedQuote?.profit ? '+' : ''}
                              {formatCurrency(selectedQuote?.profit ?? 0)}
                              {' ('}
                              {selectedReturn.toFixed(1)}
                              %)
                            </span>
                          </div>
                        </div>
                        <div className="p-3 text-center text-xs text-muted-foreground">
                          {t('Based on current executable prices.')}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                <div className={cn('text-3xl font-bold', selectedQuote?.payout ? 'text-yes' : 'text-muted-foreground')}>
                  <AnimatedCurrency value={selectedQuote?.payout ?? 0} fontSize="30px" />
                </div>
              </div>
            </div>
          </div>

          {validationWarning && (
            <div
              className={cn(
                `mt-2 mb-3 flex animate-order-shake items-center justify-center gap-2 text-xs font-semibold whitespace-nowrap text-orange-500 sm:text-sm`,
              )}
            >
              <TriangleAlertIcon className="size-4" />
              {validationWarning === 'balance'
                ? t('Insufficient USDC balance')
                : validationWarning === 'liquidity'
                  ? t('No liquidity for this market order')
                  : t('Min. amount at current prices: {amount}', {
                      amount: formatCurrency(minimumAmount),
                    })}
            </div>
          )}

          {actionButton}
        </>
      )}

      <Dialog
        open={introOpen}
        onOpenChange={(open) => {
          if (!open) {
            dismissIntro()
          }
        }}
      >
        <DialogContent className="overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="bg-[#2E5CFF] px-6 py-5 text-left text-white">
            <DialogTitle className="grid gap-3 font-bold text-white">
              <span>{t('Arbitrage with')}</span>
              <span className="flex flex-wrap items-center gap-3">
                <span className="flex min-w-0 items-center gap-2.5">
                  <Image
                    src={site.logoUrl}
                    alt=""
                    width={32}
                    height={32}
                    className="size-8 shrink-0 object-contain brightness-0 invert"
                    unoptimized
                  />
                  <span className="truncate text-2xl leading-none font-bold">{site.name}</span>
                </span>
                <span aria-hidden="true" className="text-2xl font-medium text-white/75">
                  +
                </span>
                <Image
                  src="/images/logos/polymarket-logo-black.svg"
                  alt="Polymarket"
                  width={156}
                  height={25}
                  className="h-7 w-auto brightness-0 invert"
                />
              </span>
            </DialogTitle>
          </DialogHeader>
          <DialogDescription className="px-6 text-left text-sm text-muted-foreground">
            {t(
              'Buy opposite outcomes across {siteName} and Polymarket. When their combined cost is below $1, you can profit regardless of which outcome wins.',
              { siteName: site.name },
            )}
          </DialogDescription>
          <div className="mx-6 rounded-xl border bg-muted/30 p-4 text-sm">
            <div className="font-semibold">{t('Example')}</div>
            <div className="mt-3 grid gap-1 text-muted-foreground">
              <p>
                {t.rich('<yes>YES</yes> costs 42¢ on {siteName}', {
                  yes: (chunks) => <span className="font-bold text-yes">{chunks}</span>,
                  siteName: site.name,
                })}
              </p>
              <p>
                {t.rich('<no>NO</no> costs 53¢ on Polymarket', {
                  no: (chunks) => <span className="font-bold text-no">{chunks}</span>,
                })}
              </p>
              <p className="mt-3">
                {t('You spend 95¢ and receive $1 at resolution, for a 5¢ gross profit per matched pair, before fees.')}
              </p>
            </div>
          </div>
          <DialogFooter className="px-6 pb-4">
            <EventOrderPanelSubmitButton
              type="button"
              isLoading={false}
              isDisabled={false}
              onClick={dismissIntro}
              label={t('Continue')}
            />
          </DialogFooter>
          <p className="-mt-2 px-6 pb-2 text-center text-[10px]/none text-muted-foreground">
            {t('{siteName} is not affiliated with Polymarket.', { siteName: site.name })}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function EventOrderPanelArbitrage(props: EventOrderPanelArbitrageProps) {
  return <EventOrderPanelPolymarketArbitrage {...props} />
}
