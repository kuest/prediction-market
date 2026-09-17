'use client'

import { ArrowLeftRightIcon, ChevronRightIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'
import Image from 'next/image'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MIN_USD_BALANCE } from '@/hooks/useLiFiWalletTokens'
import { cn } from '@/lib/utils'

function WalletTokenList({
  onContinue,
  items,
  isLoadingTokens,
  hasError = false,
  selectedId,
  onSelect,
  emptyMessage,
  errorMessage,
  onConnectAnotherNetwork,
}: {
  onContinue: () => void
  items: Array<{
    id: string
    symbol: string
    network: string
    icon: string
    chainIcon?: string
    balance: string
    usd: string
    hasUsdValue: boolean
    disabled: boolean
  }>
  isLoadingTokens: boolean
  hasError?: boolean
  selectedId: string
  onSelect: (id: string) => void
  emptyMessage?: string
  errorMessage?: string
  onConnectAnotherNetwork?: () => void
}) {
  const t = useExtracted()
  const showErrorState = !isLoadingTokens && hasError && items.length === 0
  const showEmptyState = !isLoadingTokens && !hasError && items.length === 0
  const resolvedEmptyMessage =
    emptyMessage ??
    t('No supported tokens were found in your connected wallet. Add funds on a supported network and try again.')
  const resolvedErrorMessage = errorMessage ?? t('Could not load wallet balances. Please try again.')
  const selectedItem = items.find((item) => item.id === selectedId)
  const hasValidSelection = Boolean(selectedItem && !selectedItem.disabled)

  return (
    <div className="space-y-4">
      <div className="max-h-90 overflow-y-scroll pr-1">
        <div className="space-y-2">
          {isLoadingTokens &&
            Array.from({ length: 4 }).map((_, index) => (
              <div
                key={`wallet-token-skeleton-${index}`}
                className="flex w-full items-center justify-between rounded-lg border border-transparent px-3 py-1.5"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex align-middle">
                    <span className="size-8.5 animate-pulse rounded-full bg-accent" />
                  </span>
                  <div className="space-y-1">
                    <span className="inline-flex align-middle">
                      <span className="h-4 w-16 animate-pulse rounded-md bg-accent" />
                    </span>
                    <span className="inline-flex align-middle">
                      <span className="h-3 w-24 animate-pulse rounded-md bg-accent" />
                    </span>
                  </div>
                </div>
                <span className="inline-flex align-middle">
                  <span className="h-6 w-16 animate-pulse rounded-md bg-accent" />
                </span>
              </div>
            ))}
          {showEmptyState && (
            <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              {resolvedEmptyMessage}
            </div>
          )}
          {showErrorState && (
            <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              {resolvedErrorMessage}
            </div>
          )}
          {items.map((item) => {
            const isSelected = selectedId === item.id
            const isDisabled = item.disabled
            const chainIconSrc = item.chainIcon ?? '/images/deposit/transfer/polygon_dark.png'
            return (
              <button
                key={item.id}
                type="button"
                disabled={isDisabled}
                onClick={() => {
                  if (!isDisabled) {
                    onSelect(item.id)
                  }
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left transition',
                  isSelected ? 'border border-foreground/20' : 'border border-transparent',
                  {
                    'cursor-not-allowed opacity-50': isDisabled,
                    'hover:bg-muted/50': !isDisabled && !isSelected,
                  },
                )}
              >
                <div className="flex items-center gap-3">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <div className="relative">
                          <Image
                            src={item.icon}
                            alt={item.symbol}
                            width={34}
                            height={34}
                            className="rounded-full"
                            unoptimized
                          />
                          <span className="absolute -right-1 -bottom-1 rounded-full bg-background p-0.5">
                            {chainIconSrc.startsWith('http') ? (
                              <Image
                                src={chainIconSrc}
                                alt={item.network}
                                width={14}
                                height={14}
                                className="rounded-full"
                                unoptimized
                              />
                            ) : (
                              <Image
                                src={chainIconSrc}
                                alt={item.network}
                                width={14}
                                height={14}
                                className="rounded-full"
                              />
                            )}
                          </span>
                        </div>
                      }
                    />
                    <TooltipContent>
                      {t('{token} on {network}', { token: item.symbol, network: item.network })}
                    </TooltipContent>
                  </Tooltip>
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold text-foreground">{item.symbol}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.balance} {item.symbol}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isDisabled && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {t('Low Balance')}
                          </span>
                        }
                      />
                      <TooltipContent>
                        {t('Minimum required: ${amount}', { amount: MIN_USD_BALANCE.toFixed(2) })}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  <span className="text-lg font-semibold text-foreground">
                    {item.hasUsdValue ? `$${item.usd}` : '—'}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
      <div className="-mx-6 border-t" />
      <Button
        type="button"
        className="h-12 w-full"
        onClick={onContinue}
        disabled={!hasValidSelection || isLoadingTokens || showEmptyState || showErrorState}
      >
        {t('Continue')}
      </Button>
      {onConnectAnotherNetwork && (
        <>
          <div className="-mx-6 border-t" />
          <button
            type="button"
            className={cn(
              'group flex w-full items-center justify-between gap-4 rounded-lg border border-border px-4 py-2 text-left transition hover:bg-muted/50',
            )}
            onClick={onConnectAnotherNetwork}
          >
            <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center text-foreground">
                <ArrowLeftRightIcon className="size-6" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{t('Bridge from another network')}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{t('Connect a wallet via LI.FI')}</span>
                  <span className="size-1 rounded-full bg-muted-foreground" />
                  <span>{t('All supported networks')}</span>
                </div>
              </div>
            </div>
            <ChevronRightIcon className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
          </button>
        </>
      )}
    </div>
  )
}

export default WalletTokenList
