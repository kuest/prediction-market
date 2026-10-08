import { getExtracted } from 'next-intl/server'

import {
  PortfolioOverviewSkeleton,
  PortfolioPositionsSkeleton,
  PortfolioWinningsSkeleton,
} from '@/app/[locale]/(platform)/portfolio/_components/PortfolioSkeletons'

export default async function Loading() {
  const t = await getExtracted()

  return (
    <>
      <PortfolioOverviewSkeleton />
      <PortfolioWinningsSkeleton />
      <PortfolioPositionsSkeleton
        labels={[t('Positions'), t('Open Orders'), t('History')]}
        filterLabels={[t('Active'), t('Closed'), t('Current value')]}
      />
    </>
  )
}
