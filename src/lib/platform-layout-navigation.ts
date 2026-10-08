import { getExtracted } from 'next-intl/server'

import type { SupportedLocale } from '@/i18n/locales'

import { getRootLocale } from '@/i18n/root-locale'
import { hasDatabaseEnv } from '@/lib/db/env'
import { loadPlatformMainTags } from '@/lib/platform-main-tags'
import { buildChildParentMap, buildPlatformNavigationTags } from '@/lib/platform-navigation'
import { deferPublicShellPrerenderIfNeeded } from '@/lib/public-shell-rendering'

async function loadCachedPlatformLayoutNavigation(locale: SupportedLocale) {
  'use cache'

  const t = await getExtracted({ locale })
  const { data: mainTags, globalChilds } = await loadPlatformMainTags(locale)

  return {
    tags: buildPlatformNavigationTags({
      mainTags: mainTags ?? [],
      globalChilds,
      trendingLabel: t('Trending'),
      newLabel: t('New'),
    }),
    childParentMap: buildChildParentMap(mainTags ?? []),
  }
}

type PlatformLayoutNavigation = Awaited<ReturnType<typeof loadCachedPlatformLayoutNavigation>>

export async function loadPlatformLayoutNavigation(): Promise<PlatformLayoutNavigation> {
  // Layout segments render independently. Defer before entering the cache so
  // Docker builds without runtime env do not capture an empty navigation tree.
  await deferPublicShellPrerenderIfNeeded()

  // An explicit prerender override can skip deferral even without database env.
  if (!hasDatabaseEnv()) {
    return { tags: [], childParentMap: {} }
  }

  const locale = await getRootLocale()
  return loadCachedPlatformLayoutNavigation(locale)
}
