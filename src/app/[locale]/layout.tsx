import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import { NextIntlClientProvider } from 'next-intl'
import { cacheLife, cacheTag } from 'next/cache'
import { notFound } from 'next/navigation'

import type { SupportedLocale } from '@/i18n/locales'
import type { RuntimeThemeState } from '@/lib/theme-settings'

import CustomJavascriptCode from '@/components/CustomJavascriptCode'
import GlobalAnnouncementBanner from '@/components/GlobalAnnouncementBanner'
import PublicRuntimeConfigScript from '@/components/PublicRuntimeConfigScript'
import PwaInstallStateSync from '@/components/PwaInstallStateSync'
import PwaServiceWorker from '@/components/PwaServiceWorker'
import SiteStructuredData from '@/components/seo/SiteStructuredData'
import TestModeBannerDeferred from '@/components/TestModeBannerDeferred'
import { loadEnabledLocales } from '@/i18n/locale-settings'
import { getRootLocale } from '@/i18n/root-locale'
import { cacheTags } from '@/lib/cache-tags'
import { openSauceOne } from '@/lib/fonts'
import { loadGlobalAnnouncementSettings } from '@/lib/global-announcement-settings'
import { IS_TEST_MODE } from '@/lib/network'
import { getPublicRuntimeConfig } from '@/lib/public-runtime-config.server'
import { deferPublicShellPrerenderIfNeeded, shouldPrerenderPublicShell } from '@/lib/public-shell-rendering'
import { resolvePwaThemeColors } from '@/lib/pwa-colors'
import resolveSiteUrl from '@/lib/site-url'
import { loadRuntimeThemeState } from '@/lib/theme-settings'
import { AppProviders } from '@/providers/AppProviders'
import PublicRuntimeConfigProvider from '@/providers/PublicRuntimeConfigProvider'
import SiteIdentityProvider from '@/providers/SiteIdentityProvider'

import '../globals.css'

// Startup configuration keeps the initial document dynamic; child routes can validate their own navigations.
export const instant = false

export async function generateViewport(): Promise<Viewport> {
  'use cache'
  cacheTag(cacheTags.settings)

  const runtimeTheme = await loadRuntimeThemeState()
  if (runtimeTheme.cacheable) {
    cacheLife('max')
  } else {
    cacheLife('default')
  }
  const { lightSurface, darkSurface } = resolvePwaThemeColors(runtimeTheme.theme)

  return {
    themeColor: [
      { media: '(prefers-color-scheme: light)', color: lightSurface },
      { media: '(prefers-color-scheme: dark)', color: darkSurface },
    ],
  }
}

export async function generateMetadata(): Promise<Metadata> {
  'use cache'
  cacheTag(cacheTags.settings)

  const runtimeTheme = await loadRuntimeThemeState()
  if (runtimeTheme.cacheable) {
    cacheLife('max')
  } else {
    cacheLife('default')
  }
  const site = runtimeTheme.site
  const siteUrl = resolveSiteUrl(process.env)
  const defaultTitle = `${site.name} | ${site.description}`
  const fallbackOgImage = new URL('/api/og', siteUrl).toString()
  const socialImage = {
    url: fallbackOgImage,
    width: 1200,
    height: 630,
    alt: `${site.name} social image`,
    type: 'image/png',
  } as const

  return {
    title: {
      template: `%s | ${site.name}`,
      default: defaultTitle,
    },
    description: site.description,
    applicationName: site.name,
    openGraph: {
      type: 'website',
      title: defaultTitle,
      description: site.description,
      siteName: site.name,
      images: [socialImage],
    },
    twitter: {
      card: 'summary_large_image',
      title: defaultTitle,
      description: site.description,
      images: [socialImage],
    },
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      capable: true,
      title: site.name,
      statusBarStyle: 'default',
    },
    icons: {
      icon: [
        { url: site.pwaIcon192Url, sizes: '192x192', type: 'image/png' },
        { url: site.pwaIcon512Url, sizes: '512x512', type: 'image/png' },
        { url: site.logoUrl },
      ],
      apple: [{ url: site.appleTouchIconUrl, sizes: '180x180', type: 'image/png' }],
      shortcut: [site.pwaIcon192Url],
    },
  }
}

export async function generateStaticParams() {
  return [{ locale: 'en' }]
}

interface LocaleDocumentProps {
  children: ReactNode
}

interface LocaleBodyProps extends LocaleDocumentProps {
  locale: SupportedLocale
  publicRuntimeConfig: Awaited<ReturnType<typeof getPublicRuntimeConfig>>
}

interface LocalePublicData {
  globalAnnouncement: Awaited<ReturnType<typeof loadGlobalAnnouncementSettings>>
  hasGlobalAnnouncement: boolean
  runtimeTheme: RuntimeThemeState
}

async function loadLocalePublicData(locale: SupportedLocale): Promise<LocalePublicData> {
  'use cache'
  cacheTag(cacheTags.settings)

  const enabledLocales = await loadEnabledLocales()
  if (!enabledLocales.includes(locale)) {
    notFound()
  }

  const [runtimeTheme, globalAnnouncement] = await Promise.all([
    loadRuntimeThemeState(),
    loadGlobalAnnouncementSettings(),
  ])
  cacheLife(runtimeTheme.cacheable ? 'max' : 'default')
  const hasGlobalAnnouncement = globalAnnouncement.message.trim().length > 0

  return {
    globalAnnouncement,
    hasGlobalAnnouncement,
    runtimeTheme,
  }
}

function ThemeDocumentState({
  runtimeTheme,
  syncRootPreset,
}: {
  runtimeTheme: RuntimeThemeState
  syncRootPreset: boolean
}) {
  const setPresetScript = `document.documentElement.setAttribute('data-theme-preset',${JSON.stringify(runtimeTheme.theme.presetId)});`

  return (
    <>
      {syncRootPreset && <script id="theme-preset-sync" dangerouslySetInnerHTML={{ __html: setPresetScript }} />}
      {runtimeTheme.theme.cssText && (
        <style id="theme-vars" dangerouslySetInnerHTML={{ __html: runtimeTheme.theme.cssText }} />
      )}
    </>
  )
}

function LocaleBody({
  children,
  globalAnnouncement,
  hasGlobalAnnouncement,
  locale,
  publicRuntimeConfig,
  runtimeTheme,
  syncRootPreset,
}: LocaleBodyProps & LocalePublicData & { syncRootPreset: boolean }) {
  return (
    <body className="flex min-h-screen flex-col font-sans">
      <PublicRuntimeConfigScript config={publicRuntimeConfig} />
      <ThemeDocumentState runtimeTheme={runtimeTheme} syncRootPreset={syncRootPreset} />
      <SiteStructuredData site={runtimeTheme.site} />
      <PwaServiceWorker />
      <PublicRuntimeConfigProvider config={publicRuntimeConfig}>
        <SiteIdentityProvider site={runtimeTheme.site}>
          <NextIntlClientProvider locale={locale}>
            <AppProviders>
              {hasGlobalAnnouncement ? (
                <GlobalAnnouncementBanner
                  locale={locale}
                  message={globalAnnouncement.message}
                  linkUrl={globalAnnouncement.linkUrl}
                  disabledOn={globalAnnouncement.disabledOn}
                />
              ) : null}
              {IS_TEST_MODE && !globalAnnouncement.disableFaucetBanner && <TestModeBannerDeferred />}
              <PwaInstallStateSync />
              {children}
              <CustomJavascriptCode locale={locale} codes={runtimeTheme.site.customJavascriptCodes} />
            </AppProviders>
          </NextIntlClientProvider>
        </SiteIdentityProvider>
      </PublicRuntimeConfigProvider>
    </body>
  )
}

async function PrerenderedLocaleDocument({ children }: LocaleDocumentProps) {
  const locale = await getRootLocale()
  const [publicData, publicRuntimeConfig] = await Promise.all([
    loadLocalePublicData(locale),
    getPublicRuntimeConfig(),
  ])

  return (
    <html
      lang={locale}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      className={openSauceOne.variable}
      data-theme-preset={publicData.runtimeTheme.theme.presetId}
      suppressHydrationWarning
    >
      <LocaleBody {...publicData} publicRuntimeConfig={publicRuntimeConfig} locale={locale} syncRootPreset={false}>
        {children}
      </LocaleBody>
    </html>
  )
}

async function RuntimeLocaleDocument({ children }: LocaleDocumentProps) {
  await deferPublicShellPrerenderIfNeeded()

  const locale = await getRootLocale()
  const [publicData, publicRuntimeConfig] = await Promise.all([
    loadLocalePublicData(locale),
    getPublicRuntimeConfig(),
  ])

  return (
    <html
      lang={locale}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      className={openSauceOne.variable}
      suppressHydrationWarning
    >
      <LocaleBody {...publicData} publicRuntimeConfig={publicRuntimeConfig} locale={locale} syncRootPreset>
        {children}
      </LocaleBody>
    </html>
  )
}

export default async function LocaleLayout({ children }: LayoutProps<'/[locale]'>) {
  return shouldPrerenderPublicShell() ? (
    <PrerenderedLocaleDocument>{children}</PrerenderedLocaleDocument>
  ) : (
    <RuntimeLocaleDocument>{children}</RuntimeLocaleDocument>
  )
}
