'use client'

import { AnimatedCounter } from '@/components/ui/animated-counter'

export default function EventOrderPanelAnimatedCents({
  value,
  fontSize = '16px',
}: {
  value: number
  fontSize?: string
}) {
  const normalizedValue = Number.isFinite(value) ? Number(value.toFixed(1)) : 0

  return (
    <span className="inline-flex items-baseline">
      <AnimatedCounter
        value={normalizedValue}
        color="currentColor"
        fontSize={fontSize}
        includeCommas={false}
        includeDecimals={!Number.isInteger(normalizedValue)}
        decimalPrecision={1}
        digitStyles={{ fontWeight: 700, lineHeight: '1' }}
        containerStyles={{
          display: 'inline-flex',
          alignItems: 'baseline',
          flexDirection: 'row-reverse',
          lineHeight: '1',
        }}
      />
      <span>¢</span>
    </span>
  )
}
