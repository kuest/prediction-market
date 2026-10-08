import { getExtracted } from 'next-intl/server'

import type { SupportedLocale } from '@/i18n/locales'

import { getRootLocale } from '@/i18n/root-locale'
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

export async function loadPlatformLayoutNavigation() {
  // Layout segments render independently. Defer before entering the cache so
  // Docker builds without runtime env do not capture an empty navigation tree.
  await deferPublicShellPrerenderIfNeeded()

  const locale = await getRootLocale()
  return loadCachedPlatformLayoutNavigation(locale)
}
