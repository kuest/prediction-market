import 'server-only'
import { ASSET_ID, resolveRemoteAssetReference } from '@/lib/image/asset-reference'

export const ASSETS_BUCKET = 'kuest-assets'
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off'])

export type StorageProvider = 'supabase' | 's3' | 'none'
export interface S3StorageConfig {
  endpoint: string | null
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  publicUrl: string | null
  forcePathStyle: boolean
}

export interface StorageRuntimeConfig {
  provider: StorageProvider
  supabaseUrl: string | null
  supabaseSecretKey: string | null
  s3: S3StorageConfig | null
}

function normalizeEnv(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized || null
}

function parseBooleanEnv(value: string | null, fallback: boolean) {
  if (!value) {
    return fallback
  }

  const normalized = value.trim().toLowerCase()
  if (TRUE_VALUES.has(normalized)) {
    return true
  }
  if (FALSE_VALUES.has(normalized)) {
    return false
  }

  return fallback
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

export function normalizeAssetPath(value: string) {
  return value.replace(/^\/+/, '')
}

function resolveS3Config() {
  const endpoint = normalizeEnv(process.env.S3_ENDPOINT)
  const region = normalizeEnv(process.env.S3_REGION) ?? normalizeEnv(process.env.AWS_REGION) ?? 'us-east-1'
  const bucket = normalizeEnv(process.env.S3_BUCKET)
  const accessKeyId = normalizeEnv(process.env.S3_ACCESS_KEY_ID) ?? normalizeEnv(process.env.AWS_ACCESS_KEY_ID)
  const secretAccessKey =
    normalizeEnv(process.env.S3_SECRET_ACCESS_KEY) ?? normalizeEnv(process.env.AWS_SECRET_ACCESS_KEY)
  const publicUrl = normalizeEnv(process.env.S3_PUBLIC_URL)
  const forcePathStyleDefault = Boolean(endpoint)
  const forcePathStyle = parseBooleanEnv(normalizeEnv(process.env.S3_FORCE_PATH_STYLE), forcePathStyleDefault)

  const hasAny = Boolean(endpoint || bucket || accessKeyId || secretAccessKey || publicUrl)
  const missing: string[] = []

  if (!bucket) {
    missing.push('S3_BUCKET')
  }
  if (!accessKeyId) {
    missing.push('S3_ACCESS_KEY_ID')
  }
  if (!secretAccessKey) {
    missing.push('S3_SECRET_ACCESS_KEY')
  }

  let config: S3StorageConfig | null = null
  if (bucket && accessKeyId && secretAccessKey) {
    config = {
      endpoint,
      region,
      bucket,
      accessKeyId,
      secretAccessKey,
      publicUrl,
      forcePathStyle,
    }
  }

  return { hasAny, missing, config }
}

function resolveSupabaseSecretKey() {
  return normalizeEnv(process.env.SUPABASE_SECRET_KEY) ?? normalizeEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export function resolveStorageRuntimeConfig(): StorageRuntimeConfig {
  const supabaseUrl = normalizeEnv(process.env.SUPABASE_URL)
  const supabaseSecretKey = resolveSupabaseSecretKey()
  const hasAnySupabase = Boolean(supabaseUrl || supabaseSecretKey)

  if (hasAnySupabase) {
    if (!supabaseUrl || !supabaseSecretKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set together.')
    }

    return {
      provider: 'supabase',
      supabaseUrl,
      supabaseSecretKey,
      s3: null,
    }
  }

  const s3 = resolveS3Config()
  if (s3.hasAny) {
    if (s3.missing.length > 0) {
      throw new Error(`S3 configuration is incomplete. Missing env vars: ${s3.missing.join(', ')}`)
    }

    return {
      provider: 's3',
      supabaseUrl: null,
      supabaseSecretKey: null,
      s3: s3.config,
    }
  }

  return {
    provider: 'none',
    supabaseUrl: null,
    supabaseSecretKey: null,
    s3: null,
  }
}

function buildS3PublicAssetBaseUrl(config: S3StorageConfig) {
  if (config.publicUrl) {
    return trimTrailingSlash(config.publicUrl)
  }

  if (!config.endpoint) {
    return trimTrailingSlash(`https://${config.bucket}.s3.${config.region}.amazonaws.com`)
  }

  const normalizedEndpoint = trimTrailingSlash(config.endpoint)
  if (config.forcePathStyle) {
    return `${normalizedEndpoint}/${config.bucket}`
  }

  try {
    const parsed = new URL(normalizedEndpoint)
    const normalizedPath = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/+$/, '') : ''
    return `${parsed.protocol}//${config.bucket}.${parsed.host}${normalizedPath}`
  } catch {
    return `${normalizedEndpoint}/${config.bucket}`
  }
}

export function getPublicAssetUrl(assetPath: string | null): string {
  if (!assetPath) {
    return ''
  }

  if (/^(?:https?:)?\/\//i.test(assetPath) || ASSET_ID.test(assetPath)) {
    return resolveRemoteAssetReference(assetPath) ?? ''
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(assetPath)) {
    return ''
  }

  const normalizedPath = normalizeAssetPath(assetPath)
  const config = resolveStorageRuntimeConfig()

  if (config.provider === 'supabase' && config.supabaseUrl) {
    return `${config.supabaseUrl}/storage/v1/object/public/${ASSETS_BUCKET}/${normalizedPath}`
  }

  if (config.provider === 's3' && config.s3) {
    const baseUrl = buildS3PublicAssetBaseUrl(config.s3)
    return `${baseUrl}/${normalizedPath}`
  }

  return ''
}
