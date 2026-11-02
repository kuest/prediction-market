import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { cloneElement } from 'react'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  push: mock(),
  useHasHydrated: mock(),
  useSession: mock(),
  useUser: mock(),
}))

void mock.module('@/app/[locale]/(platform)/_components/HeaderSearch', () => ({
  default: ({ emptyState, onPredictionResultsNavigate }: any) => (
    <>
      <input data-testid="header-search-input" />
      <button onClick={() => onPredictionResultsNavigate('/predictions/canada')}>See all results</button>
      {emptyState}
    </>
  ),
}))

void mock.module('next-intl', () => ({
  useExtracted: () => (value: string) => value,
  useLocale: () => 'en',
}))

void mock.module('@/app/[locale]/(platform)/_components/SearchDiscoveryContent', () => ({
  default: () => <div data-testid="search-discovery" />,
}))

void mock.module('@/components/PwaInstallDialog', () => ({
  default: () => <div data-testid="pwa-install-dialog" />,
}))

void mock.module('@/components/ThemeSelector', () => ({
  default: () => <div data-testid="theme-selector" />,
}))

void mock.module('@/components/ui/button', () => ({
  Button: function MockButton({ children, nativeButton: _nativeButton, render, ...props }: any) {
    return render ?? <button {...props}>{children}</button>
  },
}))

void mock.module('@/components/ui/drawer', () => ({
  Drawer: ({ children }: any) => <div>{children}</div>,
  DrawerClose: ({ children, render: close }: any) => cloneElement(close, {}, children),
  DrawerContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  DrawerHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  DrawerTitle: ({ children }: any) => <div>{children}</div>,
}))

void mock.module('@/components/ui/skeleton', () => ({
  Skeleton: (props: any) => <span {...props} />,
}))

void mock.module('@/hooks/useAppKit', () => ({
  useAppKit: () => ({ open: mock() }),
}))

void mock.module('@/hooks/useBalance', () => ({
  useBalance: () => ({ balance: { raw: 0 }, isLoadingBalance: false }),
}))

void mock.module('@/hooks/useHasHydrated', () => ({
  useHasHydrated: () => mocks.useHasHydrated(),
}))

void mock.module('@/hooks/usePortfolioValue', () => ({
  usePortfolioValue: () => ({ isLoading: false, value: 0 }),
}))

void mock.module('@/hooks/usePwaInstall', () => ({
  usePwaInstall: () => ({
    canShowInstallUi: false,
    isIos: false,
    isPrompting: false,
    requestInstall: mock(),
  }),
}))

void mock.module('@/i18n/navigation', () => ({
  Link: function MockLink({ children, href, ...props }: any) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
  usePathname: () => '/crypto',
  useRouter: () => ({ push: mocks.push }),
}))

void mock.module('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => mocks.useSession(),
  },
}))

void mock.module('@/stores/usePortfolioValueVisibility', () => ({
  usePortfolioValueVisibility: (selector: (state: { isHidden: boolean }) => unknown) => selector({ isHidden: false }),
}))

void mock.module('@/stores/useUser', () => ({
  useUser: () => mocks.useUser(),
}))

const { default: MobileBottomNav } = await import('@/app/[locale]/(platform)/_components/MobileBottomNav')

describe('mobileBottomNav', () => {
  beforeEach(() => {
    mocks.push.mockReset()
    mocks.useHasHydrated.mockReset()
    mocks.useSession.mockReset()
    mocks.useUser.mockReset()
    mocks.useHasHydrated.mockReturnValue(false)
    mocks.useSession.mockReturnValue({ data: { user: { id: 'user-1' } } })
    mocks.useUser.mockReturnValue({ id: 'user-1' })
  })

  it('keeps the hydration render on the guest fourth-tab shape', () => {
    render(<MobileBottomNav />)

    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Portfolio' })).not.toBeInTheDocument()
  })

  it('shows the portfolio tab after hydration for authenticated users', () => {
    mocks.useHasHydrated.mockReturnValue(true)

    render(<MobileBottomNav />)

    expect(screen.getByRole('link', { name: 'Portfolio' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
  })

  it('loads mobile discovery when search opens and closes the drawer after navigation', async () => {
    render(<MobileBottomNav />)

    expect(screen.queryByTestId('search-discovery')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(await screen.findByTestId('header-search-input')).toBeInTheDocument()
    expect(await screen.findByTestId('search-discovery')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'See all results' }))

    expect(mocks.push).toHaveBeenCalledWith('/predictions/canada')
    expect(screen.queryByTestId('search-discovery')).not.toBeInTheDocument()
    expect(screen.queryByTestId('header-search-input')).not.toBeInTheDocument()
  })
})
