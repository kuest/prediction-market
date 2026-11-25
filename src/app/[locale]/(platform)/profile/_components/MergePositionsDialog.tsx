'use client'

import { CheckIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'

import EventIconImage from '@/components/EventIconImage'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { useIsMobile } from '@/hooks/useIsMobile'
import { Link } from '@/i18n/navigation'
import { formatCurrency } from '@/lib/formatters'
import { resolveMarketAssetUrl } from '@/lib/image/asset-reference'
import { cn } from '@/lib/utils'

export interface MergeableMarket {
  conditionId: string
  eventSlug: string
  title: string
  icon?: string
  mergeAmount: number
  outcomeAssets: [string, string]
  isNegRisk: boolean
}

interface MergePositionsDialogProps {
  open: boolean
  markets: MergeableMarket[]
  isProcessing: boolean
  mergeCount: number
  isSuccess: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function MergePositionsDialog({
  open,
  markets,
  isProcessing,
  mergeCount,
  isSuccess,
  onOpenChange,
  onConfirm,
}: MergePositionsDialogProps) {
  const t = useExtracted()
  const isMobile = useIsMobile()

  function formatMergeValue(value: number) {
    const safeValue = Number.isFinite(value) ? value : 0
    return formatCurrency(safeValue)
  }
  const totalValue = markets.reduce((total, market) => total + (market.mergeAmount || 0), 0)
  const totalCount = markets.length
  const progressCount = mergeCount > 0 ? mergeCount : 0
  const dialogTitle = t('Merge {amount} in positions', { amount: formatMergeValue(totalValue || 0) })
  const dialogDescription = t('This will merge all eligible market positions.')
  const actionLabel = isSuccess
    ? t('Done')
    : isProcessing && totalCount > 0
      ? t('Processing... {current}/{total}', { current: String(progressCount), total: String(totalCount) })
      : t('Merge positions')

  const dialogBody = isSuccess ? (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <div className="grid size-16 place-items-center rounded-full bg-yes">
        <CheckIcon className="size-8 text-white" />
      </div>
      <p className="text-sm text-muted-foreground">{t('You successfully merged all your eligible positions.')}</p>
    </div>
  ) : (
    <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
      {markets.map((market) => {
        const imageUrl = resolveMarketAssetUrl(market.icon)
        return (
          <Link
            key={market.conditionId}
            href={`/event/${market.eventSlug}`}
            className={cn('flex items-start gap-3 rounded-lg p-3 transition-colors', 'hover:bg-muted/60')}
          >
            <div className="relative size-10 overflow-hidden rounded-md bg-muted sm:size-12">
              {imageUrl ? (
                <EventIconImage
                  src={imageUrl}
                  alt={`${market.title} icon`}
                  sizes="(min-width: 640px) 48px, 40px"
                  containerClassName="size-full"
                />
              ) : (
                <div className="grid size-full place-items-center text-xs text-muted-foreground">{t('No image')}</div>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-1">
              <h3 className="text-sm/tight font-semibold text-foreground">{market.title}</h3>
              <p className="text-sm text-muted-foreground">Value {formatMergeValue(market.mergeAmount || 0)}</p>
            </div>
          </Link>
        )
      })}
    </div>
  )

  const actionButton = (
    <Button
      size="outcome"
      className="w-full text-base font-bold"
      disabled={!isSuccess && (isProcessing || markets.length === 0)}
      onClick={isSuccess ? () => onOpenChange(false) : onConfirm}
    >
      {actionLabel}
    </Button>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[90vh] w-full bg-background px-4 pt-4 pb-6">
          <div className="space-y-4">
            <DrawerHeader className="space-y-3 text-center">
              <DrawerTitle className="text-2xl font-bold">{dialogTitle}</DrawerTitle>
              <DrawerDescription>{dialogDescription}</DrawerDescription>
            </DrawerHeader>
            {dialogBody}
            <DrawerFooter>{actionButton}</DrawerFooter>
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg space-y-4 sm:space-y-6">
        <DialogHeader className="space-y-3">
          <DialogTitle className="text-center text-2xl font-bold">{dialogTitle}</DialogTitle>
          <DialogDescription className="text-center">{dialogDescription}</DialogDescription>
        </DialogHeader>
        {dialogBody}
        <DialogFooter>{actionButton}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
