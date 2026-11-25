import type { OpenAPIV3_2 } from 'fumadocs-openapi'

import { createOpenAPI } from 'fumadocs-openapi/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { ASSET_ID, resolveRemoteAssetReference } from '@/lib/image/asset-reference'
import { OPENAPI_SERVER_URLS } from '@/lib/openapi-servers'
import { defaultPublicRuntimeConfig, resolvePublicRuntimeEnv } from '@/lib/public-runtime-config.shared'

type SchemaServer = Record<string, unknown> & {
  url?: string
}

type OpenApiSchema = OpenAPIV3_2.Document & {
  servers?: SchemaServer[]
}

const schemaCache = new Map<string, Promise<OpenApiSchema>>()

function getSchemaCacheKey(schemaFileName: string, serverUrl?: string, assetsUrl?: string) {
  return JSON.stringify([schemaFileName, serverUrl, assetsUrl])
}

function applyServerUrl(schema: OpenApiSchema, serverUrl?: string): OpenApiSchema {
  if (!serverUrl) {
    return schema
  }

  const existingServers = Array.isArray(schema.servers) ? schema.servers : []

  if (existingServers.length === 0) {
    return {
      ...schema,
      servers: [{ url: serverUrl }],
    }
  }

  return {
    ...schema,
    servers: existingServers.map((server, index) => {
      if (index !== 0) {
        return server
      }

      return {
        ...server,
        url: serverUrl,
      }
    }),
  }
}

async function readSchema(schemaFileName: string): Promise<OpenApiSchema> {
  const schemaFilePath = path.join(process.cwd(), 'docs', 'api-reference', 'schemas', schemaFileName)
  const schemaContents = await readFile(schemaFilePath, 'utf8')
  return JSON.parse(schemaContents) as OpenApiSchema
}

type CreateMarketSchema = typeof import('../../docs/api-reference/schemas/openapi-create-market.json')

export function applyCreateMarketAssetExamples(schema: OpenApiSchema, assetsUrl: string): OpenApiSchema {
  const canonicalAssetsUrl = defaultPublicRuntimeConfig.assetsUrl
  if (assetsUrl === canonicalAssetsUrl) {
    return schema
  }

  const document = structuredClone(schema)
  const createMarket = document as unknown as CreateMarketSchema
  const metadata = createMarket.paths['/prepare'].post.responses['200'].content['application/json'].example
    .metadata as {
    eventImageUri: string
    markets: { metadataUri: string; optionImageUri: string | null }[]
  }
  function rewrite(uri: string) {
    if (!uri.startsWith(`${canonicalAssetsUrl}/`)) {
      return uri
    }
    return resolveRemoteAssetReference(uri, assetsUrl) ?? uri
  }
  metadata.eventImageUri = rewrite(metadata.eventImageUri)
  for (const market of metadata.markets) {
    market.metadataUri = rewrite(market.metadataUri)
    if (market.optionImageUri) {
      market.optionImageUri = rewrite(market.optionImageUri)
    }
  }

  const origins = [canonicalAssetsUrl, assetsUrl]
    .map((origin) => origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  const pattern = `^(?:${origins})/${ASSET_ID.source.slice(1)}`
  const { PreparedMarketItem, PreparedMetadata } = createMarket.components.schemas
  PreparedMetadata.properties.eventImageUri.pattern = pattern
  PreparedMarketItem.properties.metadataUri.pattern = pattern
  PreparedMarketItem.properties.optionImageUri.pattern = pattern
  return document
}

function loadSchemaWithServerUrl(schemaFileName: string, serverUrl?: string, assetsUrl?: string) {
  const cacheKey = getSchemaCacheKey(schemaFileName, serverUrl, assetsUrl)
  const cachedSchema = schemaCache.get(cacheKey)
  if (cachedSchema) {
    return cachedSchema
  }

  const schema = readSchema(schemaFileName)
    .then((document) =>
      applyServerUrl(assetsUrl ? applyCreateMarketAssetExamples(document, assetsUrl) : document, serverUrl),
    )
    .catch((error: unknown) => {
      schemaCache.delete(cacheKey)
      throw error
    })

  schemaCache.set(cacheKey, schema)
  return schema
}

export const openapi = createOpenAPI({
  input: {
    clob: () => loadSchemaWithServerUrl('openapi-clob.json', OPENAPI_SERVER_URLS.clob),
    'create-market': () =>
      loadSchemaWithServerUrl(
        'openapi-create-market.json',
        OPENAPI_SERVER_URLS.createMarket,
        resolvePublicRuntimeEnv(process.env).assetsUrl,
      ),
    'data-api': () => loadSchemaWithServerUrl('openapi-data-api.json', OPENAPI_SERVER_URLS.dataApi),
    gamma: () => loadSchemaWithServerUrl('openapi-gamma.json', OPENAPI_SERVER_URLS.gamma),
    'price-reference': () =>
      loadSchemaWithServerUrl('openapi-price-reference.json', OPENAPI_SERVER_URLS.priceReference),
    relayer: () => loadSchemaWithServerUrl('openapi-relayer.json', OPENAPI_SERVER_URLS.relayer),
  },
  proxyUrl: '/docs/api/proxy',
})
