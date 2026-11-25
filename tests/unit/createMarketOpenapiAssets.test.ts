import { describe, expect, it } from 'bun:test'

import { applyCreateMarketAssetExamples } from '@/lib/openapi'
import { defaultPublicRuntimeConfig } from '@/lib/public-runtime-config.shared'

import createMarketSchema from '../../docs/api-reference/schemas/openapi-create-market.json'

type CreateMarketSchema = typeof createMarketSchema
type OpenApiSchema = Parameters<typeof applyCreateMarketAssetExamples>[0]

const operatorAssets = 'https://assets.operator.example:8443'
const canonicalAssets = defaultPublicRuntimeConfig.assetsUrl

function preparedExample(schema: CreateMarketSchema) {
  return schema.paths['/prepare'].post.responses['200'].content['application/json'].example
}

function applyAssets(schema: CreateMarketSchema, assets: string): CreateMarketSchema {
  return applyCreateMarketAssetExamples(schema as unknown as OpenApiSchema, assets) as unknown as CreateMarketSchema
}

describe('Create Market OpenAPI asset examples', () => {
  it('uses canonical SHA-256 base64url IDs in the checked-in response', () => {
    const { metadata } = preparedExample(createMarketSchema)
    const market = metadata.markets[0]
    const { PreparedMetadata, PreparedMarketItem } = createMarketSchema.components.schemas
    const eventImageId = new URL(metadata.eventImageUri).pathname.slice(1)

    expect(Buffer.from(eventImageId, 'base64url')).toHaveLength(32)
    expect(Buffer.from(market.metadataTxId, 'base64url')).toHaveLength(32)
    expect(new RegExp(PreparedMetadata.properties.eventImageUri.pattern).test(metadata.eventImageUri)).toBe(true)
    expect(new RegExp(PreparedMarketItem.properties.metadataTxId.pattern).test(market.metadataTxId)).toBe(true)
    expect(market.metadataUri).toBe(`${canonicalAssets}/${market.metadataTxId}`)
  })

  it('uses the configured Assets origin independently of the API server', () => {
    const original = preparedExample(createMarketSchema)
    const adjusted = applyAssets(createMarketSchema, operatorAssets)
    const { metadata } = preparedExample(adjusted)
    const market = metadata.markets[0]
    const assetUriPattern = new RegExp(adjusted.components.schemas.PreparedMarketItem.properties.metadataUri.pattern)

    expect(metadata.eventImageUri).toBe(`${operatorAssets}${new URL(original.metadata.eventImageUri).pathname}`)
    expect(market.metadataUri).toBe(`${operatorAssets}/${market.metadataTxId}`)
    expect(market.metadataTxId).toBe(original.metadata.markets[0].metadataTxId)
    expect(market.optionImageUri).toBeNull()
    expect(assetUriPattern.test(market.metadataUri)).toBe(true)
    expect(assetUriPattern.test(original.metadata.markets[0].metadataUri)).toBe(true)
    expect(assetUriPattern.test(`https://other.example/${market.metadataTxId}`)).toBe(false)
    expect(original.metadata.eventImageUri).toStartWith(`${canonicalAssets}/`)
    expect(preparedExample(adjusted).txPlan).toEqual(original.txPlan)
    expect(adjusted.servers).toEqual(createMarketSchema.servers)
  })

  it('keeps examples unchanged for the default origin and preserves external URLs', () => {
    expect(applyAssets(createMarketSchema, canonicalAssets)).toBe(createMarketSchema)

    const schema = structuredClone(createMarketSchema)
    preparedExample(schema).metadata.eventImageUri = 'https://cdn.example/unchanged.png'
    expect(preparedExample(applyAssets(schema, operatorAssets)).metadata.eventImageUri).toBe(
      'https://cdn.example/unchanged.png',
    )
  })
})
