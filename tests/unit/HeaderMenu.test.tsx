import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  openAppKit: mock(),
  useIsMobile: mock(),
  useOptionalTradingOnboarding: mock(),
  useSession: mock(),
  useUser: mock(),
}))

void mock.module('next-intl', () => ({
  useExtracted: () => (value: string) => value,
}))

void mock.module('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

void mock.module('@/app/[locale]/(platform)/_components/HeaderDropdownUserMenuGuest', () => ({
  default: () => <div data-testid="header-guest-menu" />,
}))

void mock.module('@/app/[locale]/(platform)/_components/HeaderNotifications', () => ({
  default: () => <div data-testid="header-notifications" />,
}))

void mock.module('@/app/[locale]/(platform)/_providers/TradingOnboardingContext', () => ({
  useOptionalTradingOnboarding: () => mocks.useOptionalTradingOnboarding(),
}))

void mock.module('@/components/HeaderDropdownUserMenuAuth', () => ({
  default: () => <div data-testid="header-auth-menu" />,
}))

void mock.module('@/components/HeaderPortfolio', () => ({
  default: () => <div data-testid="header-portfolio" />,
}))

void mock.module('@/hooks/useAppKit', () => ({
  useAppKit: () => ({ open: mocks.openAppKit }),
}))

void mock.module('@/hooks/useHasHydrated', () => ({
  useHasHydrated: () => true,
}))

void mock.module('@/hooks/useIsMobile', () => ({
  useIsMobile: () => mocks.useIsMobile(),
}))

void mock.module('@/lib/auth-client', () => ({
  authClient: {
    useSession: mocks.useSession,
  },
}))

void mock.module('@/stores/useUser', () => ({
  useUser: () => mocks.useUser(),
}))

const { default: HeaderMenu } = await import('@/app/[locale]/(platform)/_components/HeaderMenu')

describe('HeaderMenu', () => {
  beforeEach(() => {
    mocks.openAppKit.mockReset()
    mocks.useIsMobile.mockReset().mockReturnValue(false)
    mocks.useOptionalTradingOnboarding.mockReset().mockReturnValue(null)
    mocks.useSession.mockReset().mockReturnValue({ data: null, isPending: false })
    mocks.useUser.mockReset().mockReturnValue(null)
  })

  it('keeps the skeleton visible until a logged-in session resolves', async () => {
    mocks.useSession.mockReturnValue({ data: null, isPending: true })

    const view = render(<HeaderMenu />)

    expect(screen.getByTestId('header-menu-skeleton')).toBeInTheDocument()
    expect(screen.queryByTestId('header-login-button')).not.toBeInTheDocument()

    mocks.useSession.mockReturnValue({ data: { user: { id: 'user-1' } }, isPending: false })
    view.rerender(<HeaderMenu />)

    expect(screen.queryByTestId('header-login-button')).not.toBeInTheDocument()
    expect(await screen.findByTestId('header-auth-menu')).toBeInTheDocument()
    expect(screen.queryByTestId('header-menu-skeleton')).not.toBeInTheDocument()
    expect(await screen.findByTestId('header-notifications')).toBeInTheDocument()
    expect(await screen.findByTestId('header-portfolio')).toBeInTheDocument()
  })

  it('shows guest actions after an anonymous session resolves', () => {
    mocks.useSession.mockReturnValue({ data: null, isPending: false })

    render(<HeaderMenu />)

    expect(screen.queryByTestId('header-menu-skeleton')).not.toBeInTheDocument()
    expect(screen.getByTestId('header-login-button')).toBeInTheDocument()
    expect(screen.getByTestId('header-guest-menu')).toBeInTheDocument()
    expect(screen.queryByTestId('header-auth-menu')).not.toBeInTheDocument()
    expect(screen.queryByTestId('header-notifications')).not.toBeInTheDocument()
    expect(screen.queryByTestId('header-portfolio')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('header-login-button'))
    fireEvent.click(screen.getByTestId('header-signup-button'))
    expect(mocks.openAppKit).toHaveBeenCalledTimes(2)
  })

  it('loads account controls after sign-in and removes them after sign-out', async () => {
    const view = render(<HeaderMenu />)

    mocks.useSession.mockReturnValue({ data: { user: { id: 'user-1' } }, isPending: false })
    view.rerender(<HeaderMenu />)
    expect(await screen.findByTestId('header-auth-menu')).toBeInTheDocument()

    mocks.useSession.mockReturnValue({ data: null, isPending: false })
    view.rerender(<HeaderMenu />)

    expect(screen.getByTestId('header-login-button')).toBeInTheDocument()
    expect(screen.queryByTestId('header-auth-menu')).not.toBeInTheDocument()
    expect(screen.queryByTestId('header-notifications')).not.toBeInTheDocument()
    expect(screen.queryByTestId('header-portfolio')).not.toBeInTheDocument()
  })

  it('keeps mobile account controls available without mounting desktop balances', async () => {
    mocks.useIsMobile.mockReturnValue(true)
    mocks.useUser.mockReturnValue({ id: 'user-1' })

    render(<HeaderMenu />)

    expect(await screen.findByTestId('header-auth-menu')).toBeInTheDocument()
    expect(await screen.findByTestId('header-notifications')).toBeInTheDocument()
    expect(screen.queryByTestId('header-portfolio')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deposit' })).not.toBeInTheDocument()
  })

  it('preserves the trading-onboarding deposit action after the account UI loads', async () => {
    const startDepositFlow = mock()
    mocks.useOptionalTradingOnboarding.mockReturnValue({ startDepositFlow })
    mocks.useSession.mockReturnValue({ data: { user: { id: 'user-1' } }, isPending: false })

    render(<HeaderMenu />)
    await screen.findByTestId('header-auth-menu')
    fireEvent.click(screen.getByRole('button', { name: 'Deposit' }))

    expect(startDepositFlow).toHaveBeenCalledTimes(1)
  })
})
