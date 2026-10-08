import type { Metadata } from 'next'

import { getExtracted } from 'next-intl/server'
import { io } from 'next/cache'
import { cache, Suspense } from 'react'

import PortfolioMarketsWonCard from '@/app/[locale]/(platform)/portfolio/_components/PortfolioMarketsWonCard'
import {
  PortfolioOverviewSkeleton,
  PortfolioPositionsSkeleton,
  PortfolioWinningsSkeleton,
} from '@/app/[locale]/(platform)/portfolio/_components/PortfolioSkeletons'
import PortfolioTabs from '@/app/[locale]/(platform)/portfolio/_components/PortfolioTabs'
import PortfolioWalletActions from '@/app/[locale]/(platform)/portfolio/_components/PortfolioWalletActions'
import PublicProfileHeroCards from '@/app/[locale]/(platform)/profile/_components/PublicProfileHeroCards'
import { UserRepository } from '@/lib/db/queries/user'
import { fetchPortfolioSnapshot } from '@/lib/portfolio'

const getPortfolioUser = cache(function getCurrentPortfolioUser() {
  return UserRepository.getCurrentUser()
})

export async function generateMetadata(): Promise<Metadata> {
  const t = await getExtracted()

  return { title: t('Portfolio') }
}

function getFallbackChartEndDate() {
  return new Date().toISOString()
}

async function PortfolioOverview() {
  await io()
  const t = await getExtracted()
  const user = await getPortfolioUser()
  const snapshot = await fetchPortfolioSnapshot(user?.deposit_wallet_address)
  const fallbackChartEndDate = getFallbackChartEndDate()

  return (
    <PublicProfileHeroCards
      profile={{
        username: user?.username ?? t('Your portfolio'),
        avatarUrl: user?.image ?? '',
        joinedAt: (user as any)?.created_at?.toString?.() ?? (user as any)?.createdAt?.toString?.(),
        portfolioAddress: user?.deposit_wallet_address ?? undefined,
      }}
      snapshot={snapshot}
      actions={<PortfolioWalletActions />}
      variant="portfolio"
      fallbackChartEndDate={fallbackChartEndDate}
    />
  )
}

async function PortfolioWinnings() {
  await io()
  const user = await getPortfolioUser()

  return <PortfolioMarketsWonCard depositWalletAddress={user?.deposit_wallet_address ?? null} />
}

async function PortfolioPositions() {
  await io()
  const user = await getPortfolioUser()

  return <PortfolioTabs userAddress={user?.deposit_wallet_address ?? ''} />
}

export default async function PortfolioPage() {
  const t = await getExtracted()

  return (
    <>
      <Suspense fallback={<PortfolioOverviewSkeleton />}>
        <PortfolioOverview />
      </Suspense>

      <Suspense fallback={<PortfolioWinningsSkeleton />}>
        <PortfolioWinnings />
      </Suspense>

      <Suspense
        fallback={
          <PortfolioPositionsSkeleton
            labels={[t('Positions'), t('Open Orders'), t('History')]}
            filterLabels={[t('Active'), t('Closed'), t('Current value')]}
          />
        }
      >
        <PortfolioPositions />
      </Suspense>
    </>
  )
}
