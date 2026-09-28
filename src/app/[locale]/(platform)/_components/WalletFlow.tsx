'use client'

import { useExtracted } from 'next-intl'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isAddress } from 'viem'
import { useSignTypedData } from 'wagmi'

import type { DepositWalletStatus } from '@/types'

import { WalletDepositModal, WalletWithdrawModal } from '@/app/[locale]/(platform)/_components/WalletModal'
import { useTradingOnboarding } from '@/app/[locale]/(platform)/_providers/TradingOnboardingProvider'
import { MeldReturnStatus } from '@/app/[locale]/payments/meld/return/MeldReturnStatus'
import { toast } from '@/components/ui/toast'
import { useAppKit } from '@/hooks/useAppKit'
import { useBalance } from '@/hooks/useBalance'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useLiFiWalletUsdBalance } from '@/hooks/useLiFiWalletUsdBalance'
import { useSignaturePromptRunner } from '@/hooks/useSignaturePromptRunner'
import { useSiteIdentity } from '@/hooks/useSiteIdentity'
import { MAX_AMOUNT_INPUT } from '@/lib/amount-input'
import { DEFAULT_ERROR_MESSAGE } from '@/lib/constants'
import { COLLATERAL_TOKEN_ADDRESS } from '@/lib/contracts'
import { formatAmountInputValue } from '@/lib/formatters'
import { IS_TEST_MODE } from '@/lib/network'
import {
  clearMeldPendingCheckout,
  ensureMeldPendingCheckout,
  getMeldCheckoutIdFromUrl,
  getMeldCheckoutPollDelay,
  getMeldPendingCheckout,
  isMeldCheckoutId,
  isMeldCheckoutReturnMessage,
  isMeldCheckoutUnauthorized,
  listMeldPendingCheckouts,
  markMeldCheckoutUnauthorized,
  MELD_CHECKOUT_CLEARED_EVENT,
  MELD_CHECKOUT_POLL_EVENT,
  MELD_CHECKOUT_RETURN_CHANNEL,
  removeMeldCheckoutIdFromUrl,
  resumeMeldCheckoutPolling,
  setMeldCheckoutIdInUrl,
} from '@/lib/payments/meld-return-channel'
import { startMeldCheckout } from '@/lib/payments/start-meld-checkout'
import { isTradingAuthRequiredError } from '@/lib/trading-auth/errors'
import { signAndSubmitDepositWalletCalls } from '@/lib/wallet/client'
import { buildSendErc20Call } from '@/lib/wallet/transactions'

type DepositView = 'fund' | 'receive' | 'wallets' | 'amount' | 'confirm' | 'success'

interface WalletFlowProps {
  depositOpen: boolean
  onDepositOpenChange: (open: boolean) => void
  withdrawOpen: boolean
  onWithdrawOpenChange: (open: boolean) => void
  user: {
    id: string
    address: string
    deposit_wallet_address?: string | null
    deposit_wallet_status?: DepositWalletStatus | null
  } | null
  canBuyMeld: boolean
}

interface WalletSendMessages {
  depositWalletRequired: string
  invalidRecipient: string
  invalidAmount: string
  reconnectWallet: string
  withdrawalSubmitted: string
  withdrawalSubmittedDescription: string
}

const MELD_CHECKOUT_POPUP_REFERENCE_TTL_MS = 24 * 60 * 60 * 1_000

const WalletLiFiBridge = dynamic(() => import('@/app/[locale]/(platform)/_components/wallet-modal/WalletLiFiBridge'), {
  ssr: false,
  loading: () => null,
})

interface MeldCheckoutPopupReference {
  popup: Window
  expiresAt: number
  cleanupTimer: ReturnType<typeof setTimeout>
}

interface MeldCheckoutPoll {
  checkoutId: string
  controller: AbortController
  expiresAt: number
  attempt: number
  timeout?: ReturnType<typeof setTimeout>
  resolveWait?: () => void
}

interface MeldCheckoutPollControl {
  stop: (checkoutId: string) => void
}

function useDepositViewState(onDepositOpenChange: (open: boolean) => void) {
  const [depositView, setDepositView] = useState<DepositView>('fund')

  const handleDepositModalChange = useCallback(
    (next: boolean) => {
      onDepositOpenChange(next)
      if (!next) {
        setDepositView('fund')
      }
    },
    [onDepositOpenChange],
  )

  return { depositView, setDepositView, handleDepositModalChange }
}

function useWithdrawFormState(onWithdrawOpenChange: (open: boolean) => void) {
  const [walletSendTo, setWalletSendTo] = useState('')
  const [walletSendAmount, setWalletSendAmount] = useState('')
  const [isWalletSending, setIsWalletSending] = useState(false)

  const handleWithdrawModalChange = useCallback(
    (next: boolean) => {
      onWithdrawOpenChange(next)
      if (!next) {
        setIsWalletSending(false)
        setWalletSendTo('')
        setWalletSendAmount('')
      }
    },
    [onWithdrawOpenChange],
  )

  return {
    walletSendTo,
    setWalletSendTo,
    walletSendAmount,
    setWalletSendAmount,
    isWalletSending,
    setIsWalletSending,
    handleWithdrawModalChange,
  }
}

function useHasDeployedDepositWallet(user: WalletFlowProps['user']) {
  return useMemo(
    () => Boolean(user?.deposit_wallet_address && user?.deposit_wallet_status === 'deployed'),
    [user?.deposit_wallet_address, user?.deposit_wallet_status],
  )
}

function useWalletSendHandler({
  user,
  walletSendTo,
  walletSendAmount,
  setIsWalletSending,
  setWalletSendTo,
  setWalletSendAmount,
  handleWithdrawModalChange,
  openTradeRequirements,
  openWalletModal,
  runWithSignaturePrompt,
  signTypedDataAsync,
  messages,
}: {
  user: WalletFlowProps['user']
  walletSendTo: string
  walletSendAmount: string
  setIsWalletSending: (value: boolean) => void
  setWalletSendTo: (value: string) => void
  setWalletSendAmount: (value: string) => void
  handleWithdrawModalChange: (next: boolean) => void
  openTradeRequirements: ReturnType<typeof useTradingOnboarding>['openTradeRequirements']
  openWalletModal: ReturnType<typeof useAppKit>['open']
  runWithSignaturePrompt: ReturnType<typeof useSignaturePromptRunner>['runWithSignaturePrompt']
  signTypedDataAsync: ReturnType<typeof useSignTypedData>['signTypedDataAsync']
  messages: WalletSendMessages
}) {
  return useCallback(
    async (event?: React.FormEvent<HTMLFormElement>) => {
      event?.preventDefault()
      if (!user?.deposit_wallet_address) {
        toast.error(messages.depositWalletRequired)
        return
      }
      if (!isAddress(walletSendTo)) {
        toast.error(messages.invalidRecipient)
        return
      }
      const amountNumber = Number(walletSendAmount)
      if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
        toast.error(messages.invalidAmount)
        return
      }

      setIsWalletSending(true)
      try {
        const call = buildSendErc20Call({
          token: COLLATERAL_TOKEN_ADDRESS,
          to: walletSendTo as `0x${string}`,
          amount: walletSendAmount,
          decimals: 6,
        })

        const result = await runWithSignaturePrompt(() =>
          signAndSubmitDepositWalletCalls({
            user,
            calls: [call],
            metadata: 'send_tokens',
            signTypedDataAsync,
          }),
        )
        if (result.error) {
          if (isTradingAuthRequiredError(result.error)) {
            handleWithdrawModalChange(false)
            openTradeRequirements({ forceTradingAuth: true })
          } else if (result.code === 'wallet_connector_not_connected') {
            toast.error(messages.reconnectWallet)
            void openWalletModal({ view: 'Connect' })
          } else {
            toast.error(result.error)
          }
          return
        }

        toast.success(messages.withdrawalSubmitted, {
          description: messages.withdrawalSubmittedDescription,
        })
        setWalletSendTo('')
        setWalletSendAmount('')
        handleWithdrawModalChange(false)
      } catch (error) {
        const message = error instanceof Error ? error.message : DEFAULT_ERROR_MESSAGE
        toast.error(message)
      } finally {
        setIsWalletSending(false)
      }
    },
    [
      handleWithdrawModalChange,
      messages,
      openTradeRequirements,
      openWalletModal,
      runWithSignaturePrompt,
      setIsWalletSending,
      setWalletSendAmount,
      setWalletSendTo,
      signTypedDataAsync,
      user,
      walletSendAmount,
      walletSendTo,
    ],
  )
}

function useUseConnectedWalletHandler({
  connectedWalletAddress,
  setWalletSendTo,
}: {
  connectedWalletAddress: string | null
  setWalletSendTo: (value: string) => void
}) {
  return useCallback(() => {
    if (!connectedWalletAddress) {
      return
    }
    setWalletSendTo(connectedWalletAddress)
  }, [connectedWalletAddress, setWalletSendTo])
}

function useSetMaxAmountHandler({
  balanceRaw,
  setWalletSendAmount,
}: {
  balanceRaw: number
  setWalletSendAmount: (value: string) => void
}) {
  return useCallback(() => {
    const amount = Number.isFinite(balanceRaw) ? balanceRaw : 0
    const limitedAmount = Math.min(amount, MAX_AMOUNT_INPUT)
    setWalletSendAmount(formatAmountInputValue(limitedAmount, { roundingMode: 'floor' }))
  }, [balanceRaw, setWalletSendAmount])
}

export function WalletFlow({
  depositOpen,
  onDepositOpenChange,
  withdrawOpen,
  onWithdrawOpenChange,
  user,
  canBuyMeld,
}: WalletFlowProps) {
  const isMobile = useIsMobile()
  const t = useExtracted()
  const { signTypedDataAsync } = useSignTypedData()
  const { runWithSignaturePrompt } = useSignaturePromptRunner()
  const { open: openAppKit } = useAppKit()
  const { depositView, setDepositView, handleDepositModalChange } = useDepositViewState(onDepositOpenChange)
  const [isLiFiBridgeOpen, setIsLiFiBridgeOpen] = useState(false)
  const [returnedMeldCheckoutId, setReturnedMeldCheckoutId] = useState<string | null>(null)
  const [isMeldReturnStatusOpen, setIsMeldReturnStatusOpen] = useState(false)
  const returnedMeldCheckoutIdRef = useRef<string | null>(null)
  const isMeldReturnStatusOpenRef = useRef(false)
  const meldCheckoutHandoffIdsRef = useRef(new Set<string>())
  const meldCheckoutPopupsRef = useRef(new Map<string, MeldCheckoutPopupReference>())
  const meldCheckoutPollsRef = useRef(new Map<string, MeldCheckoutPoll>())
  const meldCheckoutExpiryTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const meldCheckoutPollControlRef = useRef<MeldCheckoutPollControl>({ stop: () => undefined })
  const {
    walletSendTo,
    setWalletSendTo,
    walletSendAmount,
    setWalletSendAmount,
    isWalletSending,
    setIsWalletSending,
    handleWithdrawModalChange,
  } = useWithdrawFormState(onWithdrawOpenChange)
  const hasDeployedDepositWallet = useHasDeployedDepositWallet(user)
  const depositWalletAddress = user?.deposit_wallet_address ?? null
  const { balance, isLoadingBalance, refetchBalance } = useBalance({ depositWalletAddress })
  const refetchBalanceRef = useRef(refetchBalance)
  useEffect(() => {
    refetchBalanceRef.current = refetchBalance
  }, [refetchBalance])
  const {
    formattedUsdBalance: formattedConnectedWalletUsdBalance,
    isLoadingUsdBalance: isLoadingConnectedWalletUsdBalance,
  } = useLiFiWalletUsdBalance(user?.address, { enabled: depositOpen && !IS_TEST_MODE })
  const site = useSiteIdentity()
  const connectedWalletAddress = user?.address ?? null
  const { openTradeRequirements } = useTradingOnboarding()

  const handleOpenLiFiBridge = useCallback(() => {
    handleDepositModalChange(false)
    setIsLiFiBridgeOpen(true)
  }, [handleDepositModalChange])

  const handleReturnToDeposit = useCallback(() => {
    setDepositView('fund')
    setIsLiFiBridgeOpen(false)
    handleDepositModalChange(true)
  }, [handleDepositModalChange, setDepositView])

  const handleCloseMeldReturnStatus = useCallback(() => {
    const checkoutId = returnedMeldCheckoutIdRef.current
    setIsMeldReturnStatusOpen(false)
    isMeldReturnStatusOpenRef.current = false
    setReturnedMeldCheckoutId(null)
    returnedMeldCheckoutIdRef.current = null
    if (checkoutId) {
      removeMeldCheckoutIdFromUrl(checkoutId)
      window.setTimeout(() => resumeMeldCheckoutPolling(checkoutId), 0)
    }
    void refetchBalanceRef.current()
  }, [])

  const handleMeldCheckoutExpired = useCallback((checkoutId: string) => {
    meldCheckoutPollControlRef.current.stop(checkoutId)
    clearMeldPendingCheckout(checkoutId)
    removeMeldCheckoutIdFromUrl(checkoutId)
    if (returnedMeldCheckoutIdRef.current === checkoutId) {
      returnedMeldCheckoutIdRef.current = null
      isMeldReturnStatusOpenRef.current = false
      setReturnedMeldCheckoutId(null)
      setIsMeldReturnStatusOpen(false)
    }
  }, [])

  const walletSendMessages = useMemo<WalletSendMessages>(
    () => ({
      depositWalletRequired: t('Set up your Deposit Wallet first.'),
      invalidRecipient: t('Enter a valid recipient address.'),
      invalidAmount: t('Enter a valid amount.'),
      reconnectWallet: t('Your wallet connection expired. Reconnect your wallet and try again.'),
      withdrawalSubmitted: t('Withdrawal submitted'),
      withdrawalSubmittedDescription: t('We sent your withdrawal transaction.'),
    }),
    [t],
  )

  const handleWalletSend = useWalletSendHandler({
    user,
    walletSendTo,
    walletSendAmount,
    setIsWalletSending,
    setWalletSendTo,
    setWalletSendAmount,
    handleWithdrawModalChange,
    openTradeRequirements,
    openWalletModal: openAppKit,
    runWithSignaturePrompt,
    signTypedDataAsync,
    messages: walletSendMessages,
  })

  const handleBuy = useCallback(() => {
    if (!canBuyMeld) {
      return
    }

    const popup = window.open('', '_blank', 'width=450,height=790,scrollbars=yes,resizable=yes')
    if (popup) {
      popup.opener = null
      popup.focus()
    }
    handleDepositModalChange(false)
    void startMeldCheckout(popup, {
      onCheckoutCreated: (checkoutId) => {
        if (typeof BroadcastChannel !== 'undefined' && popup && !popup.closed) {
          const expiresAt = Date.now() + MELD_CHECKOUT_POPUP_REFERENCE_TTL_MS
          const cleanupTimer = setTimeout(
            () => meldCheckoutPopupsRef.current.delete(checkoutId),
            MELD_CHECKOUT_POPUP_REFERENCE_TTL_MS,
          )
          meldCheckoutPopupsRef.current.set(checkoutId, {
            popup,
            expiresAt,
            cleanupTimer,
          })
        }
      },
    }).catch(() => {
      toast.error(t('An unexpected error occurred. Please try again.'))
    })
  }, [canBuyMeld, handleDepositModalChange, t])

  useEffect(() => {
    function clearPopupReferences() {
      for (const reference of meldCheckoutPopupsRef.current.values()) {
        clearTimeout(reference.cleanupTimer)
      }
      meldCheckoutPopupsRef.current.clear()
    }

    if (typeof BroadcastChannel === 'undefined') {
      return clearPopupReferences
    }

    const channel = new BroadcastChannel(MELD_CHECKOUT_RETURN_CHANNEL)
    function handleReturn(event: MessageEvent<unknown>) {
      if (!isMeldCheckoutReturnMessage(event.data) || event.data.type !== 'return') {
        return
      }

      const checkoutId = event.data.checkoutId
      const popupReference = meldCheckoutPopupsRef.current.get(checkoutId)
      if (!popupReference || popupReference.expiresAt <= Date.now()) {
        meldCheckoutPopupsRef.current.delete(checkoutId)
        if (popupReference) {
          clearTimeout(popupReference.cleanupTimer)
        }
        return
      }

      meldCheckoutPopupsRef.current.delete(checkoutId)
      clearTimeout(popupReference.cleanupTimer)
      channel.postMessage({ type: 'ack', checkoutId })
      const popup = popupReference.popup
      if (!popup.closed) {
        try {
          popup.close()
        } catch {
          // The return window has its own close attempt and a fallback screen.
        }
      }
      const pendingCheckout = ensureMeldPendingCheckout(checkoutId)
      if (!pendingCheckout) {
        return
      }
      const previousCheckoutId = isMeldReturnStatusOpenRef.current ? returnedMeldCheckoutIdRef.current : null
      if (previousCheckoutId && previousCheckoutId !== checkoutId) {
        meldCheckoutHandoffIdsRef.current.add(previousCheckoutId)
      }
      meldCheckoutPollControlRef.current.stop(checkoutId)
      setMeldCheckoutIdInUrl(checkoutId)
      returnedMeldCheckoutIdRef.current = checkoutId
      isMeldReturnStatusOpenRef.current = true
      setReturnedMeldCheckoutId(checkoutId)
      setIsMeldReturnStatusOpen(true)
    }

    channel.addEventListener('message', handleReturn)
    return () => {
      channel.removeEventListener('message', handleReturn)
      channel.close()
      clearPopupReferences()
    }
  }, [])

  useEffect(() => {
    const handoffIds = meldCheckoutHandoffIdsRef.current
    if (handoffIds.size === 0) {
      return
    }

    const handoffTimer = window.setTimeout(() => {
      for (const checkoutId of handoffIds) {
        handoffIds.delete(checkoutId)
        if (checkoutId !== returnedMeldCheckoutIdRef.current) {
          resumeMeldCheckoutPolling(checkoutId)
        }
      }
    }, 0)

    return () => window.clearTimeout(handoffTimer)
  }, [returnedMeldCheckoutId])

  const handleUseConnectedWallet = useUseConnectedWalletHandler({ connectedWalletAddress, setWalletSendTo })
  const handleSetMaxAmount = useSetMaxAmountHandler({ balanceRaw: balance.raw, setWalletSendAmount })

  useEffect(() => {
    let isActive = true
    const runningCheckouts = meldCheckoutPollsRef.current
    const expiryTimers = meldCheckoutExpiryTimersRef.current

    function clearExpiryTimer(checkoutId: string) {
      const timer = expiryTimers.get(checkoutId)
      if (timer) {
        clearTimeout(timer)
        expiryTimers.delete(checkoutId)
      }
    }

    function stopPolling(checkoutId: string) {
      const poll = runningCheckouts.get(checkoutId)
      if (!poll) {
        return
      }
      runningCheckouts.delete(checkoutId)
      poll.controller.abort()
      if (poll.timeout) {
        clearTimeout(poll.timeout)
        poll.timeout = undefined
      }
      poll.resolveWait?.()
      poll.resolveWait = undefined
    }

    function finishCheckout(checkoutId: string) {
      clearExpiryTimer(checkoutId)
      clearMeldPendingCheckout(checkoutId)
      removeMeldCheckoutIdFromUrl(checkoutId)
      if (returnedMeldCheckoutIdRef.current === checkoutId) {
        returnedMeldCheckoutIdRef.current = null
        isMeldReturnStatusOpenRef.current = false
        setReturnedMeldCheckoutId(null)
        setIsMeldReturnStatusOpen(false)
      }
    }

    function scheduleExpiry(pendingCheckout: { checkoutId: string; expiresAt: number }) {
      if (expiryTimers.has(pendingCheckout.checkoutId)) {
        return
      }

      const delay = Math.max(0, pendingCheckout.expiresAt - Date.now())
      const timer = setTimeout(() => {
        expiryTimers.delete(pendingCheckout.checkoutId)
        stopPolling(pendingCheckout.checkoutId)
        finishCheckout(pendingCheckout.checkoutId)
      }, delay)
      expiryTimers.set(pendingCheckout.checkoutId, timer)
    }

    async function pollCheckout(poll: MeldCheckoutPoll) {
      const { checkoutId, controller } = poll
      try {
        while (isActive && !controller.signal.aborted) {
          const remainingMs = poll.expiresAt - Date.now()
          if (remainingMs <= 0) {
            finishCheckout(checkoutId)
            break
          }

          try {
            const response = await fetch(`/api/payments/meld/checkouts/${encodeURIComponent(checkoutId)}/status`, {
              cache: 'no-store',
              signal: controller.signal,
            })
            if (!isActive || controller.signal.aborted) {
              break
            }
            if (response.status === 401) {
              markMeldCheckoutUnauthorized(checkoutId)
              break
            }
            if (response.status === 404) {
              finishCheckout(checkoutId)
              break
            }
            if (!response.ok) {
              throw new Error('meld_checkout_status_unavailable')
            }

            const result: unknown = await response.json()
            if (
              !isActive ||
              controller.signal.aborted ||
              typeof result !== 'object' ||
              result === null ||
              !('status' in result) ||
              typeof result.status !== 'string'
            ) {
              if (!controller.signal.aborted && isActive) {
                throw new Error('invalid_meld_checkout_status')
              }
              break
            }

            if (result.status === 'SETTLED') {
              finishCheckout(checkoutId)
              void refetchBalanceRef.current()
              break
            }
            if (['FAILED', 'DECLINED', 'CANCELLED', 'REFUNDED', 'AUTHORIZATION_EXPIRED'].includes(result.status)) {
              finishCheckout(checkoutId)
              break
            }
          } catch {
            if (!isActive || controller.signal.aborted) {
              break
            }
            // Retry transient network and provider errors with progressive backoff.
          }

          if (!isActive || controller.signal.aborted) {
            break
          }
          const delay = Math.min(getMeldCheckoutPollDelay(poll.attempt), poll.expiresAt - Date.now())
          poll.attempt += 1
          if (delay <= 0) {
            continue
          }
          await new Promise<void>((resolve) => {
            poll.resolveWait = resolve
            poll.timeout = setTimeout(() => {
              poll.timeout = undefined
              poll.resolveWait = undefined
              resolve()
            }, delay)
          })
        }
      } finally {
        if (runningCheckouts.get(checkoutId) === poll) {
          runningCheckouts.delete(checkoutId)
        }
      }
    }

    function startPolling(checkoutId: string) {
      if (
        !isActive ||
        !isMeldCheckoutId(checkoutId) ||
        (isMeldReturnStatusOpenRef.current && returnedMeldCheckoutIdRef.current === checkoutId) ||
        runningCheckouts.has(checkoutId)
      ) {
        return
      }

      const pendingCheckout = getMeldPendingCheckout(checkoutId)
      if (!pendingCheckout) {
        return
      }
      scheduleExpiry(pendingCheckout)
      if (isMeldCheckoutUnauthorized(checkoutId)) {
        return
      }

      const poll: MeldCheckoutPoll = {
        checkoutId,
        controller: new AbortController(),
        expiresAt: pendingCheckout.expiresAt,
        attempt: 0,
      }
      runningCheckouts.set(checkoutId, poll)
      void pollCheckout(poll)
    }

    meldCheckoutPollControlRef.current = { stop: stopPolling }

    function resumeFromEvent(event: Event) {
      const checkoutId = (event as CustomEvent<unknown>).detail
      if (isMeldCheckoutId(checkoutId)) {
        startPolling(checkoutId)
      }
    }

    function resumeStoredCheckouts() {
      for (const checkout of listMeldPendingCheckouts()) {
        startPolling(checkout.checkoutId)
      }
    }

    function stopClearedCheckout(event: Event) {
      const checkoutId = (event as CustomEvent<unknown>).detail
      if (!isMeldCheckoutId(checkoutId)) {
        return
      }
      clearExpiryTimer(checkoutId)
      stopPolling(checkoutId)
    }

    window.addEventListener(MELD_CHECKOUT_POLL_EVENT, resumeFromEvent)
    window.addEventListener(MELD_CHECKOUT_CLEARED_EVENT, stopClearedCheckout)
    window.addEventListener('storage', resumeStoredCheckouts)

    const queryCheckoutId = getMeldCheckoutIdFromUrl()
    let restoredCheckoutId: string | null = null
    if (queryCheckoutId) {
      const pendingCheckout = ensureMeldPendingCheckout(queryCheckoutId)
      if (pendingCheckout) {
        scheduleExpiry(pendingCheckout)
        restoredCheckoutId = queryCheckoutId
        returnedMeldCheckoutIdRef.current = queryCheckoutId
        isMeldReturnStatusOpenRef.current = true
        // Restore the client-only URL fallback after hydration while keeping HomePage static.
        /* oxlint-disable react/set-state-in-effect */
        setReturnedMeldCheckoutId(queryCheckoutId)
        setIsMeldReturnStatusOpen(true)
        /* oxlint-enable react/set-state-in-effect */
      } else {
        removeMeldCheckoutIdFromUrl(queryCheckoutId)
      }
    } else if (new URL(window.location.href).searchParams.has('meldCheckoutId')) {
      removeMeldCheckoutIdFromUrl()
    }

    for (const checkout of listMeldPendingCheckouts()) {
      if (checkout.checkoutId !== restoredCheckoutId) {
        startPolling(checkout.checkoutId)
      }
    }

    return () => {
      isActive = false
      window.removeEventListener(MELD_CHECKOUT_POLL_EVENT, resumeFromEvent)
      window.removeEventListener(MELD_CHECKOUT_CLEARED_EVENT, stopClearedCheckout)
      window.removeEventListener('storage', resumeStoredCheckouts)
      for (const checkoutId of runningCheckouts.keys()) {
        stopPolling(checkoutId)
      }
      for (const timer of expiryTimers.values()) {
        clearTimeout(timer)
      }
      expiryTimers.clear()
      meldCheckoutPollControlRef.current = { stop: () => undefined }
    }
  }, [])

  return (
    <>
      <WalletDepositModal
        open={depositOpen && !isLiFiBridgeOpen}
        onOpenChange={handleDepositModalChange}
        onBridge={handleOpenLiFiBridge}
        isMobile={isMobile}
        walletAddress={depositWalletAddress}
        walletEoaAddress={user?.address ?? null}
        siteName={site.name}
        canBuyMeld={canBuyMeld}
        hasDeployedDepositWallet={hasDeployedDepositWallet}
        view={depositView}
        onViewChange={setDepositView}
        onBuy={handleBuy}
        depositWalletBalance={balance.text}
        isDepositWalletBalanceLoading={isLoadingBalance}
        walletBalance={formattedConnectedWalletUsdBalance}
        isBalanceLoading={isLoadingConnectedWalletUsdBalance}
      />
      {depositWalletAddress && isLiFiBridgeOpen && (
        <WalletLiFiBridge
          open
          onClose={handleReturnToDeposit}
          destinationAddress={depositWalletAddress}
          siteName={site.name}
        />
      )}
      {returnedMeldCheckoutId && isMeldReturnStatusOpen && isMeldCheckoutId(returnedMeldCheckoutId) && (
        <MeldReturnStatus
          key={returnedMeldCheckoutId}
          checkoutId={returnedMeldCheckoutId}
          open={isMeldReturnStatusOpen}
          onClose={handleCloseMeldReturnStatus}
          onExpired={handleMeldCheckoutExpired}
        />
      )}
      <WalletWithdrawModal
        open={withdrawOpen}
        onOpenChange={handleWithdrawModalChange}
        isMobile={isMobile}
        siteName={site.name}
        sendTo={walletSendTo}
        onChangeSendTo={(event) => setWalletSendTo(event.target.value)}
        sendAmount={walletSendAmount}
        onChangeSendAmount={setWalletSendAmount}
        isSending={isWalletSending}
        onSubmitSend={handleWalletSend}
        connectedWalletAddress={connectedWalletAddress}
        onUseConnectedWallet={handleUseConnectedWallet}
        availableBalance={balance.raw}
        onMax={handleSetMaxAmount}
        isBalanceLoading={isLoadingBalance}
      />
    </>
  )
}
