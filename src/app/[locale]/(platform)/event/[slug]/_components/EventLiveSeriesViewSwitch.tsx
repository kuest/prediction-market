'use client'

import { ChartLineIcon, RadioIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'

import type { EventLiveChartConfig } from '@/types'

import { cn } from '@/lib/utils'

import { hexToRgba, isGoldDailySeries } from '../_utils/eventLiveSeriesChartUtils'

interface EventLiveSeriesViewSwitchProps {
  activeView: 'live' | 'market'
  setActiveView: (view: 'live' | 'market') => void
  liveColor: string
  config: EventLiveChartConfig
}

export default function EventLiveSeriesViewSwitch({
  activeView,
  setActiveView,
  liveColor,
  config,
}: EventLiveSeriesViewSwitchProps) {
  const t = useExtracted()
  const isLiveChartView = activeView === 'live'
  const isMarketView = activeView === 'market'

  const liveSwitchIconStyle = isLiveChartView
    ? {
        color: liveColor,
      }
    : undefined

  const switchThumbStyle = isLiveChartView
    ? {
        transform: 'translateX(2rem)',
        backgroundColor: hexToRgba(liveColor, 0.2),
      }
    : {
        transform: 'translateX(0)',
      }

  return (
    <div className="relative z-0 flex h-[42px] items-center rounded-md border border-border bg-background/70 p-1">
      <span
        className={cn(
          'pointer-events-none absolute top-1 left-1 z-0 size-8 rounded-sm transition-all duration-300 ease-out',
          !isLiveChartView && 'bg-primary/30',
        )}
        style={switchThumbStyle}
      />
      <button
        type="button"
        onClick={() => setActiveView('market')}
        className={cn(
          'relative z-1 flex size-8 items-center justify-center rounded-sm transition-colors',
          isMarketView ? 'text-primary' : 'bg-transparent text-muted-foreground hover:bg-muted',
        )}
        aria-label={t('Show market chart')}
      >
        <ChartLineIcon className="size-[18px]" />
      </button>
      <button
        type="button"
        onClick={() => setActiveView('live')}
        className={cn(
          'relative z-1 flex size-8 items-center justify-center rounded-sm transition-colors',
          !isLiveChartView && 'bg-transparent text-muted-foreground hover:bg-muted',
        )}
        style={liveSwitchIconStyle}
        aria-label={t('Show live chart')}
      >
        {isGoldDailySeries(config.series_slug) ? (
          <RadioIcon className="size-[18px]" aria-hidden />
        ) : config.icon_path ? (
          <span
            className="block size-4 bg-current"
            aria-hidden
            style={{
              WebkitMaskImage: `url(${config.icon_path})`,
              maskImage: `url(${config.icon_path})`,
              WebkitMaskPosition: 'center',
              maskPosition: 'center',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              WebkitMaskSize: 'contain',
              maskSize: 'contain',
            }}
          />
        ) : (
          <span className="size-2 rounded-full bg-current" />
        )}
      </button>
    </div>
  )
}
