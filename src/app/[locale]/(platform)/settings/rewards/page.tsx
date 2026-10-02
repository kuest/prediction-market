import type { Metadata } from 'next'

import { getExtracted } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'

import type { SupportedLocale } from '@/i18n/locales'
import type { DataApiRewardAccount, DataApiRewardMarket } from '@/lib/data-api/resolution-rewards'

import SettingsAffiliateContent from '@/app/[locale]/(platform)/settings/_components/SettingsAffiliateContent'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@/i18n/locales'
import { getAffiliateFeeSettings } from '@/lib/affiliate-fee-settings'
import {
  baseUnitsToNumber,
  combineDailyFeeSeries,
  fetchFeeHistoryTotal,
  fetchFeeHistoryTimeSeries,
  fetchFeeReceiverTotals,
  sumFeeVolumes,
} from '@/lib/data-api/fees'
import { fetchResolutionRewardAccount, fetchResolutionRewardMarket } from '@/lib/data-api/resolution-rewards'
import { AffiliateRepository } from '@/lib/db/queries/affiliate'
import { SettingsRepository } from '@/lib/db/queries/settings'
import { TagRepository } from '@/lib/db/queries/tag'
import { UserRepository } from '@/lib/db/queries/user'
import { hydrateResolutionRewardAccount } from '@/lib/resolution-reward-display'
import resolveSiteUrl from '@/lib/site-url'
import { getPublicAssetUrl } from '@/lib/storage'

export const instant = false

interface RewardsSettingsPageProps {
  params: Promise<{ locale: string }>
}

function parseRawAmount(value: string) {
  try {
    return BigInt(value)
  } catch {
    return 0n
  }
}

async function getRequestTime() {
  await connection()
  return new Date()
}

function buildResolutionRewardSeries(
  account: DataApiRewardAccount | null,
  rewardMarkets: DataApiRewardMarket[],
  now: Date,
) {
  const marketById = new Map(rewardMarkets.map((market) => [market.id.toLowerCase(), market]))
  const rewardsByDate = new Map<string, bigint>()

  for (const proposal of account?.rewardProposals ?? []) {
    const market = marketById.get(proposal.market.id.toLowerCase())
    if (!market?.resolvedAt) {
      continue
    }
    try {
      const amount = BigInt(proposal.rewardAmount)
      if (amount <= 0n) {
        continue
      }
      const date = new Date(Number(market.resolvedAt) * 1_000).toISOString().slice(0, 10)
      rewardsByDate.set(date, (rewardsByDate.get(date) ?? 0n) + amount)
    } catch (error) {
      console.warn('Ignoring malformed resolution reward amount.', { amount: proposal.rewardAmount, error })
    }
  }

  const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Array.from({ length: 30 }, (_, index) => {
    const timestamp = currentDay - (29 - index) * 86_400_000
    const date = new Date(timestamp).toISOString().slice(0, 10)
    return { date, value: baseUnitsToNumber(rewardsByDate.get(date) ?? 0n, 6) }
  })
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getExtracted()

  return {
    title: t('Rewards Settings'),
  }
}

export default async function RewardsSettingsPage({ params }: RewardsSettingsPageProps) {
  const { locale } = await params
  const resolvedLocale = SUPPORTED_LOCALES.includes(locale as SupportedLocale)
    ? (locale as SupportedLocale)
    : DEFAULT_LOCALE

  const t = await getExtracted()

  const user = await UserRepository.getCurrentUser({ disableCookieCache: true })
  if (!user) {
    notFound()
  }
  const affiliateCode = user.affiliate_code
  const receiverAddress = user.deposit_wallet_address ?? user.address

  const feeTotalsPromise = receiverAddress
    ? fetchFeeReceiverTotals({
        endpoint: 'referrers',
        address: receiverAddress,
        feeType: 'AFFILIATE',
      }).catch((error) => {
        console.warn('Failed to load affiliate fee totals', error)
        return null
      })
    : Promise.resolve(null)
  const affiliateSeriesPromise = receiverAddress
    ? fetchFeeHistoryTimeSeries(receiverAddress, 'AFFILIATE').catch((error) => {
        console.warn('Failed to load affiliate fee history', error)
        return null
      })
    : Promise.resolve(null)
  const affiliateTotalPromise = receiverAddress
    ? fetchFeeHistoryTotal(receiverAddress, 'AFFILIATE').catch((error) => {
        console.warn('Failed to load affiliate fee total', error)
        return null
      })
    : Promise.resolve(null)
  const resolutionAccountPromise = user.deposit_wallet_address
    ? fetchResolutionRewardAccount(user.deposit_wallet_address).catch((error) => {
        console.warn('Failed to load resolution rewards account', error)
        return null
      })
    : Promise.resolve(null)

  const [
    { data: allSettings },
    { data: statsData },
    { data: referralsData },
    { data: mainTags },
    feeTotals,
    affiliateFeeSeries,
    affiliateFeeTotal,
    resolutionAccount,
  ] = await Promise.all([
    SettingsRepository.getSettings(),
    AffiliateRepository.getUserAffiliateStats(user.id),
    AffiliateRepository.listReferralsByAffiliate(user.id),
    TagRepository.getMainTags(resolvedLocale),
    feeTotalsPromise,
    affiliateSeriesPromise,
    affiliateTotalPromise,
    resolutionAccountPromise,
  ])
  const affiliateFeeSettings = getAffiliateFeeSettings(allSettings)
  const displayResolutionAccount = await hydrateResolutionRewardAccount(resolutionAccount)
  const rewardMarketIds = Array.from(
    new Set(
      (resolutionAccount?.rewardProposals ?? [])
        .filter((proposal) => parseRawAmount(proposal.rewardAmount) > 0n)
        .map((proposal) => proposal.market.id),
    ),
  )
  const indexedRewardMarkets = await Promise.all(
    rewardMarketIds.map((marketId) =>
      fetchResolutionRewardMarket(marketId).catch((error) => {
        console.warn('Failed to load resolution reward market history', { marketId, error })
        return null
      }),
    ),
  ).then((markets) => markets.filter((market): market is DataApiRewardMarket => market !== null))
  const now = await getRequestTime()
  let totalAffiliateFees = 0
  let referredVolume = 0

  if (affiliateFeeTotal) {
    try {
      totalAffiliateFees = baseUnitsToNumber(BigInt(affiliateFeeTotal.totalAmount), 6)
    } catch (error) {
      console.warn('Ignoring malformed affiliate fee total.', { amount: affiliateFeeTotal.totalAmount, error })
    }
  }

  if (feeTotals) {
    referredVolume = sumFeeVolumes(feeTotals.filter((total) => total.feeType === 'AFFILIATE'))
  }

  const commissionPercent = affiliateFeeSettings.affiliateShareBps / 100

  function resolveBaseUrl() {
    return resolveSiteUrl(process.env)
  }

  const affiliateData = affiliateCode
    ? {
        referralUrl: `${resolveBaseUrl()}/r/${encodeURIComponent(user.username?.trim() || affiliateCode)}`,
        commissionPercent,
        stats: {
          total_referrals: Number(statsData?.total_referrals ?? 0),
          active_referrals: Number(statsData?.active_referrals ?? 0),
          volume: referredVolume,
          total_affiliate_fees: totalAffiliateFees,
        },
        recentReferrals: (referralsData ?? []).map((referral: any) => {
          const userInfo = (Array.isArray(referral.users) ? referral.users[0] : referral.users) as {
            username: string
            address?: string
            deposit_wallet_address?: string
            image?: string | null
          }
          return {
            user_id: referral.user_id as string,
            username: userInfo.username,
            address: (userInfo?.address as string | undefined) ?? (referral.user_id as string),
            deposit_wallet_address: userInfo?.deposit_wallet_address as string | undefined,
            image: getPublicAssetUrl(userInfo?.image ?? null) ?? '',
            created_at: referral.created_at as string,
          }
        }),
      }
    : undefined

  return (
    <section className="grid min-w-0 gap-8">
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('Rewards')}</h1>
        <p className="text-muted-foreground">{t('Track and claim your affiliate and resolution rewards.')}</p>
      </div>

      <div className="w-full min-w-0">
        <SettingsAffiliateContent
          affiliateData={affiliateData}
          affiliateSeries={combineDailyFeeSeries(affiliateFeeSeries ? [affiliateFeeSeries] : [])}
          currentTimestamp={Math.floor(now.getTime() / 1_000)}
          mainCategories={(mainTags ?? []).map((tag) => ({
            slug: tag.slug,
            name: tag.name,
          }))}
          resolutionAccount={
            displayResolutionAccount ?? {
              rewardAccountStats: null,
              rewardProposals: [],
              rewardClaims: [],
            }
          }
          resolutionSeries={buildResolutionRewardSeries(resolutionAccount, indexedRewardMarkets, now)}
        />
      </div>
    </section>
  )
}
