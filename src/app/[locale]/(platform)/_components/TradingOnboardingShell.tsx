'use client'

import type { ComponentProps } from 'react'

import dynamic from 'next/dynamic'
import { useState, useSyncExternalStore } from 'react'

import {
  listMeldPendingCheckouts,
  MELD_CHECKOUT_CLEARED_EVENT,
  MELD_CHECKOUT_POLL_EVENT,
  MELD_CHECKOUT_URL_EVENT,
} from '@/lib/payments/meld-return-channel'

import type TradingOnboardingDialogsComponent from './TradingOnboardingDialogs'

type TradingOnboardingShellProps = ComponentProps<typeof TradingOnboardingDialogsComponent>

const TradingOnboardingDialogs = dynamic(() => import('./TradingOnboardingDialogs'), { ssr: false })
const WalletFlow = dynamic(() => import('./WalletFlow').then((module) => module.WalletFlow), { ssr: false })

const paymentEvents = [
  MELD_CHECKOUT_CLEARED_EVENT,
  MELD_CHECKOUT_POLL_EVENT,
  MELD_CHECKOUT_URL_EVENT,
  'storage',
  'popstate',
  'pageshow',
] as const

function subscribeToPaymentResume(onStoreChange: () => void) {
  for (const event of paymentEvents) {
    window.addEventListener(event, onStoreChange)
  }
  return function unsubscribeFromPaymentResume() {
    for (const event of paymentEvents) {
      window.removeEventListener(event, onStoreChange)
    }
  }
}

function getPaymentResumeSnapshot() {
  // WalletFlow also clears expired and invalid checkout parameters on mount.
  return new URL(window.location.href).searchParams.has('meldCheckoutId') || listMeldPendingCheckouts().length > 0
}

function getPaymentResumeServerSnapshot() {
  return false
}

export default function TradingOnboardingShell(props: TradingOnboardingShellProps) {
  const hasPendingPayment = useSyncExternalStore(
    subscribeToPaymentResume,
    getPaymentResumeSnapshot,
    getPaymentResumeServerSnapshot,
  )
  const needsDialogs = props.activeModal !== null || props.fundModalOpen
  const needsWallet = props.depositModalOpen || props.withdrawModalOpen || hasPendingPayment
  const [hasOpenedDialogs, setHasOpenedDialogs] = useState(false)
  const [hasOpenedWallet, setHasOpenedWallet] = useState(false)

  if (needsDialogs && !hasOpenedDialogs) {
    setHasOpenedDialogs(true)
  }
  if (needsWallet && !hasOpenedWallet) {
    setHasOpenedWallet(true)
  }

  return (
    <>
      {hasOpenedDialogs && <TradingOnboardingDialogs {...props} />}
      {hasOpenedWallet && (
        <WalletFlow
          depositOpen={props.depositModalOpen}
          onDepositOpenChange={props.onDepositOpenChange}
          withdrawOpen={props.withdrawModalOpen}
          onWithdrawOpenChange={props.onWithdrawOpenChange}
          user={props.user}
          canBuyMeld={props.canBuyMeld}
        />
      )}
    </>
  )
}
