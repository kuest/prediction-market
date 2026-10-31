import { render, screen } from '@testing-library/react'
import { describe, expect, it, mock } from 'bun:test'

import EventChartHeader from '@/app/[locale]/(platform)/event/[slug]/_components/EventChartHeader'
import { OUTCOME_INDEX } from '@/lib/constants'

void mock.module('next-intl', () => ({
  useExtracted: () => (message: string) => (message === 'chance' ? '概率' : message),
}))

void mock.module('@/components/ui/animated-counter', () => ({
  AnimatedCounter: ({ value }: { value: number }) => <span>{value}</span>,
}))

void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventSeriesPills', () => ({
  default: () => null,
}))

void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventTweetMarketsPanel', () => ({
  default: () => null,
}))

describe('eventChartHeader', () => {
  it('localizes the probability label', () => {
    render(
      <EventChartHeader
        isSingleMarket
        activeOutcomeIndex={OUTCOME_INDEX.YES}
        activeOutcomeLabel="上涨"
        primarySeriesColor="#00ff00"
        yesChanceValue={29}
        effectiveBaselineYesChance={29}
        effectiveCurrentYesChance={29}
        watermark={{}}
      />,
    )

    expect(screen.getByText(/% 概率/)).toBeInTheDocument()
    expect(screen.queryByText(/chance/)).not.toBeInTheDocument()
  })
})
