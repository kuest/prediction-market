import type { SQL } from 'drizzle-orm'

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { getTableName } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

import { hoisted } from '../bun-test-helpers'

interface ContextRow {
  id: string
  featured_event_id: string
  event_id: string
  locale: string
  item_type: string
  source: string
  title: string
  url: string | null
  favicon_url: string | null
  published_at: Date | null
  relevance_score: string | null
  is_manual: boolean
  selected_at: Date
  expires_at: Date
}

const state = hoisted(() => ({
  rows: [] as ContextRow[],
  expirations: {} as Record<string, number>,
  markerExists: false,
  markerInserts: 0,
  markerUpdates: 0,
  phases: [] as string[],
  apiKey: 'openrouter-key',
  now: Date.now(),
  completion: mock(),
  revalidateTag: mock(),
}))
const dialect = new PgDialect()
function queryParams(condition: SQL) {
  return dialect.sqlToQuery(condition).params
}
function matchingRows(condition: SQL) {
  const params = queryParams(condition)
  return state.rows.filter(
    (row) =>
      params.includes(row.featured_event_id) &&
      params.includes(row.event_id) &&
      params.includes(row.locale) &&
      (!params.includes('news') || row.item_type === 'news') &&
      row.expires_at.getTime() > Date.now(),
  )
}

const fakeTransaction = {
  execute: async () => {
    state.phases.push('lock')
  },
  select: () => ({
    from: (table: Parameters<typeof getTableName>[0]) => ({
      where: (condition: SQL) => ({
        orderBy: async () => matchingRows(condition),
        limit: async () => {
          expect(getTableName(table)).toBe('settings')
          expect(queryParams(condition)).toEqual(['cache', 'home_featured_news_refreshes'])
          return state.markerExists ? [{ id: 1, value: JSON.stringify(state.expirations) }] : []
        },
      }),
    }),
  }),
  delete: () => ({
    where: async (condition: SQL) => {
      const params = queryParams(condition)
      state.rows = state.rows.filter(
        (row) =>
          row.is_manual ||
          !params.includes(row.featured_event_id) ||
          !params.includes(row.locale) ||
          (!params.includes(row.event_id) && row.expires_at.getTime() > Date.now()),
      )
    },
  }),
  insert: (table: Parameters<typeof getTableName>[0]) => ({
    values: (values: Omit<ContextRow, 'id' | 'selected_at'>[] | { group: string; key: string; value: string }) => {
      if (!Array.isArray(values)) {
        expect(getTableName(table)).toBe('settings')
        expect([values.group, values.key]).toEqual(['cache', 'home_featured_news_refreshes'])
        state.expirations = JSON.parse(values.value)
        state.markerExists = true
        state.markerInserts += 1
        return {}
      }
      return {
        returning: async () => {
          const rows = values.map((value, index) => ({ ...value, id: `generated-${index}`, selected_at: new Date() }))
          state.rows.push(...rows)
          return rows
        },
      }
    },
  }),
  update: () => ({
    set: (values: { value: string }) => ({
      where: async () => {
        state.expirations = JSON.parse(values.value)
        state.markerUpdates += 1
      },
    }),
  }),
}
const fakeDb = {
  ...fakeTransaction,
  async transaction<T>(callback: (tx: typeof fakeTransaction) => Promise<T>): Promise<T> {
    state.phases.push('begin')
    const result = await callback(fakeTransaction)
    state.phases.push('commit')
    return result
  },
}

void mock.module('@/lib/drizzle', () => ({ db: fakeDb }))
void mock.module('next/cache', () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  revalidateTag: (...args: unknown[]) => {
    state.phases.push('invalidate')
    state.revalidateTag(...args)
  },
}))
void mock.module('@/lib/storage', () => ({ getPublicAssetUrl: (value: string) => value }))
void mock.module('@/lib/db/queries/settings', () => ({
  SettingsRepository: { getSettings: async () => ({ data: {}, error: null }) },
}))
void mock.module('@/lib/ai/market-context-config', () => ({
  parseOpenRouterProviderSettings: () => ({ apiKey: state.apiKey, model: 'test-model' }),
}))
void mock.module('@/lib/ai/openrouter', () => ({
  requestOpenRouterCompletion: (...args: unknown[]) => state.completion(...args),
  sanitizeForPrompt: (value: string) => value,
}))
void mock.module('@/lib/home-featured-context-metadata', () => ({
  fetchHomeFeaturedNewsMetadata: async (url: string) => ({
    url,
    source: 'Publisher',
    title: 'Metadata story',
    faviconUrl: null,
    publishedAt: null,
  }),
  assertHomeFeaturedNewsMetadataUrlAllowed: async (url: string) => new URL(url),
}))

const { loadHomeFeaturedNews } = await import('@/lib/home-featured-news')
const { HOME_FEATURED_NEWS_TTL_MS } = await import('@/lib/home-featured-settings')
const event = { id: 'event-current', slug: 'current', title: 'Brazil vs Norway', end_date: null }
function loadNews(locale: 'en' | 'pt' = 'pt') {
  return loadHomeFeaturedNews('featured', event, locale, [], true)
}

function existingRow(locale: string): ContextRow {
  return {
    id: `saved-${locale}`,
    featured_event_id: 'featured',
    event_id: event.id,
    locale,
    item_type: 'news',
    source: 'Publisher',
    title: `Saved ${locale} story`,
    url: `https://example.com/${locale}`,
    favicon_url: null,
    published_at: null,
    relevance_score: null,
    is_manual: false,
    selected_at: new Date(),
    expires_at: new Date(state.now + HOME_FEATURED_NEWS_TTL_MS),
  }
}

describe('home featured news refresh cache', () => {
  beforeEach(() => {
    state.rows = []
    state.expirations = {}
    state.markerExists = false
    state.markerInserts = 0
    state.markerUpdates = 0
    state.phases = []
    state.apiKey = 'openrouter-key'
    state.now = Date.now()
    state.completion.mockReset()
    state.completion.mockResolvedValue('{"news":[]}')
    state.revalidateTag.mockReset()
    spyOn(Date, 'now').mockImplementation(() => state.now)
  })

  afterEach(() => {
    mock.restore()
  })

  it('reuses an empty result for two hours, then retries the search', async () => {
    expect(await loadNews()).toEqual([])
    state.now += 60_000
    expect(await loadNews()).toEqual([])
    expect(state.completion).toHaveBeenCalledTimes(1)
    expect(state.revalidateTag).toHaveBeenCalledTimes(1)

    state.now += HOME_FEATURED_NEWS_TTL_MS
    expect(await loadNews()).toEqual([])
    expect(state.completion).toHaveBeenCalledTimes(2)
    expect(state.revalidateTag).toHaveBeenCalledTimes(2)
  })

  it('generates localized articles even when English articles are available', async () => {
    state.rows = [existingRow('en')]
    state.completion.mockResolvedValue('{"news":[{"url":"https://example.com/pt","title":"Notícia"}]}')

    const items = await loadNews()

    expect(items.map((item) => item.title)).toEqual(['Notícia'])
    expect(state.completion).toHaveBeenCalledTimes(1)
    expect(state.completion.mock.calls[0]![0][1].content).toContain('Return headlines in language: pt')
    expect(state.rows.map((row) => row.locale)).toEqual(['en', 'pt'])
  })

  it('displays English fallback after an empty localized search without searching on each poll', async () => {
    state.rows = [existingRow('en')]

    expect((await loadNews()).map((item) => item.title)).toEqual(['Saved en story'])
    state.now += 60_000
    expect((await loadNews()).map((item) => item.title)).toEqual(['Saved en story'])
    expect(state.completion).toHaveBeenCalledTimes(1)
    expect(state.expirations[`featured:${event.id}:pt`]).toBeGreaterThan(state.now)
  })

  it('invalidates featured data after the refresh commits and skips invalidation on cache hits', async () => {
    state.completion.mockResolvedValue('{"news":[{"url":"https://example.com/pt"}]}')

    await loadNews()
    expect(state.phases).toEqual(['begin', 'lock', 'commit', 'invalidate'])
    expect(state.revalidateTag).toHaveBeenCalledWith('home:featured-events', { expire: 0 })

    await loadNews()
    expect(state.revalidateTag).toHaveBeenCalledTimes(1)
    expect(state.completion).toHaveBeenCalledTimes(1)
  })

  it('keeps English fallback available when the localized search fails', async () => {
    state.rows = [existingRow('en')]
    state.completion.mockRejectedValueOnce(new Error('Provider unavailable'))

    expect((await loadNews()).map((item) => item.title)).toEqual(['Saved en story'])
    expect(state.expirations).toEqual({})
    expect(state.revalidateTag).not.toHaveBeenCalled()
  })

  it('updates the existing marker row while pruning expired keys and preserving other valid outcomes', async () => {
    state.markerExists = true
    const otherExpiry = state.now + HOME_FEATURED_NEWS_TTL_MS
    state.expirations = { expired: state.now - 1, 'other:event:en': otherExpiry }

    await loadNews()

    expect(state.expirations).toEqual({
      'other:event:en': otherExpiry,
      [`featured:${event.id}:pt`]: state.now + HOME_FEATURED_NEWS_TTL_MS,
    })
    expect(state.markerInserts).toBe(0)
    expect(state.markerUpdates).toBe(1)
  })

  it('returns fresh localized rows without generating news', async () => {
    state.rows = [existingRow('en'), existingRow('pt')]

    expect((await loadNews()).map((item) => item.title)).toEqual(['Saved pt story'])
    expect(state.completion).not.toHaveBeenCalled()
    expect(state.revalidateTag).not.toHaveBeenCalled()
  })

  it('does not mix English articles into a partially localized queue', async () => {
    state.rows = [existingRow('pt'), existingRow('en')]

    const items = await loadHomeFeaturedNews('featured', event, 'pt', [], false)

    expect(items.map((item) => item.title)).toEqual(['Saved pt story'])
  })

  it('does not treat saved comments as a news cache hit', async () => {
    state.rows = [{ ...existingRow('pt'), id: 'saved-comment', item_type: 'comment' }]
    state.completion.mockResolvedValue('{"news":[{"url":"https://example.com/pt"}]}')

    const items = await loadNews()

    expect(items.map((item) => item.type)).toEqual(['news'])
    expect(state.completion).toHaveBeenCalledTimes(1)
  })

  it('does not cache a missing API key as an empty search result', async () => {
    state.apiKey = ''
    expect(await loadNews()).toEqual([])
    expect(state.expirations).toEqual({})
    expect(state.phases).toEqual([])

    state.apiKey = 'configured-later'
    await loadNews()
    expect(state.completion).toHaveBeenCalledTimes(1)
  })
})
