import type { ReactElement } from 'react'

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import * as actualNextCache from 'next/cache'
import * as actualNextNavigation from 'next/navigation'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  getEventRouteBySlug: mock(),
  loadEventPagePublicContentData: mock(),
  loadRuntimeThemeState: mock(),
  redirect: mock(),
  notFound: mock(),
  buildTranslatedEventFaqItems: mock(),
}))

void mock.module('next/cache', () => ({
  ...actualNextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}))
void mock.module('next/navigation', () => ({
  ...actualNextNavigation,
  notFound: (...args: unknown[]) => mocks.notFound(...args),
}))
void mock.module('@/i18n/navigation', () => ({
  redirect: (...args: unknown[]) => mocks.redirect(...args),
}))
void mock.module('@/i18n/root-locale', () => ({ getRootLocale: async () => 'pt' }))
void mock.module('@/lib/event-page-data', () => ({
  getEventRouteBySlug: (...args: unknown[]) => mocks.getEventRouteBySlug(...args),
  loadEventPagePublicContentData: (...args: unknown[]) => mocks.loadEventPagePublicContentData(...args),
}))
void mock.module('@/lib/theme-settings', () => ({
  loadRuntimeThemeState: (...args: unknown[]) => mocks.loadRuntimeThemeState(...args),
}))
void mock.module('@/lib/event-faq-server', () => ({
  buildTranslatedEventFaqItems: (...args: unknown[]) => mocks.buildTranslatedEventFaqItems(...args),
}))
void mock.module('@/lib/event-open-graph', () => ({ buildEventPageMetadata: async () => ({}) }))
void mock.module('@/lib/static-params', () => ({
  STATIC_PARAMS_PLACEHOLDER: '__public_shell__',
  getPublicShellStaticParams: () => [],
  shouldBypassPublicShellPlaceholder: () => false,
}))
void mock.module('@/app/[locale]/(platform)/event/[slug]/_components/EventContent', () => ({ default: () => null }))
void mock.module('@/components/seo/EventStructuredData', () => ({ default: () => null }))

const [{ default: EventPage }, { default: EventMarketPage }] = await Promise.all([
  import('@/app/[locale]/(platform)/event/[slug]/page'),
  import('@/app/[locale]/(platform)/event/[slug]/[market]/page'),
])

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve()
  }
}

const variants = [
  { name: 'event page', market: undefined, canonicalPath: '/sports/soccer/team-a-team-b' },
  { name: 'market page', market: 'winner', canonicalPath: '/sports/soccer/team-a-team-b/winner' },
] as const

async function startRendering(market: string | undefined) {
  const params = Promise.resolve({ locale: 'pt', slug: 'legacy-match', market: market ?? 'winner' })
  const shell = market ? await EventMarketPage({ params } as any) : await EventPage({ params } as any)
  if (!shell || typeof shell.type !== 'function') {
    throw new Error('Expected the cached event server component')
  }
  const element = shell as ReactElement<Record<string, unknown>>
  return {
    rendering: (shell.type as (props: typeof element.props) => Promise<unknown>)(element.props),
  }
}

describe('cold event route loading', () => {
  beforeEach(() => {
    mocks.getEventRouteBySlug.mockReset()
    mocks.loadEventPagePublicContentData.mockReset()
    mocks.loadRuntimeThemeState.mockReset()
    mocks.buildTranslatedEventFaqItems.mockReset().mockResolvedValue([])
    mocks.redirect.mockReset().mockImplementation(() => {
      throw new Error('canonical-redirect')
    })
    mocks.notFound.mockReset().mockImplementation(() => {
      throw new Error('not-found')
    })
  })

  it.each(variants)('redirects a cold $name before content or theme finish', async ({ market, canonicalPath }) => {
    const content = deferred<unknown>()
    const theme = deferred<unknown>()
    mocks.loadEventPagePublicContentData.mockReturnValue(content.promise)
    mocks.loadRuntimeThemeState.mockReturnValue(theme.promise)
    mocks.getEventRouteBySlug.mockResolvedValue({
      slug: 'legacy-match',
      sports_sport_slug: 'soccer',
      sports_event_slug: 'team-a-team-b',
      sports_section: 'games',
    })

    const { rendering } = await startRendering(market)
    let rejection: unknown
    void rendering.catch((error) => {
      rejection = error
    })
    await flushMicrotasks()

    expect(rejection).toEqual(new Error('canonical-redirect'))
    expect(mocks.redirect).toHaveBeenCalledWith({ href: canonicalPath, locale: 'pt' })
    expect(mocks.buildTranslatedEventFaqItems).not.toHaveBeenCalled()

    // The redirect's Promise.all must also handle later failures from work already started.
    content.reject(new Error('late-content-failure'))
    theme.reject(new Error('late-theme-failure'))
    await flushMicrotasks()
  })

  it.each(variants)('starts content and theme for $name while route lookup is pending', async ({ market }) => {
    const route = deferred<unknown>()
    mocks.getEventRouteBySlug.mockReturnValue(route.promise)
    mocks.loadEventPagePublicContentData.mockResolvedValue({
      event: { slug: 'legacy-match', series_slug: null, is_bookmarked: false },
      marketContextEnabled: false,
      seriesEvents: [],
      liveChartConfig: null,
    })
    mocks.loadRuntimeThemeState.mockResolvedValue({ site: { name: 'Kuest' } })

    const { rendering } = await startRendering(market)
    await flushMicrotasks()

    expect(mocks.loadEventPagePublicContentData).toHaveBeenCalledWith('legacy-match', 'pt')
    expect(mocks.loadRuntimeThemeState).toHaveBeenCalledTimes(1)
    expect(mocks.buildTranslatedEventFaqItems).not.toHaveBeenCalled()

    route.resolve({ slug: 'legacy-match' })
    await rendering
    expect(mocks.buildTranslatedEventFaqItems).toHaveBeenCalledTimes(1)
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it.each(variants)('returns not-found for $name before cold content finishes', async ({ market }) => {
    mocks.getEventRouteBySlug.mockResolvedValue(null)
    mocks.loadEventPagePublicContentData.mockReturnValue(new Promise(() => {}))
    mocks.loadRuntimeThemeState.mockReturnValue(new Promise(() => {}))

    const { rendering } = await startRendering(market)
    let rejection: unknown
    void rendering.catch((error) => {
      rejection = error
    })
    await flushMicrotasks()

    expect(rejection).toEqual(new Error('not-found'))
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})
