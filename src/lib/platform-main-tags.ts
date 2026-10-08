import { cacheTag } from 'next/cache'

import type { SupportedLocale } from '@/i18n/locales'

import { cacheTags } from '@/lib/cache-tags'
import { hasDatabaseEnv } from '@/lib/db/env'
import { TagRepository } from '@/lib/db/queries/tag'

type PlatformMainTagsResult = Awaited<ReturnType<typeof TagRepository.getMainTags>>

async function loadCachedPlatformMainTags(locale: SupportedLocale): Promise<PlatformMainTagsResult> {
  'use cache'
  cacheTag(cacheTags.mainTags(locale))

  const result = await TagRepository.getMainTags(locale)

  return {
    ...result,
    data: result.data ?? [],
    globalChilds: result.globalChilds ?? [],
  }
}

export async function loadPlatformMainTags(locale: SupportedLocale): Promise<PlatformMainTagsResult> {
  if (!hasDatabaseEnv()) {
    return { data: [], error: 'Database env vars are not configured.', globalChilds: [] }
  }

  return loadCachedPlatformMainTags(locale)
}
