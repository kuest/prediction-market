export const ASSETS_HOST = 'assets.kuest.com'
export const ASSETS_ORIGIN = `https://${ASSETS_HOST}`
export const ASSET_ID = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/

export function isRetiredAssetHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, '')
  return host === 'irys.xyz' || host.endsWith('.irys.xyz')
}

export function resolveRemoteAssetReference(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const reference = value.trim()
  if (ASSET_ID.test(reference)) {
    return `${ASSETS_ORIGIN}/${reference}`
  }
  if (!/^(?:https?:)?\/\//i.test(reference)) {
    return null
  }
  try {
    const absolute = reference.startsWith('//') ? `https:${reference}` : reference
    const url = new URL(absolute)
    if (!url.username && !url.password && !isRetiredAssetHost(url.hostname)) {
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
