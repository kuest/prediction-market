'use client'

import { useExtracted } from 'next-intl'
import Image from 'next/image'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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
    disabled: boolean
  }>
  isLoadingTokens: boolean
  hasError?: boolean
  selectedId: string
  onSelect: (id: string) => void
  emptyMessage?: string
  errorMessage?: string
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
                aria-hidden="true"
                className="flex w-full items-center justify-between rounded-lg border border-transparent px-3 py-1.5"
              >
                <div className="flex items-center gap-3">
                  <div className="relative shrink-0">
                    <Skeleton className="size-8.5 rounded-full" />
                    <div className="absolute -right-1 -bottom-1 rounded-full bg-background p-0.5">
                      <Skeleton className="size-3.5 rounded-full" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <div className="flex h-5 items-center">
                      <Skeleton className="h-3.5 w-12 rounded" />
                    </div>
                    <div className="flex h-4 items-center">
                      <Skeleton className="h-3 w-24 rounded" />
                    </div>
                  </div>
                </div>
                <div className="flex h-7 items-center">
                  <Skeleton className="h-5 w-16 rounded" />
                </div>
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
                  <span className="text-lg font-semibold text-foreground">${item.usd}</span>
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
    </div>
  )
}

export default WalletTokenList
