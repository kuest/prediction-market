import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import { hoisted, stubEnv, unstubAllEnvs } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  cacheTag: mock(),
  getExtracted: mock(),
  getMainTags: mock(),
  io: mock(),
}))

void mock.module('next/cache', () => ({
  cacheTag: mocks.cacheTag,
  io: mocks.io,
}))

void mock.module('next-intl/server', () => ({
  getExtracted: mocks.getExtracted,
}))

void mock.module('@/lib/db/queries/tag', () => ({
  TagRepository: { getMainTags: mocks.getMainTags },
}))

const { loadPlatformLayoutNavigation } = await import('@/lib/platform-layout-navigation')
const { loadPlatformMainTags } = await import('@/lib/platform-main-tags')

beforeEach(() => {
  mocks.cacheTag.mockClear()
  mocks.getExtracted.mockReset()
  mocks.getExtracted.mockResolvedValue((message: string) => message)
  mocks.getMainTags.mockReset()
  mocks.io.mockReset()
  mocks.io.mockResolvedValue(undefined)
  stubEnv('BUILD_PRERENDER_PUBLIC_SHELL', '')
  stubEnv('NEXT_PHASE', 'phase-production-build')
  stubEnv('POSTGRES_URL', '')
  stubEnv('REOWN_APPKIT_PROJECT_ID', '')
  stubEnv('SITE_URL', '')
  stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '')
  mocks.getMainTags.mockResolvedValue({
    data: [{ name: 'Crypto', slug: 'crypto', childs: [{ name: 'Bitcoin', slug: 'bitcoin', count: 1 }] }],
    globalChilds: [{ name: 'Bitcoin', slug: 'bitcoin', count: 1 }],
    error: null,
  })
})

afterEach(() => {
  unstubAllEnvs()
})

describe('platform layout navigation', () => {
  it.each(['', '   '])(
    'keeps forced prerenders with missing database env %j outside the navigation cache',
    async (databaseUrl) => {
      stubEnv('BUILD_PRERENDER_PUBLIC_SHELL', 'true')
      stubEnv('POSTGRES_URL', databaseUrl)

      expect(await loadPlatformLayoutNavigation()).toEqual({ tags: [], childParentMap: {} })
      expect(mocks.io).not.toHaveBeenCalled()
      expect(mocks.getExtracted).not.toHaveBeenCalled()
      expect(mocks.cacheTag).not.toHaveBeenCalled()
      expect(mocks.getMainTags).not.toHaveBeenCalled()

      stubEnv('NEXT_PHASE', 'phase-production-server')
      stubEnv('POSTGRES_URL', 'postgres://user:pass@localhost:5432/app')

      const result = await loadPlatformLayoutNavigation()

      expect(result.tags.map((tag) => tag.slug)).toEqual(['trending', 'new', 'crypto'])
      expect(result.childParentMap.bitcoin).toBe('crypto')
      expect(mocks.getExtracted).toHaveBeenCalledOnce()
      expect(mocks.cacheTag).toHaveBeenCalledOnce()
      expect(mocks.getMainTags).toHaveBeenCalledWith('en')
    },
  )

  it('waits for runtime before filling the menu cache in an env-less Docker build', async () => {
    const runtime = Promise.withResolvers<void>()
    mocks.io.mockReturnValue(runtime.promise)

    const navigation = loadPlatformLayoutNavigation()

    expect(mocks.io).toHaveBeenCalledOnce()
    expect(mocks.cacheTag).not.toHaveBeenCalled()
    expect(mocks.getMainTags).not.toHaveBeenCalled()

    stubEnv('NEXT_PHASE', 'phase-production-server')
    stubEnv('POSTGRES_URL', 'postgres://user:pass@localhost:5432/app')
    stubEnv('REOWN_APPKIT_PROJECT_ID', 'project-id')
    stubEnv('SITE_URL', 'https://markets.example.com')
    runtime.resolve()

    const result = await navigation

    expect(result.tags.map((tag) => tag.slug)).toEqual(['trending', 'new', 'crypto'])
    expect(result.childParentMap.bitcoin).toBe('crypto')
    expect(mocks.getMainTags).toHaveBeenCalledWith('en')
  })

  it('does not fill the main tag cache from other build callers without database env', async () => {
    expect(await loadPlatformMainTags('en')).toEqual({
      data: [],
      error: 'Database env vars are not configured.',
      globalChilds: [],
    })
    expect(mocks.cacheTag).not.toHaveBeenCalled()
    expect(mocks.getMainTags).not.toHaveBeenCalled()

    stubEnv('POSTGRES_URL', 'postgres://user:pass@localhost:5432/app')

    const result = await loadPlatformMainTags('en')

    expect(result.data?.map((tag) => tag.slug)).toEqual(['crypto'])
    expect(mocks.cacheTag).toHaveBeenCalledOnce()
    expect(mocks.getMainTags).toHaveBeenCalledOnce()
  })

  it('keeps configured builds eligible for prerendering the complete menu', async () => {
    stubEnv('POSTGRES_URL', 'postgres://user:pass@localhost:5432/app')
    stubEnv('REOWN_APPKIT_PROJECT_ID', 'project-id')
    stubEnv('SITE_URL', 'https://markets.example.com')

    const result = await loadPlatformLayoutNavigation()

    expect(mocks.io).not.toHaveBeenCalled()
    expect(result.tags.map((tag) => tag.slug)).toEqual(['trending', 'new', 'crypto'])
  })
})
