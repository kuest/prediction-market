import type { PublicRuntimeConfig } from '@/lib/public-runtime-config.shared'

import { resolveCommitSha } from '@/lib/git'
import { getLiFiIntegrator } from '@/lib/lifi-config.server'
import { resolvePublicRuntimeEnv } from '@/lib/public-runtime-config.shared'
import resolveSiteUrl from '@/lib/site-url'

export type { PublicRuntimeConfig } from '@/lib/public-runtime-config.shared'

export async function getPublicRuntimeConfig(
  env: Readonly<Partial<NodeJS.ProcessEnv>> = process.env,
): Promise<PublicRuntimeConfig> {
  const lifiIntegrator = await getLiFiIntegrator()

  return {
    ...resolvePublicRuntimeEnv(env),
    commitSha: resolveCommitSha(env),
    lifiIntegrator,
    siteUrl: resolveSiteUrl(env),
  }
}

export function serializePublicRuntimeConfig(config: PublicRuntimeConfig) {
  return JSON.stringify(config).replace(/</g, '\\u003c')
}
