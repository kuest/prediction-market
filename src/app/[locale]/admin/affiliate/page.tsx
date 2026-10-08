import { getExtracted } from 'next-intl/server'
import { io } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { Suspense } from 'react'

import AdminAffiliateContentClient from '@/app/[locale]/admin/affiliate/_components/AdminAffiliateContentClient'
import AdminAffiliateOverview from '@/app/[locale]/admin/affiliate/_components/AdminAffiliateOverview'
import { Skeleton } from '@/components/ui/skeleton'
import {
  BUILDER_TAKER_FEE_SHARE_BPS_KEY,
  getAffiliateFeeSettings,
  getAffiliateFeeSettingsUpdatedAt,
} from '@/lib/affiliate-fee-settings'
import { fetchFeeReceiverTotals, sumFeeTotals, sumFeeVolumes } from '@/lib/data-api/fees'
import { AffiliateRepository } from '@/lib/db/queries/affiliate'
import { SettingsRepository } from '@/lib/db/queries/settings'
import { getPublicAssetUrl } from '@/lib/storage'
import { getFeeRecipientWalletFormValue } from '@/lib/theme-settings'

export const instant = false

interface AffiliateOverviewRow {
  affiliate_user_id: string
  total_referrals: number | null
  volume: number | null
}

interface AffiliateProfile {
  id: string
  username: string
  address: string
  deposit_wallet_address?: string | null
  image?: string | null
  affiliate_code?: string | null
}

interface RowSummary {
  id: string
  username: string
  address: string
  deposit_wallet_address?: string | null
  image: string
  affiliate_code: string | null
  total_referrals: number
  volume: number
  total_affiliate_fees: number
}

function formatIsoUtcFromTimestamp(timestamp: number) {
  return new Date(timestamp).toISOString()
}

function AdminAffiliateFallback({ loadingLabel }: { loadingLabel: string }) {
  return (
    <div className="grid gap-6" role="status" aria-label={loadingLabel}>
      <section className="grid gap-4 rounded-lg border p-6" aria-hidden="true">
        <div className="grid gap-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="grid gap-2 rounded-lg bg-muted/40 p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-28 max-w-full" />
            </div>
          ))}
        </div>
      </section>

      <section className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="grid min-h-80 content-start gap-5 rounded-lg border p-6" aria-hidden="true">
            <div className="grid gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <Skeleton className={index === 0 ? 'h-44 w-full' : 'h-56 w-full'} />
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-lg border" aria-hidden="true">
        <div className="grid gap-2 border-b p-6">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-3 w-60 max-w-full" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex h-16 items-center gap-4 px-6">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="ml-auto h-4 w-20" />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

async function AdminAffiliateContent() {
  await io()
  const [{ data: allSettings }, { data: overviewData }] = await Promise.all([
    SettingsRepository.getSettings(),
    AffiliateRepository.listAffiliateOverview(),
  ])
  const affiliateFeeSettings = getAffiliateFeeSettings(allSettings)
  const hasSavedBuilderTakerShare = Boolean(allSettings?.affiliate?.[BUILDER_TAKER_FEE_SHARE_BPS_KEY])
  const initialFeeRecipientWallet = getFeeRecipientWalletFormValue(allSettings ?? undefined)

  const overview = (overviewData ?? []) as AffiliateOverviewRow[]
  const userIds = overview.map((row) => row.affiliate_user_id)
  const { data: profilesData } = await AffiliateRepository.getAffiliateProfiles(userIds)
  const profiles = (profilesData ?? []) as AffiliateProfile[]

  let updatedAtLabel: string | undefined
  const latestUpdatedAt = getAffiliateFeeSettingsUpdatedAt(allSettings)

  if (latestUpdatedAt) {
    const latestUpdatedAtMs = Date.parse(latestUpdatedAt)
    if (Number.isFinite(latestUpdatedAtMs)) {
      const iso = formatIsoUtcFromTimestamp(latestUpdatedAtMs)
      updatedAtLabel = `${iso.replace('T', ' ').slice(0, 19)} UTC`
    }
  }

  const profileMap = new Map<string, AffiliateProfile>(profiles.map((profile) => [profile.id, profile]))
  const feeTotalsByAddress = new Map<string, { fees: number; volume: number }>()

  if (profiles.length > 0) {
    const uniqueReceivers = Array.from(
      new Set(
        profiles
          .map((profile) => profile.deposit_wallet_address || profile.address || '')
          .map((address) => address.trim())
          .filter(Boolean),
      ),
    )

    const feeTotals = await Promise.allSettled(
      uniqueReceivers.map((address) =>
        fetchFeeReceiverTotals({ endpoint: 'referrers', address, feeType: 'AFFILIATE' }),
      ),
    )

    feeTotals.forEach((result, idx) => {
      if (result.status !== 'fulfilled') {
        unstable_rethrow(result.reason)
        console.warn('Failed to load affiliate fee totals', result.reason)
        return
      }
      const affiliateTotals = result.value.filter((total) => total.feeType === 'AFFILIATE')
      const usdcTotal = sumFeeTotals(affiliateTotals)
      const volumeTotal = sumFeeVolumes(affiliateTotals)
      feeTotalsByAddress.set(uniqueReceivers[idx].toLowerCase(), {
        fees: usdcTotal,
        volume: volumeTotal,
      })
    })
  }

  const rows: RowSummary[] = overview.map((item) => {
    const profile = profileMap.get(item.affiliate_user_id)

    const receiverAddress = (profile?.deposit_wallet_address || profile?.address || '').toLowerCase()
    const onchainData = receiverAddress ? feeTotalsByAddress.get(receiverAddress) : undefined

    return {
      id: item.affiliate_user_id,
      username: profile?.username as string,
      address: profile?.address ?? '',
      deposit_wallet_address: profile?.deposit_wallet_address ?? null,
      image: profile?.image ? getPublicAssetUrl(profile.image) : '',
      affiliate_code: profile?.affiliate_code ?? null,
      total_referrals: Number(item.total_referrals ?? 0),
      volume: onchainData?.volume ?? 0,
      total_affiliate_fees: onchainData?.fees ?? 0,
    }
  })

  const aggregate = rows.reduce<{ totalVolume: number; totalAffiliateFees: number; totalReferrals: number }>(
    (acc, row) => {
      acc.totalVolume += row.volume
      acc.totalAffiliateFees += row.total_affiliate_fees
      acc.totalReferrals += row.total_referrals
      return acc
    },
    { totalVolume: 0, totalAffiliateFees: 0, totalReferrals: 0 },
  )

  return (
    <>
      <AdminAffiliateContentClient
        key={`${initialFeeRecipientWallet}-${affiliateFeeSettings.builderTakerFeeShareBps}-${affiliateFeeSettings.builderMakerFlatFeeBps}`}
        builderTakerFeeShareBps={affiliateFeeSettings.builderTakerFeeShareBps}
        builderMakerFlatFeeBps={affiliateFeeSettings.builderMakerFlatFeeBps}
        affiliateShareBps={affiliateFeeSettings.affiliateShareBps}
        hasSavedBuilderTakerShare={hasSavedBuilderTakerShare}
        initialFeeRecipientWallet={initialFeeRecipientWallet}
        updatedAtLabel={updatedAtLabel}
        aggregate={aggregate}
      />
      <AdminAffiliateOverview rows={rows} />
    </>
  )
}

export default async function AdminSettingsPage() {
  const t = await getExtracted()

  return (
    <Suspense fallback={<AdminAffiliateFallback loadingLabel={t('Loading affiliate settings')} />}>
      <AdminAffiliateContent />
    </Suspense>
  )
}
