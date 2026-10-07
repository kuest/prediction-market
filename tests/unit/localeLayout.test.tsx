import type { ReactElement, ReactNode } from 'react'

import { beforeEach, describe, expect, it, mock, jest } from 'bun:test'
import { Suspense } from 'react'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  deferPublicShellPrerenderIfNeeded: mock(),
  getPublicRuntimeConfig: mock(),
  getRootLocale: mock(),
  loadEnabledLocales: mock(),
  loadGlobalAnnouncementSettings: mock(),
  loadRuntimeThemeState: mock(),
  notFound: mock(),
  shouldPrerenderPublicShell: mock(),
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
  notFound: (...args: unknown[]) => mocks.notFound(...args),
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

void mock.module('@/i18n/root-locale', () => ({
  getRootLocale: (...args: unknown[]) => mocks.getRootLocale(...args),
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
  shouldPrerenderPublicShell: () => mocks.shouldPrerenderPublicShell(),
}))

void mock.module('@/lib/theme-settings', () => ({
  loadRuntimeThemeState: (...args: unknown[]) => mocks.loadRuntimeThemeState(...args),
}))

void mock.module('@/providers/AppProviders', () => ({ AppProviders: 'app-providers' }))
void mock.module('@/providers/PublicRuntimeConfigProvider', () => ({ default: 'public-runtime-config-provider' }))
void mock.module('@/providers/SiteIdentityProvider', () => ({ default: 'site-identity-provider' }))

async function renderLocaleDocument(children: ReactNode) {
  const { default: LocaleLayout } = await import('@/app/[locale]/layout')
  const layout = (await LocaleLayout({
    children,
    params: Promise.resolve({ locale: 'en' }),
  } as LayoutProps<'/[locale]'>)) as ReactElement
  const LocaleDocument = layout.type as (props: typeof layout.props) => Promise<ReactElement>
  return (await LocaleDocument(layout.props)) as ReactElement<{
    children: ReactElement<{
      children: ReactNode
      publicRuntimeConfig: Record<string, unknown>
      syncRootPreset: boolean
      hasGlobalAnnouncement: boolean
      globalAnnouncement: Record<string, unknown>
    }>
    'data-theme-preset'?: string
    lang: string
    dir: string
  }>
}

describe('locale layout', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mocks.deferPublicShellPrerenderIfNeeded.mockResolvedValue(undefined)
    mocks.getRootLocale.mockResolvedValue('en')
    mocks.shouldPrerenderPublicShell.mockReturnValue(false)
    mocks.notFound.mockImplementation(() => {
      throw new Error('NEXT_NOT_FOUND')
    })
    mocks.loadEnabledLocales.mockResolvedValue(['en'])
    mocks.loadRuntimeThemeState.mockResolvedValue({
      cacheable: true,
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
    const children = <main>Visible homepage</main>
    const document = await renderLocaleDocument(children)
    const body = document.props.children

    expect(document.type).toBe('html')
    expect(body.type).not.toBe(Suspense)
    expect(body.props.children).toBe(children)
    expect(body.props.syncRootPreset).toBe(true)
    expect(mocks.deferPublicShellPrerenderIfNeeded).toHaveBeenCalledOnce()
    expect(mocks.loadRuntimeThemeState).toHaveBeenCalledOnce()
  })

  it('prerenders a complete document and theme preset without runtime deferral', async () => {
    mocks.shouldPrerenderPublicShell.mockReturnValue(true)
    const children = <main>Visible docs</main>

    const document = await renderLocaleDocument(children)

    expect(document.props['data-theme-preset']).toBe('default')
    expect(document.props.children.props.children).toBe(children)
    expect(document.props.children.props.syncRootPreset).toBe(false)
    expect(mocks.deferPublicShellPrerenderIfNeeded).not.toHaveBeenCalled()
  })

  it('waits for runtime before reading startup configuration and public settings', async () => {
    const runtime = Promise.withResolvers<void>()
    mocks.deferPublicShellPrerenderIfNeeded.mockReturnValue(runtime.promise)
    const { default: LocaleLayout } = await import('@/app/[locale]/layout')
    const layout = (await LocaleLayout({
      children: <main>Visible homepage</main>,
      params: Promise.resolve({ locale: 'en' }),
    } as LayoutProps<'/[locale]'>)) as ReactElement
    const RuntimeLocaleDocument = layout.type as (props: typeof layout.props) => Promise<ReactElement>
    const document = RuntimeLocaleDocument(layout.props)

    expect(mocks.deferPublicShellPrerenderIfNeeded).toHaveBeenCalledOnce()
    expect(mocks.getPublicRuntimeConfig).not.toHaveBeenCalled()
    expect(mocks.loadEnabledLocales).not.toHaveBeenCalled()

    runtime.resolve()
    await document

    expect(mocks.getPublicRuntimeConfig).toHaveBeenCalledOnce()
    expect(mocks.loadEnabledLocales).toHaveBeenCalledOnce()
  })

  it('reads the current startup configuration separately from shared public data', async () => {
    mocks.getPublicRuntimeConfig.mockResolvedValueOnce({ siteUrl: 'https://first.example' })
    mocks.getPublicRuntimeConfig.mockResolvedValueOnce({ siteUrl: 'https://second.example' })

    const first = await renderLocaleDocument(<main>Visible homepage</main>)
    const second = await renderLocaleDocument(<main>Visible homepage</main>)

    expect(first.props.children.props.publicRuntimeConfig.siteUrl).toBe('https://first.example')
    expect(second.props.children.props.publicRuntimeConfig.siteUrl).toBe('https://second.example')
  })

  it('rejects disabled locales before loading their public settings', async () => {
    mocks.loadEnabledLocales.mockResolvedValue(['pt'])

    await expect(renderLocaleDocument(<main>Hidden docs</main>)).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mocks.loadRuntimeThemeState).not.toHaveBeenCalled()
    expect(mocks.loadGlobalAnnouncementSettings).not.toHaveBeenCalled()
  })

  it('preserves right-to-left locale and announcement data in the document', async () => {
    mocks.getRootLocale.mockResolvedValue('ar')
    mocks.loadEnabledLocales.mockResolvedValue(['en', 'ar'])
    const globalAnnouncement = {
      disableFaucetBanner: true,
      disabledOn: ['docs'],
      linkUrl: '/event/example',
      message: 'Announcement',
    }
    mocks.loadGlobalAnnouncementSettings.mockResolvedValue(globalAnnouncement)

    const document = await renderLocaleDocument(<main>Visible docs</main>)

    expect(document.props.lang).toBe('ar')
    expect(document.props.dir).toBe('rtl')
    expect(document.props.children.props.hasGlobalAnnouncement).toBe(true)
    expect(document.props.children.props.globalAnnouncement).toBe(globalAnnouncement)
  })
})
