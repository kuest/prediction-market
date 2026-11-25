import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, mock, setSystemTime } from 'bun:test'

import type { Market } from '@/types'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  isMobile: false,
  fetchPriceHistory: mock(),
}))
const firstOpen = new Date('2026-11-15T12:00:00Z')
const nextOpen = new Date('2026-11-16T12:00:00Z')
const eventStart = new Date('2026-01-01T12:00:00Z')
const chosenFrom = new Date('2026-02-05T12:00:00Z')

void mock.module('next-intl', () => ({ useExtracted: () => (message: string) => message }))
void mock.module('@/hooks/useIsMobile', () => ({ useIsMobile: () => mocks.isMobile }))
void mock.module('@/hooks/useSiteIdentity', () => ({ useSiteIdentity: () => ({ name: 'Kuest' }) }))
void mock.module('@/hooks/usePublicRuntimeConfig', () => ({ usePublicRuntimeConfig: () => ({ clobUrl: '' }) }))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_utils/priceHistoryApi', () => ({
  fetchBatchPriceHistoryByTokenIds: mocks.fetchPriceHistory,
  mapTokenHistoryToConditionHistory: mock(),
}))
void mock.module('@/components/ui/calendar', () => ({
  Calendar: ({ onSelect }: { onSelect: (date: Date) => void }) => (
    <button type="button" onClick={() => onSelect(chosenFrom)}>
      Choose test date
    </button>
  ),
}))

const { default: EventChartExportDialog } =
  await import('@/app/[locale]/(platform)/event/[slug]/_components/EventChartExportDialog')
const markets = [
  { condition_id: 'bitcoin', short_title: 'Bitcoin', outcomes: [] },
  { condition_id: 'ethereum', short_title: 'Ethereum', outcomes: [] },
] as unknown as Market[]

function dateLabel(date: Date) {
  return new Intl.DateTimeFormat(navigator.language || 'en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

beforeEach(() => {
  mocks.fetchPriceHistory.mockClear()
  setSystemTime(firstOpen)
})
afterEach(() => {
  setSystemTime()
})

describe('event chart export form', () => {
  it.each([false, true])(
    'resets the real form and refreshes the export end date on reopen (mobile=%s)',
    async (isMobile) => {
      mocks.isMobile = isMobile
      const props = {
        onOpenChange: mock(),
        eventCreatedAt: eventStart.toISOString(),
        markets,
        isMultiMarket: true,
      }
      const { rerender } = render(<EventChartExportDialog {...props} open />)
      expect(screen.getByRole('combobox')).toHaveTextContent('Daily')
      expect(screen.getByRole('button', { name: dateLabel(firstOpen) })).toBeDisabled()

      await userEvent.click(screen.getByRole('combobox'))
      await userEvent.click(await screen.findByRole('option', { name: 'Weekly' }))
      expect(screen.getByRole('combobox')).toHaveTextContent('Weekly')
      await userEvent.click(screen.getByRole('button', { name: dateLabel(eventStart) }))
      await userEvent.click(await screen.findByRole('button', { name: 'Choose test date' }))
      expect(screen.getByRole('button', { name: dateLabel(chosenFrom) })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('checkbox', { name: 'Bitcoin' }))
      expect(screen.getByRole('checkbox', { name: 'Bitcoin' })).toBeChecked()

      rerender(<EventChartExportDialog {...props} open={false} />)
      expect(screen.queryByRole('combobox', { hidden: true })).not.toBeInTheDocument()
      expect(screen.queryByRole('checkbox', { hidden: true })).not.toBeInTheDocument()
      expect(mocks.fetchPriceHistory).not.toHaveBeenCalled()

      setSystemTime(nextOpen)
      rerender(<EventChartExportDialog {...props} open />)
      expect(await screen.findByRole('combobox')).toHaveTextContent('Daily')
      expect(screen.getByRole('button', { name: dateLabel(eventStart) })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: dateLabel(nextOpen) })).toBeDisabled()
      expect(screen.getByRole('checkbox', { name: 'Bitcoin' })).not.toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Ethereum' })).not.toBeChecked()
      expect(mocks.fetchPriceHistory).not.toHaveBeenCalled()
    },
  )
})
