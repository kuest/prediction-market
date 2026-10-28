import type { Metadata } from 'next'

import { getExtracted } from 'next-intl/server'
import { Suspense } from 'react'

import type { SupportedLocale } from '@/i18n/locales'

import LeaderboardClient from '@/app/[locale]/(platform)/leaderboard/_components/LeaderboardClient'
import LeaderboardPageSkeleton from '@/app/[locale]/(platform)/leaderboard/_components/LeaderboardPageSkeleton'
import {
  buildLeaderboardPath,
  parseLeaderboardFilters,
} from '@/app/[locale]/(platform)/leaderboard/_utils/leaderboardFilters'
import { DEFAULT_LOCALE } from '@/i18n/locales'
import { getRootLocale } from '@/i18n/root-locale'
import { resolveCommitSha } from '@/lib/git'
import { deferPublicShellPrerenderIfNeeded } from '@/lib/public-shell-rendering'
import resolveSiteUrl from '@/lib/site-url'
import { loadRuntimeThemeState } from '@/lib/theme-settings'

function buildLocalizedPagePath(path: string, locale: SupportedLocale) {
  if (locale === DEFAULT_LOCALE) {
    return path
  }

  return `/${locale}${path}`
}

function buildLeaderboardOgImageUrl({
  locale,
  category,
  period,
  order,
  version,
}: {
  locale: SupportedLocale
  category: string
  period: string
  order: string
  version?: string | null
}) {
  const params = new URLSearchParams({
    locale,
    category,
    period,
    order,
  })
  const normalizedVersion = version?.trim()
  if (normalizedVersion) {
    params.set('v', normalizedVersion)
  }

  const siteUrl = resolveSiteUrl(process.env)
  return new URL(`/api/og/leaderboard?${params.toString()}`, siteUrl).toString()
}

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/leaderboard/[[...filters]]'>): Promise<Metadata> {
  await deferPublicShellPrerenderIfNeeded()

  const { filters } = await params
  const locale = await getRootLocale()
  const t = await getExtracted()

  const runtimeTheme = await loadRuntimeThemeState()
  const siteName = runtimeTheme.site.name
  const parsedFilters = parseLeaderboardFilters(filters)
  const hasRequestedFilters = Array.isArray(filters) && filters.length > 0
  const pagePath = hasRequestedFilters ? buildLeaderboardPath(parsedFilters) : '/leaderboard'
  const pageUrl = new URL(buildLocalizedPagePath(pagePath, locale), resolveSiteUrl(process.env)).toString()
  const imageUrl = buildLeaderboardOgImageUrl({
    locale,
    category: parsedFilters.category,
    period: parsedFilters.period,
    order: parsedFilters.order,
    version: resolveCommitSha(),
  })
  const title = t('Leaderboard')
  const description = t('See top traders and biggest wins on {siteName}', { siteName })
  const socialImage = {
    url: imageUrl,
    width: 1200,
    height: 630,
    alt: `${title} | ${siteName}`,
    type: 'image/png',
  } as const

  return {
    title,
    description,
    openGraph: {
      type: 'website',
      url: pageUrl,
      title,
      description,
      siteName,
      images: [socialImage],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [socialImage],
    },
  }
}

export default function LeaderboardPage({ params }: PageProps<'/[locale]/leaderboard/[[...filters]]'>) {
  return (
    <main className="container w-full py-6 md:py-8">
      <Suspense fallback={<LeaderboardPageSkeleton />}>
        <LeaderboardPageWithParams params={params} />
      </Suspense>
    </main>
  )
}

async function LeaderboardPageWithParams({
  params,
}: {
  params: PageProps<'/[locale]/leaderboard/[[...filters]]'>['params']
}) {
  const { filters } = await params

  return <LeaderboardPageContent filters={filters} />
}

async function LeaderboardPageContent({ filters }: { filters?: string[] }) {
  'use cache'

  const initialFilters = parseLeaderboardFilters(filters)

  return <LeaderboardClient initialFilters={initialFilters} />
}
