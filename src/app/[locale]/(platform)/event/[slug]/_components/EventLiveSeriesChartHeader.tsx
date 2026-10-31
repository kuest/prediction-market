'use client'

import { ChevronRightIcon, TriangleIcon } from 'lucide-react'
import { useExtracted, useLocale } from 'next-intl'

import SiteLogoIcon from '@/components/SiteLogoIcon'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'

import type { CountdownUnit } from '../_utils/eventLiveSeriesChartUtils'

import { countdownLabel, formatUsd } from '../_utils/eventLiveSeriesChartUtils'

interface Watermark {
  iconSvg: string | null
  iconImageUrl: string | null
  label: string
}

function LiveIndicator({ pingOpacity = 0.45 }: { pingOpacity?: number }) {
  return (
    <span aria-hidden className="relative inline-flex size-2.5 items-center justify-center">
      <span
        className="absolute inset-0 m-auto inline-flex size-2.5 animate-ping rounded-full bg-red-500"
        style={{ opacity: pingOpacity }}
      />
      <span className="relative inline-flex size-2 rounded-full bg-red-500" />
    </span>
  )
}

interface EventLiveSeriesChartHeaderProps {
  resolvedBaselinePrice: number | null
  headerPriceDisplayDigits: number
  currentPrice: number | null
  delta: number | null
  deltaDisplayDigits: number
  liveColor: string
  shouldShowCountdown: boolean
  isEventClosed: boolean
  liveMarketHref: string | null
  isMobile: boolean
  isTradingWindowActive: boolean
  visibleCountdownUnits: Array<{ unit: CountdownUnit; value: number }>
  countdownLeftLabel: string
  etDateLabel: string
  etTimeLabel: string
  utcDateLabel: string
  utcTimeLabel: string
  status: 'connecting' | 'live' | 'offline'
  watermark: Watermark
  showCountdownLogo?: boolean
}

const ROLLING_DIGITS = Array.from({ length: 10 }, (_, digit) => digit)

function RollingDigit({ digit }: { digit: number }) {
  return (
    <span className="relative inline-block h-[1em] overflow-hidden align-bottom leading-[1em]">
      <span className="invisible">0</span>
      <span
        className="absolute inset-x-0 top-0 transition-transform duration-300 ease-out"
        style={{ transform: `translateY(-${digit}em)` }}
      >
        {ROLLING_DIGITS.map((rollingDigit) => (
          <span key={rollingDigit} className="block h-[1em] leading-[1em]">
            {rollingDigit}
          </span>
        ))}
      </span>
    </span>
  )
}

function RollingValue({ value }: { value: string }) {
  return (
    <span className="inline-flex items-baseline">
      <span className="sr-only">{value}</span>
      <span aria-hidden className="inline-flex items-baseline">
        {Array.from(value).map((character, index) => {
          const digit = Number(character)

          return Number.isInteger(digit) ? (
            <RollingDigit key={value.length - index} digit={digit} />
          ) : (
            <span key={value.length - index}>{character}</span>
          )
        })}
      </span>
    </span>
  )
}

export default function EventLiveSeriesChartHeader({
  resolvedBaselinePrice,
  headerPriceDisplayDigits,
  currentPrice,
  delta,
  deltaDisplayDigits,
  liveColor,
  shouldShowCountdown,
  isEventClosed,
  liveMarketHref,
  isMobile,
  isTradingWindowActive,
  visibleCountdownUnits,
  countdownLeftLabel,
  etDateLabel,
  etTimeLabel,
  utcDateLabel,
  utcTimeLabel,
  status,
  watermark,
  showCountdownLogo = true,
}: EventLiveSeriesChartHeaderProps) {
  const t = useExtracted()
  const locale = useLocale()
  const liveMarketLabel = isMobile ? t('Live') : t('Go to live market')
  const countdownEndedLogo =
    watermark.iconSvg || watermark.iconImageUrl || watermark.label ? (
      <div
        className={cn(
          'pointer-events-none relative flex translate-y-0.5 items-center gap-1 text-lg leading-none text-muted-foreground opacity-50 select-none min-[360px]:text-xl sm:text-2xl',
        )}
        aria-hidden
      >
        {watermark.iconSvg || watermark.iconImageUrl ? (
          <SiteLogoIcon
            logoSvg={watermark.iconSvg ?? ''}
            logoImageUrl={watermark.iconImageUrl}
            alt={`${watermark.label} logo`}
            className="size-[1em] **:fill-current **:stroke-current"
            imageClassName="size-[1em] object-contain"
            size={24}
          />
        ) : null}
        {watermark.label ? <span className="font-semibold">{watermark.label}</span> : null}
      </div>
    ) : null
  const priceStatusLabel = isEventClosed ? t('Final price') : t('Current price')
  function resolveCountdownLabel(unit: CountdownUnit, value: number) {
    if (locale === 'en') {
      return countdownLabel(unit, value)
    }

    switch (unit) {
      case 'day':
        return t('{count, plural, one {Day} other {Days}}', { count: value })
      case 'hr':
        return t('{count, plural, one {Hour} other {Hours}}', { count: value })
      case 'min':
        return t('{count, plural, one {Minute} other {Minutes}}', { count: value })
      case 'sec':
        return t('{count, plural, one {Second} other {Seconds}}', { count: value })
    }
  }
  const resolvedCountdownLeftLabel =
    locale === 'en'
      ? countdownLeftLabel
      : visibleCountdownUnits.map(({ unit, value }) => `${value} ${resolveCountdownLabel(unit, value)}`).join(' ')

  return (
    <div
      className={cn(
        'flex items-end pr-0 pl-0',
        liveMarketHref
          ? 'flex-nowrap gap-1 sm:flex-wrap sm:gap-4'
          : shouldShowCountdown
            ? 'flex-nowrap gap-1 min-[360px]:gap-2 sm:flex-wrap sm:gap-4'
            : 'flex-wrap gap-4',
      )}
    >
      <div
        className={cn(
          'flex items-start',
          liveMarketHref
            ? 'min-w-0 flex-nowrap gap-1 min-[360px]:gap-2 sm:gap-5'
            : shouldShowCountdown
              ? 'min-w-0 flex-nowrap gap-1 min-[360px]:gap-3 sm:gap-5'
              : 'flex-wrap gap-5',
        )}
      >
        <div>
          <div className="text-xs font-semibold whitespace-nowrap text-muted-foreground">{t('Price To Beat')}</div>
          <div
            className={cn(
              `mt-1 text-[16px] leading-none font-semibold whitespace-nowrap text-muted-foreground tabular-nums sm:text-[22px]`,
              liveMarketHref ? 'min-[360px]:text-[20px]' : 'min-[360px]:text-[18px]',
            )}
          >
            {resolvedBaselinePrice != null ? formatUsd(resolvedBaselinePrice, headerPriceDisplayDigits) : '--'}
          </div>
        </div>
        <div className={cn('h-10 w-px bg-border', liveMarketHref ? 'block' : 'hidden sm:block')} />
        <div>
          <div
            className={cn(
              'flex items-center gap-0.5 text-xs font-semibold whitespace-nowrap min-[360px]:gap-1 sm:gap-2',
              isEventClosed && 'text-foreground',
            )}
            style={isEventClosed ? undefined : { color: liveColor }}
          >
            <span>{priceStatusLabel}</span>
            {delta != null && (
              <span
                className={`inline-flex items-center gap-0.5 text-xs font-semibold ${
                  delta >= 0 ? 'text-yes' : 'text-no'
                }`}
              >
                <TriangleIcon
                  className={`size-1.5 min-[360px]:size-2 sm:size-2.5 ${delta >= 0 ? '' : 'rotate-180'}`}
                  fill="currentColor"
                  stroke="none"
                />
                {formatUsd(Math.abs(delta), deltaDisplayDigits)}
              </span>
            )}
          </div>
          <div
            className={cn(
              `mt-1 inline-flex items-baseline text-[16px] leading-none font-semibold whitespace-nowrap tabular-nums sm:text-[22px]`,
              liveMarketHref ? 'min-[360px]:text-[20px]' : 'min-[360px]:text-[18px]',
              isEventClosed && 'text-foreground',
            )}
            style={isEventClosed ? undefined : { color: liveColor }}
          >
            {currentPrice != null ? <RollingValue value={formatUsd(currentPrice, headerPriceDisplayDigits)} /> : '--'}
          </div>
        </div>
      </div>
      {shouldShowCountdown ? (
        <div className="ml-auto flex shrink-0 items-end gap-1 min-[360px]:gap-2 sm:gap-3">
          <Tooltip>
            <TooltipTrigger
              render={
                <button type="button" className="grid shrink-0 justify-items-end gap-1 text-left">
                  <div className="flex items-end gap-0.5 min-[360px]:gap-1 sm:gap-2">
                    {visibleCountdownUnits.map(({ unit, value }) => (
                      <div key={unit} className="min-w-6 text-right min-[360px]:min-w-7 sm:min-w-8">
                        <div
                          className={cn(
                            'text-[16px] leading-none font-semibold tabular-nums min-[360px]:text-[18px] sm:text-[22px]',
                            isTradingWindowActive ? 'text-red-500' : 'text-muted-foreground',
                          )}
                        >
                          <RollingValue value={String(Math.max(0, Math.floor(value))).padStart(2, '0')} />
                        </div>
                        <div className="mt-1 text-[8px] font-semibold tracking-[0.08em] text-muted-foreground uppercase min-[360px]:text-[9px] sm:text-2xs">
                          {resolveCountdownLabel(unit, value)}
                        </div>
                      </div>
                    ))}
                  </div>
                  <span className="sr-only">{status}</span>
                </button>
              }
            />
            <TooltipContent align="end" className="w-72 rounded-xl p-3 text-left">
              <div className="grid gap-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="inline-flex items-center gap-2 text-red-500">
                    <LiveIndicator />
                    <span className="text-xs font-semibold tracking-[0.08em] uppercase">{t('Live')}</span>
                  </div>
                  <div className="text-sm">
                    <span className="font-semibold text-foreground">
                      {t('{time} left', { time: resolvedCountdownLeftLabel })}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">{t('Resolution time')}</div>

                <div className="grid gap-2 text-sm text-foreground">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        `inline-flex h-6 min-w-9 items-center justify-center rounded-md bg-muted px-2 text-xs font-semibold`,
                      )}
                    >
                      ET
                    </span>
                    <span className="tabular-nums">{etDateLabel}</span>
                    <span className="ml-auto tabular-nums">{etTimeLabel}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        `inline-flex h-6 min-w-9 items-center justify-center rounded-md bg-muted px-2 text-xs font-semibold`,
                      )}
                    >
                      UTC
                    </span>
                    <span className="tabular-nums">{utcDateLabel}</span>
                    <span className="ml-auto tabular-nums">{utcTimeLabel}</span>
                  </div>
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
          {showCountdownLogo && <div className="shrink-0 self-start">{countdownEndedLogo}</div>}
        </div>
      ) : liveMarketHref ? (
        <div className="ml-auto flex shrink-0 items-center gap-1 min-[360px]:gap-2 sm:gap-3">
          <Button
            size={isMobile ? 'sm' : 'default'}
            variant="outline"
            className={cn(
              'shrink-0 rounded-full font-semibold shadow-none',
              isMobile ? 'mr-[-4px] gap-1 text-xs' : 'has-[>svg]:px-3.5',
            )}
            nativeButton={false}
            render={
              <Link href={liveMarketHref}>
                <LiveIndicator pingOpacity={0.4} />
                <span>{liveMarketLabel}</span>
                <ChevronRightIcon className={isMobile ? 'size-3.5' : 'size-4'} />
              </Link>
            }
          />
          {showCountdownLogo && <div className="shrink-0">{countdownEndedLogo}</div>}
        </div>
      ) : isEventClosed ? (
        <div className="mr-[-4px] ml-auto sm:mr-[-6px]">{countdownEndedLogo}</div>
      ) : null}
    </div>
  )
}
