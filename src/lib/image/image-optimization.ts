import {
  defaultPublicRuntimeConfig,
  isRetiredAssetHost,
  resolvePublicRuntimeEnv,
} from '@/lib/public-runtime-config.shared'

const DEFAULT_IMAGE_HOST_PATTERNS = ['*.supabase.co'] as const

type EnvMap = NodeJS.ProcessEnv | Record<string, string | undefined>

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function parseBooleanEnv(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback
  }

  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false
  }

  return fallback
}

function resolveS3ImageHostPatterns(env: EnvMap) {
  const publicUrl = env.S3_PUBLIC_URL?.trim()
  if (publicUrl) {
    try {
      return [new URL(publicUrl).hostname]
    } catch {
      return []
    }
  }

  const bucket = env.S3_BUCKET?.trim()
  if (!bucket) {
    return []
  }

  const endpoint = env.S3_ENDPOINT?.trim()
  if (!endpoint) {
    const region = env.S3_REGION?.trim() || env.AWS_REGION?.trim() || 'us-east-1'
    return [`${bucket}.s3.${region}.amazonaws.com`]
  }

  const forcePathStyle = parseBooleanEnv(env.S3_FORCE_PATH_STYLE, true)

  try {
    const parsedEndpoint = new URL(trimTrailingSlash(endpoint))
    if (forcePathStyle) {
      return [parsedEndpoint.hostname]
    }
    return [`${bucket}.${parsedEndpoint.hostname}`]
  } catch {
    return []
  }
}

export function getOptimizedImageHostPatterns(env: EnvMap = process.env) {
  const assetsHosts = [defaultPublicRuntimeConfig.assetsUrl, resolvePublicRuntimeEnv(env).assetsUrl].map(
    (origin) => new URL(origin).hostname,
  )
  const hosts = [...assetsHosts, ...DEFAULT_IMAGE_HOST_PATTERNS, ...resolveS3ImageHostPatterns(env)]
  return Array.from(new Set(hosts.filter((host) => !isRetiredAssetHost(host))))
}
