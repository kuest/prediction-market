'use client'

import type { Route } from 'next'
import type { ReactNode } from 'react'

import { CheckIcon, ChevronDownIcon, Globe2Icon } from 'lucide-react'
import { useExtracted, useLocale } from 'next-intl'
import { Suspense, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import type { SocialIconName } from '@/components/SocialIcon'
import type { SupportedLocale } from '@/i18n/locales'
import type { PlatformNavigationChild, PlatformNavigationTag } from '@/lib/platform-navigation'
import type { Event } from '@/types'

import { usePlatformNavigationData } from '@/app/[locale]/(platform)/_providers/PlatformNavigationProvider'
import LocaleFlag from '@/components/LocaleFlag'
import SiteLogoIcon from '@/components/SiteLogoIcon'
import SocialIcon from '@/components/SocialIcon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSiteIdentity } from '@/hooks/useSiteIdentity'
import { LOCALE_LABELS, normalizeEnabledLocales, SUPPORTED_LOCALES } from '@/i18n/locales'
import { Link, usePathname } from '@/i18n/navigation'
import { fetchHomeEventsPageApi } from '@/lib/events-api'
import { stripLocalePrefix, withLocalePrefix } from '@/lib/locale-path'
import { parsePlatformPathname } from '@/lib/platform-navigation'
import { buildDynamicHomeCategorySlugSet } from '@/lib/platform-routing'
import { cn } from '@/lib/utils'

const DEFAULT_CATEGORY_LIMIT = 15
const CATEGORY_SECTION_LIMIT = 10
const ONE_DAY_MS = 24 * 60 * 60 * 1000

type CategorySectionKey = 'new' | 'popular' | 'related'

interface PlatformFooterProps {
  categorySlug?: string | null
  categoryTag?: string | null
  categoryPopularEvents?: Event[]
}

interface FooterExternalLink {
  href: string
  icon: SocialIconName
  label: string
}

function subscribeToCurrentYear(onStoreChange: () => void) {
  const interval = window.setInterval(onStoreChange, ONE_DAY_MS)
  return () => window.clearInterval(interval)
}

function getCurrentYearSnapshot() {
  return new Date().getFullYear()
}

function getServerYearSnapshot() {
  return null
}

function isExternalHref(href: string) {
  return href.startsWith('http://') || href.startsWith('https://')
}

function getExternalLinkProps(href: string) {
  return isExternalHref(href) ? { target: '_blank' as const, rel: 'noopener noreferrer' } : {}
}

function useEnabledLocales() {
  const [enabledLocales, setEnabledLocales] = useState<SupportedLocale[]>([...SUPPORTED_LOCALES])

  useEffect(function fetchEnabledLocalesForFooter() {
    let isActive = true

    async function loadEnabledLocales() {
      try {
        const response = await fetch('/api/locales')
        if (!response.ok) {
          return
        }

        const payload = await response.json()
        if (!isActive || !Array.isArray(payload?.locales)) {
          return
        }

        const normalized = normalizeEnabledLocales(payload.locales)
        if (normalized.length > 0) {
          setEnabledLocales(normalized)
        }
      } catch (error) {
        console.error('Failed to load enabled locales for footer', error)
      }
    }

    void loadEnabledLocales()

    return function cancelEnabledLocalesFetch() {
      isActive = false
    }
  }, [])

  return enabledLocales
}

function FooterLocaleSwitcher() {
  const locale = useLocale() as SupportedLocale
  const enabledLocales = useEnabledLocales()
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, setIsPending] = useState(false)

  function handleLocaleChange(nextLocale: string) {
    const resolvedLocale = nextLocale as SupportedLocale
    if (resolvedLocale === locale || typeof window === 'undefined') {
      return
    }

    const currentPathname = stripLocalePrefix(window.location.pathname)
    const targetPathname = withLocalePrefix(currentPathname, resolvedLocale)
    setIsPending(true)
    window.location.replace(`${targetPathname}${window.location.search}${window.location.hash}`)
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger
        disabled={isPending}
        className="group flex items-center gap-2 rounded-md text-sm font-medium text-foreground transition-colors outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <Globe2Icon className="size-4" />
        <span>{LOCALE_LABELS[locale]}</span>
        <ChevronDownIcon className="size-4 transition-transform duration-200 group-data-popup-open:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        collisionPadding={16}
        className="max-h-72 min-w-48 overflow-x-hidden overflow-y-auto"
      >
        <DropdownMenuRadioGroup value={locale} onValueChange={handleLocaleChange}>
          {enabledLocales.map((option) => (
            <DropdownMenuRadioItem
              key={option}
              value={option}
              className="group flex items-center gap-2 pr-7 pl-2 text-sm [&>span:first-child]:hidden"
            >
              <span className="flex flex-1 items-center gap-2">
                <LocaleFlag locale={option} />
                <span>{LOCALE_LABELS[option]}</span>
              </span>
              <CheckIcon className="ml-auto size-4 text-primary opacity-0 group-data-checked:opacity-100" />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FooterToggle({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  const t = useExtracted()

  return (
    <button
      type="button"
      className="mt-1 flex items-center gap-1 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      onClick={onClick}
    >
      {expanded ? t('View less') : t('View more')}
      <ChevronDownIcon className={cn('size-4 transition-transform duration-200', expanded && 'rotate-180')} />
    </button>
  )
}

function FooterCategoryLink({ category }: { category: PlatformNavigationTag }) {
  const t = useExtracted()

  return (
    <Link href={`/${category.slug}` as Route} className="group block w-fit">
      <span className="block text-sm font-medium text-foreground transition-colors group-hover:text-primary">
        {category.name}
      </span>
      <span className="block text-xs text-muted-foreground">{t('Predictions & odds')}</span>
    </Link>
  )
}

function splitIntoColumns<T>(items: T[], columnCount: number) {
  const columnSize = Math.ceil(items.length / columnCount)
  return Array.from({ length: columnCount }, (_, index) => items.slice(index * columnSize, (index + 1) * columnSize))
}

function DefaultMarketsFooter({ categories }: { categories: PlatformNavigationTag[] }) {
  const t = useExtracted()
  const [expanded, setExpanded] = useState(false)
  const visibleCategories = expanded ? categories : categories.slice(0, DEFAULT_CATEGORY_LIMIT)
  const columns = splitIntoColumns(visibleCategories, 3)
  const canToggle = categories.length > DEFAULT_CATEGORY_LIMIT

  return (
    <section className="min-w-0 lg:col-span-9">
      <h2 className="mb-5 text-sm font-medium text-muted-foreground">{t('Markets by category and topics')}</h2>
      <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
        {columns.map((column, columnIndex) => (
          <div key={columnIndex} className="space-y-4">
            {column.map((category) => (
              <FooterCategoryLink key={category.slug} category={category} />
            ))}
            {canToggle && columnIndex === columns.length - 1 && (
              <FooterToggle expanded={expanded} onClick={() => setExpanded((value) => !value)} />
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function SectionList({
  sectionKey,
  title,
  items,
  expandedSections,
  onToggle,
}: {
  sectionKey: CategorySectionKey
  title: string
  items: Array<{ href: Route; label: string; description?: string }>
  expandedSections: Set<CategorySectionKey>
  onToggle: (section: CategorySectionKey) => void
}) {
  const expanded = expandedSections.has(sectionKey)
  const visibleItems = expanded ? items : items.slice(0, CATEGORY_SECTION_LIMIT)
  const canToggle = items.length > CATEGORY_SECTION_LIMIT

  return (
    <section className="min-w-0">
      <h2 className="mb-5 text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="space-y-4">
        {visibleItems.map((item) => (
          <Link key={`${item.href}-${item.label}`} href={item.href} className="group block w-fit max-w-full">
            <span className="block truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">
              {item.label}
            </span>
            {item.description && <span className="block text-xs text-muted-foreground">{item.description}</span>}
          </Link>
        ))}
        {canToggle && <FooterToggle expanded={expanded} onClick={() => onToggle(sectionKey)} />}
      </div>
    </section>
  )
}

function uniqueEvents(events: Event[]) {
  const seen = new Set<string>()
  return events.filter((event) => {
    const key = String(event.id)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function relatedTopicItems(category: PlatformNavigationTag, description: string) {
  return category.childs.map((topic: PlatformNavigationChild) => ({
    href: `/${category.slug}/${topic.slug}` as Route,
    label: topic.name,
    description,
  }))
}

function marketItems(events: Event[]) {
  return uniqueEvents(events).map((event) => ({
    href: `/event/${event.slug}` as Route,
    label: event.title,
  }))
}

function CategoryMarketsFooter({
  category,
  popularEvents,
  newEvents,
}: {
  category: PlatformNavigationTag
  popularEvents: Event[]
  newEvents: Event[]
}) {
  const t = useExtracted()
  const [expandedSections, setExpandedSections] = useState<Set<CategorySectionKey>>(() => new Set())

  const sections = [
    {
      key: 'related' as const,
      title: t('Related topics'),
      items: relatedTopicItems(category, t('Predictions & odds')),
    },
    {
      key: 'popular' as const,
      title: t('Popular {category} markets', { category: category.name }),
      items: marketItems(popularEvents),
    },
    {
      key: 'new' as const,
      title: t('New {category} markets', { category: category.name }),
      items: marketItems(newEvents),
    },
  ]

  function handleToggle(section: CategorySectionKey) {
    setExpandedSections((current) => {
      const next = new Set(current)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }

  return (
    <div className="grid min-w-0 gap-10 lg:col-span-9 lg:grid-cols-3">
      {sections.map((section) => (
        <SectionList
          key={section.key}
          sectionKey={section.key}
          title={section.title}
          items={section.items}
          expandedSections={expandedSections}
          onToggle={handleToggle}
        />
      ))}
    </div>
  )
}

function FooterNavigation({ links }: { links: FooterExternalLink[] }) {
  const t = useExtracted()
  const site = useSiteIdentity()
  const platformLinks = [
    { href: '/docs/api-reference' as Route, label: t('APIs') },
    { href: '/leaderboard' as Route, label: t('Leaderboard') },
    { href: '/activity' as Route, label: t('Activity') },
  ]

  return (
    <div className="grid gap-10 self-start sm:grid-cols-2 lg:col-span-3 lg:gap-6">
      <section>
        <h2 className="mb-5 text-sm font-medium text-muted-foreground">{t('Support & Social')}</h2>
        <div className="space-y-4">
          {links.map((link) => (
            <a
              key={`${link.label}-${link.href}`}
              href={link.href}
              {...getExternalLinkProps(link.href)}
              className="block w-fit text-sm font-medium text-foreground transition-colors hover:text-primary"
            >
              {link.label}
            </a>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-5 text-sm font-medium text-muted-foreground">{site.name}</h2>
        <div className="space-y-4">
          {platformLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block w-fit text-sm font-medium text-foreground transition-colors hover:text-primary"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

function FooterBottom({ socialLinks }: { socialLinks: FooterExternalLink[] }) {
  const t = useExtracted()
  const site = useSiteIdentity()
  const year = useSyncExternalStore(subscribeToCurrentYear, getCurrentYearSnapshot, getServerYearSnapshot)

  return (
    <div className="mt-14">
      <div className="grid items-center gap-8 border-t border-border/70 pt-8 lg:grid-cols-[1fr_auto_1fr]">
        <div className="flex items-center justify-between gap-4 lg:contents">
          <div className="flex flex-wrap items-center gap-4 lg:col-start-1 lg:row-start-1">
            {socialLinks.map((link) => (
              <a
                key={`${link.icon}-${link.href}`}
                href={link.href}
                aria-label={link.label}
                {...getExternalLinkProps(link.href)}
                className="text-foreground transition-colors hover:text-primary"
              >
                <SocialIcon social={link.icon} className="size-[18px]" />
              </a>
            ))}
          </div>

          <div className="lg:col-start-3 lg:row-start-1 lg:justify-self-end">
            <FooterLocaleSwitcher />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-muted-foreground lg:col-start-2 lg:row-start-1">
          <span className="font-medium text-foreground">
            {site.name} © <span suppressHydrationWarning>{year}</span>
          </span>
          <span aria-hidden="true">·</span>
          <Link href="/tos" className="transition-colors hover:text-foreground">
            {t('Terms of Use')}
          </Link>
          <span aria-hidden="true">·</span>
          <Link href="/docs" className="transition-colors hover:text-foreground">
            {t('Docs')}
          </Link>
        </div>
      </div>

      <p className="mx-auto mt-8 max-w-6xl text-center text-xs/5 text-muted-foreground">
        {t.rich(
          'Prediction markets involve risk and may not be available in every jurisdiction. Review the <terms>Terms of Use</terms> before trading.',
          {
            terms: (chunks) => (
              <Link href="/tos" className="underline underline-offset-2 transition-colors hover:text-foreground">
                {chunks}
              </Link>
            ),
          },
        )}
      </p>
    </div>
  )
}

export default function PlatformFooter({
  categorySlug = null,
  categoryTag = null,
  categoryPopularEvents = [],
}: PlatformFooterProps) {
  const t = useExtracted()
  const locale = useLocale()
  const site = useSiteIdentity()
  const { tags } = usePlatformNavigationData()

  const mainCategories = useMemo(() => tags.filter((tag) => tag.slug !== 'trending' && tag.slug !== 'new'), [tags])
  const activeCategory = categorySlug
    ? (mainCategories.find((category) => category.slug === categorySlug) ?? null)
    : null
  const activeCategorySlug = activeCategory?.slug ?? null
  const selectedCategoryTag = categoryTag ?? activeCategorySlug
  const shouldShowCategoryFooter = activeCategory !== null && categoryPopularEvents.length > 0
  const [categoryNewEventsState, setCategoryNewEventsState] = useState<{
    categorySlug: string | null
    events: Event[]
  }>({ categorySlug: null, events: [] })
  const categoryNewEvents =
    categoryNewEventsState.categorySlug === activeCategorySlug ? categoryNewEventsState.events : []

  useEffect(
    function loadCategoryNewEvents() {
      if (!shouldShowCategoryFooter || !activeCategorySlug || !selectedCategoryTag) {
        return
      }

      const categorySlug = activeCategorySlug
      const tag = selectedCategoryTag
      const abortController = new AbortController()

      async function fetchCategoryNewEvents() {
        try {
          const result = await fetchHomeEventsPageApi({
            tag,
            mainTag: categorySlug,
            locale,
            status: 'active',
            sort: 'created_at',
            currentTimestamp: Date.now(),
            signal: abortController.signal,
          })

          if (!abortController.signal.aborted) {
            setCategoryNewEventsState({ categorySlug, events: result.events })
          }
        } catch (error) {
          if (!abortController.signal.aborted) {
            console.error('Failed to load new category events for the footer', error)
          }
        }
      }

      void fetchCategoryNewEvents()

      return function abortCategoryNewEventsFetch() {
        abortController.abort()
      }
    },
    [activeCategorySlug, locale, selectedCategoryTag, shouldShowCategoryFooter],
  )

  const supportLinks = useMemo(
    () =>
      [
        site.twitterLink ? { href: site.twitterLink, icon: 'x' as const, label: 'X (Twitter)' } : null,
        site.instagramLink ? { href: site.instagramLink, icon: 'instagram' as const, label: 'Instagram' } : null,
        site.discordLink ? { href: site.discordLink, icon: 'discord' as const, label: 'Discord' } : null,
        site.tiktokLink ? { href: site.tiktokLink, icon: 'tiktok' as const, label: 'TikTok' } : null,
        site.facebookLink ? { href: site.facebookLink, icon: 'facebook' as const, label: 'Facebook' } : null,
        site.linkedinLink ? { href: site.linkedinLink, icon: 'linkedin' as const, label: 'LinkedIn' } : null,
        site.youtubeLink ? { href: site.youtubeLink, icon: 'youtube' as const, label: 'YouTube' } : null,
        site.supportUrl ? { href: site.supportUrl, icon: 'email' as const, label: t('Contact us') } : null,
      ].filter((link): link is FooterExternalLink => link !== null),
    [site, t],
  )

  const uniqueSocialLinks = useMemo(() => {
    const seen = new Set<string>()
    return supportLinks.filter((link) => {
      if (seen.has(link.href)) {
        return false
      }
      seen.add(link.href)
      return true
    })
  }, [supportLinks])

  return (
    <footer className="mt-[140px] pb-[60px]">
      <div className="mb-12">
        <Link
          href="/"
          className="inline-flex items-center gap-3 text-3xl font-semibold text-foreground transition-opacity hover:opacity-80"
        >
          <SiteLogoIcon
            logoSvg={site.logoSvg}
            logoImageUrl={site.logoImageUrl}
            alt={`${site.name} logo`}
            className="size-8 text-current [&_svg]:size-8 [&_svg_*]:fill-current [&_svg_*]:stroke-current"
            imageClassName="size-8 object-contain"
            size={32}
          />
          <span>{site.name}</span>
        </Link>
        <p className="mt-3 max-w-xl text-base font-medium text-foreground/90">{site.description}</p>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-12 sm:grid-cols-1 sm:gap-12 lg:grid-cols-12">
        {shouldShowCategoryFooter ? (
          <CategoryMarketsFooter
            category={activeCategory}
            popularEvents={categoryPopularEvents}
            newEvents={categoryNewEvents}
          />
        ) : (
          <DefaultMarketsFooter categories={mainCategories} />
        )}

        <FooterNavigation links={supportLinks} />
      </div>

      <FooterBottom socialLinks={uniqueSocialLinks} />
    </footer>
  )
}

function PathnamePlatformLayoutFooter({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { tags } = usePlatformNavigationData()
  const dynamicHomeCategorySlugSet = useMemo(() => buildDynamicHomeCategorySlugSet(tags), [tags])
  const pathState = useMemo(
    () => parsePlatformPathname(pathname, dynamicHomeCategorySlugSet),
    [dynamicHomeCategorySlugSet, pathname],
  )

  if (pathState.isHomeLikePage && !pathState.isSportsPathPage) {
    return null
  }

  return children
}

export function PlatformLayoutFooter() {
  const footer = (
    <div className="container">
      <PlatformFooter />
    </div>
  )

  return (
    <Suspense fallback={footer}>
      <PathnamePlatformLayoutFooter>{footer}</PathnamePlatformLayoutFooter>
    </Suspense>
  )
}
