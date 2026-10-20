import type { AnchorHTMLAttributes } from 'react'

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, mock } from 'bun:test'
import { createElement } from 'react'

import CategorySidebar from '@/app/[locale]/(platform)/(home)/_components/CategorySidebar'
import { resolveCategorySidebarData } from '@/lib/category-sidebar-config'

void mock.module('next-intl', () => ({
  useExtracted: () => (message: string) => message,
}))

void mock.module('next/image', () => ({
  default: function MockImage({ unoptimized: _unoptimized, ...props }: any) {
    return createElement('img', props)
  },
}))

void mock.module('@/i18n/navigation', () => ({
  Link: function MockLink({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

describe('categorySidebar', () => {
  it('renders configured sidebar items, counts, and dividers', () => {
    render(
      <CategorySidebar
        categorySlug="crypto"
        categoryTitle="Crypto"
        activeSubcategorySlug={null}
        sidebarItems={[
          { type: 'link', slug: 'crypto', label: 'All', count: 3, icon: 'all-grid', isAll: true },
          { type: 'link', slug: '5M', label: '5 Min', count: 0, icon: 'five-minute' },
          { type: 'divider', key: 'assets' },
          { type: 'link', slug: 'bitcoin', label: 'Bitcoin', count: 1, icon: 'bitcoin' },
        ]}
        subcategories={[]}
      />,
    )

    expect(screen.getByText('All')).toBeInTheDocument()
    expect(screen.getByText('5 Min')).toBeInTheDocument()
    expect(screen.getByText('Bitcoin')).toBeInTheDocument()
    expect(screen.getAllByText('0')).toHaveLength(1)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()

    const fiveMinuteLink = screen.getByRole('link', { name: /5 Min/ })
    const fiveMinuteIcon = fiveMinuteLink.querySelector('svg')
    expect(fiveMinuteIcon).not.toBeNull()
    expect(fiveMinuteIcon?.querySelector('[stroke="currentColor"]')).not.toBeNull()
    expect(fiveMinuteIcon?.parentElement).toHaveClass('text-foreground')
    expect(fiveMinuteLink.querySelector('img')).toBeNull()
  })

  it('uses custom href overrides for configured items', () => {
    render(
      <CategorySidebar
        categorySlug="finance"
        categoryTitle="Finance"
        activeSubcategorySlug={null}
        sidebarItems={[
          { type: 'link', slug: 'finance', label: 'All', count: 3, icon: 'all-grid', isAll: true },
          {
            type: 'link',
            slug: 'earnings-calendar',
            label: 'Earnings Calendar',
            href: '/earnings',
            icon: 'earnings-calendar',
          },
        ]}
        subcategories={[]}
      />,
    )

    expect(screen.getByRole('link', { name: 'Earnings Calendar' })).toHaveAttribute('href', '/earnings')
  })

  it('renders finance vector icons in the foreground color and keeps branded image icons', () => {
    render(
      <CategorySidebar
        categorySlug="finance"
        categoryTitle="Finance"
        activeSubcategorySlug={null}
        sidebarItems={[
          { type: 'link', slug: 'finance', label: 'All', count: 3, icon: 'all-grid', isAll: true },
          { type: 'link', slug: 'stocks', label: 'Stocks', count: 2, icon: 'stocks' },
          { type: 'link', slug: 'privates', label: 'Privates', count: 1, icon: 'privates' },
          { type: 'link', slug: 'kpis', label: 'KPIs', count: 1, icon: 'kpis' },
        ]}
        subcategories={[]}
      />,
    )

    for (const label of ['All', 'Privates', 'KPIs']) {
      const link = screen.getByRole('link', { name: new RegExp(`^${label}\\s?\\d+$`) })
      const icon = link.querySelector('svg')
      expect(icon).not.toBeNull()
      expect(icon?.querySelector('[stroke="currentColor"], [fill="currentColor"]')).not.toBeNull()
      expect(icon?.parentElement).toHaveClass('text-foreground')
    }

    expect(screen.getByRole('link', { name: /Stocks/ }).querySelector('img')).not.toBeNull()
  })

  it('allows an active weather temperature branch to be collapsed and reopened', () => {
    render(
      <CategorySidebar
        categorySlug="weather"
        categoryTitle="Weather"
        activeSubcategorySlug="high-temperature"
        sidebarItems={[
          { type: 'link', slug: 'weather', label: 'All', count: 6, icon: 'all-grid', isAll: true },
          {
            type: 'link',
            slug: 'temperature',
            label: 'Temperature',
            icon: 'temperature',
            subItems: [
              { type: 'link', slug: 'high-temperature', label: 'High Temp', count: 2, icon: 'high-temperature' },
              { type: 'link', slug: 'low-temperature', label: 'Low Temp', count: 1, icon: 'low-temperature' },
            ],
          },
          { type: 'link', slug: 'precipitation', label: 'Precipitation', count: 3, icon: 'precipitation' },
        ]}
        subcategories={[]}
      />,
    )

    const temperatureToggle = screen.getByRole('button', { name: 'Temperature sub-items' })
    expect(temperatureToggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: /High Temp/ })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(temperatureToggle)

    expect(temperatureToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: /High Temp/ })).not.toBeInTheDocument()

    fireEvent.click(temperatureToggle)

    expect(temperatureToggle).toHaveAttribute('aria-expanded', 'true')
    for (const label of ['High Temp', 'Low Temp']) {
      const link = screen.getByRole('link', { name: new RegExp(label) })
      const icon = link.querySelector('svg')
      expect(icon?.querySelector('[stroke="currentColor"], [fill="currentColor"]')).not.toBeNull()
      expect(icon?.parentElement).toHaveClass('text-foreground')
    }

    const precipitationIcon = screen.getByRole('link', { name: /^Precipitation\s?3$/ }).querySelector('svg')
    expect(precipitationIcon?.querySelector('[stroke="currentColor"]')).not.toBeNull()
    expect(precipitationIcon?.parentElement).toHaveClass('text-foreground')
  })

  it('renders category icons inline and preserves the crypto asset logo section', () => {
    const { childs, sidebarItems } = resolveCategorySidebarData({
      categorySlug: 'crypto',
      categoryCount: 12,
      childs: [],
    })

    render(
      <CategorySidebar
        categorySlug="crypto"
        categoryTitle="Crypto"
        activeSubcategorySlug={null}
        sidebarItems={sidebarItems}
        subcategories={childs}
      />,
    )

    const inlineIconLabels = [
      'All',
      '5 Min',
      '15 Min',
      '1 Hour',
      '4 Hours',
      'Daily',
      'Weekly',
      'Monthly',
      'Yearly',
      'Targets',
      'Pre-Market',
      'Institutions',
      'Industry',
      'Protocol Metrics',
    ]
    for (const label of inlineIconLabels) {
      const link = screen.getByRole('link', { name: new RegExp(`^${label}\\s?\\d+$`) })
      const icon = link.querySelector('svg')
      expect(icon).not.toBeNull()
      expect(icon?.querySelector('[stroke="currentColor"], [fill="currentColor"]')).not.toBeNull()
      expect(icon?.parentElement).toHaveClass('text-foreground')
    }

    const assetLabels = ['Bitcoin', 'Ethereum', 'Solana', 'XRP', 'Dogecoin', 'BNB', 'HYPE', 'MicroStrategy']
    for (const label of assetLabels) {
      const link = screen.getByRole('link', { name: new RegExp(label, 'i') })
      expect(link.querySelector('img')).not.toBeNull()
    }
    expect(screen.getByAltText('HYPE logo')).toHaveAttribute('src', '/images/logos/hype.png')
  })
})
