'use client'

import { CodeXmlIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'
import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'

import type { Event } from '@/types'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useOrder } from '@/stores/useOrder'

const EventChartEmbedDialog = dynamic(
  () => import('@/app/[locale]/(platform)/event/[slug]/_components/EventChartEmbedDialog'),
  { ssr: false },
)

interface EventEmbedProps {
  event: Event
}

export default function EventEmbed({ event }: EventEmbedProps) {
  const t = useExtracted()
  const [open, setOpen] = useState(false)
  const [hasOpened, setHasOpened] = useState(false)
  const selectedMarketConditionId = useOrder((state) => state.market?.condition_id)
  const initialMarketId = useMemo(() => {
    return event.markets.some((market) => market.condition_id === selectedMarketConditionId)
      ? selectedMarketConditionId
      : (event.markets[0]?.condition_id ?? null)
  }, [event.markets, selectedMarketConditionId])

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          `size-auto rounded-sm border border-transparent bg-transparent p-0 text-foreground transition-colors hover:bg-muted/80 focus-visible:ring-1 focus-visible:ring-ring md:size-9`,
        )}
        onClick={() => {
          setHasOpened(true)
          setOpen(true)
        }}
        aria-label={t('Embed')}
        title={t('Embed')}
      >
        <CodeXmlIcon className="size-4" />
      </Button>
      {hasOpened && (
        <EventChartEmbedDialog
          open={open}
          onOpenChange={setOpen}
          markets={event.markets}
          initialMarketId={initialMarketId}
        />
      )}
    </>
  )
}
