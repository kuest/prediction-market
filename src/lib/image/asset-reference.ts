import {
  defaultPublicRuntimeConfig,
  isRetiredAssetHost,
  normalizePublicAssetsUrl,
  resolvePublicRuntimeEnv,
} from '@/lib/public-runtime-config.shared'

export const ASSET_ID = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/

export function resolveAssetsOrigin(): string {
  if (typeof window !== 'undefined') {
    return normalizePublicAssetsUrl(window.__PUBLIC_RUNTIME_CONFIG__?.assetsUrl)
  }
  return resolvePublicRuntimeEnv(process.env).assetsUrl
}

export function resolveRemoteAssetReference(value: unknown, assetsOrigin = resolveAssetsOrigin()): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const reference = value.trim()
  if (ASSET_ID.test(reference)) {
    return `${assetsOrigin}/${reference}`
  }
  if (!/^(?:https?:)?\/\//i.test(reference)) {
    return null
  }
  try {
    const absolute = reference.startsWith('//') ? `https:${reference}` : reference
    const url = new URL(absolute)
    if (!url.username && !url.password && !isRetiredAssetHost(url.hostname)) {
      if (url.origin === defaultPublicRuntimeConfig.assetsUrl && ASSET_ID.test(url.pathname.slice(1))) {
        return `${assetsOrigin}${url.pathname}${url.search}${url.hash}`
      }
      return absolute
    }
  } catch {
    // Invalid references behave like missing artwork.
  }
  return null
}

export function resolveMarketAssetUrl(value: unknown): string | null {
  if (typeof value === 'string') {
    const reference = value.trim()
    if (reference.startsWith('/') && !reference.startsWith('//') && !reference.startsWith('/\\')) {
      return reference
    }
  }
  return resolveRemoteAssetReference(value)
}
