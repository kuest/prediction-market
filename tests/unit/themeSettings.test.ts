import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  cacheLife: mock(),
  cacheTag: mock(),
  getSettings: mock(),
}))

void mock.module('next/cache', () => ({
  cacheLife: (...args: any[]) => mocks.cacheLife(...args),
  cacheTag: (...args: any[]) => mocks.cacheTag(...args),
}))

void mock.module('@/lib/db/queries/settings', () => ({
  SettingsRepository: { getSettings: (...args: any[]) => mocks.getSettings(...args) },
}))

const originalPostgresUrl = process.env.POSTGRES_URL

describe('theme settings runtime resolver', () => {
  beforeEach(() => {
    mocks.cacheLife.mockReset()
    mocks.cacheTag.mockReset()
    mocks.getSettings.mockReset()
    process.env.POSTGRES_URL = 'postgres://theme-settings-test'
  })

  afterEach(() => {
    if (originalPostgresUrl == null) {
      delete process.env.POSTGRES_URL
      return
    }

    process.env.POSTGRES_URL = originalPostgresUrl
  })

  it('uses default fallback when DB read fails', async () => {
    mocks.getSettings.mockResolvedValueOnce({ data: null, error: 'Failed to fetch settings.' })

    const { loadRuntimeThemeState } = await import('@/lib/theme-settings')
    const state = await loadRuntimeThemeState()

    expect(state.source).toBe('default')
    expect(state.theme.presetId).toBe('default')
    expect(state.theme.radius).toBeNull()
  })

  it('uses uncached default fallback when database env is missing', async () => {
    delete process.env.POSTGRES_URL

    const { loadRuntimeThemeState } = await import('@/lib/theme-settings')
    const state = await loadRuntimeThemeState()

    expect(state.source).toBe('default')
    expect(mocks.getSettings).not.toHaveBeenCalled()
  })

  it('uses settings theme when DB values are valid', async () => {
    mocks.getSettings.mockResolvedValueOnce({
      data: {
        theme: {
          preset: { value: 'lime', updated_at: '2026-01-01T00:00:00.000Z' },
          radius: { value: '12px', updated_at: '2026-01-01T00:00:00.000Z' },
          light_json: { value: '{"primary":"#112233"}', updated_at: '2026-01-01T00:00:00.000Z' },
          dark_json: { value: '{"primary":"#445566"}', updated_at: '2026-01-01T00:00:00.000Z' },
        },
        general: {
          site_name: { value: 'Kuest Lime', updated_at: '2026-01-01T00:00:00.000Z' },
          site_description: { value: 'Lime branded market', updated_at: '2026-01-01T00:00:00.000Z' },
          site_logo_mode: { value: 'svg', updated_at: '2026-01-01T00:00:00.000Z' },
          site_logo_svg: {
            value:
              '<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"><circle cx=\"5\" cy=\"5\" r=\"4\"/></svg>',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
          pwa_icon_192_path: { value: 'theme/pwa-192.png', updated_at: '2026-01-01T00:00:00.000Z' },
          pwa_icon_512_path: { value: 'theme/pwa-512.png', updated_at: '2026-01-01T00:00:00.000Z' },
          site_google_analytics: { value: 'G-TEST123', updated_at: '2026-01-01T00:00:00.000Z' },
          site_discord_link: { value: 'https://discord.gg/kuest', updated_at: '2026-01-01T00:00:00.000Z' },
          site_support_url: { value: 'https://kuest.com/support', updated_at: '2026-01-01T00:00:00.000Z' },
        },
      },
      error: null,
    })

    const { loadRuntimeThemeState } = await import('@/lib/theme-settings')
    const state = await loadRuntimeThemeState()

    expect(state.source).toBe('settings')
    expect(state.theme.presetId).toBe('lime')
    expect(state.theme.radius).toBe('12px')
    expect(state.theme.light.primary).toBe('#112233')
    expect(state.theme.dark.primary).toBe('#445566')
    expect(state.theme.cssText).toContain('--radius: 12px;')
    expect(state.site.name).toBe('Kuest Lime')
    expect(state.site.description).toBe('Lime branded market')
    expect(state.site.logoMode).toBe('svg')
    expect(state.site.googleAnalyticsId).toBe('G-TEST123')
    expect(state.site.discordLink).toBe('https://discord.gg/kuest')
    expect(state.site.supportUrl).toBe('https://kuest.com/support')
    expect(state.site.pwaIcon192Url).toContain('theme/pwa-192.png')
    expect(state.site.pwaIcon512Url).toContain('theme/pwa-512.png')
  })

  it('falls back when stored settings are invalid', async () => {
    mocks.getSettings.mockResolvedValueOnce({
      data: {
        theme: {
          preset: { value: 'lime', updated_at: '2026-01-01T00:00:00.000Z' },
          radius: { value: 'invalid', updated_at: '2026-01-01T00:00:00.000Z' },
          light_json: { value: '{"bad-token":"#112233"}', updated_at: '2026-01-01T00:00:00.000Z' },
          dark_json: { value: '{}', updated_at: '2026-01-01T00:00:00.000Z' },
        },
      },
      error: null,
    })

    const { loadRuntimeThemeState } = await import('@/lib/theme-settings')
    const state = await loadRuntimeThemeState()

    expect(state.source).toBe('default')
    expect(state.theme.presetId).toBe('default')
    expect(state.theme.radius).toBeNull()
  })

  it('uses default theme when there are no stored settings', async () => {
    mocks.getSettings.mockResolvedValueOnce({ data: {}, error: null })

    const { loadRuntimeThemeState } = await import('@/lib/theme-settings')
    const state = await loadRuntimeThemeState()

    expect(state.source).toBe('default')
    expect(state.theme.presetId).toBe('default')
    expect(state.theme.radius).toBeNull()
  })

  it('does not read site identity from theme group', async () => {
    mocks.getSettings.mockResolvedValueOnce({
      data: {
        theme: {
          site_name: { value: 'Legacy Theme Name', updated_at: '2026-01-01T00:00:00.000Z' },
          site_description: { value: 'Legacy Theme Description', updated_at: '2026-01-01T00:00:00.000Z' },
        },
      },
      error: null,
    })

    const { loadRuntimeThemeState } = await import('@/lib/theme-settings')
    const state = await loadRuntimeThemeState()

    expect(state.site.name).not.toBe('Legacy Theme Name')
    expect(state.site.description).not.toBe('Legacy Theme Description')
  })

  it('reads the fee wallet directly without blanking it on unrelated invalid site settings', async () => {
    const { getFeeRecipientWalletFormValue } = await import('@/lib/theme-settings')

    expect(
      getFeeRecipientWalletFormValue({
        general: {
          site_support_url: { value: 'notaurl', updated_at: '2026-01-01T00:00:00.000Z' },
          fee_recipient_wallet: {
            value: '0x1111111111111111111111111111111111111111',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
    ).toBe('0x1111111111111111111111111111111111111111')
  })

  it('keeps the fee wallet empty when no fee recipient override is stored', async () => {
    const { getFeeRecipientWalletFormValue } = await import('@/lib/theme-settings')

    expect(
      getFeeRecipientWalletFormValue({
        general: {
          site_support_url: { value: 'https://kuest.com/support', updated_at: '2026-01-01T00:00:00.000Z' },
        },
      }),
    ).toBe('')
  })
})
