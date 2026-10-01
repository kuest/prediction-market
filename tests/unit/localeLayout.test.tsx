import type { ReactElement, ReactNode } from 'react'

import { beforeEach, describe, expect, it, mock, jest } from 'bun:test'
import { Suspense } from 'react'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  deferPublicShellPrerenderIfNeeded: mock(),
  getPublicRuntimeConfig: mock(),
  loadEnabledLocales: mock(),
  loadGlobalAnnouncementSettings: mock(),
  loadRuntimeThemeState: mock(),
}))

void mock.module('next-intl', () => ({
  hasLocale: () => true,
  NextIntlClientProvider: 'next-intl-provider',
}))

void mock.module('next/cache', () => ({
  cacheLife: mock(),
  cacheTag: mock(),
}))

void mock.module('next/navigation', () => ({
  notFound: mock(),
}))

void mock.module('@/components/CustomJavascriptCode', () => ({ default: 'custom-javascript-code' }))
void mock.module('@/components/GlobalAnnouncementBanner', () => ({ default: 'global-announcement-banner' }))
void mock.module('@/components/PublicRuntimeConfigScript', () => ({ default: 'public-runtime-config-script' }))
void mock.module('@/components/PwaInstallStateSync', () => ({ default: 'pwa-install-state-sync' }))
void mock.module('@/components/PwaServiceWorker', () => ({ default: 'pwa-service-worker' }))
void mock.module('@/components/seo/SiteStructuredData', () => ({ default: 'site-structured-data' }))
void mock.module('@/components/TestModeBannerDeferred', () => ({ default: 'test-mode-banner' }))

void mock.module('@/i18n/locale-settings', () => ({
  loadEnabledLocales: (...args: unknown[]) => mocks.loadEnabledLocales(...args),
}))

void mock.module('@/lib/fonts', () => ({
  openSauceOne: { variable: 'font-open-sauce-one' },
}))

void mock.module('@/lib/global-announcement-settings', () => ({
  loadGlobalAnnouncementSettings: (...args: unknown[]) => mocks.loadGlobalAnnouncementSettings(...args),
}))

void mock.module('@/lib/public-runtime-config.server', () => ({
  getPublicRuntimeConfig: (...args: unknown[]) => mocks.getPublicRuntimeConfig(...args),
}))

void mock.module('@/lib/public-shell-rendering', () => ({
  deferPublicShellPrerenderIfNeeded: (...args: unknown[]) => mocks.deferPublicShellPrerenderIfNeeded(...args),
  shouldPrerenderPublicShell: () => false,
}))

void mock.module('@/lib/theme-settings', () => ({
  loadRuntimeThemeState: (...args: unknown[]) => mocks.loadRuntimeThemeState(...args),
}))

void mock.module('@/providers/AppProviders', () => ({ AppProviders: 'app-providers' }))
void mock.module('@/providers/PublicRuntimeConfigProvider', () => ({ default: 'public-runtime-config-provider' }))
void mock.module('@/providers/SiteIdentityProvider', () => ({ default: 'site-identity-provider' }))

describe('locale layout', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mocks.deferPublicShellPrerenderIfNeeded.mockResolvedValue(undefined)
    mocks.loadEnabledLocales.mockResolvedValue(['en'])
    mocks.loadRuntimeThemeState.mockResolvedValue({
      site: {
        customJavascriptCodes: [],
      },
      theme: {
        cssText: '',
        presetId: 'default',
      },
    })
    mocks.getPublicRuntimeConfig.mockReturnValue({})
    mocks.loadGlobalAnnouncementSettings.mockResolvedValue({
      disableFaucetBanner: false,
      disabledOn: [],
      linkUrl: null,
      message: '',
    })
  })

  it('returns a complete runtime body without a document-wide Suspense fallback', async () => {
    const { default: LocaleLayout, instant } = await import('@/app/[locale]/layout')
    const children = <main>Visible homepage</main>

    const layout = (await LocaleLayout({
      children,
      params: Promise.resolve({ locale: 'en' }),
    } as LayoutProps<'/[locale]'>)) as ReactElement
    const RuntimeLocaleDocument = layout.type as (props: typeof layout.props) => Promise<ReactElement>
    const document = (await RuntimeLocaleDocument(layout.props)) as ReactElement<{ children: ReactNode }>
    const body = document.props.children as ReactElement<{ children: ReactNode }>

    expect(instant).toBe(false)
    expect(document.type).toBe('html')
    expect(body.type).not.toBe(Suspense)
    expect(body.props.children).toBe(children)
    expect(mocks.deferPublicShellPrerenderIfNeeded).toHaveBeenCalledOnce()
    expect(mocks.loadRuntimeThemeState).toHaveBeenCalledOnce()
  })
})
