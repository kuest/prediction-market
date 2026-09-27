'use client'

import { ArrowLeftRightIcon, CircleDollarSignIcon, CreditCardIcon, ExternalLinkIcon, WalletIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'
import { useTheme } from 'next-themes'
import Image from 'next/image'

import {
  formatWalletModalAddress,
  MELD_PAYMENT_METHODS,
  TEST_MODE_DISCORD_URL,
  TRANSFER_PAYMENT_METHODS,
} from '@/app/[locale]/(platform)/_components/wallet-modal/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { IS_TEST_MODE } from '@/lib/network'
import { cn } from '@/lib/utils'

function WalletFundMenu({
  onBuy,
  onBridge,
  onReceive,
  onWallet,
  canBridge,
  disabledReceive,
  canBuyMeld,
  walletEoaAddress,
  walletBalance,
  isBalanceLoading,
}: {
  onBuy: () => void
  onBridge: () => void
  onReceive: () => void
  onWallet: () => void
  canBridge: boolean
  disabledReceive: boolean
  canBuyMeld: boolean
  walletEoaAddress?: string | null
  walletBalance?: string | null
  isBalanceLoading?: boolean
}) {
  const t = useExtracted()
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const logoVariant = isDark ? 'dark' : 'light'
  const paymentLogos = MELD_PAYMENT_METHODS.map((method) => `/images/deposit/meld/${method}_${logoVariant}.png`)
  const transferLogos = TRANSFER_PAYMENT_METHODS.map(
    (method) => `/images/deposit/transfer/${method}_${logoVariant}.png`,
  )
  const bridgeLogos = ['bitcoin', 'solana', 'tron', 'ethereum'].map(
    (network) => `/images/deposit/bridge/${network}.svg`,
  )
  const walletLabel = formatWalletModalAddress(walletEoaAddress) ?? '----'
  const formattedWalletBalance = walletBalance && walletBalance !== '' ? walletBalance : '0.00'

  return (
    <div className="grid gap-2">
      {IS_TEST_MODE && (
        <a
          href={TEST_MODE_DISCORD_URL}
          target="_blank"
          rel="noreferrer"
          className={cn(
            `group flex w-full items-center justify-between gap-4 rounded-lg border border-border px-4 py-2 text-left transition hover:bg-muted/50`,
          )}
        >
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center text-foreground">
              <Image
                src="/images/deposit/social-media/discord.svg"
                alt={t('Discord')}
                width={24}
                height={24}
                className="size-6 dark:brightness-0 dark:invert"
              />
            </div>
            <div>
              <p className="text-sm font-semibold">{t('Get free Amoy USDC')}</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {t('Use')} <span className="font-semibold text-foreground">/faucet</span>
                </span>
                <span className="size-1 rounded-full bg-muted-foreground" />
                <span>{t('on Discord')}</span>
              </div>
            </div>
          </div>
          <span
            className={cn(
              `inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-foreground`,
            )}
          >
            <span>{t('Open Discord')}</span>
            <ExternalLinkIcon className="size-3.5" />
          </span>
        </a>
      )}

      <button
        type="button"
        className={cn(
          `group flex w-full items-center justify-between gap-4 rounded-lg border border-border px-4 py-2 text-left transition hover:bg-muted/50`,
        )}
        onClick={onWallet}
      >
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center text-foreground">
            <WalletIcon className="size-6" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">{t('Wallet ({address})', { address: walletLabel })}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {isBalanceLoading ? (
                <Skeleton className="h-3 w-10 rounded-full" />
              ) : (
                <span>${formattedWalletBalance}</span>
              )}
              <span className="size-1 rounded-full bg-muted-foreground" />
              <span>{t('Instant')}</span>
            </div>
          </div>
        </div>
      </button>

      <div className="mx-auto flex w-full items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border/70" />
        <span>{t('more')}</span>
        <div className="h-px flex-1 bg-border/70" />
      </div>

      <button
        type="button"
        className={cn(
          `group flex w-full items-center justify-between gap-4 rounded-lg border border-border px-4 py-2 text-left transition hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50`,
        )}
        onClick={() => {
          if (!canBuyMeld) {
            return
          }
          onBuy()
        }}
        disabled={!canBuyMeld}
      >
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center text-foreground">
            <CreditCardIcon className="size-6" />
          </div>
          <div>
            <p className="text-sm font-semibold">{t('Buy Crypto')}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{t('card')}</span>
              <span className="size-1 rounded-full bg-muted-foreground" />
              <span>{t('bank wire')}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center -space-x-2 transition-all group-hover:-space-x-1">
          {paymentLogos.map((logo) => (
            <div key={logo} className="relative size-5 overflow-hidden rounded-full bg-background shadow-sm">
              <Image src={logo} alt={t('Meld payment method')} fill sizes="24px" className="object-cover" />
            </div>
          ))}
        </div>
      </button>

      {canBridge && (
        <button
          type="button"
          className={cn(
            `group flex w-full items-center justify-between gap-4 rounded-lg border border-border px-4 py-2 text-left transition hover:bg-muted/50`,
          )}
          onClick={onBridge}
        >
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center text-foreground">
              <ArrowLeftRightIcon className="size-6" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold">{t('Transfer from another network')}</p>
              <p className="text-xs text-muted-foreground">{t('To USDC on Polygon')}</p>
            </div>
          </div>
          <div className="flex items-center -space-x-2 transition-all group-hover:-space-x-1">
            {bridgeLogos.map((logo) => (
              <div key={logo} className="relative size-6 overflow-hidden rounded-full bg-background shadow-sm">
                <Image src={logo} alt="" fill sizes="28px" className="object-contain" />
              </div>
            ))}
          </div>
        </button>
      )}

      <button
        type="button"
        className={cn(
          `group flex w-full items-center justify-between gap-4 rounded-lg border border-border px-4 py-2 text-left transition hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50`,
        )}
        onClick={onReceive}
        disabled={disabledReceive}
      >
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center text-foreground">
            <CircleDollarSignIcon className="size-6" />
          </div>
          <div>
            <p className="text-sm font-semibold">{t('Transfer Funds')}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>USDC</span>
              <span className="size-1 rounded-full bg-muted-foreground" />
              <span>{t('copy wallet or scan QR code')}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center -space-x-2 transition-all group-hover:-space-x-1">
          {transferLogos.map((logo) => (
            <div key={logo} className="relative size-6 overflow-hidden rounded-full bg-background shadow-sm">
              <Image src={logo} alt={t('Transfer method icon')} fill sizes="28px" className="object-cover" />
            </div>
          ))}
        </div>
      </button>
    </div>
  )
}

export default WalletFundMenu
