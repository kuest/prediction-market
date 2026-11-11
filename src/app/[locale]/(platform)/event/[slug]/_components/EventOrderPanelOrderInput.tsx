'use client'

import type { RefObject } from 'react'

import { TriangleAlertIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'

import type { EventOrderPanelOutcomeSelectedAccent } from '@/app/[locale]/(platform)/event/[slug]/_components/EventOrderPanelOutcomeButton'
import type { useBalance } from '@/hooks/useBalance'
import type { OUTCOME_INDEX } from '@/lib/constants'
import type { LimitExpirationOption } from '@/lib/orders/expiration'

import EventOrderPanelEarnings from '@/app/[locale]/(platform)/event/[slug]/_components/EventOrderPanelEarnings'
import EventOrderPanelInput from '@/app/[locale]/(platform)/event/[slug]/_components/EventOrderPanelInput'
import EventOrderPanelLimitControls from '@/app/[locale]/(platform)/event/[slug]/_components/EventOrderPanelLimitControls'
import EventOrderPanelSubmitButton from '@/app/[locale]/(platform)/event/[slug]/_components/EventOrderPanelSubmitButton'
import EventOrderPanelUserShares from '@/app/[locale]/(platform)/event/[slug]/_components/EventOrderPanelUserShares'
import { ORDER_SIDE } from '@/lib/constants'
import { cn } from '@/lib/utils'

interface EventOrderPanelOrderInputProps {
  isMobile: boolean
  side: typeof ORDER_SIDE.BUY | typeof ORDER_SIDE.SELL
  isLimitOrder: boolean
  amount: string
  amountNumber: number
  availableShares: number
  availableYesTokenShares: number
  availableNoTokenShares: number
  outcomeIndex: typeof OUTCOME_INDEX.YES | typeof OUTCOME_INDEX.NO | undefined
  balance: ReturnType<typeof useBalance>['balance']
  maxBuyAmount?: number
  isBalanceLoading: boolean
  isBalanceError: boolean
  onRetryBalance: () => void
  inputRef: RefObject<HTMLInputElement | null>
  shouldShakeInput: boolean
  shouldShowEarnings: boolean
  sellAmountLabel: string
  avgSellPriceLabel: string
  avgBuyPriceLabel: string
  avgSellPriceCentsValue: number | null
  avgBuyPriceCentsValue: number | null
  buyPayoutSummary: {
    payout: number
    cost: number
    profit: number
    changePct: number
    multiplier: number
  }
  totalFee: number | null
  shouldShowResolvedMarketMinimumWarning: boolean
  shouldShowResolvedNoLiquidityWarning: boolean
  showInsufficientSharesWarning: boolean
  showInsufficientBalanceWarning: boolean
  showAmountTooLowWarning: boolean
  limitPrice: string
  limitShares: string
  limitExpirationOption: LimitExpirationOption
  limitExpirationTimestamp: number | null
  limitMatchingShares: number | null
  liquidityRewardMinShares?: number
  shouldShowLimitMinimumWarning: boolean
  shouldShakeLimitShares: boolean
  limitSharesRef: RefObject<HTMLInputElement | null>
  onAmountChange: (nextAmount: string) => void
  onLimitPriceChange: (nextLimitPrice: string) => void
  onLimitSharesChange: (nextLimitShares: string) => void
  onLimitExpirationOptionChange: (option: LimitExpirationOption) => void
  onLimitExpirationTimestampChange: (timestamp: number | null) => void
  onAmountUpdateFromLimit: (amount: string) => void
  isInteractiveWalletReady: boolean
  shouldShowDepositCta: boolean
  isLoading: boolean
  selectedSubmitAccent: EventOrderPanelOutcomeSelectedAccent | null
  outcomeButtonStyleVariant: 'default' | 'sports3d'
  submitButtonLabel: string
  onSubmitButtonClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}

export default function EventOrderPanelOrderInput({
  isMobile,
  side,
  isLimitOrder,
  amount,
  amountNumber,
  availableShares,
  availableYesTokenShares,
  availableNoTokenShares,
  outcomeIndex,
  balance,
  maxBuyAmount,
  isBalanceLoading,
  isBalanceError,
  onRetryBalance,
  inputRef,
  shouldShakeInput,
  shouldShowEarnings,
  sellAmountLabel,
  avgSellPriceLabel,
  avgBuyPriceLabel,
  avgSellPriceCentsValue,
  avgBuyPriceCentsValue,
  buyPayoutSummary,
  totalFee,
  shouldShowResolvedMarketMinimumWarning,
  shouldShowResolvedNoLiquidityWarning,
  showInsufficientSharesWarning,
  showInsufficientBalanceWarning,
  showAmountTooLowWarning,
  limitPrice,
  limitShares,
  limitExpirationOption,
  limitExpirationTimestamp,
  limitMatchingShares,
  liquidityRewardMinShares,
  shouldShowLimitMinimumWarning,
  shouldShakeLimitShares,
  limitSharesRef,
  onAmountChange,
  onLimitPriceChange,
  onLimitSharesChange,
  onLimitExpirationOptionChange,
  onLimitExpirationTimestampChange,
  onAmountUpdateFromLimit,
  isInteractiveWalletReady,
  shouldShowDepositCta,
  isLoading,
  selectedSubmitAccent,
  outcomeButtonStyleVariant,
  submitButtonLabel,
  onSubmitButtonClick,
}: EventOrderPanelOrderInputProps) {
  const t = useExtracted()

  return (
    <>
      {isLimitOrder ? (
        <div className="mb-4">
          {side === ORDER_SIDE.SELL && (
            <EventOrderPanelUserShares
              yesShares={availableYesTokenShares}
              noShares={availableNoTokenShares}
              activeOutcome={outcomeIndex}
            />
          )}
          <EventOrderPanelLimitControls
            side={side}
            limitPrice={limitPrice}
            limitShares={limitShares}
            limitExpirationOption={limitExpirationOption}
            limitExpirationTimestamp={limitExpirationTimestamp}
            isLimitOrder={isLimitOrder}
            matchingShares={limitMatchingShares}
            liquidityRewardMinShares={liquidityRewardMinShares}
            availableShares={availableShares}
            showLimitMinimumWarning={shouldShowLimitMinimumWarning}
            shouldShakeShares={shouldShakeLimitShares}
            limitSharesRef={limitSharesRef}
            onLimitPriceChange={onLimitPriceChange}
            onLimitSharesChange={onLimitSharesChange}
            onLimitExpirationOptionChange={onLimitExpirationOptionChange}
            onLimitExpirationTimestampChange={onLimitExpirationTimestampChange}
            onAmountUpdateFromLimit={onAmountUpdateFromLimit}
          />
        </div>
      ) : (
        <>
          {side === ORDER_SIDE.SELL ? (
            <EventOrderPanelUserShares
              yesShares={availableYesTokenShares}
              noShares={availableNoTokenShares}
              activeOutcome={outcomeIndex}
            />
          ) : (
            <div className="mb-4"></div>
          )}
          <EventOrderPanelInput
            isMobile={isMobile}
            side={side}
            amount={amount}
            amountNumber={amountNumber}
            availableShares={availableShares}
            balance={balance}
            maxBuyAmount={maxBuyAmount}
            isBalanceLoading={isBalanceLoading}
            inputRef={inputRef}
            onAmountChange={onAmountChange}
            shouldShake={shouldShakeInput}
          />
          <div
            className={cn(
              'overflow-hidden transition-all duration-500 ease-in-out',
              shouldShowEarnings
                ? 'max-h-96 translate-y-0 opacity-100'
                : 'pointer-events-none max-h-0 -translate-y-2 opacity-0',
            )}
            aria-hidden={!shouldShowEarnings}
          >
            <EventOrderPanelEarnings
              isMobile={isMobile}
              side={side}
              sellAmountLabel={sellAmountLabel}
              avgSellPriceLabel={avgSellPriceLabel}
              avgBuyPriceLabel={avgBuyPriceLabel}
              avgSellPriceCents={avgSellPriceCentsValue}
              avgBuyPriceCents={avgBuyPriceCentsValue}
              buyPayout={buyPayoutSummary.payout}
              buyProfit={buyPayoutSummary.profit}
              buyChangePct={buyPayoutSummary.changePct}
              buyMultiplier={buyPayoutSummary.multiplier}
              totalFee={totalFee}
            />
          </div>
          {shouldShowResolvedMarketMinimumWarning && (
            <div
              className={cn(
                `mt-3 flex animate-order-shake items-center justify-center gap-2 pb-1 text-sm font-semibold text-orange-500`,
              )}
            >
              <TriangleAlertIcon className="size-4" />
              {t('Market buys must be at least $1')}
            </div>
          )}
          {shouldShowResolvedNoLiquidityWarning && (
            <div
              className={cn(
                `mt-3 flex animate-order-shake items-center justify-center gap-2 pb-1 text-sm font-semibold text-orange-500`,
              )}
            >
              <TriangleAlertIcon className="size-4" />
              {t('No liquidity for this market order')}
            </div>
          )}
        </>
      )}

      {(showInsufficientSharesWarning || showInsufficientBalanceWarning || showAmountTooLowWarning) && (
        <div
          className={cn(
            `mt-2 mb-3 flex animate-order-shake items-center justify-center gap-2 text-sm font-semibold text-orange-500`,
          )}
        >
          <TriangleAlertIcon className="size-4" />
          {showAmountTooLowWarning
            ? t('Amount too low')
            : showInsufficientBalanceWarning
              ? t('Insufficient USDC balance')
              : t('Insufficient shares for this order')}
        </div>
      )}

      {isBalanceError && side === ORDER_SIDE.BUY && (
        <div className="mt-2 mb-3 flex items-center justify-center gap-2 text-center text-sm font-semibold text-orange-500">
          <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
          <span>{t('Could not validate USDC balance right now.')}</span>
          <button type="button" className="underline underline-offset-2" onClick={onRetryBalance}>
            {t('Retry')}
          </button>
        </div>
      )}

      <EventOrderPanelSubmitButton
        type={!isInteractiveWalletReady || shouldShowDepositCta ? 'button' : 'submit'}
        isLoading={isLoading}
        isDisabled={isLoading || (side === ORDER_SIDE.BUY && isBalanceError)}
        selectedAccent={selectedSubmitAccent}
        styleVariant={outcomeButtonStyleVariant}
        onClick={onSubmitButtonClick}
        label={submitButtonLabel}
      />
    </>
  )
}
