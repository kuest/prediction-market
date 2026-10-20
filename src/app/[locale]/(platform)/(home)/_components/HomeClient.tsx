'use client'

import type { Route } from 'next'

import { useQueryClient } from '@tanstack/react-query'
import { useExtracted, useLocale } from 'next-intl'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { FilterState } from '@/app/[locale]/(platform)/_providers/FilterProvider'
import type { EventFaqItem } from '@/lib/event-faq'
import type { Event, HomeFeaturedEventCard, HomeFeaturedHotTopic, HomeFeaturedSideCardSettings } from '@/types'

import EventsGrid from '@/app/[locale]/(platform)/(home)/_components/EventsGrid'
import FilterToolbar from '@/app/[locale]/(platform)/(home)/_components/FilterToolbar'
import HomeFeaturedEventsCarousel from '@/app/[locale]/(platform)/(home)/_components/HomeFeaturedEventsCarousel'
import HomeSecondaryNavigation from '@/app/[locale]/(platform)/(home)/_components/HomeSecondaryNavigation'
import PlatformFooter from '@/app/[locale]/(platform)/(home)/_components/PlatformFooter'
import { DEFAULT_FILTERS, useFilters } from '@/app/[locale]/(platform)/_providers/FilterProvider'
import { usePlatformNavigationData } from '@/app/[locale]/(platform)/_providers/PlatformNavigationProvider'
import EventFaq from '@/app/[locale]/(platform)/event/[slug]/_components/EventFaq'
import { usePathname, useRouter } from '@/i18n/navigation'
import { resolveCategorySidebarPageTitle } from '@/lib/category-sidebar-config'
import {
  fetchHomeEventsQueryPage,
  getHomeEventsNextPageParam,
  getHomeEventsQueryKey,
  HOME_FEED_REFRESH_INTERVAL_MS,
} from '@/lib/home-events-query'
import { getDefaultHomeRouteSortBy } from '@/lib/home-route-sort'
import { parsePlatformPathname, resolvePlatformNavigationSelection } from '@/lib/platform-navigation'
import { buildDynamicHomeCategorySlugSet } from '@/lib/platform-routing'
import { useUser } from '@/stores/useUser'

const CategorySidebar = dynamic(() => import('@/app/[locale]/(platform)/(home)/_components/CategorySidebar'))

interface HomeClientProps {
  categoryFaqItems: EventFaqItem[]
  initialEvents: Event[]
  initialHasMore: boolean
  initialFeaturedEvents: HomeFeaturedEventCard[]
  initialFeaturedHotTopics: HomeFeaturedHotTopic[]
  initialFeaturedSideCard: HomeFeaturedSideCardSettings
  initialCurrentTimestamp: number | null
  initialTag?: string
  initialMainTag?: string
}

function createHomeRouteFilters(targetTag: string, targetMainTag: string): FilterState {
  return {
    ...DEFAULT_FILTERS,
    tag: targetTag,
    mainTag: targetMainTag,
    sortBy: getDefaultHomeRouteSortBy(targetTag),
  }
}

function useHomeClientState({ initialTag, initialMainTag }: Pick<HomeClientProps, 'initialTag' | 'initialMainTag'>) {
  const pathname = usePathname()
  const { tags, childParentMap } = usePlatformNavigationData()
  const dynamicHomeCategorySlugSet = useMemo(() => buildDynamicHomeCategorySlugSet(tags), [tags])
  const serverTargetTag = initialTag ?? 'trending'
  const serverTargetMainTag = initialMainTag ?? serverTargetTag
  const pathState = useMemo(
    () => parsePlatformPathname(pathname, dynamicHomeCategorySlugSet),
    [dynamicHomeCategorySlugSet, pathname],
  )
  const pathTargetTag = useMemo(() => {
    if (pathState.isHomePage) {
      return 'trending'
    }

    if (pathState.isMainTagPathPage && !pathState.isSportsPathPage) {
      return pathState.selectedSubtagPathSlug ?? pathState.selectedMainTagPathSlug ?? serverTargetTag
    }

    return serverTargetTag
  }, [
    pathState.isHomePage,
    pathState.isMainTagPathPage,
    pathState.isSportsPathPage,
    pathState.selectedMainTagPathSlug,
    pathState.selectedSubtagPathSlug,
    serverTargetTag,
  ])
  const pathTargetMainTag = useMemo(() => {
    if (pathState.isHomePage) {
      return 'trending'
    }

    if (pathState.isMainTagPathPage && !pathState.isSportsPathPage) {
      return pathState.selectedMainTagPathSlug ?? pathTargetTag
    }

    return serverTargetMainTag
  }, [
    pathState.isHomePage,
    pathState.isMainTagPathPage,
    pathState.isSportsPathPage,
    pathState.selectedMainTagPathSlug,
    pathTargetTag,
    serverTargetMainTag,
  ])
  const targetTag = pathState.isHomeLikePage && !pathState.isSportsPathPage ? pathTargetTag : serverTargetTag
  const targetMainTag =
    pathState.isHomeLikePage && !pathState.isSportsPathPage ? pathTargetMainTag : serverTargetMainTag
  const targetFilterKey = `${targetMainTag}:${targetTag}`

  return {
    pathname,
    tags,
    childParentMap,
    dynamicHomeCategorySlugSet,
    serverTargetTag,
    serverTargetMainTag,
    pathState,
    targetTag,
    targetMainTag,
    targetFilterKey,
  }
}

export default function HomeClient({
  categoryFaqItems,
  initialEvents,
  initialHasMore,
  initialFeaturedEvents,
  initialFeaturedHotTopics,
  initialFeaturedSideCard,
  initialCurrentTimestamp,
  initialTag,
  initialMainTag,
}: HomeClientProps) {
  const {
    pathname,
    tags,
    childParentMap,
    dynamicHomeCategorySlugSet,
    serverTargetTag,
    serverTargetMainTag,
    pathState,
    targetTag,
    targetMainTag,
    targetFilterKey,
  } = useHomeClientState({
    initialTag,
    initialMainTag,
  })

  return (
    <HomeClientContent
      key={targetFilterKey}
      childParentMap={childParentMap}
      categoryFaqItems={categoryFaqItems}
      dynamicHomeCategorySlugSet={dynamicHomeCategorySlugSet}
      initialCurrentTimestamp={initialCurrentTimestamp}
      initialEvents={initialEvents}
      initialHasMore={initialHasMore}
      initialFeaturedEvents={initialFeaturedEvents}
      initialFeaturedHotTopics={initialFeaturedHotTopics}
      initialFeaturedSideCard={initialFeaturedSideCard}
      pathname={pathname}
      pathState={pathState}
      serverTargetMainTag={serverTargetMainTag}
      serverTargetTag={serverTargetTag}
      tags={tags}
      targetMainTag={targetMainTag}
      targetTag={targetTag}
    />
  )
}

interface HomeClientContentProps {
  categoryFaqItems: EventFaqItem[]
  childParentMap: ReturnType<typeof usePlatformNavigationData>['childParentMap']
  dynamicHomeCategorySlugSet: Set<string>
  initialCurrentTimestamp: number | null
  initialEvents: Event[]
  initialHasMore: boolean
  initialFeaturedEvents: HomeFeaturedEventCard[]
  initialFeaturedHotTopics: HomeFeaturedHotTopic[]
  initialFeaturedSideCard: HomeFeaturedSideCardSettings
  pathname: ReturnType<typeof usePathname>
  pathState: ReturnType<typeof parsePlatformPathname>
  serverTargetMainTag: string
  serverTargetTag: string
  tags: ReturnType<typeof usePlatformNavigationData>['tags']
  targetMainTag: string
  targetTag: string
}

type HomeClientContentStateInput = Pick<
  HomeClientContentProps,
  | 'childParentMap'
  | 'dynamicHomeCategorySlugSet'
  | 'pathname'
  | 'serverTargetMainTag'
  | 'serverTargetTag'
  | 'tags'
  | 'targetMainTag'
  | 'targetTag'
>

function useHomeClientContentState({
  childParentMap,
  dynamicHomeCategorySlugSet,
  pathname,
  serverTargetMainTag,
  serverTargetTag,
  tags,
  targetMainTag,
  targetTag,
}: HomeClientContentStateInput) {
  const router = useRouter()
  const locale = useLocale()
  const queryClient = useQueryClient()
  const user = useUser()
  const { updateFilters } = useFilters()
  const [homeFilters, setHomeFilters] = useState<FilterState>(() => createHomeRouteFilters(targetTag, targetMainTag))
  const canUseServerInitialEvents = useMemo(
    () => serverTargetTag === targetTag && serverTargetMainTag === targetMainTag,
    [serverTargetMainTag, serverTargetTag, targetMainTag, targetTag],
  )

  useEffect(
    function syncHomeFiltersToGlobalFilterStore() {
      updateFilters({
        tag: homeFilters.tag,
        mainTag: homeFilters.mainTag,
        bookmarked: homeFilters.bookmarked,
      })
    },
    [homeFilters.bookmarked, homeFilters.mainTag, homeFilters.tag, updateFilters],
  )

  const handleFiltersChange = useCallback((updates: Partial<FilterState>) => {
    setHomeFilters((prev) => ({ ...prev, ...updates }))
  }, [])

  const handleClearFilters = useCallback(() => {
    setHomeFilters(createHomeRouteFilters(targetTag, targetMainTag))
  }, [targetMainTag, targetTag])

  const navigationSelection = useMemo(
    () =>
      resolvePlatformNavigationSelection({
        dynamicHomeCategorySlugSet,
        pathname,
        filters: {
          tag: homeFilters.tag,
          mainTag: homeFilters.mainTag,
          bookmarked: homeFilters.bookmarked,
        },
        childParentMap,
      }),
    [
      childParentMap,
      dynamicHomeCategorySlugSet,
      homeFilters.bookmarked,
      homeFilters.mainTag,
      homeFilters.tag,
      pathname,
    ],
  )

  const activeNavigationTag = useMemo(
    () => tags.find((tag) => tag.slug === navigationSelection.activeMainTagSlug) ?? null,
    [navigationSelection.activeMainTagSlug, tags],
  )

  const showCategoryPathTitle = useMemo(
    () =>
      activeNavigationTag !== null &&
      navigationSelection.pathState.isMainTagPathPage &&
      navigationSelection.pathState.selectedMainTagPathSlug === activeNavigationTag.slug &&
      dynamicHomeCategorySlugSet.has(activeNavigationTag.slug),
    [
      activeNavigationTag,
      dynamicHomeCategorySlugSet,
      navigationSelection.pathState.isMainTagPathPage,
      navigationSelection.pathState.selectedMainTagPathSlug,
    ],
  )

  const categorySidebar = useMemo(() => {
    if (!activeNavigationTag || !showCategoryPathTitle || !dynamicHomeCategorySlugSet.has(activeNavigationTag.slug)) {
      return null
    }

    return {
      slug: activeNavigationTag.slug,
      sidebarItems: activeNavigationTag.sidebarItems,
      title: activeNavigationTag.name,
      childs: activeNavigationTag.childs,
    }
  }, [activeNavigationTag, dynamicHomeCategorySlugSet, showCategoryPathTitle])

  const hasCategorySidebar = categorySidebar !== null
  const shouldUsePathSubcategoryNavigation =
    hasCategorySidebar && navigationSelection.pathState.selectedMainTagPathSlug === categorySidebar.slug

  const activeSecondaryTagSlug = useMemo(() => {
    if (!activeNavigationTag) {
      return 'trending'
    }

    const availableSlugs = new Set([activeNavigationTag.slug, ...activeNavigationTag.childs.map((child) => child.slug)])

    return availableSlugs.has(navigationSelection.activeTagSlug)
      ? navigationSelection.activeTagSlug
      : activeNavigationTag.slug
  }, [activeNavigationTag, navigationSelection.activeTagSlug])

  const activeSidebarSubcategorySlug =
    hasCategorySidebar && activeSecondaryTagSlug !== categorySidebar.slug ? activeSecondaryTagSlug : null
  const categoryPageTitle = categorySidebar
    ? resolveCategorySidebarPageTitle({
        activeSubcategorySlug: activeSidebarSubcategorySlug,
        categorySlug: categorySidebar.slug,
        categoryTitle: categorySidebar.title,
        childs: categorySidebar.childs,
      })
    : null

  const resolveSecondaryNavigationPath = useCallback(
    ({ slug: targetTag, href }: { href?: string; slug: string }) => {
      if (!activeNavigationTag) {
        return null
      }

      if (href) {
        return href
      }

      if (shouldUsePathSubcategoryNavigation) {
        return targetTag === activeNavigationTag.slug
          ? `/${activeNavigationTag.slug}`
          : `/${activeNavigationTag.slug}/${targetTag}`
      }

      return null
    },
    [activeNavigationTag, shouldUsePathSubcategoryNavigation],
  )

  const handleSecondaryNavigation = useCallback(
    ({ slug: targetTag, href }: { href?: string; slug: string }) => {
      const nextPath = resolveSecondaryNavigationPath({ slug: targetTag, href })
      if (nextPath) {
        router.push(nextPath as Route)
        return
      }

      if (activeNavigationTag) {
        handleFiltersChange({ tag: targetTag, mainTag: activeNavigationTag.slug })
      }
    },
    [activeNavigationTag, handleFiltersChange, resolveSecondaryNavigationPath, router],
  )

  const handlePrefetchSecondaryNavigation = useCallback(
    ({ slug: targetTag, href }: { href?: string; slug: string }) => {
      if (!activeNavigationTag) {
        return
      }

      const nextPath = resolveSecondaryNavigationPath({ slug: targetTag, href })
      if (nextPath) {
        router.prefetch(nextPath as Route)
      }

      if (href) {
        return
      }

      const targetFilters = shouldUsePathSubcategoryNavigation
        ? createHomeRouteFilters(targetTag, activeNavigationTag.slug)
        : { ...homeFilters, tag: targetTag, mainTag: activeNavigationTag.slug }
      const homeFeedClockState = targetFilters.status === 'active' ? 'clock-ready' : 'clock-static'
      const queryKey = getHomeEventsQueryKey({
        filters: targetFilters,
        locale,
        queryUserScope: user?.id ?? 'guest',
        homeFeedClockState,
      })

      void queryClient
        .prefetchInfiniteQuery({
          queryKey,
          queryFn: ({ pageParam }) =>
            fetchHomeEventsQueryPage({
              pageParam,
              currentTimestamp: targetFilters.status === 'active' ? Date.now() : null,
              filters: targetFilters,
              locale,
            }),
          getNextPageParam: getHomeEventsNextPageParam,
          initialPageParam: 0,
          staleTime: HOME_FEED_REFRESH_INTERVAL_MS,
        })
        .catch(() => undefined)
    },
    [
      activeNavigationTag,
      homeFilters,
      locale,
      queryClient,
      resolveSecondaryNavigationPath,
      router,
      shouldUsePathSubcategoryNavigation,
      user?.id,
    ],
  )

  const secondaryNavigation = activeNavigationTag ? (
    <HomeSecondaryNavigation
      tag={activeNavigationTag}
      activeSubtagSlug={activeSecondaryTagSlug}
      heading={categoryPageTitle ?? undefined}
      showCategoryTitle={showCategoryPathTitle}
      hideOnDesktop={hasCategorySidebar}
      onPrefetchTag={handlePrefetchSecondaryNavigation}
      onSelectTag={handleSecondaryNavigation}
    />
  ) : null

  return {
    homeFilters,
    canUseServerInitialEvents,
    handleFiltersChange,
    handleClearFilters,
    hasCategorySidebar,
    categorySidebar,
    categoryPageTitle,
    activeSidebarSubcategorySlug,
    secondaryNavigation,
  }
}

function HomeClientContent({
  categoryFaqItems,
  childParentMap,
  dynamicHomeCategorySlugSet,
  initialCurrentTimestamp,
  initialEvents,
  initialHasMore,
  initialFeaturedEvents,
  initialFeaturedHotTopics,
  initialFeaturedSideCard,
  pathname,
  pathState,
  serverTargetMainTag,
  serverTargetTag,
  tags,
  targetMainTag,
  targetTag,
}: HomeClientContentProps) {
  const t = useExtracted()
  const {
    homeFilters,
    canUseServerInitialEvents,
    handleFiltersChange,
    handleClearFilters,
    hasCategorySidebar,
    categorySidebar,
    categoryPageTitle,
    activeSidebarSubcategorySlug,
    secondaryNavigation,
  } = useHomeClientContentState({
    childParentMap,
    dynamicHomeCategorySlugSet,
    pathname,
    serverTargetMainTag,
    serverTargetTag,
    tags,
    targetMainTag,
    targetTag,
  })
  const hasFeaturedEvents = pathState.isHomePage && initialFeaturedEvents.length > 0

  return (
    <>
      <div className="flex min-w-0 gap-6 lg:items-start lg:gap-10">
        {categorySidebar && (
          <CategorySidebar
            categorySlug={categorySidebar.slug}
            categoryTitle={categorySidebar.title}
            activeSubcategorySlug={activeSidebarSubcategorySlug}
            sidebarItems={categorySidebar.sidebarItems}
            subcategories={categorySidebar.childs}
          />
        )}

        <div className="min-w-0 flex-1 space-y-4 lg:space-y-5">
          {hasFeaturedEvents && (
            <HomeFeaturedEventsCarousel
              currentTimestamp={initialCurrentTimestamp}
              hotTopics={initialFeaturedHotTopics}
              items={initialFeaturedEvents}
              sideCard={initialFeaturedSideCard}
            />
          )}

          {hasFeaturedEvents ? (
            <div className="grid gap-3">
              <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <h1 className="hidden shrink-0 text-2xl font-semibold tracking-tight md:block">{t('All markets')}</h1>

                <div className="min-w-0">
                  <FilterToolbar
                    collapsibleSearch
                    filters={homeFilters}
                    onFiltersChange={handleFiltersChange}
                    showFilterCheckboxes={pathState.isHomePage}
                  />
                </div>
              </div>

              {secondaryNavigation}
            </div>
          ) : (
            <FilterToolbar
              filters={homeFilters}
              onFiltersChange={handleFiltersChange}
              hideDesktopSecondaryNavigation={hasCategorySidebar}
              desktopTitle={categoryPageTitle ?? categorySidebar?.title}
              secondaryNavigation={secondaryNavigation}
              showFilterCheckboxes={pathState.isHomePage}
            />
          )}

          <EventsGrid
            filters={homeFilters}
            initialEvents={canUseServerInitialEvents ? initialEvents : []}
            initialHasMore={canUseServerInitialEvents && initialHasMore}
            initialCurrentTimestamp={initialCurrentTimestamp}
            onClearFilters={handleClearFilters}
            routeMainTag={targetMainTag}
            routeTag={targetTag}
            maxColumns={hasCategorySidebar ? 3 : undefined}
          />
        </div>
      </div>

      <EventFaq items={categoryFaqItems} />

      <PlatformFooter
        categoryPopularEvents={initialEvents}
        categoryTag={pathState.isMainTagPathPage ? targetTag : null}
        categorySlug={pathState.isMainTagPathPage ? targetMainTag : null}
      />
    </>
  )
}
