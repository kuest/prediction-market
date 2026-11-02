'use client'

import { GiftIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'
import dynamic from 'next/dynamic'

import HeaderDropdownUserMenuGuest from '@/app/[locale]/(platform)/_components/HeaderDropdownUserMenuGuest'
import { useOptionalTradingOnboarding } from '@/app/[locale]/(platform)/_providers/TradingOnboardingContext'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppKit } from '@/hooks/useAppKit'
import { useHasHydrated } from '@/hooks/useHasHydrated'
import { useIsMobile } from '@/hooks/useIsMobile'
import { Link } from '@/i18n/navigation'
import { authClient } from '@/lib/auth-client'
import { useUser } from '@/stores/useUser'

const { useSession } = authClient

const HeaderNotifications = dynamic(() => import('@/app/[locale]/(platform)/_components/HeaderNotifications'), {
  loading: () => <Skeleton className="size-9 rounded-md" />,
})
const HeaderDropdownUserMenuAuth = dynamic(() => import('@/components/HeaderDropdownUserMenuAuth'), {
  loading: () => <Skeleton className="h-9 w-20 rounded-md" />,
})
const HeaderPortfolio = dynamic(() => import('@/components/HeaderPortfolio'), {
  loading: () => (
    <div className="flex items-center gap-2" aria-hidden="true">
      <Skeleton className="h-9 w-16" />
      <Skeleton className="h-9 w-16" />
    </div>
  ),
})

const HeaderDepositButton = dynamic(() => import('@/app/[locale]/(platform)/_components/HeaderDepositButton'), {
  ssr: false,
})

function HeaderMenuSkeleton() {
  return (
    <div className="flex items-center gap-2" aria-hidden="true" data-testid="header-menu-skeleton">
      <Skeleton className="hidden h-9 w-16 lg:block" />
      <Skeleton className="hidden h-9 w-16 lg:block" />
      <Skeleton className="hidden h-9 w-20 lg:block" />
      <Skeleton className="size-9 rounded-md" />
      <Skeleton className="size-9 rounded-md" />
      <div className="-ml-1 hidden h-5 w-px bg-border md:block" />
      <Skeleton className="h-9 w-20 rounded-md" />
    </div>
  )
}

export default function HeaderMenu() {
  const t = useExtracted()
  const { open: openAppKit } = useAppKit()
  const { data: session, isPending } = useSession()
  const hasHydrated = useHasHydrated()
  const isMobile = useIsMobile()
  const tradingOnboarding = useOptionalTradingOnboarding()
  const user = useUser()

  const shouldShowSkeleton = !hasHydrated || isPending
  const isAuthenticated = !shouldShowSkeleton && (Boolean(session?.user) || Boolean(user))
  const shouldShowGuestActions = !shouldShowSkeleton && !isAuthenticated
  const startDepositFlow = tradingOnboarding?.startDepositFlow

  return (
    <>
      {shouldShowSkeleton && <HeaderMenuSkeleton />}

      {isAuthenticated && (
        <>
          {!isMobile && <HeaderPortfolio />}
          {!isMobile &&
            (startDepositFlow ? (
              <Button size="sm" onClick={startDepositFlow}>
                {t('Deposit')}
              </Button>
            ) : (
              <HeaderDepositButton />
            ))}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon"
                  variant="ghost"
                  nativeButton={false}
                  render={<Link href="/settings/rewards" aria-label={t('Rewards')} />}
                >
                  <GiftIcon className="size-[1.35rem]" aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>{t('Rewards')}</TooltipContent>
          </Tooltip>
          <HeaderNotifications />
          <div className="-ml-1 hidden h-5 w-px bg-border md:block" aria-hidden="true" />
          <HeaderDropdownUserMenuAuth />
        </>
      )}

      {shouldShowGuestActions && (
        <>
          <Button size="sm" variant="ghost" data-testid="header-login-button" onClick={() => openAppKit()}>
            {t('Log In')}
          </Button>
          <Button size="sm" data-testid="header-signup-button" onClick={() => openAppKit()}>
            {t('Sign Up')}
          </Button>
          {!isMobile && <HeaderDropdownUserMenuGuest />}
        </>
      )}
    </>
  )
}
