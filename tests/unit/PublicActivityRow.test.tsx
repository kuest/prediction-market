import type { ReactNode } from 'react'

import { render, screen } from '@testing-library/react'
import { describe, expect, it, mock } from 'bun:test'

import { mapDataApiActivityToActivityOrder } from '@/lib/data-api/user'

void mock.module('@/i18n/navigation', () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}))
void mock.module('@/components/EventIconImage', () => ({ default: () => null }))
void mock.module('@/hooks/useLocalizedTimeAgo', () => ({
  default: () => ({ formatTimeAgo: () => 'just now' }),
}))

const { default: PublicActivityRow } = await import('@/app/[locale]/(platform)/profile/_components/PublicActivityRow')

describe('public activity collateral flows', () => {
  it.each([
    { type: 'SPLIT', cashFlow: '-$2,101.45' },
    { type: 'MERGE', cashFlow: '+$2,101.45' },
  ])('displays the $type amount and collateral cash flow from the data API', ({ type, cashFlow }) => {
    const activity = mapDataApiActivityToActivityOrder({
      type,
      size: 2101.45,
      usdcSize: 2101.45,
      price: 0,
      title: 'Bitcoin Up or Down',
      timestamp: 1793653617,
    })

    render(
      <table>
        <tbody>
          <PublicActivityRow activity={activity} />
        </tbody>
      </table>,
    )

    expect(screen.getByText('2,101.45 shares')).toBeInTheDocument()
    expect(screen.getByText(cashFlow)).toBeInTheDocument()
  })
})
