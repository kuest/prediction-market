import { ASSET_ID } from '@/lib/image/asset-reference'
import { resolvePublicRuntimeEnv } from '@/lib/public-runtime-config.shared'

export class RetryableMarketSyncError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause })
    this.name = 'RetryableMarketSyncError'
  }
}

export function isTransientAssetResponse(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

export async function fetchMarketAssetMetadata(metadataHash: string) {
  if (!ASSET_ID.test(metadataHash)) {
    throw new Error('Invalid metadata asset ID')
  }

  const { assetsUrl } = resolvePublicRuntimeEnv(process.env)
  const url = `${assetsUrl}/${metadataHash}`
  let response: Response
  try {
    response = await fetch(url, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    throw new RetryableMarketSyncError(`Failed to reach asset metadata at ${url}`, error)
  }

  if (!response.ok) {
    const error = new Error(`Failed to fetch metadata from ${url}: HTTP ${response.status}`)
    if (isTransientAssetResponse(response.status)) {
      throw new RetryableMarketSyncError(error.message, error)
    }
    // A missing legacy ID is terminal; the existing per-market skip advances the cursor.
    throw error
  }

  let contents: string
  try {
    contents = await response.text()
  } catch (error) {
    throw new RetryableMarketSyncError(`Failed to read asset metadata at ${url}`, error)
  }

  const metadata = JSON.parse(contents)
  if (!metadata?.name || !metadata.slug || !metadata.event) {
    throw new Error(`Invalid metadata: missing required fields at ${url}`)
  }
  return metadata
}
