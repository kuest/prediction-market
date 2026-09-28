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
  isMeldCheckoutId,
  isMeldCheckoutReturnMessage,
  MELD_CHECKOUT_RETURN_CHANNEL,
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
  const meldCheckoutPopupsRef = useRef(new Map<string, MeldCheckoutPopupReference>())
  const meldCheckoutPollStopsRef = useRef(new Map<string, () => void>())
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
    setIsMeldReturnStatusOpen(false)
    if (!returnedMeldCheckoutId) {
      return
    }
    try {
      if (window.localStorage.getItem('kuest:pending-meld-checkout') !== returnedMeldCheckoutId) {
        setReturnedMeldCheckoutId((current) => (current === returnedMeldCheckoutId ? null : current))
      }
    } catch {
      // Keep the local checkout ID so background polling can continue without storage.
    }
  }, [returnedMeldCheckoutId])

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
        if (popup && !popup.closed) {
          meldCheckoutPopupsRef.current.set(checkoutId, {
            popup,
            expiresAt: Date.now() + MELD_CHECKOUT_POPUP_REFERENCE_TTL_MS,
          })
        }
      },
    }).catch(() => {
      toast.error(t('An unexpected error occurred. Please try again.'))
    })
  }, [canBuyMeld, handleDepositModalChange, t])

  useEffect(() => {
    const cleanupPopupReferences = window.setInterval(() => {
      const now = Date.now()
      for (const [checkoutId, reference] of meldCheckoutPopupsRef.current) {
        if (reference.popup.closed || reference.expiresAt <= now) {
          meldCheckoutPopupsRef.current.delete(checkoutId)
        }
      }
    }, 60_000)

    if (typeof BroadcastChannel === 'undefined') {
      return () => window.clearInterval(cleanupPopupReferences)
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
        return
      }

      meldCheckoutPopupsRef.current.delete(checkoutId)
      channel.postMessage({ type: 'ack', checkoutId })
      const popup = popupReference.popup
      if (!popup.closed) {
        try {
          popup.close()
        } catch {
          // The return window has its own close attempt and a fallback screen.
        }
      }
      setReturnedMeldCheckoutId(checkoutId)
      setIsMeldReturnStatusOpen(true)
    }

    channel.addEventListener('message', handleReturn)
    return () => {
      window.clearInterval(cleanupPopupReferences)
      channel.removeEventListener('message', handleReturn)
      channel.close()
    }
  }, [])

  const handleUseConnectedWallet = useUseConnectedWalletHandler({ connectedWalletAddress, setWalletSendTo })
  const handleSetMaxAmount = useSetMaxAmountHandler({ balanceRaw: balance.raw, setWalletSendAmount })

  useEffect(() => {
    let isActive = true
    const runningCheckouts = new Set<string>()
    const timers = new Map<ReturnType<typeof setTimeout>, () => void>()
    const pollStops = meldCheckoutPollStopsRef.current

    function clearPendingCheckout(checkoutId: string) {
      try {
        if (window.localStorage.getItem('kuest:pending-meld-checkout') === checkoutId) {
          window.localStorage.removeItem('kuest:pending-meld-checkout')
        }
      } catch {
        // Storage is optional; the return page continues polling the checkout.
      }
    }

    async function pollCheckout(checkoutId: string) {
      if (!isMeldCheckoutId(checkoutId) || runningCheckouts.has(checkoutId)) {
        return
      }
      runningCheckouts.add(checkoutId)
      const controller = new AbortController()
      let cancelWait: (() => void) | undefined
      function stop() {
        controller.abort()
        cancelWait?.()
      }
      pollStops.set(checkoutId, stop)

      try {
        for (let attempt = 0; isActive && !controller.signal.aborted; attempt += 1) {
          try {
            const response = await fetch(`/api/payments/meld/checkouts/${encodeURIComponent(checkoutId)}/status`, {
              cache: 'no-store',
              signal: controller.signal,
            })
            if (!isActive || controller.signal.aborted) {
              break
            }
            if (response.status === 401) {
              break
            }
            if (response.status === 404) {
              clearPendingCheckout(checkoutId)
              setReturnedMeldCheckoutId((current) => (current === checkoutId ? null : current))
              break
            }
            if (response.ok) {
              const result: unknown = await response.json()
              if (!isActive || controller.signal.aborted) {
                break
              }
              const status =
                typeof result === 'object' && result !== null && 'status' in result && typeof result.status === 'string'
                  ? result.status
                  : null
              if (status === 'SETTLED') {
                clearPendingCheckout(checkoutId)
                void refetchBalance()
                setReturnedMeldCheckoutId((current) => (current === checkoutId ? null : current))
                break
              }
              if (status && ['FAILED', 'DECLINED', 'CANCELLED', 'REFUNDED', 'AUTHORIZATION_EXPIRED'].includes(status)) {
                clearPendingCheckout(checkoutId)
                setReturnedMeldCheckoutId((current) => (current === checkoutId ? null : current))
                break
              }
            }
          } catch {
            if (controller.signal.aborted) {
              break
            }
            // Retry transient network and provider errors while the page remains open.
          }

          if (!isActive || controller.signal.aborted) {
            break
          }
          const delay = attempt < 12 ? 10_000 : 30_000
          await new Promise<void>((resolve) => {
            let timer: ReturnType<typeof setTimeout>
            function finish() {
              timers.delete(timer)
              if (cancelWait === finish) {
                cancelWait = undefined
              }
              resolve()
            }
            timer = setTimeout(finish, delay)
            timers.set(timer, finish)
            cancelWait = finish
          })
        }
      } finally {
        runningCheckouts.delete(checkoutId)
        if (pollStops.get(checkoutId) === stop) {
          pollStops.delete(checkoutId)
        }
      }
    }

    function readPendingCheckout() {
      if (isMeldReturnStatusOpen) {
        return
      }
      try {
        const checkoutId = window.localStorage.getItem('kuest:pending-meld-checkout')
        if (checkoutId) {
          void pollCheckout(checkoutId)
        }
      } catch {
        // Status tracking in the return page remains available without browser storage.
      }
    }
    function onCreated(event: Event) {
      const checkoutId = (event as CustomEvent<unknown>).detail
      if (!isMeldReturnStatusOpen && typeof checkoutId === 'string') {
        void pollCheckout(checkoutId)
      }
    }

    if (!isMeldReturnStatusOpen) {
      readPendingCheckout()
      if (returnedMeldCheckoutId) {
        void pollCheckout(returnedMeldCheckoutId)
      }
    }
    window.addEventListener('storage', readPendingCheckout)
    window.addEventListener('kuest:meld-checkout-created', onCreated)
    return () => {
      isActive = false
      window.removeEventListener('storage', readPendingCheckout)
      window.removeEventListener('kuest:meld-checkout-created', onCreated)
      for (const [timer, finish] of timers) {
        clearTimeout(timer)
        finish()
      }
      timers.clear()
      for (const stop of pollStops.values()) {
        stop()
      }
      pollStops.clear()
    }
  }, [isMeldReturnStatusOpen, refetchBalance, returnedMeldCheckoutId])

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
          checkoutId={returnedMeldCheckoutId}
          open={isMeldReturnStatusOpen}
          onClose={handleCloseMeldReturnStatus}
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
