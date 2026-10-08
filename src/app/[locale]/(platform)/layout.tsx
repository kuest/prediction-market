import type { ReactNode } from 'react'

import { PlatformLayoutFooter } from '@/app/[locale]/(platform)/(home)/_components/PlatformFooter'
import AffiliateQueryHandler from '@/app/[locale]/(platform)/_components/AffiliateQueryHandler'
import Header from '@/app/[locale]/(platform)/_components/Header'
import MobileBottomNav from '@/app/[locale]/(platform)/_components/MobileBottomNav'
import NavigationTabs from '@/app/[locale]/(platform)/_components/NavigationTabs'
import PlatformViewerState from '@/app/[locale]/(platform)/_components/PlatformViewerState'
import { FilterProvider } from '@/app/[locale]/(platform)/_providers/FilterProvider'
import PlatformNavigationProvider from '@/app/[locale]/(platform)/_providers/PlatformNavigationProvider'
import { TradingOnboardingProvider } from '@/app/[locale]/(platform)/_providers/TradingOnboardingProvider'
import { loadPlatformLayoutNavigation } from '@/lib/platform-layout-navigation'
import AppKitProvider from '@/providers/AppKitProvider'
import { CommunityFollowsProvider } from '@/providers/CommunityFollowsProvider'
import TradeAlertsProvider from '@/providers/TradeAlertsProvider'

export const instant = false

async function PlatformLayoutContent({ children }: { children: ReactNode }) {
  const { tags, childParentMap } = await loadPlatformLayoutNavigation()

  return (
    <TradingOnboardingProvider>
      <PlatformViewerState />
      <FilterProvider>
        <PlatformNavigationProvider tags={tags} childParentMap={childParentMap}>
          <div className="min-h-screen">
            <Header />
            <NavigationTabs />
            {children}
          </div>
          <PlatformLayoutFooter />
          <MobileBottomNav />
          <AffiliateQueryHandler />
        </PlatformNavigationProvider>
      </FilterProvider>
    </TradingOnboardingProvider>
  )
}

export default function PlatformLayout({ children }: LayoutProps<'/[locale]'>) {
  return (
    <AppKitProvider>
      <CommunityFollowsProvider>
        <TradeAlertsProvider>
          <PlatformLayoutContent>{children}</PlatformLayoutContent>
        </TradeAlertsProvider>
      </CommunityFollowsProvider>
    </AppKitProvider>
  )
}
