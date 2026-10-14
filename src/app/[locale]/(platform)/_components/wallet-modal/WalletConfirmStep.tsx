'use client'

import { ChevronRightIcon, FuelIcon, InfoIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'
import Image from 'next/image'
import { useState } from 'react'

import type { LiFiWalletTokenItem } from '@/hooks/useLiFiWalletTokens'

import WalletTransferSummary, {
  WalletTransferSummaryDivider,
  WalletTransferSummaryRow,
} from '@/app/[locale]/(platform)/_components/wallet-modal/WalletTransferSummary'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useDirectUsdcDepositExecution } from '@/hooks/useDirectUsdcDepositExecution'
import { useLiFiExecution } from '@/hooks/useLiFiExecution'
import { useLiFiQuote } from '@/hooks/useLiFiQuote'
import { formatDisplayAmount } from '@/lib/amount-input'
import { cn } from '@/lib/utils'

function WalletConfirmStep({
  walletEoaAddress,
  walletAddress,
  siteLabel,
  onComplete,
  amountValue,
  selectedToken,
  quote,
  refreshIndex,
  executionMode = 'lifi',
}: {
  walletEoaAddress?: string | null
  walletAddress?: string | null
  siteLabel: string
  onComplete: () => void
  amountValue: string
  selectedToken?: LiFiWalletTokenItem | null
  quote?: { toAmountDisplay: string | null; gasUsdDisplay: string | null } | null
  refreshIndex: number
  executionMode?: 'lifi' | 'direct-usdc'
}) {
  const t = useExtracted()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hasExecutionError, setHasExecutionError] = useState(false)
  const [isBreakdownOpen, setIsBreakdownOpen] = useState(false)
  const formattedAmount = formatDisplayAmount(amountValue)
  const displayAmount = formattedAmount && formattedAmount.trim() !== '' ? formattedAmount : '0.00'
  const {
    quote: fetchedQuote,
    isLoadingQuote,
    isQuoteError,
    refetchQuote,
  } = useLiFiQuote({
    fromToken: selectedToken,
    amountValue,
    fromAddress: walletEoaAddress,
    toAddress: walletAddress,
    refreshIndex,
    enabled: executionMode === 'lifi',
  })
  const effectiveQuote = quote ?? (executionMode === 'lifi' ? fetchedQuote : null)
  const hasAmount = amountValue.trim() !== ''
  const isQuoteLoading = isLoadingQuote && hasAmount
  const hasQuoteError = executionMode === 'lifi' && isQuoteError && !isLoadingQuote
  const status: 'quote' | 'gas' | 'ready' = effectiveQuote ? 'ready' : isLoadingQuote ? 'gas' : 'quote'
  const {
    execute: executeLiFi,
    isExecuting: isExecutingLiFi,
    pendingTransaction: pendingLiFiTransaction,
  } = useLiFiExecution({
    fromToken: selectedToken,
    amountValue,
    fromAddress: walletEoaAddress,
    toAddress: walletAddress,
  })
  const {
    execute: executeDirectUsdcDeposit,
    isExecuting: isExecutingDirectUsdcDeposit,
    pendingTransaction: pendingDirectTransaction,
  } = useDirectUsdcDepositExecution({
    amountValue,
    fromAddress: walletEoaAddress,
    toAddress: walletAddress,
  })
  const execute = executionMode === 'direct-usdc' ? executeDirectUsdcDeposit : executeLiFi
  const isExecuting = executionMode === 'direct-usdc' ? isExecutingDirectUsdcDeposit : isExecutingLiFi
  const pendingTransaction = executionMode === 'direct-usdc' ? pendingDirectTransaction : pendingLiFiTransaction
  const isCtaDisabled =
    isExecuting || isSubmitting || (!pendingTransaction && ((!effectiveQuote && !hasQuoteError) || isLoadingQuote))
  const sendSymbol = selectedToken?.symbol ?? 'Token'
  const sendIcon = selectedToken?.icon ?? '/images/deposit/transfer/polygon_dark.png'
  const chainIcon = selectedToken?.chainIcon ?? '/images/deposit/transfer/polygon_dark.png'
  const receiveAmountDisplay = effectiveQuote?.toAmountDisplay ?? '—'
  const gasUsdDisplay = effectiveQuote?.gasUsdDisplay ?? null

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-center">
        <p className="text-5xl font-semibold text-foreground">{displayAmount}</p>
      </div>

      <div className="space-y-3">
        <WalletTransferSummary
          walletEoaAddress={walletEoaAddress}
          walletAddress={walletAddress}
          siteLabel={siteLabel}
          extraRows={
            <>
              <WalletTransferSummaryDivider />
              <WalletTransferSummaryRow label={t('Estimated time')} value={t('< 1 min')} />
            </>
          }
        />

        <div className="rounded-lg border">
          <div className="px-4 py-1.5 text-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>{t('You send')}</span>
              <span className="flex items-center gap-2 font-semibold text-foreground">
                <span className="relative">
                  <Image src={sendIcon} alt={sendSymbol} width={18} height={18} className="rounded-full" unoptimized />
                  <span className="absolute -right-1 -bottom-1 rounded-full bg-background p-0.5">
                    <Image
                      src={chainIcon}
                      alt={selectedToken?.network ?? t('Chain')}
                      width={10}
                      height={10}
                      className="rounded-full"
                      unoptimized={chainIcon.startsWith('http')}
                    />
                  </span>
                </span>
                {displayAmount} {sendSymbol}
              </span>
            </div>
          </div>
          <div className="mx-auto h-px w-[90%] bg-border/60" />
          <div className="px-4 py-1.5 text-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>{t('You receive')}</span>
              {isQuoteLoading ? (
                <Skeleton className="h-4 w-28 rounded-full" />
              ) : (
                <span className="flex items-center gap-2 font-semibold text-foreground">
                  <span className="relative">
                    <Image
                      src="/images/deposit/transfer/usdc_dark.png"
                      alt="USDC"
                      width={18}
                      height={18}
                      className="rounded-full"
                    />
                    <span className="absolute -right-1 -bottom-1 rounded-full bg-background p-0.5">
                      <Image
                        src="/images/deposit/transfer/polygon_dark.png"
                        alt="Polygon"
                        width={10}
                        height={10}
                        className="rounded-full"
                      />
                    </span>
                  </span>
                  {receiveAmountDisplay} USDC
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2 text-xs text-muted-foreground">
        <button
          type="button"
          className="flex w-full items-center justify-between text-xs text-muted-foreground"
          onClick={() => setIsBreakdownOpen((current) => !current)}
          disabled={isQuoteLoading}
        >
          <span>{t('Transaction breakdown')}</span>
          <span className="flex items-center gap-1">
            {isQuoteLoading ? (
              <Skeleton className="h-3 w-20 rounded-full" />
            ) : (
              <>
                {!isBreakdownOpen && <span>{gasUsdDisplay ? `$${gasUsdDisplay}` : '—'}</span>}
                <ChevronRightIcon className={cn('size-3 transition', { 'rotate-90': isBreakdownOpen })} />
              </>
            )}
          </span>
        </button>
        {isBreakdownOpen && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1">
                {t('Network cost')}
                <Tooltip>
                  <TooltipTrigger render={<InfoIcon className="size-3" />} />
                  <TooltipContent>
                    <div className="space-y-1 text-xs text-foreground">
                      <div className="flex items-center justify-between gap-4">
                        <span>{t('Total cost')}</span>
                        <span className="text-right">{gasUsdDisplay ? `$${gasUsdDisplay}` : '—'}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span>{t('Source chain gas')}</span>
                        <span className="text-right">{gasUsdDisplay ? `$${gasUsdDisplay}` : '—'}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span>{t('Destination chain gas')}</span>
                        <span className="text-right">—</span>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </span>
              <span className="flex items-center gap-2">
                <FuelIcon className="size-3" />
                {gasUsdDisplay ? `$${gasUsdDisplay}` : '—'}
              </span>
            </div>
          </div>
        )}
      </div>

      <Badge variant="outline" className="w-full p-3 text-muted-foreground">
        {t('By clicking on Confirm Order, you agree to our')}{' '}
        <a href="/tos" target="_blank" rel="noreferrer" className="underline">
          {t('terms')}
        </a>
        .
      </Badge>
      {(hasQuoteError || hasExecutionError || pendingTransaction) && (
        <p role="alert" className={cn('text-sm', pendingTransaction ? 'text-muted-foreground' : 'text-destructive')}>
          {pendingTransaction
            ? t('Transaction sent. Check its status before trying again.')
            : t('An unexpected error occurred. Please try again.')}
        </p>
      )}
      <Button
        type="button"
        className="h-12 w-full"
        disabled={isCtaDisabled}
        onClick={async () => {
          if (hasQuoteError && !pendingTransaction) {
            await refetchQuote()
            return
          }
          if (status !== 'ready' && !pendingTransaction) {
            return
          }
          try {
            setIsSubmitting(true)
            setHasExecutionError(false)
            await execute()
            onComplete()
          } catch {
            setHasExecutionError(true)
          } finally {
            setIsSubmitting(false)
          }
        }}
      >
        {(isLoadingQuote || isSubmitting || isExecuting) && <Spinner className="size-4" />}
        {pendingTransaction && t('Check transaction status')}
        {!pendingTransaction && isSubmitting && t('Confirm transaction in your wallet')}
        {!pendingTransaction && !isSubmitting && hasQuoteError && t('Try again')}
        {!pendingTransaction && !isSubmitting && !hasQuoteError && status === 'quote' && t('Preparing your quote...')}
        {!pendingTransaction && !isSubmitting && status === 'gas' && t('Estimating gas...')}
        {!pendingTransaction && !isSubmitting && !hasQuoteError && status === 'ready' && t('Confirm order')}
      </Button>
    </div>
  )
}

export default WalletConfirmStep
