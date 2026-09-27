import { describe, expect, it } from 'bun:test'

import { getThemeSiteSettingsFormState, validateThemeSiteSettingsInput } from '@/lib/theme-settings'
import { createDefaultThemeSiteIdentity } from '@/lib/theme-site-identity'

function createValidationInput() {
  const defaults = createDefaultThemeSiteIdentity()

  return {
    siteName: defaults.name,
    siteDescription: defaults.description,
    logoMode: defaults.logoMode,
    logoSvg: defaults.logoSvg,
    logoImagePath: '',
    pwaIcon192Path: '',
    pwaIcon512Path: '',
    googleAnalyticsId: '',
    discordLink: '',
    twitterLink: '',
    facebookLink: '',
    instagramLink: '',
    tiktokLink: '',
    linkedinLink: '',
    youtubeLink: '',
    supportUrl: '',
    customJavascriptCodesJson: '',
    feeRecipientWallet: '',
    lifiIntegrator: '',
    lifiApiKey: '',
  }
}

describe('themeSettings social links', () => {
  it('normalizes new social link inputs through theme site validation', () => {
    const result = validateThemeSiteSettingsInput({
      ...createValidationInput(),
      twitterLink: 'x.com/kuest',
      facebookLink: 'facebook.com/kuest',
      instagramLink: 'instagram.com/kuest',
      tiktokLink: 'tiktok.com/@kuest',
      linkedinLink: 'linkedin.com/company/kuest',
      youtubeLink: 'youtube.com/@kuest',
      supportUrl: 'support@kuest.com',
      customJavascriptCodesJson: JSON.stringify([
        {
          name: 'Crisp',
          snippet: '<script>window.$crisp = [];</script>',
          disabledOn: ['admin'],
        },
      ]),
    })

    expect(result.error).toBeNull()
    expect(result.data?.twitterLinkValue).toBe('https://x.com/kuest')
    expect(result.data?.facebookLinkValue).toBe('https://facebook.com/kuest')
    expect(result.data?.instagramLinkValue).toBe('https://instagram.com/kuest')
    expect(result.data?.tiktokLinkValue).toBe('https://tiktok.com/@kuest')
    expect(result.data?.linkedinLinkValue).toBe('https://linkedin.com/company/kuest')
    expect(result.data?.youtubeLinkValue).toBe('https://youtube.com/@kuest')
    expect(result.data?.supportUrlValue).toBe('mailto:support@kuest.com')
    expect(result.data?.customJavascriptCodes).toEqual([
      {
        name: 'Crisp',
        snippet: '<script>window.$crisp = [];</script>',
        runOn: ['home', 'event', 'portfolio', 'settings', 'docs', 'other'],
      },
    ])
  })

  it('hydrates social links and support email from general settings', () => {
    const state = getThemeSiteSettingsFormState({
      general: {
        site_twitter_link: {
          value: 'x.com/kuest',
          updated_at: '2026-03-08T00:00:00.000Z',
        },
        site_facebook_link: {
          value: 'facebook.com/kuest',
          updated_at: '2026-03-08T00:00:00.000Z',
        },
        site_instagram_link: {
          value: 'instagram.com/kuest',
          updated_at: '2026-03-08T00:00:00.000Z',
        },
        site_tiktok_link: {
          value: 'tiktok.com/@kuest',
          updated_at: '2026-03-08T00:00:00.000Z',
        },
        site_linkedin_link: {
          value: 'linkedin.com/company/kuest',
          updated_at: '2026-03-08T00:00:00.000Z',
        },
        site_youtube_link: {
          value: 'youtube.com/@kuest',
          updated_at: '2026-03-08T00:00:00.000Z',
        },
        site_support_url: {
          value: 'support@kuest.com',
          updated_at: '2026-03-08T00:00:00.000Z',
        },
        site_custom_javascript_codes: {
          value: JSON.stringify([
            {
              name: 'Crisp',
              snippet: '<script>window.$crisp = [];</script>',
              disabledOn: ['portfolio'],
            },
          ]),
          updated_at: '2026-03-08T00:00:00.000Z',
        },
      },
    })

    expect(state.twitterLink).toBe('https://x.com/kuest')
    expect(state.facebookLink).toBe('https://facebook.com/kuest')
    expect(state.instagramLink).toBe('https://instagram.com/kuest')
    expect(state.tiktokLink).toBe('https://tiktok.com/@kuest')
    expect(state.linkedinLink).toBe('https://linkedin.com/company/kuest')
    expect(state.youtubeLink).toBe('https://youtube.com/@kuest')
    expect(state.supportUrl).toBe('mailto:support@kuest.com')
    expect(state.customJavascriptCodes).toEqual([
      {
        name: 'Crisp',
        snippet: '<script>window.$crisp = [];</script>',
        runOn: ['home', 'event', 'settings', 'docs', 'admin', 'other'],
      },
    ])
  })

  it('hydrates admin-visible integration and PWA fields from general settings', () => {
    const state = getThemeSiteSettingsFormState({
      general: {
        site_name: {
          value: 'Kuest',
          updated_at: '2026-03-08T00:00:00.000Z',
        },
        site_description: {
          value: 'Prediction markets',
          updated_at: '2026-03-08T00:00:00.000Z',
        },
        site_logo_mode: {
          value: 'svg',
          updated_at: '2026-03-08T00:00:00.000Z',
        },
        pwa_icon_192_path: {
          value: 'theme/pwa-192.png',
          updated_at: '2026-03-08T00:00:00.000Z',
        },
        pwa_icon_512_path: {
          value: 'theme/pwa-512.png',
          updated_at: '2026-03-08T00:00:00.000Z',
        },
        site_google_analytics: {
          value: 'G-ABC123',
          updated_at: '2026-03-08T00:00:00.000Z',
        },
        lifi_integrator: {
          value: 'kuest-prod',
          updated_at: '2026-03-08T00:00:00.000Z',
        },
        lifi_api_key: {
          value: 'enc.v1.lifi-key',
          updated_at: '2026-03-08T00:00:00.000Z',
        },
      },
    })

    expect(state.pwaIcon192Path).toBe('theme/pwa-192.png')
    expect(state.pwaIcon512Path).toBe('theme/pwa-512.png')
    expect(state.googleAnalyticsId).toBe('G-ABC123')
    expect(state.lifiIntegrator).toBe('kuest-prod')
    expect(state.lifiApiKey).toBe('')
    expect(state.lifiApiKeyConfigured).toBe(true)
  })
})
