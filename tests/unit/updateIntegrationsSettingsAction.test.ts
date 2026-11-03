import { afterEach, beforeEach, describe, expect, it, mock, jest } from 'bun:test'
import * as actualNextCache from 'next/cache'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  getCurrentUser: mock(),
  getSettings: mock(),
  updateSettings: mock(),
  requestHeaders: mock(),
  revalidatePath: mock(),
  updateTag: mock(),
  requestPaymentsOperatorChallenge: mock(),
  verifyPaymentsOperatorDomain: mock(),
}))

void mock.module('next/headers', () => ({ headers: mocks.requestHeaders }))

void mock.module('next/cache', () => ({
  ...actualNextCache,
  revalidatePath: mocks.revalidatePath,
  updateTag: mocks.updateTag,
}))

void mock.module('@/lib/db/queries/user', () => ({
  UserRepository: { getCurrentUser: mocks.getCurrentUser },
}))

void mock.module('@/lib/db/queries/settings', () => ({
  SettingsRepository: {
    getSettings: mocks.getSettings,
    updateSettings: mocks.updateSettings,
  },
}))

void mock.module('@/lib/payments/worker', () => ({
  PaymentsOperatorProvisioningError: class PaymentsOperatorProvisioningError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  },
  requestPaymentsOperatorChallenge: mocks.requestPaymentsOperatorChallenge,
  verifyPaymentsOperatorDomain: mocks.verifyPaymentsOperatorDomain,
}))

void mock.module('@/lib/encryption', () => ({
  decryptSecret: (value: string) => (value.startsWith('encrypted:') ? value.slice('encrypted:'.length) : ''),
  encryptSecret: (value: string) => `encrypted:${value}`,
}))

function formData() {
  const data = new FormData()
  data.set('google_analytics_id', 'G-ABC123')
  data.set('openrouter_api_key', 'openrouter-key')
  data.set('openrouter_model', 'model-1')
  data.set('openrouter_translation_model', 'translation-model-1')
  data.set('openrouter_decision_model', 'typesafe/jev-1.13')
  data.set('sports_thesportsdb_api_key', 'sports-key')
  data.set('sports_pandascore_token', 'panda-token')
  data.set('lifi_integrator', 'kuest')
  data.set('lifi_api_key', 'lifi-key')
  data.set('custom_javascript_codes_json', '')
  data.set('arbitrage_enabled', 'true')
  data.set('arbitrage_multi_wallet_enabled', 'false')
  data.set('kuest_support_enabled', 'true')
  data.set('kuest_support_position', 'left')
  data.set('sumsub_enabled', 'false')
  data.set('sumsub_enforcement', 'disabled')
  data.set('sumsub_level_name', '')
  data.set('sumsub_app_token', '')
  data.set('sumsub_secret_key', '')
  data.set('sumsub_webhook_secret', '')
  data.set('payments_enabled', 'false')
  data.set('payments_enabled_changed', 'false')
  return data
}

describe('updateIntegrationsSettingsAction', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mocks.getCurrentUser.mockResolvedValue({ id: 'admin-1', is_admin: true })
    mocks.getSettings.mockResolvedValue({ data: {}, error: null })
    mocks.updateSettings.mockResolvedValue({ data: [], error: null })
    mocks.requestPaymentsOperatorChallenge.mockResolvedValue({
      challengeId: 'I'.repeat(22),
      challenge: 'C'.repeat(43),
      expiresAt: Date.now() + 5 * 60 * 1000,
    })
    mocks.verifyPaymentsOperatorDomain.mockResolvedValue('K'.repeat(43))
    mocks.requestHeaders.mockResolvedValue(new Headers({ host: 'fork-example.com', 'x-forwarded-proto': 'https' }))
  })

  it('rejects non-admin users without reading or writing settings', async () => {
    mocks.getCurrentUser.mockResolvedValue(null)
    const { updateIntegrationsSettingsAction } =
      await import('@/app/[locale]/admin/integrations/_actions/update-integrations-settings')

    await expect(updateIntegrationsSettingsAction({ error: null }, formData())).resolves.toEqual({
      error: 'Unauthenticated.',
    })
    expect(mocks.getSettings).not.toHaveBeenCalled()
    expect(mocks.updateSettings).not.toHaveBeenCalled()
  })

  it('updates only settings owned by the Integrations page', async () => {
    const { updateIntegrationsSettingsAction } =
      await import('@/app/[locale]/admin/integrations/_actions/update-integrations-settings')

    await expect(updateIntegrationsSettingsAction({ error: null }, formData())).resolves.toEqual({ error: null })

    const rows = mocks.updateSettings.mock.calls[0]?.[0] as Array<{ group: string; key: string; value: string }>
    expect(rows).toEqual(
      expect.arrayContaining([
        { group: 'general', key: 'site_google_analytics', value: 'G-ABC123' },
        { group: 'general', key: 'lifi_api_key', value: 'encrypted:lifi-key' },
        { group: 'ai', key: 'openrouter_api_key', value: 'encrypted:openrouter-key' },
        { group: 'ai', key: 'openrouter_translation_model', value: 'translation-model-1' },
        { group: 'ai', key: 'openrouter_decision_model', value: 'typesafe/jev-1.13' },
        { group: 'ai', key: 'sports_thesportsdb_api_key', value: 'encrypted:sports-key' },
        { group: 'ai', key: 'sports_pandascore_token', value: 'encrypted:panda-token' },
        { group: 'integrations', key: 'arbitrage_enabled', value: 'true' },
        { group: 'integrations', key: 'kuest_support_enabled', value: 'true' },
        { group: 'integrations', key: 'kuest_support_position', value: 'left' },
        { group: 'integrations', key: 'sumsub_enforcement', value: 'disabled' },
        { group: 'payments', key: 'operator_key', value: '' },
        { group: 'payments', key: 'operator_domain_challenge', value: '' },
        { group: 'payments', key: 'on_off_ramp_enabled', value: 'false' },
      ]),
    )
    expect(
      rows.some((row) =>
        [
          'site_name',
          'site_description',
          'site_logo_mode',
          'site_discord_link',
          'global_announcement_message',
        ].includes(row.key),
      ),
    ).toBe(false)
    expect(mocks.updateTag).toHaveBeenCalledWith('settings')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/[locale]/admin/integrations', 'page')
  })

  it('preserves configured secrets when their fields stay blank', async () => {
    mocks.getSettings.mockResolvedValue({
      data: {
        general: { lifi_api_key: { value: 'encrypted:old-lifi' } },
        ai: {
          openrouter_api_key: { value: 'encrypted:old-openrouter' },
          sports_thesportsdb_api_key: { value: 'encrypted:old-sports' },
          sports_pandascore_token: { value: 'encrypted:old-panda' },
        },
        integrations: {
          sumsub_app_token: { value: 'encrypted:old-sumsub-app-token' },
          sumsub_secret_key: { value: 'encrypted:old-sumsub-secret-key' },
          sumsub_webhook_secret: { value: 'encrypted:old-sumsub-webhook-secret' },
        },
        payments: {
          operator_key: { value: `encrypted:${'K'.repeat(43)}` },
          on_off_ramp_enabled: { value: 'true' },
        },
      },
      error: null,
    })
    const data = formData()
    data.set('lifi_api_key', '')
    data.set('openrouter_api_key', '')
    data.set('sports_thesportsdb_api_key', '')
    data.set('sports_pandascore_token', '')
    const { updateIntegrationsSettingsAction } =
      await import('@/app/[locale]/admin/integrations/_actions/update-integrations-settings')

    await updateIntegrationsSettingsAction({ error: null }, data)

    const rows = mocks.updateSettings.mock.calls[0]?.[0] as Array<{ key: string; value: string }>
    expect(rows.find((row) => row.key === 'lifi_api_key')?.value).toBe('encrypted:old-lifi')
    expect(rows.find((row) => row.key === 'openrouter_api_key')?.value).toBe('encrypted:old-openrouter')
    expect(rows.find((row) => row.key === 'sports_thesportsdb_api_key')?.value).toBe('encrypted:old-sports')
    expect(rows.find((row) => row.key === 'sports_pandascore_token')?.value).toBe('encrypted:old-panda')
    expect(rows.find((row) => row.key === 'sumsub_app_token')?.value).toBe('encrypted:old-sumsub-app-token')
    expect(rows.find((row) => row.key === 'sumsub_secret_key')?.value).toBe('encrypted:old-sumsub-secret-key')
    expect(rows.find((row) => row.key === 'sumsub_webhook_secret')?.value).toBe('encrypted:old-sumsub-webhook-secret')
    expect(rows.find((row) => row.key === 'operator_key')?.value).toBe(`encrypted:${'K'.repeat(43)}`)
    expect(rows.find((row) => row.key === 'on_off_ramp_enabled')?.value).toBe('true')
  })

  it('preserves Kuest Support settings submitted by an older open form', async () => {
    mocks.getSettings.mockResolvedValue({
      data: {
        integrations: {
          kuest_support_enabled: { value: 'false' },
          kuest_support_position: { value: 'left' },
        },
      },
      error: null,
    })
    const data = formData()
    data.delete('kuest_support_enabled')
    data.delete('kuest_support_position')
    const { updateIntegrationsSettingsAction } =
      await import('@/app/[locale]/admin/integrations/_actions/update-integrations-settings')

    await expect(updateIntegrationsSettingsAction({ error: null }, data)).resolves.toEqual({ error: null })

    const rows = mocks.updateSettings.mock.calls[0]?.[0] as Array<{ key: string; value: string }>
    expect(rows.find((row) => row.key === 'kuest_support_enabled')?.value).toBe('false')
    expect(rows.find((row) => row.key === 'kuest_support_position')?.value).toBe('left')
  })

  it('preserves the configured Decision model when an older form omits the field', async () => {
    mocks.getSettings.mockResolvedValue({
      data: {
        ai: {
          openrouter_decision_model: { value: 'typesafe/jev-1.13' },
        },
      },
      error: null,
    })
    const data = formData()
    data.delete('openrouter_decision_model')
    const { updateIntegrationsSettingsAction } =
      await import('@/app/[locale]/admin/integrations/_actions/update-integrations-settings')

    await expect(updateIntegrationsSettingsAction({ error: null }, data)).resolves.toEqual({ error: null })

    const rows = mocks.updateSettings.mock.calls[0]?.[0] as Array<{ key: string; value: string }>
    expect(rows.some((row) => row.key === 'openrouter_decision_model')).toBe(false)
  })

  it('preserves enabled payments on an unrelated save when the request domain changed', async () => {
    mocks.getSettings.mockResolvedValue({
      data: {
        payments: {
          operator_key: { value: `encrypted:${'K'.repeat(43)}` },
          operator_domain: { value: 'old-example.com' },
          on_off_ramp_enabled: { value: 'true' },
        },
      },
      error: null,
    })
    mocks.requestHeaders.mockResolvedValue(new Headers({ host: 'fork-example.com' }))
    const { updateIntegrationsSettingsAction } =
      await import('@/app/[locale]/admin/integrations/_actions/update-integrations-settings')

    await expect(updateIntegrationsSettingsAction({ error: null }, formData())).resolves.toEqual({ error: null })

    const rows = mocks.updateSettings.mock.calls[0]?.[0] as Array<{ group: string; key: string; value: string }>
    expect(rows.find((row) => row.group === 'payments' && row.key === 'on_off_ramp_enabled')?.value).toBe('true')
    expect(rows.find((row) => row.group === 'payments' && row.key === 'operator_domain')?.value).toBe('old-example.com')
    expect(mocks.requestHeaders).not.toHaveBeenCalled()
    expect(mocks.requestPaymentsOperatorChallenge).not.toHaveBeenCalled()
    expect(mocks.verifyPaymentsOperatorDomain).not.toHaveBeenCalled()
  })

  it('allows an explicit payments switch change to disable payments', async () => {
    mocks.getSettings.mockResolvedValue({
      data: {
        payments: {
          operator_key: { value: `encrypted:${'K'.repeat(43)}` },
          operator_domain: { value: 'old-example.com' },
          on_off_ramp_enabled: { value: 'true' },
        },
      },
      error: null,
    })
    const data = formData()
    data.set('payments_enabled', 'false')
    data.set('payments_enabled_changed', 'true')
    const { updateIntegrationsSettingsAction } =
      await import('@/app/[locale]/admin/integrations/_actions/update-integrations-settings')

    await expect(updateIntegrationsSettingsAction({ error: null }, data)).resolves.toEqual({ error: null })

    const rows = mocks.updateSettings.mock.calls[0]?.[0] as Array<{ group: string; key: string; value: string }>
    expect(rows.find((row) => row.group === 'payments' && row.key === 'on_off_ramp_enabled')?.value).toBe('false')
    expect(mocks.requestPaymentsOperatorChallenge).not.toHaveBeenCalled()
  })

  it('preserves enabled payments when the administrator explicitly submits a domain migration', async () => {
    const currentOperatorKey = 'O'.repeat(43)
    mocks.getSettings.mockResolvedValue({
      data: {
        payments: {
          operator_key: { value: `encrypted:${currentOperatorKey}` },
          operator_domain: { value: 'old-example.com' },
          on_off_ramp_enabled: { value: 'true' },
        },
      },
      error: null,
    })
    const data = formData()
    data.set('payments_reissue_operator_key', 'true')
    const { updateIntegrationsSettingsAction } =
      await import('@/app/[locale]/admin/integrations/_actions/update-integrations-settings')

    await expect(updateIntegrationsSettingsAction({ error: null }, data)).resolves.toEqual({ error: null })

    expect(mocks.verifyPaymentsOperatorDomain).toHaveBeenCalledWith(
      'fork-example.com',
      'I'.repeat(22),
      'C'.repeat(43),
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      currentOperatorKey,
    )
    const savedRows = mocks.updateSettings.mock.calls[1]?.[0] as Array<{ group: string; key: string; value: string }>
    expect(savedRows.find((row) => row.group === 'payments' && row.key === 'operator_domain')?.value).toBe(
      'fork-example.com',
    )
    expect(savedRows.find((row) => row.group === 'payments' && row.key === 'on_off_ramp_enabled')?.value).toBe('true')
  })

  it('verifies the canonical domain and stores the issued key without returning it', async () => {
    const data = formData()
    data.set('payments_enabled', 'true')
    data.set('payments_enabled_changed', 'true')
    const { updateIntegrationsSettingsAction } =
      await import('@/app/[locale]/admin/integrations/_actions/update-integrations-settings')

    const result = await updateIntegrationsSettingsAction({ error: null }, data)
    expect(result).toEqual({ error: null })

    expect(mocks.requestPaymentsOperatorChallenge).toHaveBeenCalledWith(
      'fork-example.com',
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
    )
    expect(mocks.verifyPaymentsOperatorDomain).toHaveBeenCalledWith(
      'fork-example.com',
      'I'.repeat(22),
      'C'.repeat(43),
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      undefined,
    )
    expect(mocks.updateSettings).toHaveBeenCalledTimes(2)
    const challengeRows = mocks.updateSettings.mock.calls[0]?.[0] as Array<{ key: string; value: string }>
    const storedChallenge = challengeRows.find(
      (row) => row.key === `operator_domain_challenge:${'I'.repeat(22)}`,
    )?.value
    expect(storedChallenge).toContain('encrypted:')
    expect(storedChallenge).not.toContain('K'.repeat(43))
    const savedRows = mocks.updateSettings.mock.calls[1]?.[0] as Array<{ group: string; key: string; value: string }>
    expect(savedRows.find((row) => row.group === 'payments' && row.key === 'operator_key')?.value).toBe(
      `encrypted:${'K'.repeat(43)}`,
    )
    expect(savedRows.find((row) => row.group === 'payments' && row.key === 'on_off_ramp_enabled')?.value).toBe('true')
    expect(JSON.stringify(result)).not.toContain('K'.repeat(43))
  })

  it('proves the new domain with the existing key and preserves the operator during migration', async () => {
    const currentOperatorKey = 'O'.repeat(43)
    mocks.getSettings.mockResolvedValue({
      data: {
        payments: {
          operator_key: { value: `encrypted:${currentOperatorKey}` },
          operator_domain: { value: 'old-example.com' },
          on_off_ramp_enabled: { value: 'true' },
        },
      },
      error: null,
    })
    const data = formData()
    data.set('payments_enabled', 'true')
    data.set('payments_enabled_changed', 'true')
    const { updateIntegrationsSettingsAction } =
      await import('@/app/[locale]/admin/integrations/_actions/update-integrations-settings')

    await expect(updateIntegrationsSettingsAction({ error: null }, data)).resolves.toEqual({ error: null })

    expect(mocks.verifyPaymentsOperatorDomain).toHaveBeenCalledWith(
      'fork-example.com',
      'I'.repeat(22),
      'C'.repeat(43),
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      currentOperatorKey,
    )
    const savedRows = mocks.updateSettings.mock.calls[1]?.[0] as Array<{ group: string; key: string; value: string }>
    expect(savedRows.find((row) => row.group === 'payments' && row.key === 'operator_domain')?.value).toBe(
      'fork-example.com',
    )
    expect(savedRows.find((row) => row.group === 'payments' && row.key === 'operator_key')?.value).toBe(
      `encrypted:${'K'.repeat(43)}`,
    )
  })

  it('preserves the Payments domain rejection without saving an enabled integration', async () => {
    mocks.requestHeaders.mockResolvedValue(new Headers({ host: 'fork.vercel.app', 'x-forwarded-proto': 'https' }))
    const { PaymentsOperatorProvisioningError } = await import('@/lib/payments/worker')
    mocks.requestPaymentsOperatorChallenge.mockRejectedValueOnce(
      new PaymentsOperatorProvisioningError('payments_site_url_invalid'),
    )
    const data = formData()
    data.set('payments_enabled', 'true')
    data.set('payments_enabled_changed', 'true')
    const { updateIntegrationsSettingsAction } =
      await import('@/app/[locale]/admin/integrations/_actions/update-integrations-settings')

    await expect(updateIntegrationsSettingsAction({ error: null }, data)).resolves.toEqual({
      error: 'payments_site_url_invalid',
    })
    expect(mocks.requestPaymentsOperatorChallenge).toHaveBeenCalledWith('fork.vercel.app', expect.any(String))
    expect(mocks.verifyPaymentsOperatorDomain).not.toHaveBeenCalled()
    expect(mocks.updateSettings).not.toHaveBeenCalled()
  })

  it('fails clearly when the site domain changed and the operator key is missing', async () => {
    mocks.getSettings.mockResolvedValue({
      data: {
        payments: {
          operator_domain: { value: 'old-example.com' },
          on_off_ramp_enabled: { value: 'true' },
        },
      },
      error: null,
    })
    const data = formData()
    data.set('payments_enabled', 'true')
    data.set('payments_enabled_changed', 'true')
    const { updateIntegrationsSettingsAction } =
      await import('@/app/[locale]/admin/integrations/_actions/update-integrations-settings')

    await expect(updateIntegrationsSettingsAction({ error: null }, data)).resolves.toEqual({
      error: 'payments_operator_domain_change_key_missing',
    })
    expect(mocks.requestPaymentsOperatorChallenge).not.toHaveBeenCalled()
    expect(mocks.verifyPaymentsOperatorDomain).not.toHaveBeenCalled()
    expect(mocks.updateSettings).not.toHaveBeenCalled()
  })
})

const originalPaymentsOperatorKey = process.env.PAYMENTS_OPERATOR_KEY
describe('getPaymentsOperatorKey', () => {
  beforeEach(() => {
    mocks.getSettings.mockReset()
    delete process.env.PAYMENTS_OPERATOR_KEY
  })

  afterEach(() => {
    if (originalPaymentsOperatorKey === undefined) {
      delete process.env.PAYMENTS_OPERATOR_KEY
    } else {
      process.env.PAYMENTS_OPERATOR_KEY = originalPaymentsOperatorKey
    }
  })

  it('requires explicit enablement even when an environment key exists', async () => {
    process.env.PAYMENTS_OPERATOR_KEY = 'environment-operator-key'
    mocks.getSettings.mockResolvedValue({
      data: { payments: { operator_key: { value: '' } } },
      error: null,
    })
    const { getPaymentsOperatorKey } = await import('@/lib/payments/operator-key')

    await expect(getPaymentsOperatorKey('fork-example.com')).resolves.toBeNull()
  })

  it('uses only a valid encrypted key stored in settings', async () => {
    const storedKey = 'S'.repeat(43)
    mocks.getSettings.mockResolvedValue({
      data: {
        payments: {
          on_off_ramp_enabled: { value: 'true' },
          operator_key: { value: `encrypted:${storedKey}` },
          operator_domain: { value: 'fork-example.com' },
        },
      },
      error: null,
    })
    const { getPaymentsOperatorKey } = await import('@/lib/payments/operator-key')

    await expect(getPaymentsOperatorKey('fork-example.com')).resolves.toBe(storedKey)
  })

  it('does not use the operator key when the request host changes', async () => {
    const storedKey = 'S'.repeat(43)
    mocks.getSettings.mockResolvedValue({
      data: {
        payments: {
          on_off_ramp_enabled: { value: 'true' },
          operator_key: { value: `encrypted:${storedKey}` },
          operator_domain: { value: 'fork-example.com' },
        },
      },
      error: null,
    })
    const { getPaymentsOperatorKey } = await import('@/lib/payments/operator-key')

    await expect(getPaymentsOperatorKey('new-fork-example.com')).resolves.toBeNull()
  })

  it('fails closed when integration settings cannot be loaded', async () => {
    mocks.getSettings.mockResolvedValue({
      data: { payments: { on_off_ramp_enabled: { value: 'true' }, operator_key: { value: 'encrypted:key' } } },
      error: 'Failed to fetch settings.',
    })
    const { getPaymentsOperatorKey } = await import('@/lib/payments/operator-key')

    await expect(getPaymentsOperatorKey('fork-example.com')).resolves.toBeNull()
  })
})

describe('getPaymentsCanonicalDomain', () => {
  it.each(['example.com', 'app.example.com', 'preview.app.example.com'])(
    'canonicalizes the request domain %s over HTTPS',
    async (host) => {
      const { getPaymentsCanonicalDomain } = await import('@/lib/payments/operator-key')

      expect(getPaymentsCanonicalDomain(new Headers({ host, 'x-forwarded-proto': 'https' }))).toBe(host)
    },
  )

  it('uses the request host and ignores an untrusted forwarded host', async () => {
    const { getPaymentsCanonicalDomain } = await import('@/lib/payments/operator-key')
    const requestHeaders = new Headers({
      host: 'Fork-Example.com',
      'x-forwarded-host': 'attacker-example.com',
      'x-forwarded-proto': 'https',
    })

    expect(getPaymentsCanonicalDomain(requestHeaders)).toBe('fork-example.com')
  })

  it('uses the request host when the hosting platform omits the forwarded protocol', async () => {
    const { getPaymentsCanonicalDomain } = await import('@/lib/payments/operator-key')

    expect(getPaymentsCanonicalDomain(new Headers({ host: 'fork-example.com' }))).toBe('fork-example.com')
  })

  it('normalizes the final DNS dot before validation and returning the canonical domain', async () => {
    const { getPaymentsCanonicalDomain } = await import('@/lib/payments/operator-key')

    expect(getPaymentsCanonicalDomain(new Headers({ host: 'Fork-Example.com.' }))).toBe('fork-example.com')
    expect(getPaymentsCanonicalDomain(new Headers({ host: 'fork.vercel.app.' }))).toBe('fork.vercel.app')
    expect(getPaymentsCanonicalDomain(new Headers({ host: 'fork-example.com..' }))).toBeNull()
  })

  it('rejects insecure, ambiguous, and malformed request authorities', async () => {
    const { getPaymentsCanonicalDomain } = await import('@/lib/payments/operator-key')

    expect(
      getPaymentsCanonicalDomain(new Headers({ host: 'fork-example.com', 'x-forwarded-proto': 'http' })),
    ).toBeNull()
    expect(
      getPaymentsCanonicalDomain(new Headers({ host: 'fork-example.com', 'x-forwarded-proto': 'https,http' })),
    ).toBeNull()
    expect(getPaymentsCanonicalDomain(new Headers({ host: 'fork-example.com,attacker-example.com' }))).toBeNull()
    expect(
      getPaymentsCanonicalDomain(new Headers({ host: 'fork-example.com:8443', 'x-forwarded-proto': 'https' })),
    ).toBeNull()
  })
})
