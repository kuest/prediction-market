'use client'

import { sendGAEvent } from '@next/third-parties/google'
import { useCallback } from 'react'

import { useSiteIdentity } from '@/hooks/useSiteIdentity'
import { useUser } from '@/stores/useUser'

type OperatorAnalyticsEvent = 'profile_completed' | 'trading_enabled' | 'deposit_confirmed'

export function useOperatorAnalytics() {
  const { googleAnalyticsId } = useSiteIdentity()

  return useCallback(
    (event: OperatorAnalyticsEvent) => {
      // The existing session supplies this role. Drop unknown roles without replay.
      if (process.env.NODE_ENV !== 'production' || !googleAnalyticsId || useUser.getState()?.is_admin !== false) {
        return
      }
      try {
        sendGAEvent('event', event, {
          send_to: googleAnalyticsId,
          // These milestones do not need profile/search URLs or user-specific titles.
          page_location: `${window.location.origin}/`,
          page_title: 'Platform',
          page_referrer: '',
        })
      } catch {
        // Analytics must never interrupt onboarding or a confirmed deposit.
      }
    },
    [googleAnalyticsId],
  )
}
