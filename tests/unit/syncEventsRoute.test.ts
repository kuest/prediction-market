import { afterEach, beforeEach, describe, expect, it, mock, jest } from 'bun:test'

import { hoisted, spyOn, stubGlobal, unstubAllGlobals, useFakeTimers, useRealTimers } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  fetch: mock(),
  isCronAuthorized: mock(),
  loadAllowedMarketCreatorWallets: mock(),
  loadAutoDeployNewEventsEnabled: mock(),
  refreshAllowedMarketCreatorSiteSources: mock(),
  select: mock(),
  update: mock(),
}))

void mock.module('@/lib/auth-cron', () => ({
  isCronAuthorized: (...args: any[]) => mocks.isCronAuthorized(...args),
}))

void mock.module('@/lib/allowed-market-creators-server', () => ({
  loadAllowedMarketCreatorWallets: (...args: any[]) => mocks.loadAllowedMarketCreatorWallets(...args),
  refreshAllowedMarketCreatorSiteSources: (...args: any[]) => mocks.refreshAllowedMarketCreatorSiteSources(...args),
}))

void mock.module('@/lib/db/utils/run-query', () => ({
  runQuery: async (callback: () => Promise<unknown>) => await callback(),
}))

void mock.module('@/lib/drizzle', () => ({
  db: {
    select: (...args: any[]) => mocks.select(...args),
    update: (...args: any[]) => mocks.update(...args),
  },
}))

void mock.module('@/lib/event-sync-settings', () => ({
  loadAutoDeployNewEventsEnabled: (...args: any[]) => mocks.loadAutoDeployNewEventsEnabled(...args),
}))

function makeSelectChain(result: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => result,
      }),
    }),
  }
}

function makeUpdateChain(result: Array<{ id: string }>, onSet?: (payload: unknown) => void) {
  return {
    set: (payload: unknown) => {
      onSet?.(payload)
      return {
        where: () => ({
          returning: async () => result,
        }),
      }
    },
  }
}

describe('sync events route', () => {
  beforeEach(() => {
    stubGlobal('fetch', mocks.fetch)

    mocks.fetch.mockReset()
    mocks.isCronAuthorized.mockReset()
    mocks.loadAllowedMarketCreatorWallets.mockReset()
    mocks.loadAutoDeployNewEventsEnabled.mockReset()
    mocks.refreshAllowedMarketCreatorSiteSources.mockReset()
    mocks.select.mockReset()
    mocks.update.mockReset()
  })

  afterEach(() => {
    useRealTimers()
    unstubAllGlobals()
    jest.restoreAllMocks()
  })

  it('keeps an incoming additional context timestamp when only the timestamp field is present', async () => {
    const { resolveAdditionalContextUpdatedAtIso } = await import('@/app/api/sync/events/route')

    expect(
      resolveAdditionalContextUpdatedAtIso({
        hasAdditionalContextField: false,
        hasAdditionalContextTimeField: true,
        additionalContext: null,
        additionalContextUpdatedAtIso: '2026-08-25T12:00:00.000Z',
        existingAdditionalContextUpdatedAtIso: '2026-08-24T12:00:00.000Z',
      }),
    ).toBe('2026-08-25T12:00:00.000Z')
  })

  it('invalidates both normalized series tags when an event moves between series', async () => {
    const { getSeriesSlugsForCacheInvalidation, normalizeSeriesSlugsForCacheInvalidation } =
      await import('@/app/api/sync/events/route')

    expect(getSeriesSlugsForCacheInvalidation(' old-series ', 'new-series')).toEqual(['old-series', 'new-series'])
    expect(getSeriesSlugsForCacheInvalidation(' old-series ', 'old-series')).toEqual(['old-series'])
    expect(getSeriesSlugsForCacheInvalidation('old-series', null)).toEqual(['old-series'])
    expect(
      normalizeSeriesSlugsForCacheInvalidation([' old-series ', 'new-series', 'old-series', 'new-series ']),
    ).toEqual(['old-series', 'new-series'])
  })

  it('normalizes mirror token IDs and detects an explicit mapping removal', async () => {
    const {
      hasPolymarketOutcomeTokenMappingChanged,
      normalizePolymarketOutcomeTokenIds,
      resolvePolymarketOutcomeAssetIds,
    } = await import('@/app/api/sync/events/route')
    const existing = [
      { outcomeIndex: 0, polymarketTokenId: '100' },
      { outcomeIndex: 1, polymarketTokenId: '200' },
    ]

    expect(normalizePolymarketOutcomeTokenIds(undefined)).toEqual([])
    expect(hasPolymarketOutcomeTokenMappingChanged(normalizePolymarketOutcomeTokenIds([null, null]), existing)).toBe(
      true,
    )
    expect(hasPolymarketOutcomeTokenMappingChanged(normalizePolymarketOutcomeTokenIds(['100', '200']), existing)).toBe(
      false,
    )

    expect(
      resolvePolymarketOutcomeAssetIds({
        mirror_protocol: 'polyv2',
        mirror_outcome_token_ids: ['legacy-yes', 'legacy-no'],
        mirror_position_ids: ['12345678901234567890', '98765432109876543210'],
        outcomes: [{ mirror_position_id: '12345678901234567890' }, { mirror_position_id: '98765432109876543210' }],
      }),
    ).toEqual({ hasMapping: true, ids: ['12345678901234567890', '98765432109876543210'] })
    expect(
      resolvePolymarketOutcomeAssetIds({
        mirror_protocol: 'polyv2',
        mirror_outcome_token_ids: ['legacy-yes', 'legacy-no'],
        mirror_position_ids: ['12345678901234567890', '98765432109876543210'],
        outcomes: [{ mirror_position_id: '12345678901234567890' }, { mirror_position_id: 'stale-id' }],
      }),
    ).toEqual({ hasMapping: true, ids: [null, null] })
    expect(resolvePolymarketOutcomeAssetIds({ mirror_outcome_token_ids: ['100', '200'] })).toEqual({
      hasMapping: true,
      ids: ['100', '200'],
    })
  })

  it('only downloads an existing market icon when its source reference changes', async () => {
    const { shouldDownloadMarketIcon } = await import('@/app/api/sync/events/route')
    const existingReference = 'existing-icon-hash'
    const existingMarket = {
      icon_url: '/storage/markets/icons/example.png',
      metadata: JSON.stringify({ icon: existingReference }),
    }

    expect(shouldDownloadMarketIcon(undefined, existingReference)).toBe(true)
    expect(shouldDownloadMarketIcon(existingMarket, existingReference)).toBe(false)
    expect(shouldDownloadMarketIcon(existingMarket, 'new-icon-hash')).toBe(true)
    expect(shouldDownloadMarketIcon({ ...existingMarket, icon_url: null }, 'new-icon-hash')).toBe(false)
    expect(shouldDownloadMarketIcon(existingMarket, null)).toBe(false)
  })

  it('uses one canonical storage path for the same immutable asset reference', async () => {
    const { buildCanonicalIconStoragePath } = await import('@/app/api/sync/events/route')

    expect(buildCanonicalIconStoragePath('irys://shared-icon', 'events/icons/event')).toBe(
      'icons/source/shared-icon.png',
    )
    expect(buildCanonicalIconStoragePath('shared-icon', 'events/icons/event')).toBe('icons/source/shared-icon.png')
    expect(buildCanonicalIconStoragePath('https://gateway.irys.xyz/shared-icon', 'events/icons/event')).toBe(
      'icons/source/shared-icon.png',
    )
    expect(buildCanonicalIconStoragePath('https://example.com/icon.png', 'events/icons/event')).toBe(
      'events/icons/event',
    )
  })

  it('reuses sports source payload when partial incoming identity resolves to the same source', async () => {
    const { mergeSportsSourceFieldsWithExisting } = await import('@/app/api/sync/events/route')

    expect(
      mergeSportsSourceFieldsWithExisting({
        current: {
          provider: 'thesportsdb',
          eventId: null,
          gameId: null,
          leagueId: null,
          leagueLabel: null,
          matchConfidence: null,
          payload: null,
        },
        existing: {
          sports_source_provider: 'thesportsdb',
          sports_source_event_id: '123',
          sports_source_game_id: null,
          sports_source_league_id: '4328',
          sports_source_league_label: 'Premier League',
          sports_source_match_confidence: '0.8700',
          sports_source_payload: { provider: 'thesportsdb', eventId: '123' },
        },
      }),
    ).toEqual({
      provider: 'thesportsdb',
      eventId: '123',
      gameId: null,
      leagueId: '4328',
      leagueLabel: 'Premier League',
      matchConfidence: '0.8700',
      payload: { provider: 'thesportsdb', eventId: '123' },
    })
  })

  it('clears stale sports source details when incoming identity changes', async () => {
    const { mergeSportsSourceFieldsWithExisting } = await import('@/app/api/sync/events/route')

    expect(
      mergeSportsSourceFieldsWithExisting({
        current: {
          provider: 'thesportsdb',
          eventId: '456',
          gameId: null,
          leagueId: null,
          leagueLabel: null,
          matchConfidence: null,
          payload: null,
        },
        existing: {
          sports_source_provider: 'thesportsdb',
          sports_source_event_id: '123',
          sports_source_game_id: null,
          sports_source_league_id: '4328',
          sports_source_league_label: 'Premier League',
          sports_source_match_confidence: '0.8700',
          sports_source_payload: { provider: 'thesportsdb', eventId: '123' },
        },
      }),
    ).toEqual({
      provider: 'thesportsdb',
      eventId: '456',
      gameId: null,
      leagueId: null,
      leagueLabel: null,
      matchConfidence: null,
      payload: null,
    })
  })

  it('does not merge old sports source ids into a provider switch', async () => {
    const { mergeSportsSourceFieldsWithExisting } = await import('@/app/api/sync/events/route')

    expect(
      mergeSportsSourceFieldsWithExisting({
        current: {
          provider: 'pandascore',
          eventId: null,
          gameId: null,
          leagueId: null,
          leagueLabel: null,
          matchConfidence: null,
          payload: null,
        },
        existing: {
          sports_source_provider: 'thesportsdb',
          sports_source_event_id: '123',
          sports_source_game_id: '999',
          sports_source_league_id: '4328',
          sports_source_league_label: 'Premier League',
          sports_source_match_confidence: '0.8700',
          sports_source_payload: { provider: 'thesportsdb', eventId: '123' },
        },
      }),
    ).toEqual({
      provider: 'pandascore',
      eventId: null,
      gameId: null,
      leagueId: null,
      leagueLabel: null,
      matchConfidence: null,
      payload: null,
    })
  })

  it('does not reuse legacy sports source providers or ids', async () => {
    const { mergeSportsSourceFieldsWithExisting } = await import('@/app/api/sync/events/route')

    expect(
      mergeSportsSourceFieldsWithExisting({
        current: {
          provider: null,
          eventId: null,
          gameId: null,
          leagueId: null,
          leagueLabel: null,
          matchConfidence: null,
          payload: null,
        },
        existing: {
          sports_source_provider: 'legacy',
          sports_source_event_id: '123',
          sports_source_game_id: '999',
          sports_source_league_id: 'old-league',
          sports_source_league_label: 'Old League',
          sports_source_match_confidence: '0.5000',
          sports_source_payload: { provider: 'legacy', eventId: '123' },
        },
      }),
    ).toEqual({
      provider: null,
      eventId: null,
      gameId: null,
      leagueId: null,
      leagueLabel: null,
      matchConfidence: null,
      payload: null,
    })
  })

  it('includes null event sports source fields when any source field is updated', async () => {
    const { buildEventSportsSourceUpsertPayload } = await import('@/app/api/sync/events/route')
    const selectedAt = new Date('2026-07-06T12:00:00.000Z')

    expect(
      buildEventSportsSourceUpsertPayload({
        sports_source_provider: 'thesportsdb',
        sports_source_event_id: '456',
        sports_source_game_id: null,
        sports_source_league_id: null,
        sports_source_league_label: null,
        sports_source_match_confidence: null,
        sports_source_payload: null,
        sports_source_selected_at: selectedAt,
      }),
    ).toEqual({
      sports_source_provider: 'thesportsdb',
      sports_source_event_id: '456',
      sports_source_game_id: null,
      sports_source_league_id: null,
      sports_source_league_label: null,
      sports_source_match_confidence: null,
      sports_source_payload: null,
      sports_source_selected_at: selectedAt,
    })
  })

  it('includes null market sports source fields when any source field is updated', async () => {
    const { buildMarketSportsSourceUpsertPayload } = await import('@/app/api/sync/events/route')

    expect(
      buildMarketSportsSourceUpsertPayload({
        sports_source_provider: 'pandascore',
        sports_source_event_id: null,
        sports_source_game_id: null,
        sports_source_league_id: null,
        sports_source_league_label: null,
        sports_source_market_id: null,
        sports_source_match_confidence: null,
        sports_source_payload: null,
      }),
    ).toEqual({
      sports_source_provider: 'pandascore',
      sports_source_event_id: null,
      sports_source_game_id: null,
      sports_source_league_id: null,
      sports_source_league_label: null,
      sports_source_market_id: null,
      sports_source_match_confidence: null,
      sports_source_payload: null,
    })
  })

  it('treats market metadata as expired only after the one-day grace period', async () => {
    const { isMarketMetadataExpired } = await import('@/app/api/sync/events/route')
    const now = Date.parse('2026-08-03T12:00:00.000Z')

    expect(
      isMarketMetadataExpired(
        {
          end_time: '2026-08-02T11:59:59.999Z',
          event: { end_time: '2026-08-10T00:00:00.000Z' },
        },
        now,
      ),
    ).toBe(true)
    expect(isMarketMetadataExpired({ event: { end_time: '2026-08-02T12:00:00.000Z' } }, now)).toBe(false)
    expect(isMarketMetadataExpired({ event: {} }, now)).toBe(false)
  })

  it('hits the PnL subgraph and exits cleanly when no markets are returned', async () => {
    const updatePayloads: unknown[] = []
    useFakeTimers()
    jest.setSystemTime(new Date('2026-08-03T12:00:00.000Z'))
    mocks.isCronAuthorized.mockReturnValue(true)
    mocks.loadAllowedMarketCreatorWallets.mockResolvedValue({
      data: ['0xABCDEF0000000000000000000000000000000001'],
      error: null,
    })
    mocks.loadAutoDeployNewEventsEnabled.mockResolvedValue(false)
    mocks.refreshAllowedMarketCreatorSiteSources.mockResolvedValue({
      scanned: 0,
      checked: 0,
      refreshed: 0,
      skippedFresh: 0,
      wallets: 0,
      errors: [],
    })
    mocks.select.mockImplementation(() => makeSelectChain([]))
    mocks.update.mockImplementation(() =>
      makeUpdateChain([{ id: 'sync-row' }], (payload) => updatePayloads.push(payload)),
    )
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          conditions: [],
        },
      }),
    })

    const { GET } = await import('@/app/api/sync/events/route')
    const response = await GET(
      new Request('https://example.com/api/sync/events', {
        headers: {
          authorization: 'Bearer cron-secret',
        },
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: 'No new markets to process',
      processed: 0,
      fetched: 0,
    })

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://subgraphs-staging.kuest.com/pnl-subgraph',
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
      }),
    )

    const requestBody = JSON.parse(String(mocks.fetch.mock.calls[0][1].body))
    expect(requestBody.variables.creators).toEqual(['0xabcdef0000000000000000000000000000000001'])
    expect(requestBody.variables.minCreationTimestamp).toBe('1784548800')
    expect(requestBody.query).toContain('creationTimestamp_gte: $minCreationTimestamp')
    expect(mocks.refreshAllowedMarketCreatorSiteSources).toHaveBeenCalledWith({ force: false })
    expect(mocks.update).toHaveBeenCalledTimes(3)
    expect(updatePayloads).toContainEqual({
      cursor_updated_at: 1784548800n,
      cursor_id: `0x${'0'.repeat(64)}`,
    })
  })

  it('uses only the saved cursor after the initial sync', async () => {
    mocks.isCronAuthorized.mockReturnValue(true)
    mocks.loadAllowedMarketCreatorWallets.mockResolvedValue({
      data: ['0xABCDEF0000000000000000000000000000000001'],
      error: null,
    })
    mocks.loadAutoDeployNewEventsEnabled.mockResolvedValue(false)
    mocks.refreshAllowedMarketCreatorSiteSources.mockResolvedValue({
      scanned: 0,
      checked: 0,
      refreshed: 0,
      skippedFresh: 0,
      wallets: 0,
      errors: [],
    })
    mocks.select.mockImplementation(() =>
      makeSelectChain([
        {
          cursor_updated_at: BigInt(1_785_758_400),
          cursor_id: '0xlast-condition',
        },
      ]),
    )
    mocks.update.mockImplementation(() => makeUpdateChain([{ id: 'sync-row' }]))
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { conditions: [] } }),
    })

    const { GET } = await import('@/app/api/sync/events/route')
    const response = await GET(
      new Request('https://example.com/api/sync/events', {
        headers: {
          authorization: 'Bearer cron-secret',
        },
      }),
    )

    expect(response.status).toBe(200)
    const requestBody = JSON.parse(String(mocks.fetch.mock.calls[0][1].body))
    expect(requestBody.variables).toEqual({
      creators: ['0xabcdef0000000000000000000000000000000001'],
      pageSize: 200,
      lastUpdatedAt: '1785758400',
      lastConditionId: '0xlast-condition',
    })
    expect(requestBody.query).not.toContain('creationTimestamp_gte')
    expect(mocks.update).toHaveBeenCalledTimes(2)
  })

  it('keeps the persisted initial cutoff when the bootstrap resumes in a later invocation', async () => {
    const updatePayloads: unknown[] = []
    mocks.isCronAuthorized.mockReturnValue(true)
    mocks.loadAllowedMarketCreatorWallets.mockResolvedValue({
      data: ['0xABCDEF0000000000000000000000000000000001'],
      error: null,
    })
    mocks.loadAutoDeployNewEventsEnabled.mockResolvedValue(false)
    mocks.refreshAllowedMarketCreatorSiteSources.mockResolvedValue({
      scanned: 0,
      checked: 0,
      refreshed: 0,
      skippedFresh: 0,
      wallets: 0,
      errors: [],
    })
    mocks.select.mockImplementation(() =>
      makeSelectChain([
        {
          cursor_updated_at: BigInt(1_785_758_400),
          cursor_id: 'initial-market-sync:1784548800:0xlast-condition',
        },
      ]),
    )
    mocks.update.mockImplementation(() =>
      makeUpdateChain([{ id: 'sync-row' }], (payload) => updatePayloads.push(payload)),
    )
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { conditions: [] } }),
    })

    const { GET } = await import('@/app/api/sync/events/route')
    const response = await GET(
      new Request('https://example.com/api/sync/events', {
        headers: {
          authorization: 'Bearer cron-secret',
        },
      }),
    )

    expect(response.status).toBe(200)
    const requestBody = JSON.parse(String(mocks.fetch.mock.calls[0][1].body))
    expect(requestBody.variables).toEqual({
      creators: ['0xabcdef0000000000000000000000000000000001'],
      pageSize: 200,
      lastUpdatedAt: '1785758400',
      lastConditionId: '0xlast-condition',
      minCreationTimestamp: '1784548800',
    })
    expect(requestBody.query).toContain('creationTimestamp_gte: $minCreationTimestamp')
    expect(updatePayloads).toContainEqual({
      cursor_updated_at: BigInt(1_785_758_400),
      cursor_id: '0xlast-condition',
    })
  })

  it('persists the initial cutoff with the cursor when the bootstrap reaches the time limit', async () => {
    useFakeTimers()
    jest.setSystemTime(new Date('2026-08-03T12:00:00.000Z'))
    const now = Date.parse('2026-08-03T12:00:00.000Z')
    const dateNow = spyOn(Date, 'now')
    dateNow
      .mockReturnValueOnce(now)
      .mockReturnValueOnce(now)
      .mockReturnValueOnce(now)
      .mockReturnValueOnce(now)
      .mockReturnValue(now + 250_000)

    const updatePayloads: unknown[] = []
    mocks.isCronAuthorized.mockReturnValue(true)
    mocks.loadAllowedMarketCreatorWallets.mockResolvedValue({
      data: ['0xabcdef0000000000000000000000000000000001'],
      error: null,
    })
    mocks.loadAutoDeployNewEventsEnabled.mockResolvedValue(false)
    mocks.refreshAllowedMarketCreatorSiteSources.mockResolvedValue({
      scanned: 0,
      checked: 0,
      refreshed: 0,
      skippedFresh: 0,
      wallets: 0,
      errors: [],
    })
    mocks.select.mockImplementation(() => makeSelectChain([]))
    mocks.update.mockImplementation(() =>
      makeUpdateChain([{ id: 'sync-row' }], (payload) => updatePayloads.push(payload)),
    )
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          conditions: [
            {
              id: '0xfirst-condition',
              oracle: null,
              questionId: null,
              resolved: false,
              metadataHash: null,
              creator: null,
              creationTimestamp: '1785758300',
              updatedAt: '1785758300',
            },
            {
              id: '0xsecond-condition',
              oracle: '0xoracle',
              questionId: '0xquestion',
              resolved: false,
              metadataHash: 'metadata-hash',
              creator: '0xabcdef0000000000000000000000000000000001',
              creationTimestamp: '1785758400',
              updatedAt: '1785758400',
            },
          ],
        },
      }),
    })

    const { GET } = await import('@/app/api/sync/events/route')
    const response = await GET(
      new Request('https://example.com/api/sync/events', {
        headers: {
          authorization: 'Bearer cron-secret',
        },
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      fetched: 2,
      processed: 0,
      timeLimitReached: true,
    })
    expect(updatePayloads).toContainEqual({
      cursor_updated_at: BigInt(1_785_758_300),
      cursor_id: 'initial-market-sync:1784548800:0xfirst-condition',
    })
  })

  it('reads metadata and skips expired new markets before persisting them', async () => {
    useFakeTimers()
    jest.setSystemTime(new Date('2026-08-03T12:00:00.000Z'))
    mocks.isCronAuthorized.mockReturnValue(true)
    mocks.loadAllowedMarketCreatorWallets.mockResolvedValue({
      data: ['0xabcdef0000000000000000000000000000000001'],
      error: null,
    })
    mocks.loadAutoDeployNewEventsEnabled.mockResolvedValue(false)
    mocks.refreshAllowedMarketCreatorSiteSources.mockResolvedValue({
      scanned: 0,
      checked: 0,
      refreshed: 0,
      skippedFresh: 0,
      wallets: 0,
      errors: [],
    })
    mocks.select.mockImplementation(() => makeSelectChain([]))
    mocks.update.mockImplementation(() => makeUpdateChain([{ id: 'sync-row' }]))
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            conditions: [
              {
                id: '0xcondition',
                oracle: '0xoracle',
                questionId: '0xquestion',
                resolved: false,
                metadataHash: 'metadata-hash',
                creator: '0xabcdef0000000000000000000000000000000001',
                creationTimestamp: '1785758400',
                updatedAt: '1785758400',
              },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'Expired market',
          slug: 'expired-market',
          end_time: '2026-08-01T00:00:00.000Z',
          event: {
            title: 'Expired event',
            slug: 'expired-event',
            end_time: '2026-08-01T00:00:00.000Z',
          },
        }),
      })

    const { GET } = await import('@/app/api/sync/events/route')
    const response = await GET(
      new Request('https://example.com/api/sync/events', {
        headers: {
          authorization: 'Bearer cron-secret',
        },
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      processed: 0,
      fetched: 1,
      skippedCreators: 0,
      skippedExpired: 1,
      errors: 0,
      errorDetails: [],
      timeLimitReached: false,
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.update).toHaveBeenCalledTimes(4)
  })
})
