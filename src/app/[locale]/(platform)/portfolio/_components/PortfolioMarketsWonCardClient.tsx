'use client'

import type { InfiniteData } from '@tanstack/react-query'
import type { Route } from 'next'

import { useQueryClient } from '@tanstack/react-query'
import { BanknoteArrowDownIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { useSignTypedData } from 'wagmi'

import type { PublicPosition } from '@/app/[locale]/(platform)/profile/_components/PublicPositionItem'

import { useTradingOnboarding } from '@/app/[locale]/(platform)/_providers/TradingOnboardingProvider'
import EventIconImage from '@/components/EventIconImage'
import SiteLogoIcon from '@/components/SiteLogoIcon'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { toast } from '@/components/ui/toast'
import { useAppKit } from '@/hooks/useAppKit'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useSignaturePromptRunner } from '@/hooks/useSignaturePromptRunner'
import { useSiteIdentity } from '@/hooks/useSiteIdentity'
import { Link } from '@/i18n/navigation'
import { formatCurrency, formatPercent } from '@/lib/formatters'
import { isCurrentNegRiskAdapterAddress } from '@/lib/neg-risk-adapter'
import { removeClaimedPublicPositions, updateQueryDataWhere } from '@/lib/optimistic-trading'
import { buildPublicProfilePath } from '@/lib/platform-routing'
import { isTradingAuthRequiredError } from '@/lib/trading-auth/errors'
import { invalidatePortfolioClaimQueries } from '@/lib/trading-cache'
import { cn, triggerConfetti } from '@/lib/utils'
import { normalizeAddress } from '@/lib/wallet'
import {
  DepositWalletCallItemsSplitFallbackError,
  signAndSubmitDepositWalletCallItemsWithSplitFallback,
} from '@/lib/wallet/client'
import { buildNegRiskRedeemPositionCall, buildRedeemPositionCall } from '@/lib/wallet/transactions'
import { useUser } from '@/stores/useUser'

export interface PortfolioClaimMarket {
  conditionId: string
  title: string
  eventSlug?: string
  imageUrl?: string
  outcome?: string
  outcomeIndex?: number
  shares: number
  invested: number
  proceeds: number
  returnPercent: number
  timestamp?: number
  indexSets: number[]
  isNegRisk?: boolean
  negRiskAdapterAddress?: `0x${string}`
  yesShares?: number
  noShares?: number
}

export interface PortfolioMarketsWonData {
  summary: {
    marketsWon: number
    totalProceeds: number
    totalInvested: number
    totalReturnPercent: number
    latestMarket?: PortfolioClaimMarket
  }
  markets: PortfolioClaimMarket[]
}

interface PortfolioMarketsWonCardClientProps {
  data: PortfolioMarketsWonData
}

function formatSignedPercent(value: number, digits: number) {
  const safeValue = Number.isFinite(value) ? value : 0
  const sign = safeValue > 0 ? '+' : safeValue < 0 ? '-' : ''
  const formatted = formatPercent(Math.abs(safeValue), { digits })
  return `${sign}${formatted}`
}

function useMarketsWonClaimSignature(markets: PortfolioClaimMarket[]) {
  const previewMarkets = useMemo(() => markets.slice(0, 3), [markets])
  const previewExtraCount = Math.max(0, markets.length - 3)
  const claimableSignature = useMemo(() => {
    const claimableMarkets = markets
      .filter((market) => market.indexSets.length > 0)
      .map((market) => {
        const sortedIndexSets = [...market.indexSets].sort((a, b) => a - b)
        return `${market.conditionId}:${sortedIndexSets.join(',')}`
      })
      .sort()

    return claimableMarkets.join('|')
  }, [markets])
  const hasClaimableMarkets = claimableSignature.length > 0

  return { previewMarkets, previewExtraCount, claimableSignature, hasClaimableMarkets }
}

function useMarketsWonDialogState() {
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const handleDialogOpenChange = useCallback((nextOpen: boolean) => {
    setIsDialogOpen(nextOpen)
    if (nextOpen) {
      triggerConfetti('yes')
    }
  }, [])

  return { isDialogOpen, setIsDialogOpen, handleDialogOpenChange }
}

function useMarketsWonClaimState() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hiddenClaimSignature, setHiddenClaimSignature] = useState<string | null>(null)
  const [locallyClaimedConditionIds, setLocallyClaimedConditionIds] = useState<Set<string>>(() => new Set())

  const markLocallyClaimedConditionIds = useCallback((conditionIds: string[]) => {
    if (conditionIds.length === 0) {
      return
    }

    setLocallyClaimedConditionIds((current) => {
      const next = new Set(current)
      let changed = false
      for (const conditionId of conditionIds) {
        if (!next.has(conditionId)) {
          next.add(conditionId)
          changed = true
        }
      }

      return changed ? next : current
    })
  }, [])

  return {
    isSubmitting,
    setIsSubmitting,
    hiddenClaimSignature,
    setHiddenClaimSignature,
    locallyClaimedConditionIds,
    markLocallyClaimedConditionIds,
  }
}

function useMarketsWonShareOnX({
  siteName,
  totalProceeds,
  userUsername,
  userDepositWalletAddress,
}: {
  siteName: string
  totalProceeds: number
  userUsername: string | null | undefined
  userDepositWalletAddress: string | null | undefined
}) {
  const t = useExtracted()
  const [isSharingOnX, setIsSharingOnX] = useState(false)

  const handleShareOnX = useCallback(() => {
    if (typeof window === 'undefined') {
      return
    }

    setIsSharingOnX(true)
    try {
      const profileSlug = userUsername?.trim() || userDepositWalletAddress?.trim() || ''
      const shareTargetUrl = profileSlug
        ? new URL(buildPublicProfilePath(profileSlug) ?? '/', window.location.origin).toString()
        : window.location.origin
      const shareText = [
        t('I just won {amount} on {siteName}!', {
          amount: formatCurrency(totalProceeds),
          siteName,
        }),
        '',
        t('Join me and put your money where your mouth is:'),
      ].join('\n')

      const shareUrl = new URL('https://x.com/intent/post')
      shareUrl.searchParams.set('text', shareText)
      shareUrl.searchParams.set('url', shareTargetUrl)

      window.open(shareUrl.toString(), '_blank', 'noopener,noreferrer')
    } finally {
      window.setTimeout(setIsSharingOnX, 200, false)
    }
  }, [siteName, t, totalProceeds, userDepositWalletAddress, userUsername])

  return { isSharingOnX, handleShareOnX }
}

export default function PortfolioMarketsWonCardClient({ data }: PortfolioMarketsWonCardClientProps) {
  const t = useExtracted()
  const isMobile = useIsMobile()
  const { markets } = data
  const {
    isSubmitting,
    setIsSubmitting,
    hiddenClaimSignature,
    setHiddenClaimSignature,
    locallyClaimedConditionIds,
    markLocallyClaimedConditionIds,
  } = useMarketsWonClaimState()
  const { ensureTradingReady, openTradeRequirements, promptAutoRedeem } = useTradingOnboarding()
  const { signTypedDataAsync } = useSignTypedData()
  const { open: openAppKit } = useAppKit()
  const { runWithSignaturePrompt } = useSignaturePromptRunner()
  const queryClient = useQueryClient()
  const user = useUser()
  const router = useRouter()
  const site = useSiteIdentity()

  const siteName = site.name
  const visibleMarkets = useMemo(
    () => markets.filter((market) => !locallyClaimedConditionIds.has(market.conditionId)),
    [locallyClaimedConditionIds, markets],
  )
  const visibleTotalProceeds = useMemo(
    () => visibleMarkets.reduce((total, market) => total + market.proceeds, 0),
    [visibleMarkets],
  )
  const { previewMarkets, previewExtraCount, claimableSignature, hasClaimableMarkets } =
    useMarketsWonClaimSignature(visibleMarkets)
  const { isDialogOpen, setIsDialogOpen, handleDialogOpenChange } = useMarketsWonDialogState()
  const { isSharingOnX, handleShareOnX } = useMarketsWonShareOnX({
    siteName,
    totalProceeds: visibleTotalProceeds,
    userUsername: user?.username,
    userDepositWalletAddress: user?.deposit_wallet_address,
  })

  function syncClaimedMarkets(claimedConditionIds: string[]) {
    if (claimedConditionIds.length === 0) {
      return
    }

    markLocallyClaimedConditionIds(claimedConditionIds)

    updateQueryDataWhere<InfiniteData<PublicPosition[]>>(
      queryClient,
      ['user-positions'],
      (currentQueryKey) => currentQueryKey[2] === 'active',
      (current) =>
        current
          ? {
              ...current,
              pages: current.pages.map((page) => removeClaimedPublicPositions(page, claimedConditionIds) ?? page),
            }
          : current,
    )

    setTimeout(() => {
      invalidatePortfolioClaimQueries(queryClient)
    }, 4_000)
    setTimeout(() => {
      invalidatePortfolioClaimQueries(queryClient)
    }, 12_000)

    router.refresh()
  }

  async function handleClaimAll() {
    if (isSubmitting) {
      return
    }

    if (!visibleMarkets.length) {
      toast.info(t('No claimable markets available right now.'))
      return
    }

    if (!ensureTradingReady()) {
      return
    }

    if (!user?.deposit_wallet_address || !user?.address) {
      toast.error(t('Set up your Deposit Wallet before claiming.'))
      return
    }

    const claimTargets = visibleMarkets.filter((market) => market.indexSets.length > 0)
    if (claimTargets.length === 0) {
      toast.info(t('No claimable markets available right now.'))
      return
    }

    for (const market of claimTargets) {
      if (!market.isNegRisk) {
        continue
      }

      const adapterAddress = normalizeAddress(market.negRiskAdapterAddress)
      if (!isCurrentNegRiskAdapterAddress(adapterAddress)) {
        toast.error(t('This action is currently unavailable for this market.'))
        return
      }
    }

    setIsSubmitting(true)

    try {
      const response = await runWithSignaturePrompt(() =>
        signAndSubmitDepositWalletCallItemsWithSplitFallback({
          user,
          items: claimTargets,
          getCall: (market) =>
            market.isNegRisk
              ? buildNegRiskRedeemPositionCall({
                  conditionId: market.conditionId as `0x${string}`,
                  yesAmount: market.yesShares ?? 0,
                  noAmount: market.noShares ?? 0,
                  contract: normalizeAddress(market.negRiskAdapterAddress) as `0x${string}`,
                })
              : buildRedeemPositionCall({
                  conditionId: market.conditionId as `0x${string}`,
                  indexSets: market.indexSets,
                }),
          metadata: 'redeem_positions',
          signTypedDataAsync,
        }),
      )

      if (response?.error) {
        if (response.code === 'wallet_connector_not_connected') {
          setIsDialogOpen(false)
          toast.error(t('Your wallet connection expired. Reconnect your wallet and try again.'))
          void openAppKit({ view: 'Connect' })
        } else if (isTradingAuthRequiredError(response.error)) {
          setIsDialogOpen(false)
          openTradeRequirements({ forceTradingAuth: true })
        } else {
          toast.error(response.error)
        }
        return
      }

      toast.success(t('Claim submitted'), {
        description:
          claimTargets.length > 1
            ? t('We sent a claim for your winning markets.')
            : t('We sent your claim transaction.'),
      })

      const claimedConditionIds = response.successfulItems.map((market) => market.conditionId)
      syncClaimedMarkets(claimedConditionIds)

      if (response.failedItems.length === 0) {
        setHiddenClaimSignature(claimableSignature)
      }

      if (response.partialFailure) {
        if (response.failure?.code === 'wallet_connector_not_connected') {
          setIsDialogOpen(false)
          toast.error(t('Your wallet connection expired. Reconnect your wallet and try again.'))
          void openAppKit({ view: 'Connect' })
          return
        }

        toast.error(t('We could not submit your claim. Please try again.'))

        const failureError = response.failure?.error
        if (failureError && isTradingAuthRequiredError(failureError)) {
          setIsDialogOpen(false)
          openTradeRequirements({ forceTradingAuth: true })
        }
        return
      }

      setIsDialogOpen(false)
      promptAutoRedeem()
    } catch (error) {
      if (error instanceof DepositWalletCallItemsSplitFallbackError) {
        const claimedConditionIds = (error.successfulItems as PortfolioClaimMarket[]).map(
          (market) => market.conditionId,
        )
        syncClaimedMarkets(claimedConditionIds)
        if (claimedConditionIds.length > 0) {
          toast.success(t('Claim submitted'), {
            description:
              claimedConditionIds.length > 1
                ? t('We sent a claim for your winning markets.')
                : t('We sent your claim transaction.'),
          })
          toast.error(t('We could not submit your claim. Please try again.'))
          return
        }
      }

      console.error('Failed to submit claim.', error)
      toast.error(t('We could not submit your claim. Please try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const shouldHideClaimCard =
    hiddenClaimSignature != null && hiddenClaimSignature === claimableSignature && claimableSignature.length > 0

  if (shouldHideClaimCard || visibleMarkets.length === 0) {
    return null
  }

  const claimTriggerButton = (
    <Button className="h-9 shrink-0 rounded-md px-3 text-xs sm:h-10 sm:px-7 sm:text-sm" disabled={!hasClaimableMarkets}>
      <BanknoteArrowDownIcon className="size-4" />
      {t('Claim')}
    </Button>
  )

  const claimCard = (
    <Card className="relative z-0 w-full rounded-lg border bg-transparent">
      <CardContent
        className={cn(
          `flex flex-nowrap items-center justify-between gap-2 p-3 sm:gap-4 sm:pl-4 md:gap-6 md:py-4 md:pr-4 md:pl-6`,
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-5">
          <div className="relative isolate h-10 w-14 shrink-0 sm:ml-2 sm:h-12 sm:w-17">
            {previewMarkets.map((market, index) => {
              const stackClassByIndex = [
                'left-[-0.625rem] top-0 -rotate-[13deg] z-10 sm:left-[-0.875rem]',
                'left-[0.25rem] top-[0.125rem] z-20 sm:left-[0.5rem]',
                'right-[-0.625rem] top-[0.125rem] rotate-[19deg] z-30 sm:right-[-0.875rem]',
              ] as const
              const stackClass =
                previewMarkets.length <= 1
                  ? 'left-[0.25rem] top-[0.125rem] z-20 sm:left-[0.5rem]'
                  : stackClassByIndex[Math.min(index, 2)]
              const showOverflowCount = index === 2 && previewExtraCount > 0

              return (
                <div
                  key={market.conditionId}
                  className={cn(
                    `absolute size-9 overflow-hidden rounded-lg border-2 border-foreground bg-muted shadow-sm motion-safe:animate-in motion-safe:duration-300 motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-reduce:animate-none sm:size-11 ${stackClass}`,
                  )}
                  style={{ animationDelay: `${index * 55}ms` }}
                >
                  {market?.imageUrl ? (
                    <EventIconImage
                      src={market.imageUrl}
                      alt={market.title}
                      sizes="(max-width: 640px) 36px, 44px"
                      containerClassName="size-full"
                    />
                  ) : (
                    <div className="grid size-full place-items-center text-2xs text-muted-foreground">?</div>
                  )}
                  {showOverflowCount && (
                    <div
                      className={cn(
                        `absolute inset-0 grid place-items-center bg-black/40 text-xs font-bold text-white sm:text-sm`,
                      )}
                    >
                      +{previewExtraCount}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="min-w-0 flex-1 text-left sm:pl-2">
            <p
              className={cn(
                `inline-flex max-w-full items-center gap-1.5 text-sm font-semibold whitespace-nowrap text-muted-foreground sm:gap-2 sm:text-base`,
              )}
            >
              <span>{t('You won')}</span>
              <span className="text-lg leading-none font-semibold text-foreground tabular-nums sm:text-2xl">
                {formatCurrency(visibleTotalProceeds)}
              </span>
            </p>
          </div>
        </div>

        {isMobile ? <DrawerTrigger render={claimTriggerButton} /> : <DialogTrigger render={claimTriggerButton} />}
      </CardContent>
    </Card>
  )

  const claimContent = (
    <>
      <div className="flex justify-center">
        <div
          className={cn(
            `pointer-events-none inline-flex items-center gap-2 text-2xl font-semibold text-foreground select-none`,
          )}
        >
          <SiteLogoIcon
            logoSvg={site.logoSvg}
            logoImageUrl={site.logoImageUrl}
            alt={`${site.name} ${t('logo')}`}
            className="size-8 text-current [&_svg]:size-8 [&_svg_*]:fill-current [&_svg_*]:stroke-current"
            imageClassName="size-8 object-contain"
            size={32}
          />
          <span>{siteName}</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="inline-flex items-center gap-2 text-foreground dark:text-white">
          <span className="text-xl font-semibold">{t('You won')}</span>
          <span className="text-3xl leading-none font-semibold tabular-nums">
            {formatCurrency(visibleTotalProceeds)}
          </span>
        </p>
        <p className="text-sm text-muted-foreground">{t('Great job predicting the future!')}</p>
      </div>

      <div className="max-h-[min(40vh,12rem)] space-y-2 overflow-y-auto pr-1 text-left">
        {visibleMarkets.map((market) => {
          const href = market.eventSlug ? (`/event/${market.eventSlug}` as Route) : null
          const itemClassName = [
            'flex w-full items-center gap-3 rounded-md p-3 transition-colors',
            href
              ? 'hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none dark:hover:bg-muted/20'
              : 'cursor-default',
          ].join(' ')
          const content = (
            <>
              <div className="relative size-12 overflow-hidden rounded-md">
                {market.imageUrl ? (
                  <EventIconImage
                    src={market.imageUrl}
                    alt={market.title}
                    sizes="48px"
                    containerClassName="size-full"
                  />
                ) : (
                  <div className="grid size-full place-items-center text-2xs text-muted-foreground">
                    {t('No image')}
                  </div>
                )}
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-foreground">{market.title}</p>
                <p className="text-xs text-muted-foreground">
                  {t('Invested')} {formatCurrency(market.invested)} • {t('Won')} {formatCurrency(market.proceeds)} (
                  {formatSignedPercent(market.returnPercent, 0)})
                </p>
              </div>
            </>
          )

          return href ? (
            <Link key={market.conditionId} href={href} className={itemClassName}>
              {content}
            </Link>
          ) : (
            <div key={market.conditionId} className={itemClassName} aria-disabled="true">
              {content}
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" className="h-10 flex-1" onClick={handleShareOnX} disabled={isSharingOnX}>
          <Image
            src="/images/social/x.svg"
            alt=""
            width={14}
            height={14}
            className="size-3.5 dark:invert"
            aria-hidden="true"
          />
          {isSharingOnX ? t('Opening...') : t('Share')}
        </Button>
        <Button className="h-10 flex-1" onClick={handleClaimAll} disabled={isSubmitting || !hasClaimableMarkets}>
          {isSubmitting ? t('Submitting...') : `${t('Claim')} ${formatCurrency(visibleTotalProceeds)}`}
        </Button>
      </div>
    </>
  )

  if (isMobile) {
    return (
      <Drawer open={isDialogOpen} onOpenChange={handleDialogOpenChange}>
        {claimCard}
        <DrawerContent className="max-h-[90vh] w-full space-y-4 overflow-y-auto bg-background px-5 pt-4 pb-5 text-center">
          <DrawerTitle className="sr-only">{t('You Won')}</DrawerTitle>
          {claimContent}
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={isDialogOpen} onOpenChange={handleDialogOpenChange}>
      {claimCard}
      <DialogContent className="max-w-88 space-y-4 p-5 text-center sm:p-6">
        <DialogTitle className="sr-only">{t('You Won')}</DialogTitle>
        {claimContent}
      </DialogContent>
    </Dialog>
  )
}
