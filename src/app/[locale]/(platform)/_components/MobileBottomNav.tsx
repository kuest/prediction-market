'use client'

import type { Route } from 'next'
import type { ComponentProps, ReactNode } from 'react'

import {
  BookOpenIcon,
  ChartLineIcon,
  CheckIcon,
  DownloadIcon,
  FileTextIcon,
  HouseIcon,
  InfoIcon,
  MenuIcon,
  SearchIcon,
  SparkleIcon,
  TrophyIcon,
  UnplugIcon,
} from 'lucide-react'
import { useExtracted, useLocale } from 'next-intl'
import { lazy, Suspense, useEffect, useState } from 'react'

import type { SupportedLocale } from '@/i18n/locales'

import SearchDiscoveryContent from '@/app/[locale]/(platform)/_components/SearchDiscoveryContent'
import { MOBILE_BOTTOM_NAV_OFFSET } from '@/app/[locale]/(platform)/_lib/mobile-bottom-nav'
import LocaleFlag from '@/components/LocaleFlag'
import PwaInstallDialog from '@/components/PwaInstallDialog'
import ThemeSelector from '@/components/ThemeSelector'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { useAppKit } from '@/hooks/useAppKit'
import { useBalance } from '@/hooks/useBalance'
import { useHasHydrated } from '@/hooks/useHasHydrated'
import { usePortfolioValue } from '@/hooks/usePortfolioValue'
import { usePwaInstall } from '@/hooks/usePwaInstall'
import { LOCALE_LABELS, LOOP_LABELS, normalizeEnabledLocales, SUPPORTED_LOCALES } from '@/i18n/locales'
import { Link, usePathname, useRouter } from '@/i18n/navigation'
import { authClient } from '@/lib/auth-client'
import { formatCompactCurrency } from '@/lib/formatters'
import { stripLocalePrefix, withLocalePrefix } from '@/lib/locale-path'
import { cn } from '@/lib/utils'
import { usePortfolioValueVisibility } from '@/stores/usePortfolioValueVisibility'
import { useUser } from '@/stores/useUser'

const HeaderSearch = lazy(() => import('@/app/[locale]/(platform)/_components/HeaderSearch'))
const HowItWorks = lazy(() => import('@/app/[locale]/(platform)/_components/HowItWorks'))

const { useSession } = authClient

function PathnameMobileBottomNav() {
  const pathname = usePathname()

  return <MobileBottomNavContent key={pathname} pathname={pathname} />
}

export default function MobileBottomNav() {
  const hasHydrated = useHasHydrated()
  return hasHydrated ? <PathnameMobileBottomNav /> : <MobileBottomNavContent pathname={null} />
}

interface MobileBottomNavContentProps {
  pathname: string | null
}

function useMobileBottomNavState() {
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchFocusTrigger, setSearchFocusTrigger] = useState(0)
  const [isGuestMenuOpen, setIsGuestMenuOpen] = useState(false)
  const [isHowItWorksOpen, setIsHowItWorksOpen] = useState(false)
  const [isInstallDialogOpen, setIsInstallDialogOpen] = useState(false)

  return {
    isSearchOpen,
    setIsSearchOpen,
    searchFocusTrigger,
    setSearchFocusTrigger,
    isGuestMenuOpen,
    setIsGuestMenuOpen,
    isHowItWorksOpen,
    setIsHowItWorksOpen,
    isInstallDialogOpen,
    setIsInstallDialogOpen,
  }
}

function MobileBottomNavContent({ pathname }: MobileBottomNavContentProps) {
  const t = useExtracted()
  const router = useRouter()
  const { open: openAppKit } = useAppKit()
  const { data: session } = useSession()
  const user = useUser()
  const hasHydrated = useHasHydrated()
  const { canShowInstallUi, isIos, isPrompting, requestInstall } = usePwaInstall()
  const {
    isSearchOpen,
    setIsSearchOpen,
    searchFocusTrigger,
    setSearchFocusTrigger,
    isGuestMenuOpen,
    setIsGuestMenuOpen,
    isHowItWorksOpen,
    setIsHowItWorksOpen,
    isInstallDialogOpen,
    setIsInstallDialogOpen,
  } = useMobileBottomNavState()

  const isAuthenticated = hasHydrated && (Boolean(session?.user) || Boolean(user))

  function focusMobileSearchInput() {
    const input = document.querySelector<HTMLInputElement>(
      '[data-mobile-search-drawer="true"] input[data-testid="header-search-input"]',
    )

    if (!input) {
      return false
    }

    input.focus({ preventScroll: true })
    return document.activeElement === input
  }

  function handleSearchAction() {
    setIsSearchOpen(true)

    if (focusMobileSearchInput()) {
      setSearchFocusTrigger(0)
      return
    }

    setSearchFocusTrigger((prev) => prev + 1)
  }

  function resetSearchDrawerInteractionState() {
    setSearchFocusTrigger(0)

    window.setTimeout(() => {
      const activeElement = document.activeElement

      if (activeElement instanceof HTMLElement) {
        activeElement.blur()
      }
    }, 0)
  }

  function handleSearchOpenChange(nextOpen: boolean) {
    setIsSearchOpen(nextOpen)

    if (nextOpen) {
      return
    }

    resetSearchDrawerInteractionState()
  }

  function handleSearchNavigate() {
    setIsSearchOpen(false)
    resetSearchDrawerInteractionState()
  }

  function handlePredictionResultsNavigate(href: Route) {
    setIsSearchOpen(false)
    resetSearchDrawerInteractionState()
    router.push(href)
  }

  async function handleInstallAction() {
    setIsGuestMenuOpen(false)

    if (isIos) {
      window.setTimeout(() => {
        setIsInstallDialogOpen(true)
      }, 120)
      return
    }

    try {
      await requestInstall()
    } catch {
      toast.error(t('An unexpected error occurred. Please try again.'))
    }
  }

  function handleAuthAction() {
    setIsGuestMenuOpen(false)
    window.setTimeout(() => {
      void openAppKit()
    }, 120)
  }

  function handleHowItWorksAction() {
    setIsGuestMenuOpen(false)
    window.setTimeout(() => {
      setIsHowItWorksOpen(true)
    }, 120)
  }

  return (
    <>
      <div aria-hidden="true" className="lg:hidden" style={{ height: MOBILE_BOTTOM_NAV_OFFSET }} />

      {isHowItWorksOpen && (
        <div className="lg:hidden">
          <Suspense fallback={null}>
            <HowItWorks open={isHowItWorksOpen} onOpenChange={setIsHowItWorksOpen} hideTrigger displayMode="mobile" />
          </Suspense>
        </div>
      )}

      <Drawer open={isSearchOpen} onOpenChange={handleSearchOpenChange}>
        <DrawerContent
          data-mobile-search-drawer="true"
          className={cn(
            `h-[90dvh] max-h-dvh overflow-y-auto rounded-none border-x-0 border-b-0 border-border/70 bg-background px-4 pt-2 pb-6`,
          )}
        >
          <DrawerHeader className="sr-only p-0">
            <DrawerTitle>{t('Search')}</DrawerTitle>
          </DrawerHeader>
          <div className="mt-4">
            {isSearchOpen && (
              <Suspense fallback={null}>
                <HeaderSearch
                  onNavigate={handleSearchNavigate}
                  onPredictionResultsNavigate={handlePredictionResultsNavigate}
                  emptyState={<SearchDiscoveryContent onNavigate={handleSearchNavigate} />}
                  focusTrigger={searchFocusTrigger}
                />
              </Suspense>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {!isAuthenticated && (
        <Drawer open={isGuestMenuOpen} onOpenChange={setIsGuestMenuOpen}>
          <DrawerContent
            className={cn(
              `max-h-[88vh] overflow-hidden rounded-t-[1.75rem] border-border/70 bg-background px-4 pt-2 pb-6`,
            )}
          >
            <div className="grid min-h-0 auto-rows-max gap-4 overflow-y-auto overscroll-contain pt-3">
              <div className="overflow-hidden rounded-2xl border border-border/70">
                {canShowInstallUi && (
                  <>
                    <button
                      type="button"
                      className={cn(
                        `flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold disabled:pointer-events-none disabled:opacity-50`,
                      )}
                      onClick={() => {
                        void handleInstallAction()
                      }}
                      disabled={isPrompting}
                    >
                      <DownloadIcon className="size-4 text-sky-500" />
                      {t('Install app')}
                    </button>

                    <div className="mx-4 h-px bg-border/70" />
                  </>
                )}

                <DrawerClose
                  nativeButton={false}
                  render={
                    <Link href="/leaderboard" className="flex items-center gap-3 px-4 py-3 text-sm font-semibold" />
                  }
                >
                  <TrophyIcon className="size-4 text-amber-500" />
                  {t('Leaderboard')}
                </DrawerClose>

                <div className="mx-4 h-px bg-border/70" />

                <DrawerClose
                  nativeButton={false}
                  render={
                    <Link
                      href="/docs/api-reference"
                      target="_blank"
                      prefetch={false}
                      rel="noreferrer"
                      className="flex items-center gap-3 px-4 py-3 text-sm font-semibold"
                    />
                  }
                >
                  <UnplugIcon className="size-4 text-pink-500" />
                  {t('APIs')}
                </DrawerClose>
              </div>

              <div className="rounded-2xl border border-border/70 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">{t('Dark Mode')}</span>
                  <ThemeSelector />
                </div>
              </div>

              <MobileLocaleSwitcher onLocaleChange={() => setIsGuestMenuOpen(false)} />

              <div className="overflow-hidden rounded-2xl border border-border/70">
                <DrawerClose
                  render={
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold"
                      onClick={handleHowItWorksAction}
                    />
                  }
                >
                  <InfoIcon className="size-4 text-muted-foreground" />
                  {t('How it works')}
                </DrawerClose>

                <div className="mx-4 h-px bg-border/70" />

                <DrawerClose
                  nativeButton={false}
                  render={
                    <Link
                      href="/docs"
                      target="_blank"
                      prefetch={false}
                      className="flex items-center gap-3 px-4 py-3 text-sm font-semibold"
                    />
                  }
                >
                  <BookOpenIcon className="size-4 text-muted-foreground" />
                  {t('Documentation')}
                </DrawerClose>

                <div className="mx-4 h-px bg-border/70" />

                <DrawerClose
                  nativeButton={false}
                  render={<Link href="/tos" className="flex items-center gap-3 px-4 py-3 text-sm font-semibold" />}
                >
                  <FileTextIcon className="size-4 text-muted-foreground" />
                  {t('Terms of Use')}
                </DrawerClose>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <DrawerClose
                  render={<Button type="button" variant="outline" className="h-10" onClick={handleAuthAction} />}
                >
                  {t('Log In')}
                </DrawerClose>
                <DrawerClose render={<Button type="button" className="h-10" onClick={handleAuthAction} />}>
                  {t('Sign Up')}
                </DrawerClose>
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      )}

      <PwaInstallDialog open={isInstallDialogOpen} onOpenChange={setIsInstallDialogOpen} />

      <nav className="fixed inset-x-0 bottom-0 z-40 lg:hidden" aria-label={t('Primary navigation')}>
        <div
          className={cn(
            `border-t border-border/70 bg-background/95 pb-[calc(env(safe-area-inset-bottom)+0.25rem)] shadow-[0_-20px_48px_-36px_rgba(15,23,42,0.55)] backdrop-blur-sm supports-backdrop-filter:bg-background/90`,
          )}
        >
          <div className="grid h-16.5 grid-cols-4">
            <MobileNavLink href="/" label={t('Home')} active={pathname === '/'} icon={HouseIcon} />
            <MobileNavButton label={t('Search')} active={isSearchOpen} onClick={handleSearchAction} icon={SearchIcon} />
            <MobileNavLink href="/new" label={t('New')} active={pathname === '/new'} icon={SparkleIcon} />
            {isAuthenticated ? (
              <MobilePortfolioNavLink active={pathname?.startsWith('/portfolio') ?? false} />
            ) : (
              <MobileNavButton
                label={t('More')}
                active={isGuestMenuOpen}
                onClick={() => setIsGuestMenuOpen(true)}
                icon={MenuIcon}
              />
            )}
          </div>
        </div>
      </nav>
    </>
  )
}

interface MobileNavLinkProps {
  active: boolean
  href: ComponentProps<typeof Link>['href']
  icon: typeof HouseIcon
  label: ReactNode
}

function MobileNavLink({ active, href, icon: Icon, label }: MobileNavLinkProps) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        `flex size-full flex-col items-center justify-center gap-1 px-2 text-[11px] leading-none font-semibold transition-colors`,
        active ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      <Icon className="size-[17px]" />
      <span className="max-w-full truncate">{label}</span>
    </Link>
  )
}

function MobilePortfolioNavLink({ active }: { active: boolean }) {
  const t = useExtracted()
  const { balance, isLoadingBalance } = useBalance()
  const { isLoading, value: positionsValue } = usePortfolioValue()
  const areValuesHidden = usePortfolioValueVisibility((state) => state.isHidden)
  const isLoadingValue = isLoadingBalance || isLoading
  const totalPortfolioValue = (positionsValue ?? 0) + (balance?.raw ?? 0)
  const portfolioValueLabel = Number.isFinite(totalPortfolioValue)
    ? formatCompactCurrency(totalPortfolioValue)
    : '$0.00'

  return (
    <Link
      href="/portfolio"
      aria-current={active ? 'page' : undefined}
      aria-label={t('Portfolio')}
      className={cn(
        `flex size-full flex-col items-center justify-center gap-1 px-2 text-[11px] leading-none font-semibold transition-colors`,
        active ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      <ChartLineIcon className="size-[17px]" />
      {isLoadingValue ? (
        <Skeleton className="h-3 w-12 rounded-full" />
      ) : (
        <span className="max-w-full truncate">{areValuesHidden ? '****' : portfolioValueLabel}</span>
      )}
    </Link>
  )
}

interface MobileNavButtonProps {
  active: boolean
  icon: typeof HouseIcon
  label: string
  onClick: () => void
}

function MobileNavButton({ active, icon: Icon, label, onClick }: MobileNavButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        `flex size-full flex-col items-center justify-center gap-1 px-2 text-[11px] leading-none font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none`,
        active ? 'text-foreground' : 'text-muted-foreground',
      )}
      aria-label={label}
    >
      <Icon className="size-[17px]" />
      <span>{label}</span>
    </button>
  )
}

interface MobileLocaleSwitcherProps {
  onLocaleChange?: () => void
}

function useEnabledLocalesFetch() {
  const [enabledLocales, setEnabledLocales] = useState<SupportedLocale[]>([...SUPPORTED_LOCALES])

  useEffect(function fetchEnabledLocalesOnMount() {
    let isActive = true

    async function loadEnabledLocales() {
      try {
        const response = await fetch('/api/locales')
        if (!response.ok) {
          return
        }

        const payload = await response.json()
        if (!isActive || !Array.isArray(payload?.locales)) {
          return
        }

        const normalized = normalizeEnabledLocales(payload.locales)
        if (normalized.length > 0) {
          setEnabledLocales(normalized)
        }
      } catch (error) {
        console.error('Failed to load enabled locales', error)
      }
    }

    void loadEnabledLocales()

    return function cancelEnabledLocalesFetch() {
      isActive = false
    }
  }, [])

  return enabledLocales
}

function useLocaleChangeHandler({
  locale,
  onLocaleChange,
}: {
  locale: SupportedLocale
  onLocaleChange: (() => void) | undefined
}) {
  const [isPending, setIsPending] = useState(false)

  function handleLocaleChange(nextLocale: SupportedLocale) {
    if (nextLocale === locale || typeof window === 'undefined') {
      return
    }

    const currentPathname = stripLocalePrefix(window.location.pathname)
    const targetPathname = withLocalePrefix(currentPathname, nextLocale)
    const targetUrl = `${targetPathname}${window.location.search}${window.location.hash}`

    onLocaleChange?.()
    setIsPending(true)
    window.location.replace(targetUrl)
  }

  return { isPending, handleLocaleChange }
}

function MobileLocaleSwitcher({ onLocaleChange }: MobileLocaleSwitcherProps) {
  const t = useExtracted()
  const locale = useLocale() as SupportedLocale
  const enabledLocales = useEnabledLocalesFetch()
  const { isPending, handleLocaleChange } = useLocaleChangeHandler({ locale, onLocaleChange })

  return (
    <div className="rounded-2xl border border-border/70 px-4 py-3">
      <div className="mb-3 text-sm font-semibold">
        <span>{LOOP_LABELS[locale] ?? t('Language')}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {enabledLocales.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={option === locale ? 'default' : 'outline'}
            className="justify-between"
            onClick={() => handleLocaleChange(option)}
            disabled={isPending}
          >
            <span className="flex min-w-0 items-center gap-2">
              <LocaleFlag locale={option} />
              <span className="truncate">{LOCALE_LABELS[option] ?? option.toUpperCase()}</span>
            </span>
            {option === locale && <CheckIcon className="size-4" />}
          </Button>
        ))}
      </div>
    </div>
  )
}
