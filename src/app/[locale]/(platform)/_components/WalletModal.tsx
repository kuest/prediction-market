'use client'

import { ChevronLeftIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'
import { useMemo, useState } from 'react'

import type {
  WalletDepositModalProps,
  WalletWithdrawModalProps,
} from '@/app/[locale]/(platform)/_components/wallet-modal/utils'
import type { LiFiWalletTokenItem } from '@/hooks/useLiFiWalletTokens'

import CountdownBadge from '@/app/[locale]/(platform)/_components/wallet-modal/CountdownBadge'
import { getSelectedWalletTokenId } from '@/app/[locale]/(platform)/_components/wallet-modal/utils'
import WalletAmountStep from '@/app/[locale]/(platform)/_components/wallet-modal/WalletAmountStep'
import WalletConfirmStep from '@/app/[locale]/(platform)/_components/wallet-modal/WalletConfirmStep'
import WalletFundMenu from '@/app/[locale]/(platform)/_components/wallet-modal/WalletFundMenu'
import WalletReceiveView from '@/app/[locale]/(platform)/_components/wallet-modal/WalletReceiveView'
import WalletSendForm from '@/app/[locale]/(platform)/_components/wallet-modal/WalletSendForm'
import WalletSuccessStep from '@/app/[locale]/(platform)/_components/wallet-modal/WalletSuccessStep'
import WalletTokenList from '@/app/[locale]/(platform)/_components/wallet-modal/WalletTokenList'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { useBalance } from '@/hooks/useBalance'
import { useLiFiQuote } from '@/hooks/useLiFiQuote'
import { useLiFiWalletTokens } from '@/hooks/useLiFiWalletTokens'
import { useSiteIdentity } from '@/hooks/useSiteIdentity'
import { formatDisplayAmount } from '@/lib/amount-input'
import { COLLATERAL_TOKEN_ADDRESS } from '@/lib/contracts'
import { DEFAULT_CHAIN_ID, IS_TEST_MODE, POLYGON_MAINNET_CHAIN_ID } from '@/lib/network'
import { cn } from '@/lib/utils'
import { defaultViemNetwork } from '@/lib/viem-network'

export type { WalletDepositModalProps, WalletWithdrawModalProps }

export function WalletDepositModal(props: WalletDepositModalProps) {
  const t = useExtracted()
  const {
    open,
    onOpenChange,
    onBridge,
    isMobile,
    walletAddress,
    walletEoaAddress,
    siteName,
    canBuyMeld,
    hasDeployedDepositWallet,
    view,
    onViewChange,
    onBuy,
    depositWalletBalance,
    isDepositWalletBalanceLoading = false,
    walletBalance,
    isBalanceLoading = false,
  } = props

  const [copied, setCopied] = useState(false)
  const site = useSiteIdentity()
  const siteLabel = siteName ?? site.name
  const isDirectTestModeDeposit = IS_TEST_MODE
  const canUseLiFiBridge =
    DEFAULT_CHAIN_ID === POLYGON_MAINNET_CHAIN_ID && hasDeployedDepositWallet && Boolean(walletAddress)
  const tokensQueryEnabled = open && (view === 'wallets' || view === 'amount' || view === 'confirm')
  const { balance: directWalletBalance, isLoadingBalance: isLoadingDirectWalletBalance } = useBalance({
    depositWalletAddress: walletEoaAddress,
    enabled: open && isDirectTestModeDeposit,
  })
  const directWalletTokenItems = useMemo<LiFiWalletTokenItem[]>(() => {
    if (!isDirectTestModeDeposit || !walletEoaAddress || directWalletBalance.raw <= 0) {
      return []
    }

    const formattedBalance = directWalletBalance.raw.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    })
    const formattedUsdBalance = directWalletBalance.raw.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })

    return [
      {
        id: `${DEFAULT_CHAIN_ID}:${COLLATERAL_TOKEN_ADDRESS}`,
        chainId: DEFAULT_CHAIN_ID,
        address: COLLATERAL_TOKEN_ADDRESS,
        decimals: 6,
        symbol: directWalletBalance.symbol,
        network: defaultViemNetwork.name,
        icon: '/images/deposit/transfer/usdc_dark.png',
        chainIcon: '/images/deposit/transfer/polygon_dark.png',
        balance: formattedBalance,
        balanceRaw: directWalletBalance.raw,
        usd: formattedUsdBalance,
        usdValue: directWalletBalance.raw,
        disabled: false,
      },
    ]
  }, [directWalletBalance.raw, directWalletBalance.symbol, isDirectTestModeDeposit, walletEoaAddress])
  const {
    items: lifiWalletTokenItems,
    isLoadingTokens: isLoadingLiFiTokens,
    isError: isLiFiTokensError,
  } = useLiFiWalletTokens(walletEoaAddress, {
    enabled: tokensQueryEnabled && !isDirectTestModeDeposit,
  })
  const walletTokenItems = isDirectTestModeDeposit ? directWalletTokenItems : lifiWalletTokenItems
  const isLoadingTokens = isDirectTestModeDeposit ? isLoadingDirectWalletBalance : isLoadingLiFiTokens
  const [preferredSelectedTokenId, setPreferredSelectedTokenId] = useState('')
  const [amountValue, setAmountValue] = useState('')
  const [confirmRefreshIndex, setConfirmRefreshIndex] = useState(0)
  const formattedDepositWalletBalance =
    depositWalletBalance && depositWalletBalance !== '' ? depositWalletBalance : '0.00'
  const balanceDisplay = isDepositWalletBalanceLoading ? (
    <span className="inline-flex align-middle">
      <span className="h-3 w-12 animate-pulse rounded-md bg-accent" />
    </span>
  ) : (
    <>${formattedDepositWalletBalance}</>
  )
  const balanceLabel = t.rich('{siteName} Balance: <balance></balance>', {
    siteName: siteLabel,
    balance: () => balanceDisplay,
  })

  const selectedTokenId = getSelectedWalletTokenId(walletTokenItems, preferredSelectedTokenId)
  const selectedToken = walletTokenItems.find((item) => item.id === selectedTokenId) ?? null
  const { quote: lifiQuote } = useLiFiQuote({
    fromToken: selectedToken,
    amountValue,
    fromAddress: walletEoaAddress,
    toAddress: walletAddress,
    refreshIndex: confirmRefreshIndex,
    enabled: !isDirectTestModeDeposit,
  })
  const directQuote = useMemo(() => {
    if (!isDirectTestModeDeposit || !selectedToken || !amountValue.trim()) {
      return null
    }

    const amountNumber = Number.parseFloat(amountValue)
    if (!Number.isFinite(amountNumber) || amountNumber <= 0 || amountNumber > selectedToken.balanceRaw) {
      return null
    }

    return {
      toAmountDisplay: formatDisplayAmount(amountValue),
      gasUsdDisplay: null,
    }
  }, [amountValue, isDirectTestModeDeposit, selectedToken])
  const quote = isDirectTestModeDeposit ? directQuote : lifiQuote
  const effectiveWalletBalance = isDirectTestModeDeposit ? directWalletBalance.text : walletBalance
  const isEffectiveWalletBalanceLoading = isDirectTestModeDeposit ? isLoadingDirectWalletBalance : isBalanceLoading

  const content =
    view === 'fund' ? (
      <WalletFundMenu
        onBuy={onBuy}
        onBridge={onBridge}
        onReceive={() => onViewChange('receive')}
        onWallet={() => onViewChange('wallets')}
        canBridge={canUseLiFiBridge}
        disabledReceive={!hasDeployedDepositWallet}
        canBuyMeld={canBuyMeld}
        walletEoaAddress={walletEoaAddress}
        walletBalance={effectiveWalletBalance}
        isBalanceLoading={isEffectiveWalletBalanceLoading}
      />
    ) : view === 'receive' ? (
      <WalletReceiveView walletAddress={walletAddress} onCopy={handleCopy} copied={copied} />
    ) : view === 'wallets' ? (
      <WalletTokenList
        onContinue={() => onViewChange('amount')}
        items={walletTokenItems}
        isLoadingTokens={isLoadingTokens}
        hasError={!isDirectTestModeDeposit && isLiFiTokensError}
        selectedId={selectedTokenId}
        onSelect={setPreferredSelectedTokenId}
        emptyMessage={isDirectTestModeDeposit ? t('No Amoy USDC balance found.') : undefined}
        errorMessage={isDirectTestModeDeposit ? undefined : t('Could not load wallet balances. Please try again.')}
      />
    ) : view === 'amount' ? (
      <WalletAmountStep
        onContinue={() => onViewChange('confirm')}
        selectedTokenSymbol={selectedToken?.symbol ?? null}
        availableTokenAmount={selectedToken?.balanceRaw ?? null}
        amountValue={amountValue}
        onAmountChange={setAmountValue}
      />
    ) : view === 'confirm' ? (
      <WalletConfirmStep
        walletEoaAddress={walletEoaAddress}
        walletAddress={walletAddress}
        siteLabel={siteLabel}
        onComplete={() => onViewChange('success')}
        amountValue={amountValue}
        selectedToken={selectedToken}
        quote={quote}
        refreshIndex={confirmRefreshIndex}
        executionMode={isDirectTestModeDeposit ? 'direct-usdc' : 'lifi'}
      />
    ) : (
      <WalletSuccessStep
        walletEoaAddress={walletEoaAddress}
        walletAddress={walletAddress}
        siteLabel={siteLabel}
        amountValue={amountValue}
        selectedToken={selectedToken}
        quote={quote}
        onClose={() => onOpenChange(false)}
        onNewDeposit={() => onViewChange('fund')}
      />
    )

  async function handleCopy() {
    if (!walletAddress) {
      return
    }
    try {
      await navigator.clipboard.writeText(walletAddress)
      setCopied(true)
      setTimeout(setCopied, 1200, false)
    } catch {
      //
    }
  }

  if (isMobile) {
    return (
      <Drawer
        open={open}
        onOpenChange={(next) => {
          setCopied(false)
          onOpenChange(next)
        }}
      >
        <DrawerContent className="max-h-[90vh] w-full bg-background px-0">
          <DrawerHeader className="gap-1 px-4 pt-3 pb-2">
            <div className="flex items-center">
              {view !== 'fund' && view !== 'success' ? (
                <button
                  type="button"
                  className={cn(
                    `rounded-md p-2 opacity-70 ring-offset-background transition hover:bg-muted hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`,
                  )}
                  onClick={() => onViewChange('fund')}
                >
                  <ChevronLeftIcon />
                </button>
              ) : (
                <span className="size-8" aria-hidden="true" />
              )}
              <DrawerTitle className="flex-1 text-center text-xl font-semibold text-foreground">
                {t('Deposit')}
              </DrawerTitle>
              <span className="size-8" aria-hidden="true" />
            </div>
            <DrawerDescription className="text-center text-xs text-muted-foreground">{balanceLabel}</DrawerDescription>
          </DrawerHeader>
          <div className="border-t" />
          <div className="w-full px-4 pb-4">
            <div className="space-y-4 pt-4">{content}</div>
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setCopied(false)
        onOpenChange(next)
      }}
    >
      <DialogContent
        className="max-w-md border bg-background pt-4 sm:max-w-md"
        showCloseButton={view !== 'confirm'}
        closeLabel={t('Close')}
      >
        {view === 'confirm' && <CountdownBadge onReset={() => setConfirmRefreshIndex((current) => current + 1)} />}
        <DialogHeader className="gap-1">
          <div className="flex items-center">
            {view !== 'fund' && view !== 'success' ? (
              <button
                type="button"
                className={cn(
                  `rounded-md p-2 opacity-70 ring-offset-background transition hover:bg-muted hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`,
                )}
                onClick={() => onViewChange('fund')}
              >
                <ChevronLeftIcon />
              </button>
            ) : (
              <span className="size-8" aria-hidden="true" />
            )}
            <DialogTitle className="flex-1 text-center text-lg font-semibold text-foreground">
              {t('Deposit')}
            </DialogTitle>
            <span className="size-8" aria-hidden="true" />
          </div>
          <DialogDescription className="text-center text-xs text-muted-foreground">{balanceLabel}</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 border-t" />
        {content}
      </DialogContent>
    </Dialog>
  )
}

export function WalletWithdrawModal(props: WalletWithdrawModalProps) {
  const t = useExtracted()
  const {
    open,
    onOpenChange,
    isMobile,
    siteName,
    sendTo,
    onChangeSendTo,
    sendAmount,
    onChangeSendAmount,
    isSending,
    onSubmitSend,
    connectedWalletAddress,
    onUseConnectedWallet,
    availableBalance,
    onMax,
    isBalanceLoading,
  } = props
  const site = useSiteIdentity()
  const siteLabel = siteName ?? site.name

  const content = (
    <WalletSendForm
      sendTo={sendTo}
      onChangeSendTo={onChangeSendTo}
      sendAmount={sendAmount}
      onChangeSendAmount={onChangeSendAmount}
      isSending={isSending}
      onSubmitSend={onSubmitSend}
      connectedWalletAddress={connectedWalletAddress}
      onUseConnectedWallet={onUseConnectedWallet}
      availableBalance={availableBalance}
      onMax={onMax}
      isBalanceLoading={isBalanceLoading}
    />
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[90vh] w-full bg-background px-0">
          <DrawerHeader className="px-4 pt-4 pb-2">
            <DrawerTitle className="text-center text-foreground">
              {t('Withdraw from {siteName}', { siteName: siteLabel })}
            </DrawerTitle>
          </DrawerHeader>
          <div className="w-full px-4 pb-4">
            <div className="space-y-4 pt-4">{content}</div>
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-xl border bg-background" closeLabel={t('Close')}>
        <DialogHeader>
          <DialogTitle className="text-center text-foreground">
            {t('Withdraw from {siteName}', { siteName: siteLabel })}
          </DialogTitle>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  )
}
