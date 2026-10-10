import type { Metadata } from 'next'

import { cacheLife, cacheTag } from 'next/cache'
import { notFound } from 'next/navigation'

import {
  buildDynamicHomeCategoryMetadata,
  DynamicHomeCategoryPageContent,
  generateDynamicHomeCategoryStaticParams,
} from '@/app/[locale]/(platform)/_lib/dynamic-home-category-page'
import {
  buildPublicProfileMetadata,
  PublicProfilePageContent,
} from '@/app/[locale]/(platform)/_lib/public-profile-page'
import { getRootLocale } from '@/i18n/root-locale'
import { cacheTags } from '@/lib/cache-tags'
import { hasDatabaseEnv } from '@/lib/db/env'
import { isPlatformReservedRootSlug, normalizePublicProfileSlug } from '@/lib/platform-routing'
import { PUBLIC_LISTING_PAGE_CACHE_LIFE } from '@/lib/public-listing-cache'
import { deferPublicShellPrerenderIfNeeded, shouldPrerenderPublicShell } from '@/lib/public-shell-rendering'
import { shouldBypassPublicShellPlaceholder, STATIC_PARAMS_PLACEHOLDER } from '@/lib/static-params'

export const instant = false

export const generateStaticParams = generateDynamicHomeCategoryStaticParams

async function generatePlatformSlugMetadata({ slug }: { slug: string }): Promise<Metadata> {
  if (slug === STATIC_PARAMS_PLACEHOLDER) {
    if (shouldBypassPublicShellPlaceholder(slug)) {
      return {}
    }
    notFound()
  }

  const locale = await getRootLocale()
  const profileSlug = normalizePublicProfileSlug(slug)
  if (profileSlug.type !== 'invalid') {
    return await buildPublicProfileMetadata({
      slug,
      locale,
    })
  }

  if (isPlatformReservedRootSlug(slug)) {
    notFound()
  }

  return buildDynamicHomeCategoryMetadata(slug)
}

async function renderPlatformSlugPage({
  deferHomeRuntimePrerender = true,
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

  const profileSlug = normalizePublicProfileSlug(slug)
  if (profileSlug.type !== 'invalid') {
    return (
      <main className="container py-8">
        <div className="mx-auto grid max-w-6xl gap-12">
          <PublicProfilePageContent slug={slug} />
        </div>
      </main>
    )
  }

  if (isPlatformReservedRootSlug(slug)) {
    notFound()
  }

  return <DynamicHomeCategoryPageContent deferHomeRuntimePrerender={deferHomeRuntimePrerender} slug={slug} />
}

async function renderCachedPlatformCategoryPage({ slug }: { slug: string }) {
  'use cache'
  cacheLife(PUBLIC_LISTING_PAGE_CACHE_LIFE)

  const locale = await getRootLocale()
  cacheTag(cacheTags.eventsList, cacheTags.mainTags(locale), cacheTags.settings)

  return renderPlatformSlugPage({
    deferHomeRuntimePrerender: false,
    slug,
  })
}

async function renderRuntimePlatformCategoryPage({ slug }: { slug: string }) {
  await deferPublicShellPrerenderIfNeeded()

  if (!hasDatabaseEnv()) {
    return renderPlatformSlugPage({
      deferHomeRuntimePrerender: false,
      slug,
    })
  }

  return renderCachedPlatformCategoryPage({ slug })
}

export async function generateMetadata({ params }: PageProps<'/[locale]/[slug]'>): Promise<Metadata> {
  const { slug } = await params
  return await generatePlatformSlugMetadata({
    slug,
  })
}

export default async function PlatformSlugPage({ params }: PageProps<'/[locale]/[slug]'>) {
  const { slug } = await params
  const profileSlug = normalizePublicProfileSlug(slug)

  if (profileSlug.type !== 'invalid') {
    return await renderPlatformSlugPage({ slug })
  }

  const renderPage = shouldPrerenderPublicShell() ? renderCachedPlatformCategoryPage : renderRuntimePlatformCategoryPage

  return await renderPage({ slug })
}
