import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  assertHomeFeaturedNewsMetadataUrlAllowed: mock(),
  fetchHomeFeaturedNewsMetadata: mock(),
  getCurrentUser: mock(),
  getSettings: mock(),
  parseOpenRouterProviderSettings: mock(),
  requestOpenRouterCompletion: mock(),
}))

void mock.module('@/lib/db/queries/user', () => ({
  UserRepository: {
    getCurrentUser: (...args: unknown[]) => mocks.getCurrentUser(...args),
  },
}))

void mock.module('@/lib/db/queries/settings', () => ({
  SettingsRepository: {
    getSettings: (...args: unknown[]) => mocks.getSettings(...args),
  },
}))

void mock.module('@/lib/ai/market-context-config', () => ({
  parseOpenRouterProviderSettings: (...args: unknown[]) => mocks.parseOpenRouterProviderSettings(...args),
}))

void mock.module('@/lib/ai/openrouter', () => ({
  requestOpenRouterCompletion: (...args: unknown[]) => mocks.requestOpenRouterCompletion(...args),
  sanitizeForPrompt: (value: string) => value,
}))

void mock.module('@/lib/home-featured-context-metadata', () => ({
  assertHomeFeaturedNewsMetadataUrlAllowed: (...args: unknown[]) =>
    mocks.assertHomeFeaturedNewsMetadataUrlAllowed(...args),
  fetchHomeFeaturedNewsMetadata: (...args: unknown[]) => mocks.fetchHomeFeaturedNewsMetadata(...args),
}))

describe('home featured context news route', () => {
  beforeEach(() => {
    mocks.assertHomeFeaturedNewsMetadataUrlAllowed.mockReset()
    mocks.fetchHomeFeaturedNewsMetadata.mockReset()
    mocks.getCurrentUser.mockReset()
    mocks.getSettings.mockReset()
    mocks.parseOpenRouterProviderSettings.mockReset()
    mocks.requestOpenRouterCompletion.mockReset()
  })

  it('returns up to five news articles from the admin search', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'admin-1', is_admin: true })
    mocks.getSettings.mockResolvedValue({ data: {}, error: null })
    mocks.parseOpenRouterProviderSettings.mockReturnValue({ apiKey: 'openrouter-key', model: 'openai/gpt-4o-mini' })
    const news = Array.from({ length: 6 }, (_, index) => ({
      title: `Story ${index + 1}`,
      source: 'Publisher',
      url: `https://example.com/story-${index + 1}`,
      publishedAt: null,
    }))
    mocks.requestOpenRouterCompletion.mockResolvedValue(JSON.stringify({ news }))
    mocks.fetchHomeFeaturedNewsMetadata.mockImplementation(async (url: string) => ({
      ...news.find((item) => item.url === url),
      faviconUrl: null,
    }))

    const { POST } = await import('@/app/[locale]/admin/api/home-featured-events/context-news/route')
    const response = await POST(
      new Request('https://example.com/admin/api/home-featured-events/context-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Brazil vs Norway', locale: 'pt' }),
      }),
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.items).toHaveLength(5)
    expect(payload.items[4].url).toBe(news[4]!.url)
    expect(mocks.requestOpenRouterCompletion.mock.calls[0]![0][1].content).toContain('Return at most 5 results')
  })

  it('does not return AI fallback URLs when the metadata host validation rejects them', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'admin-1', is_admin: true })
    mocks.getSettings.mockResolvedValue({ data: {}, error: null })
    mocks.parseOpenRouterProviderSettings.mockReturnValue({ apiKey: 'openrouter-key', model: 'openai/gpt-4o-mini' })
    mocks.requestOpenRouterCompletion.mockResolvedValue(
      JSON.stringify({
        news: [
          {
            title: 'Blocked Story',
            source: 'Blocked',
            url: 'http://127.0.0.1/admin',
            publishedAt: null,
          },
        ],
      }),
    )
    mocks.fetchHomeFeaturedNewsMetadata.mockRejectedValue(new Error('Could not fetch URL metadata.'))
    mocks.assertHomeFeaturedNewsMetadataUrlAllowed.mockRejectedValue(new Error('URL host is not allowed.'))

    const { POST } = await import('@/app/[locale]/admin/api/home-featured-events/context-news/route')
    const response = await POST(
      new Request('https://example.com/admin/api/home-featured-events/context-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Brazil vs Norway',
          slug: 'brazil-vs-norway',
          newsSources: '',
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [] })
    expect(mocks.assertHomeFeaturedNewsMetadataUrlAllowed).toHaveBeenCalledWith('http://127.0.0.1/admin')
  })

  it('skips malformed articles without discarding valid news or consuming the result limit', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'admin-1', is_admin: true })
    mocks.getSettings.mockResolvedValue({ data: {}, error: null })
    mocks.parseOpenRouterProviderSettings.mockReturnValue({ apiKey: 'openrouter-key', model: 'openai/gpt-4o-mini' })
    mocks.requestOpenRouterCompletion.mockResolvedValue(
      JSON.stringify({
        news: [
          null,
          'not an article',
          { url: 123 },
          { url: '  ' },
          { url: 'https://example.com/bad-title', title: {} },
          { url: 'https://example.com/bad-source', source: false },
          { url: 'https://example.com/bad-favicon', faviconUrl: [] },
          { url: 'https://example.com/bad-date-type', publishedAt: {} },
          { url: 'https://example.com/bad-date-value', publishedAt: 'not a date' },
          { url: ' https://example.com/story ', title: ' Story ', source: ' Publisher ' },
          { url: 'https://example.com/minimal-story', title: null, source: null, faviconUrl: null, publishedAt: null },
        ],
      }),
    )
    mocks.fetchHomeFeaturedNewsMetadata.mockImplementation(async (url: string) => ({
      url,
      title: 'Metadata title',
      source: 'Metadata publisher',
      faviconUrl: null,
      publishedAt: '2026-10-16T12:00:00Z',
    }))

    const { POST } = await import('@/app/[locale]/admin/api/home-featured-events/context-news/route')
    const response = await POST(
      new Request('https://example.com/admin/api/home-featured-events/context-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Brazil vs Norway' }),
      }),
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.items).toEqual([
      {
        url: 'https://example.com/story',
        title: 'Story',
        source: 'Publisher',
        faviconUrl: null,
        publishedAt: '2026-10-16T12:00:00Z',
      },
      {
        url: 'https://example.com/minimal-story',
        title: 'Metadata title',
        source: 'Metadata publisher',
        faviconUrl: null,
        publishedAt: '2026-10-16T12:00:00Z',
      },
    ])
    expect(mocks.fetchHomeFeaturedNewsMetadata).toHaveBeenCalledTimes(2)
  })
})
