import type { ReactElement } from 'react'

import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'

import { stubGlobal, unstubAllGlobals } from '../bun-test-helpers'

const wallet = '0x1111111111111111111111111111111111111111'
let failedPath: string | undefined
let fetchError: Error | undefined

void mock.module('next-intl/server', () => ({ getExtracted: async () => (message: string) => message }))
void mock.module('next/cache', () => ({ io: async () => {} }))
void mock.module('@/lib/data-api/client', () => ({
  buildDataApiUrl: (path: string, params?: URLSearchParams) => `https://data.test${path}?${params ?? ''}`,
  normalizeDataApiAddress: (address: string) => address.toLowerCase(),
}))
void mock.module('@/lib/db/queries/user', () => ({
  UserRepository: {
    getCurrentUser: async () => ({
      id: 'user-1',
      address: wallet,
      deposit_wallet_address: wallet,
      affiliate_code: 'code',
    }),
  },
}))
void mock.module('@/lib/db/queries/settings', () => ({
  SettingsRepository: { getSettings: async () => ({ data: {} }) },
}))
void mock.module('@/lib/db/queries/tag', () => ({ TagRepository: { getMainTags: async () => ({ data: [] }) } }))
void mock.module('@/lib/db/queries/affiliate', () => ({
  AffiliateRepository: {
    getUserAffiliateStats: async () => ({ data: { total_referrals: 1, active_referrals: 1 } }),
    listReferralsByAffiliate: async () => ({ data: [] }),
    listAffiliateOverview: async () => ({ data: [{ affiliate_user_id: 'user-1', total_referrals: 1, volume: 0 }] }),
    getAffiliateProfiles: async () => ({ data: [{ id: 'user-1', address: wallet }] }),
  },
}))
void mock.module('@/lib/resolution-reward-display', () => ({
  hydrateResolutionRewardAccount: async (account: unknown) => account,
}))
void mock.module('@/lib/site-url', () => ({ default: () => 'https://site.test' }))
void mock.module('@/lib/storage', () => ({ getPublicAssetUrl: () => null }))
void mock.module('@/lib/theme-settings', () => ({ getFeeRecipientWalletFormValue: () => '' }))
void mock.module('@/app/[locale]/(platform)/settings/_components/SettingsAffiliateContent', () => ({
  default: 'rewards-content',
}))
void mock.module('@/app/[locale]/admin/affiliate/_components/AdminAffiliateContentClient', () => ({
  default: 'admin-affiliate-content',
}))
void mock.module('@/app/[locale]/admin/affiliate/_components/AdminAffiliateOverview', () => ({
  default: 'admin-affiliate-overview',
}))

const { default: RewardsSettingsPage } = await import('@/app/[locale]/(platform)/settings/rewards/page')
const { default: AdminAffiliatePage } = await import('@/app/[locale]/admin/affiliate/page')

function prerenderCancellation() {
  return Object.assign(new Error('Prerendering completed'), {
    digest: 'HANGING_PROMISE_REJECTION',
    route: '/[locale]/settings/rewards',
    expression: 'fetch()',
  })
}

function fetchData(input: string | URL | Request) {
  const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname
  if (path === failedPath) {
    return Promise.reject(fetchError)
  }

  let payload: unknown = null
  if (path === '/referrers') {
    payload = [{ feeType: 'AFFILIATE', totalAmount: '2', totalVolume: '3' }]
  } else if (path === '/fees/total') {
    payload = { totalAmount: '2000000' }
  } else if (path === '/fees/timeseries') {
    payload = { items: [] }
  } else if (path.includes('/accounts/')) {
    payload = {
      rewardAccountStats: null,
      rewardClaims: [],
      rewardProposals: [{ rewardAmount: '1', market: { id: 'market-1' } }],
    }
  } else if (path.includes('/markets/')) {
    payload = { rewardMarket: null }
  }
  return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
}

async function renderRewards() {
  return RewardsSettingsPage({ params: Promise.resolve({ locale: 'en' }) })
}

async function renderAdminContent() {
  const page = await AdminAffiliatePage()
  const content = page.props.children as ReactElement
  return (content.type as () => Promise<ReactElement>)()
}

describe('affiliate rewards prerender cancellation', () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {})

  beforeEach(() => {
    failedPath = undefined
    fetchError = undefined
    warn.mockClear()
    stubGlobal('fetch', mock(fetchData))
  })

  afterEach(() => {
    unstubAllGlobals()
  })

  afterAll(() => {
    warn.mockRestore()
  })

  it.each([
    '/referrers',
    '/fees/timeseries',
    '/fees/total',
    `/v1/resolution-rewards/accounts/${wallet}`,
    '/v1/resolution-rewards/markets/market-1',
  ])('lets Next.js handle cancellation of %s without warning or fallback data', async (path) => {
    failedPath = path
    fetchError = prerenderCancellation()
    await expect(renderRewards()).rejects.toBe(fetchError)
    expect(warn).not.toHaveBeenCalled()
  })

  it('preserves cancellation wrapped as an error cause', async () => {
    failedPath = '/referrers'
    const cancellation = prerenderCancellation()
    fetchError = new Error('Wrapped fetch rejection', { cause: cancellation })
    await expect(renderRewards()).rejects.toBe(cancellation)
    expect(warn).not.toHaveBeenCalled()
  })

  it('continues showing available rewards when a real API request fails', async () => {
    failedPath = '/referrers'
    fetchError = new Error('Data API request failed')
    const page = await renderRewards()
    const content = page.props.children[1].props.children
    expect(content.props.affiliateData.stats.total_affiliate_fees).toBe(2)
    expect(content.props.affiliateData.stats.volume).toBe(0)
    expect(warn).toHaveBeenCalledWith('Failed to load affiliate fee totals', fetchError)
  })

  it('does not swallow cancellation in the admin Promise.allSettled handler', async () => {
    failedPath = '/referrers'
    fetchError = prerenderCancellation()
    await expect(renderAdminContent()).rejects.toBe(fetchError)
    expect(warn).not.toHaveBeenCalled()
  })

  it('retains the admin fallback for ordinary API failures', async () => {
    failedPath = '/referrers'
    fetchError = new Error('Data API request failed')
    const content = await renderAdminContent()
    expect(content.props.children[0].props.aggregate.totalAffiliateFees).toBe(0)
    expect(warn).toHaveBeenCalledWith('Failed to load affiliate fee totals', fetchError)
  })
})
