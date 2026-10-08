import type { AnchorHTMLAttributes, ReactNode } from 'react'

import { mock } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { prerender } from 'react-dom/static'

let pathname: string | null = null
let hasHydrated = false
const pendingPathname = new Promise<string>(() => {})

function usePathname() {
  if (pathname === null) {
    throw pendingPathname
  }
  return pathname
}

function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />
}

void mock.module('@/i18n/navigation', () => ({ Link, usePathname, useRouter: () => ({}) }))
void mock.module('next/navigation', () => ({ usePathname }))
void mock.module('next-intl', () => ({
  useExtracted: () => Object.assign((message: string) => message, { rich: (message: string) => message }),
  useLocale: () => 'en',
}))
void mock.module('@/app/[locale]/(platform)/_providers/PlatformNavigationProvider', () => ({
  usePlatformNavigationData: () => ({
    tags: [
      { slug: 'trending', name: 'Trending' },
      { slug: 'new', name: 'New' },
      { slug: 'crypto', name: 'Crypto' },
    ],
    childParentMap: {},
  }),
}))
void mock.module('@/app/[locale]/(platform)/_providers/FilterProvider', () => ({
  useFilters: () => ({ filters: { tag: 'trending', mainTag: 'trending', bookmarked: false } }),
}))
void mock.module('@/app/[locale]/(platform)/_components/NavigationMoreMenu', () => ({ default: () => null }))
void mock.module('@/hooks/useAppKit', () => ({ useAppKit: () => ({ open() {} }) }))
void mock.module('@/hooks/usePwaInstall', () => ({ usePwaInstall: () => ({ canShowInstallUi: false }) }))
void mock.module('@/hooks/useHasHydrated', () => ({ useHasHydrated: () => hasHydrated }))
void mock.module('@/lib/auth-client', () => ({ authClient: { useSession: () => ({ data: null }) } }))
void mock.module('@/stores/useUser', () => ({ useUser: () => null }))
void mock.module('@/components/PwaInstallDialog', () => ({ default: () => null }))
void mock.module('@/components/ThemeSelector', () => ({ default: () => null }))
void mock.module('@/app/[locale]/(platform)/_components/SearchDiscoveryContent', () => ({ default: () => null }))
void mock.module('@/hooks/useBalance', () => ({ useBalance: () => ({}) }))
void mock.module('@/hooks/usePortfolioValue', () => ({ usePortfolioValue: () => ({}) }))

const { PlatformLayoutFooter } = await import('@/app/[locale]/(platform)/(home)/_components/PlatformFooter')
const { default: NavigationTabs } = await import('@/app/[locale]/(platform)/_components/NavigationTabs')
const { default: MobileBottomNav } = await import('@/app/[locale]/(platform)/_components/MobileBottomNav')
const { default: CustomJavascriptCode } = await import('@/components/CustomJavascriptCode')
const { default: GlobalAnnouncementBanner } = await import('@/components/GlobalAnnouncementBanner')

function renderShell(children: ReactNode) {
  return renderToString(
    <>
      <main>Visible market content</main>
      {children}
    </>,
  )
}

const suspended = {
  footer: renderShell(<PlatformLayoutFooter />),
  navigation: renderShell(<NavigationTabs />),
  mobile: renderShell(<MobileBottomNav />),
  scripts: renderShell(<CustomJavascriptCode locale="en" codes={[]} />),
  announcement: renderShell(
    <GlobalAnnouncementBanner locale="en" message="Public announcement" linkUrl="" disabledOn={[]} />,
  ),
  restrictedAnnouncement: renderShell(
    <GlobalAnnouncementBanner locale="en" message="Restricted announcement" linkUrl="" disabledOn={['docs']} />,
  ),
}

const prerenderController = new AbortController()
function FinishPrerender() {
  setImmediate(() => prerenderController.abort())
  return null
}

const pendingPrerender = prerender(
  <html lang="en">
    <body>
      <main>Visible market content</main>
      <NavigationTabs />
      <PlatformLayoutFooter />
      <MobileBottomNav />
      <CustomJavascriptCode locale="en" codes={[]} />
      <FinishPrerender />
    </body>
  </html>,
  { signal: prerenderController.signal, onError() {} },
)
const { prelude } = await pendingPrerender
const staticHtml = await new Response(prelude).text()

hasHydrated = true
pathname = '/'
const homeFooter = renderShell(<PlatformLayoutFooter />)
pathname = '/crypto'
const categoryFooter = renderShell(<PlatformLayoutFooter />)
pathname = '/event/example'
const eventFooter = renderShell(<PlatformLayoutFooter />)
pathname = '/sports/live'
const sportsFooter = renderShell(<PlatformLayoutFooter />)
pathname = '/new'
const activeMobileNavigation = renderShell(<MobileBottomNav />)
pathname = '/en/docs'
const disabledAnnouncement = renderShell(
  <GlobalAnnouncementBanner locale="en" message="Restricted announcement" linkUrl="" disabledOn={['docs']} />,
)

process.stdout.write(
  JSON.stringify({
    suspended,
    staticHtml,
    homeFooter,
    categoryFooter,
    eventFooter,
    sportsFooter,
    activeMobileNavigation,
    disabledAnnouncement,
  }),
  () => process.exit(0),
)
