import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  getSettings: mock(),
}))

void mock.module('@/lib/db/queries/settings', () => ({
  SettingsRepository: {
    getSettings: (...args: unknown[]) => mocks.getSettings(...args),
  },
}))

describe('locale settings for static generation', () => {
  beforeEach(() => {
    mocks.getSettings.mockReset()
  })

  it('returns enabled locales from settings in their configured order', async () => {
    mocks.getSettings.mockResolvedValue({
      data: {
        i18n: {
          enabled_locales: { value: '["de","pt"]', updated_at: '2026-10-10T00:00:00.000Z' },
          locale_order: { value: '["pt","de"]', updated_at: '2026-10-10T00:00:00.000Z' },
        },
      },
      error: null,
    })

    const { loadEnabledLocalesForStaticGeneration } = await import('@/i18n/locale-settings')

    await expect(loadEnabledLocalesForStaticGeneration()).resolves.toEqual(['en', 'pt', 'de'])
  })

  it('fails instead of falling back to every locale when settings query errors', async () => {
    mocks.getSettings.mockResolvedValue({ data: null, error: 'Failed to fetch settings.' })

    const { loadEnabledLocalesForStaticGeneration } = await import('@/i18n/locale-settings')

    await expect(loadEnabledLocalesForStaticGeneration()).rejects.toThrow(
      'Failed to load enabled locales for static generation: Failed to fetch settings.',
    )
  })

  it('fails when settings query returns no data without an error', async () => {
    mocks.getSettings.mockResolvedValue({ data: null, error: null })

    const { loadEnabledLocalesForStaticGeneration } = await import('@/i18n/locale-settings')

    await expect(loadEnabledLocalesForStaticGeneration()).rejects.toThrow(
      'Failed to load enabled locales for static generation: No settings data returned.',
    )
  })
})
