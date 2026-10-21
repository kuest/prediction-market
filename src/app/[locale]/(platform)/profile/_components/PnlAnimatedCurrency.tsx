'use client'

import { AnimatedCounter } from 'react-animated-counter'

import { formatCurrency } from '@/lib/formatters'

interface PnlAnimatedCurrencyProps {
  magnitude: number
  sign: '+' | '-'
  size?: 'regular' | 'large'
}

export default function PnlAnimatedCurrency({ magnitude, sign, size = 'regular' }: PnlAnimatedCurrencyProps) {
  const absoluteValue = Math.abs(magnitude)
  const sizes =
    size === 'large'
      ? ([
          ['sm:hidden', '24px'],
          ['hidden sm:inline-flex', '30px'],
        ] as const)
      : ([['inline-flex', '14px']] as const)

  return (
    <span className="inline-flex items-baseline tabular-nums">
      <span className="sr-only">
        {sign}
        {formatCurrency(absoluteValue)}
      </span>
      <span className="inline-flex items-baseline" aria-hidden="true">
        <span>{sign}$</span>
        {sizes.map(([className, fontSize]) => (
          <span key={fontSize} className={className}>
            <AnimatedCounter
              value={absoluteValue}
              color="currentColor"
              fontSize={fontSize}
              includeCommas
              includeDecimals
              decimalPrecision={2}
              incrementColor="currentColor"
              decrementColor="currentColor"
              digitStyles={{ fontWeight: 600, lineHeight: '1' }}
              containerStyles={{
                display: 'inline-flex',
                alignItems: 'baseline',
                flexDirection: 'row-reverse',
                lineHeight: '1',
              }}
            />
          </span>
        ))}
      </span>
    </span>
  )
}
