import type { Metadata } from 'next'

import { notFound } from 'next/navigation'

import {
  buildDynamicHomeSubcategoryMetadata,
  DynamicHomeSubcategoryPageContent,
  generateDynamicHomeSubcategoryStaticParams,
} from '@/app/[locale]/(platform)/_lib/dynamic-home-category-page'
import { hasDatabaseEnv } from '@/lib/db/env'
import { isPlatformReservedRootSlug, normalizePublicProfileSlug } from '@/lib/platform-routing'
import { deferPublicShellPrerenderIfNeeded, shouldPrerenderPublicShell } from '@/lib/public-shell-rendering'
import { shouldBypassPublicShellPlaceholder, STATIC_PARAMS_PLACEHOLDER } from '@/lib/static-params'

// Direct visits await URL data to deliver complete HTML without JavaScript.
// Intent-prefetched navigation is covered by the production instant() tests.
export const instant = false

export const generateStaticParams = generateDynamicHomeSubcategoryStaticParams

async function generatePlatformSubcategoryMetadata({
  slug,
  subcategory,
}: {
  slug: string
  subcategory: string
}): Promise<Metadata> {
  'use cache'

  if (slug === STATIC_PARAMS_PLACEHOLDER || subcategory === STATIC_PARAMS_PLACEHOLDER) {
    if (shouldBypassPublicShellPlaceholder(slug, subcategory)) {
      return {}
    }
    notFound()
  }

  if (normalizePublicProfileSlug(slug).type !== 'invalid' || isPlatformReservedRootSlug(slug)) {
    notFound()
  }

  return buildDynamicHomeSubcategoryMetadata(slug, subcategory)
}

async function renderPlatformSubcategoryPage({
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

  if (normalizePublicProfileSlug(slug).type !== 'invalid' || isPlatformReservedRootSlug(slug)) {
    notFound()
  }

  return (
    <DynamicHomeSubcategoryPageContent
      slug={slug}
      subcategory={subcategory}
      deferHomeRuntimePrerender={deferHomeRuntimePrerender}
    />
  )
}

async function renderCachedPlatformSubcategoryPage({ slug, subcategory }: { slug: string; subcategory: string }) {
  'use cache'

  return renderPlatformSubcategoryPage({
    deferHomeRuntimePrerender: false,
    slug,
    subcategory,
  })
}

async function renderRuntimePlatformSubcategoryPage({ slug, subcategory }: { slug: string; subcategory: string }) {
  await deferPublicShellPrerenderIfNeeded()

  if (!hasDatabaseEnv()) {
    return renderPlatformSubcategoryPage({
      deferHomeRuntimePrerender: false,
      slug,
      subcategory,
    })
  }

  return renderCachedPlatformSubcategoryPage({
    slug,
    subcategory,
  })
}

export async function generateMetadata({ params }: PageProps<'/[locale]/[slug]/[subcategory]'>): Promise<Metadata> {
  const { slug, subcategory } = await params
  return await generatePlatformSubcategoryMetadata({
    slug,
    subcategory,
  })
}

export default async function PlatformSubcategoryPage({ params }: PageProps<'/[locale]/[slug]/[subcategory]'>) {
  const { slug, subcategory } = await params
  const renderPage = shouldPrerenderPublicShell()
    ? renderCachedPlatformSubcategoryPage
    : renderRuntimePlatformSubcategoryPage

  return await renderPage({
    slug,
    subcategory,
  })
}
