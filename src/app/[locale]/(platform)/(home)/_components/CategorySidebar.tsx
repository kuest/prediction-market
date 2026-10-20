'use client'

import type { ReactNode } from 'react'

import { useExtracted } from 'next-intl'
import Image from 'next/image'
import { useState } from 'react'

import type {
  PlatformCategorySidebarIconKey,
  PlatformCategorySidebarItem,
  PlatformCategorySidebarLinkItem,
  PlatformNavigationChild,
} from '@/lib/platform-navigation'

import { categorySidebarInlineIcons } from '@/app/[locale]/(platform)/(home)/_components/CategorySidebarInlineIcons'
import IntentPrefetchLink from '@/app/[locale]/(platform)/_components/IntentPrefetchLink'
import { cn } from '@/lib/utils'

interface CategorySidebarProps {
  activeSubcategorySlug: string | null
  categorySlug: string
  categoryTitle: string
  sidebarItems?: PlatformCategorySidebarItem[]
  subcategories: PlatformNavigationChild[]
}

interface CategorySidebarLinkProps {
  children: ReactNode
  count?: number
  href: string
  icon?: PlatformCategorySidebarIconKey
  isActive: boolean
  isNested?: boolean
  useInlineIcon: boolean
}

interface SidebarIconAsset {
  alt: string
  decorative?: boolean
  rounded?: boolean
  src: string
}

interface CategorySidebarRenderLinkItem extends PlatformCategorySidebarLinkItem {}

type CategorySidebarRenderItem =
  | CategorySidebarRenderLinkItem
  | Extract<PlatformCategorySidebarItem, { type: 'divider' }>

const sidebarIconAssets: Partial<Record<PlatformCategorySidebarIconKey, SidebarIconAsset>> = {
  'all-grid': {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/crypto/all-grid.svg',
  },
  'five-minute': {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/crypto/five-minute.svg',
  },
  'fifteen-minute': {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/crypto/fifteen-minute.svg',
  },
  hourly: {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/crypto/hourly.svg',
  },
  'four-hour': {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/crypto/four-hour.svg',
  },
  daily: {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/crypto/daily.svg',
  },
  weekly: {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/crypto/weekly.svg',
  },
  monthly: {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/crypto/monthly.svg',
  },
  yearly: {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/crypto/yearly.svg',
  },
  'pre-market': {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/crypto/pre-market.svg',
  },
  etf: {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/crypto/etf.svg',
  },
  bitcoin: {
    alt: 'Bitcoin logo',
    rounded: true,
    src: '/images/logos/btc.png',
  },
  ethereum: {
    alt: 'Ethereum logo',
    rounded: true,
    src: '/images/logos/eth.png',
  },
  solana: {
    alt: 'Solana logo',
    rounded: true,
    src: '/images/logos/sol.png',
  },
  xrp: {
    alt: 'XRP logo',
    rounded: true,
    src: '/images/logos/xrp.png',
  },
  bnb: {
    alt: 'BNB logo',
    rounded: true,
    src: '/images/logos/bnb.png',
  },
  dogecoin: {
    alt: 'Dogecoin logo',
    rounded: true,
    src: '/images/logos/doge.png',
  },
  hype: {
    alt: 'HYPE logo',
    rounded: true,
    src: '/images/logos/hype.png',
  },
  microstrategy: {
    alt: 'Microstrategy logo',
    rounded: true,
    src: '/images/logos/microstrategy.jpg',
  },
  stocks: {
    alt: 'Stocks',
    src: '/images/category-sidebar/finance/stocks.png',
  },
  earnings: {
    alt: 'Earnings',
    src: '/images/category-sidebar/finance/earnings.png',
  },
  indicies: {
    alt: 'Indices',
    src: '/images/category-sidebar/finance/indices.png',
  },
  commodities: {
    alt: 'Commodities',
    src: '/images/category-sidebar/finance/commodities.png',
  },
  forex: {
    alt: 'Forex',
    src: '/images/category-sidebar/finance/forex.png',
  },
  collectibles: {
    alt: 'Collectibles',
    src: '/images/category-sidebar/finance/collectibles.png',
  },
  acquisitions: {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/finance/acquisitions.svg',
  },
  'earnings-calendar': {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/finance/earnings-calendar.svg',
  },
  'earnings-calls': {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/finance/earnings-calls.svg',
  },
  ipo: {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/finance/ipo.svg',
  },
  'fed-rates': {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/finance/fed-rates.svg',
  },
  'prediction-markets': {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/finance/prediction-markets.svg',
  },
  treasuries: {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/finance/treasuries.svg',
  },
  temperature: {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/weather/temperature.svg',
  },
  precipitation: {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/weather/precipitation.svg',
  },
  global: {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/weather/global.svg',
  },
  tornadoes: {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/weather/tornadoes.svg',
  },
  hurricanes: {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/weather/hurricanes.svg',
  },
  earthquakes: {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/weather/earthquakes.svg',
  },
  volcanoes: {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/weather/volcanoes.svg',
  },
  pandemics: {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/weather/pandemics.svg',
  },
  space: {
    alt: '',
    decorative: true,
    src: '/images/category-sidebar/weather/space.svg',
  },
}

function SidebarLinkIcon({ icon, useInlineIcon }: { icon?: PlatformCategorySidebarIconKey; useInlineIcon: boolean }) {
  if (!icon) {
    return null
  }

  const InlineIcon = useInlineIcon ? categorySidebarInlineIcons[icon] : null
  if (InlineIcon) {
    return <InlineIcon />
  }

  const asset = sidebarIconAssets[icon]
  if (!asset) {
    return null
  }

  return (
    <Image
      alt={asset.alt}
      aria-hidden={asset.decorative || undefined}
      src={asset.src}
      width={20}
      height={20}
      unoptimized={asset.src.endsWith('.svg')}
      className={cn('size-5', asset.rounded && 'rounded-full')}
    />
  )
}

function CategorySidebarLink({
  children,
  count,
  href,
  icon,
  isActive,
  isNested = false,
  useInlineIcon,
}: CategorySidebarLinkProps) {
  return (
    <IntentPrefetchLink
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-md px-3 text-sm transition-colors',
        isNested ? 'py-2.5 font-medium' : 'py-3 font-semibold',
        isActive ? 'bg-muted' : 'hover:bg-muted/60',
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        {icon && (
          <span className={cn('shrink-0 text-foreground', isNested ? '[&_svg]:size-4' : '[&_svg]:size-5')}>
            <SidebarLinkIcon icon={icon} useInlineIcon={useInlineIcon} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{children}</span>
      </span>
      {typeof count === 'number' && (
        <span className="shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">{count}</span>
      )}
    </IntentPrefetchLink>
  )
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className={cn('size-3 transition-transform', expanded && 'rotate-180')}
    >
      <polyline
        points="1.75 4.25 6 8.5 10.25 4.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  )
}

export default function CategorySidebar({
  activeSubcategorySlug,
  categorySlug,
  categoryTitle,
  sidebarItems,
  subcategories,
}: CategorySidebarProps) {
  const t = useExtracted()
  const [expandedItemOverrides, setExpandedItemOverrides] = useState<Record<string, boolean>>({})
  const items: CategorySidebarRenderItem[] = sidebarItems ?? [
    {
      type: 'link',
      slug: categorySlug,
      label: t('All'),
      isAll: true,
    },
    ...subcategories.map((subcategory) => ({
      type: 'link' as const,
      slug: subcategory.slug,
      label: subcategory.name,
      count: subcategory.count,
    })),
  ]

  return (
    <nav
      aria-label={`${categoryTitle} subcategories`}
      className={cn(
        `hidden h-[calc(100vh-9rem)] w-47.5 shrink-0 scrollbar-none flex-col overflow-y-auto py-5 lg:sticky lg:top-32 lg:flex lg:py-0 [&::-webkit-scrollbar]:hidden`,
      )}
    >
      {items.map((item) => {
        if (item.type === 'divider') {
          return <div key={item.key} className="mb-2 w-full border-b border-border pb-2" />
        }

        const isAllItem = item.isAll ?? item.slug === categorySlug
        const href = item.href ?? (isAllItem ? `/${categorySlug}` : `/${categorySlug}/${item.slug}`)
        const subItems = item.subItems ?? []
        const hasActiveSubItem = subItems.some((subItem) => subItem.slug === activeSubcategorySlug)
        const isExpanded = expandedItemOverrides[item.slug] ?? hasActiveSubItem
        const useInlineIcon = categorySlug === 'crypto' || categorySlug === 'finance' || categorySlug === 'weather'

        if (subItems.length > 0) {
          return (
            <div key={item.slug}>
              <div
                className={cn(
                  'flex w-full items-stretch rounded-md text-sm font-semibold transition-colors',
                  activeSubcategorySlug === item.slug ? 'bg-muted' : 'hover:bg-muted/60',
                )}
              >
                <IntentPrefetchLink
                  href={href}
                  aria-current={activeSubcategorySlug === item.slug ? 'page' : undefined}
                  className="flex min-w-0 flex-1 items-center gap-2.5 p-3"
                >
                  {item.icon && (
                    <span className="shrink-0 text-foreground [&_svg]:size-5">
                      <SidebarLinkIcon icon={item.icon} useInlineIcon={useInlineIcon} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {typeof item.count === 'number' && (
                    <span className="shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
                      {item.count}
                    </span>
                  )}
                </IntentPrefetchLink>
                <button
                  type="button"
                  aria-label={`${item.label} sub-items`}
                  aria-expanded={isExpanded}
                  onClick={() =>
                    setExpandedItemOverrides((current) => ({
                      ...current,
                      [item.slug]: !isExpanded,
                    }))
                  }
                  className="flex w-10 shrink-0 items-center justify-center text-muted-foreground"
                >
                  <ChevronIcon expanded={isExpanded} />
                </button>
              </div>
              {isExpanded && (
                <div className="flex flex-col pl-5">
                  {subItems.map((subItem) => (
                    <CategorySidebarLink
                      key={subItem.slug}
                      count={subItem.count}
                      href={subItem.href ?? `/${categorySlug}/${subItem.slug}`}
                      icon={subItem.icon}
                      isActive={activeSubcategorySlug === subItem.slug}
                      isNested
                      useInlineIcon={useInlineIcon}
                    >
                      {subItem.label}
                    </CategorySidebarLink>
                  ))}
                </div>
              )}
            </div>
          )
        }

        return (
          <CategorySidebarLink
            key={item.slug}
            count={item.count}
            href={href}
            icon={item.icon}
            isActive={isAllItem ? activeSubcategorySlug === null : activeSubcategorySlug === item.slug}
            useInlineIcon={useInlineIcon}
          >
            {isAllItem ? t('All') : item.label}
          </CategorySidebarLink>
        )
      })}
    </nav>
  )
}
