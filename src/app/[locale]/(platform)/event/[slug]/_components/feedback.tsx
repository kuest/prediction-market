import type { QueryClient } from '@tanstack/react-query'

import { useExtracted } from 'next-intl'
import { useCallback } from 'react'

import type { OrderValidationError } from '@/lib/orders/validation'
import type { OrderSide } from '@/types'

import EventTradeToast from '@/app/[locale]/(platform)/event/[slug]/_components/EventTradeToast'
import { toast } from '@/components/ui/toast'
import { triggerConfetti } from '@/lib/confetti'
import { ORDER_SIDE, OUTCOME_INDEX } from '@/lib/constants'
import { formatCentsValueLabel, formatDollarValueLabel } from '@/lib/formatters'

type Translate = (message: string, values?: Record<string, string | number | Date>) => string

function defaultTranslate(message: string, values?: Record<string, string | number | Date>) {
  return message.replace(/\{(\w+)\}/g, (placeholder, key) => {
    const value = values?.[key]
    return value == null ? placeholder : String(value)
  })
}

export function useOrderFeedbackTranslate() {
  const t = useExtracted()

  return useCallback(
    (message: string, values?: Record<string, string | number | Date>) => {
      switch (message) {
        case 'Order already processing':
          return t('Order already processing')
        case 'Connect your wallet to continue.':
          return t('Connect your wallet to continue.')
        case 'Sign in to place orders.':
          return t('Sign in to place orders.')
        case 'Market not available':
          return t('Market not available')
        case 'Please select a valid market and outcome.':
          return t('Please select a valid market and outcome.')
        case 'Invalid amount':
          return t('Invalid amount')
        case 'Please enter an amount greater than 0.':
          return t('Please enter an amount greater than 0.')
        case 'Invalid limit price':
          return t('Invalid limit price')
        case 'Enter a valid limit price before submitting.':
          return t('Enter a valid limit price before submitting.')
        case 'Invalid shares':
          return t('Invalid shares')
        case 'Enter the number of shares for your limit order.':
          return t('Enter the number of shares for your limit order.')
        case 'Expiration must be in future. Try again':
          return t('Expiration must be in future. Try again')
        case 'Pick a future date and time for your custom expiration.':
          return t('Pick a future date and time for your custom expiration.')
        case 'Market buys must be at least $1':
          return t('Market buys must be at least $1')
        case 'Insufficient balance':
          return t('Insufficient balance')
        case 'Reduce the order size or deposit more into your Deposit Wallet.':
          return t('Reduce the order size or deposit more into your Deposit Wallet.')
        case 'Insufficient {shareLabel} shares':
          return t('Insufficient {shareLabel} shares', { shareLabel: String(values?.shareLabel ?? '') })
        case 'Insufficient shares':
          return t('Insufficient shares')
        case 'Reduce the order size or split more shares before selling.':
          return t('Reduce the order size or split more shares before selling.')
        case 'Unable to submit order. Please review your inputs.':
          return t('Unable to submit order. Please review your inputs.')
        case 'Total':
          return t('Total')
        case 'Received':
          return t('Received')
        case 'Sell {shares} shares on {outcome}':
          return t('Sell {shares} shares on {outcome}', {
            shares: String(values?.shares ?? ''),
            outcome: String(values?.outcome ?? ''),
          })
        case '{label} {amount} @ {price}':
          return t('{label} {amount} @ {price}', {
            label: String(values?.label ?? ''),
            amount: String(values?.amount ?? ''),
            price: String(values?.price ?? ''),
          })
        case 'Buy {shares} shares on {outcome}':
          return t('Buy {shares} shares on {outcome}', {
            shares: String(values?.shares ?? ''),
            outcome: String(values?.outcome ?? ''),
          })
        case 'Buy {amount} on {outcome}':
          return t('Buy {amount} on {outcome}', {
            amount: String(values?.amount ?? ''),
            outcome: String(values?.outcome ?? ''),
          })
        case 'Trade cancelled':
          return t('Trade cancelled')
        case 'You rejected the request in your wallet.':
          return t('You rejected the request in your wallet.')
        case 'Sell unavailable':
          return t('Sell unavailable')
        case 'Market data is unavailable.':
          return t('Market data is unavailable.')
        case 'Order book unavailable':
          return t('Order book unavailable')
        case 'Please try again in a moment.':
          return t('Please try again in a moment.')
        case 'Trade failed':
          return t('Trade failed')
        case 'No liquidity for this market order.':
          return t('No liquidity for this market order.')
        case 'Wallet not ready for trading.':
          return t('Wallet not ready for trading.')
        case 'Invalid share amount.':
          return t('Invalid share amount.')
        case 'We could not sign your order. Please try again.':
          return t('We could not sign your order. Please try again.')
        case 'An unexpected error occurred. Please try again.':
          return t('An unexpected error occurred. Please try again.')
        default:
          return defaultTranslate(message, values)
      }
    },
    [t],
  )
}

interface HandleValidationErrorArgs {
  openWalletModal: () => Promise<void> | void
  shareLabel?: string
  translate: Translate
}

interface OrderSuccessFeedbackArgs {
  side: OrderSide
  amountInput: string
  buyAmountValue?: number
  buySharesLabel?: string
  sellSharesLabel?: string
  isLimitOrder?: boolean
  outcomeText: string
  eventTitle: string
  marketImage?: string
  marketTitle?: string
  sellAmountValue: number
  avgSellPrice: string
  buyPrice?: number
  queryClient: QueryClient
  outcomeIndex: number
  lastMouseEvent: any
  translate?: Translate
}

export function handleValidationError(
  reason: OrderValidationError,
  { openWalletModal, shareLabel, translate }: HandleValidationErrorArgs,
) {
  switch (reason) {
    case 'IS_LOADING':
      toast.info(translate('Order already processing'))
      break
    case 'NOT_CONNECTED':
      toast.error(translate('Connect your wallet to continue.'))
      void openWalletModal()
      break
    case 'MISSING_USER':
      toast.error(translate('Sign in to place orders.'))
      void openWalletModal()
      break
    case 'MISSING_MARKET':
    case 'MISSING_OUTCOME':
      toast.error(translate('Market not available'), {
        description: translate('Please select a valid market and outcome.'),
      })
      break
    case 'INVALID_AMOUNT':
      toast.error(translate('Invalid amount'), {
        description: translate('Please enter an amount greater than 0.'),
      })
      break
    case 'INVALID_LIMIT_PRICE':
      toast.error(translate('Invalid limit price'), {
        description: translate('Enter a valid limit price before submitting.'),
      })
      break
    case 'INVALID_LIMIT_SHARES':
      toast.error(translate('Invalid shares'), {
        description: translate('Enter the number of shares for your limit order.'),
      })
      break
    case 'INVALID_LIMIT_EXPIRATION':
      toast.error(translate('Expiration must be in future. Try again'), {
        description: translate('Pick a future date and time for your custom expiration.'),
      })
      break
    case 'MARKET_MIN_AMOUNT':
      toast.error(translate('Market buys must be at least $1'))
      break
    case 'INSUFFICIENT_BALANCE':
      toast.error(translate('Insufficient balance'), {
        description: translate('Reduce the order size or deposit more into your Deposit Wallet.'),
      })
      break
    case 'INSUFFICIENT_SHARES': {
      const title = shareLabel
        ? translate('Insufficient {shareLabel} shares', { shareLabel })
        : translate('Insufficient shares')
      toast.error(title, {
        description: translate('Reduce the order size or split more shares before selling.'),
      })
      break
    }
    default:
      toast.error(translate('Unable to submit order. Please review your inputs.'))
  }
}

export function handleOrderSuccessFeedback({
  side,
  amountInput,
  buyAmountValue,
  buySharesLabel,
  sellSharesLabel,
  isLimitOrder,
  outcomeText,
  eventTitle,
  marketImage,
  marketTitle,
  sellAmountValue,
  avgSellPrice,
  buyPrice,
  queryClient,
  outcomeIndex,
  lastMouseEvent,
  translate = defaultTranslate,
}: OrderSuccessFeedbackArgs) {
  if (side === ORDER_SIDE.SELL) {
    const displayShares = sellSharesLabel && sellSharesLabel.trim().length > 0 ? sellSharesLabel.trim() : amountInput
    const amountPrefix = isLimitOrder ? translate('Total') : translate('Received')
    toast.success(translate('Sell {shares} shares on {outcome}', { shares: displayShares, outcome: outcomeText }), {
      content: (
        <EventTradeToast title={eventTitle} marketImage={marketImage} marketTitle={marketTitle}>
          {translate('{label} {amount} @ {price}', {
            label: amountPrefix,
            amount: formatDollarValueLabel(sellAmountValue, { fallback: '0¢' }),
            price: avgSellPrice,
          })}
        </EventTradeToast>
      ),
    })
  } else {
    const amountValue = typeof buyAmountValue === 'number' ? buyAmountValue : Number.parseFloat(amountInput || '0') || 0
    const normalizedBuySharesLabel = buySharesLabel?.trim()
    const buyAmountLabel = formatDollarValueLabel(amountValue, { fallback: '0¢' })
    const priceLabel = formatCentsValueLabel(buyPrice, { fallback: '—' })

    toast.success(
      normalizedBuySharesLabel
        ? translate('Buy {shares} shares on {outcome}', { shares: normalizedBuySharesLabel, outcome: outcomeText })
        : translate('Buy {amount} on {outcome}', { amount: buyAmountLabel, outcome: outcomeText }),
      {
        content: (
          <EventTradeToast title={eventTitle} marketImage={marketImage} marketTitle={marketTitle}>
            {translate('{label} {amount} @ {price}', {
              label: translate('Total'),
              amount: buyAmountLabel,
              price: priceLabel,
            })}
          </EventTradeToast>
        ),
      },
    )
  }

  triggerConfetti(outcomeIndex === OUTCOME_INDEX.YES ? 'yes' : 'no', lastMouseEvent)

  void queryClient.invalidateQueries({
    queryKey: ['user-conditional-shares'],
  })
}

export function handleOrderErrorFeedback(message: string, description?: string) {
  toast.error(message, description ? { description } : undefined)
}

export function handleOrderCancelledFeedback(translate: Translate) {
  toast.error(translate('Trade cancelled'), {
    description: translate('You rejected the request in your wallet.'),
  })
}
