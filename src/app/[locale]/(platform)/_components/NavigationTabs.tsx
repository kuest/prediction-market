'use client'

import type { Route } from 'next'

import { useEffect, useMemo, useRef } from 'react'

import NavigationMoreMenu from '@/app/[locale]/(platform)/_components/NavigationMoreMenu'
import NavigationTab from '@/app/[locale]/(platform)/_components/NavigationTab'
import { useFilters } from '@/app/[locale]/(platform)/_providers/FilterProvider'
import { usePlatformNavigationData } from '@/app/[locale]/(platform)/_providers/PlatformNavigationProvider'
import { useHasHydrated } from '@/hooks/useHasHydrated'
import {
  resolveHorizontalScrollMaskClass,
  useHorizontalScrollShadows,
  useScrollActiveItemIntoView,
} from '@/hooks/useHorizontalScrollState'
import { usePathname } from '@/i18n/navigation'
import { resolvePlatformNavigationSelection } from '@/lib/platform-navigation'
import { buildDynamicHomeCategorySlugSet, isPlatformReservedRootSlug } from '@/lib/platform-routing'
import { cn } from '@/lib/utils'

function getMainTagHref(slug: string, dynamicHomeCategorySlugSet: ReadonlySet<string>): Route {
  if (slug === 'trending') {
    return '/' as Route
  }

  if (slug === 'sports') {
    return '/sports/live' as Route
  }

  if (slug === 'esports') {
    return '/esports/live' as Route
  }

  if (slug === 'new' || isPlatformReservedRootSlug(slug) || dynamicHomeCategorySlugSet.has(slug)) {
    return `/${slug}` as Route
  }

  return '/' as Route
}

type NavigationTag = ReturnType<typeof usePlatformNavigationData>['tags'][number]

function useNavigationTabsRefs(tagCount: number) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const tabItemRef = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(
    function syncTabItemRefLengthToTags() {
      tabItemRef.current = Array.from({ length: tagCount }).map((_, index) => tabItemRef.current[index] ?? null)
    },
    [tagCount],
  )

  return { containerRef, tabItemRef }
}

function useNavigationSelection(tags: ReadonlyArray<NavigationTag>, pathname: string | null) {
  const { filters } = useFilters()
  const { childParentMap } = usePlatformNavigationData()
  const dynamicHomeCategorySlugSet = useMemo(() => buildDynamicHomeCategorySlugSet([...tags]), [tags])

  const navigationSelection = useMemo(
    () =>
      resolvePlatformNavigationSelection({
        dynamicHomeCategorySlugSet,
        pathname: pathname ?? '/',
        filters: {
          tag: filters.tag,
          mainTag: filters.mainTag,
          bookmarked: filters.bookmarked,
        },
        childParentMap,
      }),
    [childParentMap, dynamicHomeCategorySlugSet, filters.bookmarked, filters.mainTag, filters.tag, pathname],
  )

  const activeIndex = useMemo(
    () => tags.findIndex((tag) => tag.slug === navigationSelection.activeMainTagSlug),
    [navigationSelection.activeMainTagSlug, tags],
  )

  return { navigationSelection, activeIndex, dynamicHomeCategorySlugSet }
}

function NavigationTabsContent({ pathname }: { pathname: string | null }) {
  const { tags } = usePlatformNavigationData()
  const { containerRef, tabItemRef } = useNavigationTabsRefs(tags.length)
  const { showLeftShadow, showRightShadow } = useHorizontalScrollShadows({ containerRef })
  const { navigationSelection, activeIndex, dynamicHomeCategorySlugSet } = useNavigationSelection(tags, pathname)
  useScrollActiveItemIntoView({ activeIndex: pathname === null ? -1 : activeIndex, containerRef, itemRef: tabItemRef })

  return (
    <nav className="relative z-20 bg-background lg:sticky lg:top-17">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border" />
      <div className="container mx-auto flex w-full min-w-0">
        <div
          id="navigation-main-tags"
          ref={containerRef}
          className={cn(
            `flex h-12 w-full min-w-0 snap-x snap-mandatory scroll-px-3 items-center overflow-x-auto text-sm font-medium`,
            resolveHorizontalScrollMaskClass({ showLeftShadow, showRightShadow }),
          )}
        >
          {tags.map((tag, index) => (
            <div key={tag.slug} className="flex snap-start items-center">
              <NavigationTab
                tag={tag}
                href={getMainTagHref(tag.slug, dynamicHomeCategorySlugSet)}
                isActive={pathname !== null && navigationSelection.activeMainTagSlug === tag.slug}
                tabPaddingClass={index === 0 ? 'px-2.5 pl-0' : 'px-3'}
                containerRef={(element) => {
                  tabItemRef.current[index] = element
                }}
              />

              {index === 1 && <div className="mx-3 h-5 w-px shrink-0 bg-border" />}
            </div>
          ))}

          <div className="flex snap-start items-center">
            <NavigationMoreMenu />
          </div>
        </div>
      </div>
    </nav>
  )
}

function PathnameNavigationTabs() {
  const pathname = usePathname()
  return <NavigationTabsContent pathname={pathname} />
}

export default function NavigationTabs() {
  const hasHydrated = useHasHydrated()
  // Unknown route params cannot provide a pathname in the public static shell.
  return hasHydrated ? <PathnameNavigationTabs /> : <NavigationTabsContent pathname={null} />
}
