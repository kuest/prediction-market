import {
  defaultPublicRuntimeConfig,
  normalizePublicRuntimeEnvValue,
  resolvePublicRuntimeEnv,
} from '@/lib/public-runtime-config.shared'

export function getDataApiUrl() {
  const dataApiUrl =
    typeof window !== 'undefined'
      ? normalizePublicRuntimeEnvValue(window.__PUBLIC_RUNTIME_CONFIG__?.dataUrl, defaultPublicRuntimeConfig.dataUrl)
      : resolvePublicRuntimeEnv(process.env).dataUrl
  if (!dataApiUrl) {
    throw new Error('DATA_URL environment variable is not configured.')
  }

  return dataApiUrl
}

export function buildDataApiUrl(pathname: string, searchParams?: URLSearchParams | string, baseUrl = getDataApiUrl()) {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`
  const query = typeof searchParams === 'string' ? searchParams : (searchParams?.toString() ?? '')

  return `${baseUrl.replace(/\/+$/, '')}${normalizedPath}${query ? `?${query}` : ''}`
}

export function normalizeDataApiAddress(value: string) {
  return value.trim().toLowerCase()
}
