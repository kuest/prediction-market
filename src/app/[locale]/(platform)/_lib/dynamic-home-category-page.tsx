import type { Metadata } from 'next'

import { notFound } from 'next/navigation'

import HomeInitialContent from '@/app/[locale]/(platform)/(home)/_components/HomeInitialContent'
import {
  buildLocalizedPagePath,
  buildPredictionResultsOgImageUrl,
} from '@/app/[locale]/(platform)/_lib/prediction-results-metadata'
import { resolveSupportedLocale } from '@/i18n/locales'
import { getRootLocale } from '@/i18n/root-locale'
import { resolveCommitSha } from '@/lib/git'
import { loadPlatformMainTags } from '@/lib/platform-main-tags'
import {
  findDynamicHomeCategoryBySlug,
  findDynamicHomeSubcategoryBySlug,
  getMainTagSeoTitle,
  isDynamicHomeCategorySlug,
} from '@/lib/platform-routing'
import { shouldPrerenderPublicShell } from '@/lib/public-shell-rendering'
import resolveSiteUrl from '@/lib/site-url'
import {
  getPublicShellStaticParams,
  shouldBypassPublicShellPlaceholder,
  STATIC_PARAMS_PLACEHOLDER,
} from '@/lib/static-params'

async function getMainTags() {
  const locale = await getRootLocale()
  const { data: mainTags } = await loadPlatformMainTags(locale)
  return mainTags ?? []
}

function getCategoryEventCount(category: Awaited<ReturnType<typeof getMainTags>>[number]) {
  const allItem = category.sidebarItems?.find((item) => item.type === 'link' && item.isAll)
  return allItem?.type === 'link' ? (allItem.count ?? 0) : 0
}

export async function generateDynamicHomeCategoryStaticParams({
  params,
}: {
  params?: Record<string, string | string[] | undefined>
} = {}) {
  if (!shouldPrerenderPublicShell()) {
    return getPublicShellStaticParams({ slug: STATIC_PARAMS_PLACEHOLDER })
  }

  const localeParam = params?.locale
  const locale = resolveSupportedLocale(typeof localeParam === 'string' ? localeParam : undefined)
  const { data: mainTags } = await loadPlatformMainTags(locale)
  const categoryParams = (mainTags ?? [])
    .filter((tag) => isDynamicHomeCategorySlug(tag.slug))
    .map(({ slug }) => ({ slug }))

  return categoryParams.length > 0 ? categoryParams : getPublicShellStaticParams({ slug: STATIC_PARAMS_PLACEHOLDER })
}

export async function generateDynamicHomeSubcategoryStaticParams() {
  return getPublicShellStaticParams({ slug: STATIC_PARAMS_PLACEHOLDER, subcategory: STATIC_PARAMS_PLACEHOLDER })
}

export async function buildDynamicHomeCategoryMetadata(slug: string): Promise<Metadata> {
  if (slug === STATIC_PARAMS_PLACEHOLDER) {
    if (shouldBypassPublicShellPlaceholder(slug)) {
      return {}
    }
    notFound()
  }

  const locale = await getRootLocale()
  const category = findDynamicHomeCategoryBySlug(await getMainTags(), slug)
  if (!category) {
    notFound()
  }

  const title = getMainTagSeoTitle(category.name)
  const siteUrl = resolveSiteUrl(process.env)
  const imageUrl = buildPredictionResultsOgImageUrl({
    locale,
    slug: category.slug,
    label: category.name,
    version: resolveCommitSha(),
  })
  const pageUrl = new URL(buildLocalizedPagePath(`/${category.slug}`, locale), siteUrl).toString()

  return {
    title,
    openGraph: {
      type: 'website',
      url: pageUrl,
      title,
      images: [imageUrl],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      images: [imageUrl],
    },
  }
}

export async function buildDynamicHomeSubcategoryMetadata(slug: string, subcategory: string): Promise<Metadata> {
  if (slug === STATIC_PARAMS_PLACEHOLDER || subcategory === STATIC_PARAMS_PLACEHOLDER) {
    if (shouldBypassPublicShellPlaceholder(slug, subcategory)) {
      return {}
    }
    notFound()
  }

  const locale = await getRootLocale()
  const resolvedSubcategory = findDynamicHomeSubcategoryBySlug(await getMainTags(), slug, subcategory)
  if (!resolvedSubcategory) {
    notFound()
  }

  const title = `${resolvedSubcategory.subcategory.name} ${getMainTagSeoTitle(resolvedSubcategory.category.name)}`
  const siteUrl = resolveSiteUrl(process.env)
  const imageUrl = buildPredictionResultsOgImageUrl({
    locale,
    slug: resolvedSubcategory.subcategory.slug,
    label: resolvedSubcategory.subcategory.name,
    version: resolveCommitSha(),
  })
  const pageUrl = new URL(
    buildLocalizedPagePath(`/${resolvedSubcategory.category.slug}/${resolvedSubcategory.subcategory.slug}`, locale),
    siteUrl,
  ).toString()

  return {
    title,
    openGraph: {
      type: 'website',
      url: pageUrl,
      title,
      images: [imageUrl],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      images: [imageUrl],
    },
  }
}

export async function DynamicHomeCategoryPageContent({
  deferHomeRuntimePrerender,
  slug,
}: {
  deferHomeRuntimePrerender?: boolean
  slug: string
}) {
  if (slug === STATIC_PARAMS_PLACEHOLDER) {
    if (shouldBypassPublicShellPlaceholder(slug)) {
      return null
    }
    notFound()
  }

  const category = findDynamicHomeCategoryBySlug(await getMainTags(), slug)
  if (!category) {
    notFound()
  }

  return (
    <HomeInitialContent
      initialTag={category.slug}
      categoryFaqContext={{
        categoryName: category.name,
        eventCount: getCategoryEventCount(category),
        marketCount: category.active_markets_count ?? 0,
        popularEventTitles: [],
        subcategoryNames: (category.childs ?? [])
          .filter((child) => (child.count ?? 0) > 0)
          .slice(0, 3)
          .map((child) => child.name),
      }}
      deferRuntimePrerender={deferHomeRuntimePrerender}
    />
  )
}

export async function DynamicHomeSubcategoryPageContent({
  deferHomeRuntimePrerender,
  slug,
  subcategory,
}: {
  deferHomeRuntimePrerender?: boolean
  slug: string
  subcategory: string
}) {
  if (slug === STATIC_PARAMS_PLACEHOLDER || subcategory === STATIC_PARAMS_PLACEHOLDER) {
    if (shouldBypassPublicShellPlaceholder(slug, subcategory)) {
      return null
    }
    notFound()
  }

  const resolvedSubcategory = findDynamicHomeSubcategoryBySlug(await getMainTags(), slug, subcategory)

  if (!resolvedSubcategory) {
    notFound()
  }

  return (
    <HomeInitialContent
      initialTag={resolvedSubcategory.subcategory.slug}
      initialMainTag={resolvedSubcategory.category.slug}
      deferRuntimePrerender={deferHomeRuntimePrerender}
    />
  )
}
