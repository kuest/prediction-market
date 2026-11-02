import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import type { User } from '@/types'

import { useUser } from '@/stores/useUser'

import { hoisted, stubEnv, unstubAllEnvs } from '../bun-test-helpers'

const mocks = hoisted(() => ({ sendGAEvent: mock(), gaId: 'G-OPERATOR' as string | null }))
void mock.module('@next/third-parties/google', () => ({ sendGAEvent: mocks.sendGAEvent }))
void mock.module('@/hooks/useSiteIdentity', () => ({
  useSiteIdentity: () => ({ googleAnalyticsId: mocks.gaId }),
}))

const { useOperatorAnalytics } = await import('@/hooks/useOperatorAnalytics')

beforeEach(() => {
  stubEnv('NODE_ENV', 'production')
  mocks.gaId = 'G-OPERATOR'
  mocks.sendGAEvent.mockReset()
  useUser.setState({ is_admin: false } as User)
})
afterEach(() => {
  useUser.setState(null)
  window.history.replaceState(null, '', '/')
  document.title = ''
  unstubAllEnvs()
})

describe('operator analytics', () => {
  it('sends only milestone names to the configured operator without user data', () => {
    window.history.replaceState(null, '', '/@private-user?email=private%40example.com')
    document.title = 'private-user'
    const { result } = renderHook(useOperatorAnalytics)
    for (const event of ['profile_completed', 'trading_enabled', 'deposit_confirmed'] as const) {
      result.current(event)
      expect(mocks.sendGAEvent).toHaveBeenLastCalledWith('event', event, {
        send_to: 'G-OPERATOR',
        page_location: 'http://localhost:3000/',
        page_title: 'Platform',
        page_referrer: '',
      })
    }
    expect(mocks.sendGAEvent).toHaveBeenCalledTimes(3)
  })

  it('does nothing when the operator has not enabled GA', () => {
    mocks.gaId = null
    const { result } = renderHook(useOperatorAnalytics)
    result.current('profile_completed')
    expect(mocks.sendGAEvent).not.toHaveBeenCalled()
  })

  it('does nothing outside production', () => {
    stubEnv('NODE_ENV', 'development')
    const { result } = renderHook(useOperatorAnalytics)
    result.current('deposit_confirmed')
    expect(mocks.sendGAEvent).not.toHaveBeenCalled()
  })

  it('omits all three milestones for a confirmed administrator', () => {
    useUser.setState({ is_admin: true } as User)
    const { result } = renderHook(useOperatorAnalytics)
    for (const event of ['profile_completed', 'trading_enabled', 'deposit_confirmed'] as const) {
      result.current(event)
    }
    expect(mocks.sendGAEvent).not.toHaveBeenCalled()
  })

  it('drops unknown roles without replay and checks the latest role at emission', () => {
    useUser.setState(null)
    const { result } = renderHook(useOperatorAnalytics)
    result.current('profile_completed')
    useUser.setState({} as User)
    result.current('trading_enabled')
    useUser.setState({ is_admin: false } as User)
    expect(mocks.sendGAEvent).not.toHaveBeenCalled()
    result.current('deposit_confirmed')
    expect(mocks.sendGAEvent).toHaveBeenCalledTimes(1)
    expect(mocks.sendGAEvent.mock.calls[0][1]).toBe('deposit_confirmed')
    useUser.setState({ is_admin: true } as User)
    result.current('deposit_confirmed')
    expect(mocks.sendGAEvent).toHaveBeenCalledTimes(1)
  })

  it('does not interrupt the successful operation if analytics fails', () => {
    mocks.sendGAEvent.mockImplementation(() => {
      throw new Error('unavailable')
    })
    const { result } = renderHook(useOperatorAnalytics)
    expect(() => result.current('trading_enabled')).not.toThrow()
  })
})
