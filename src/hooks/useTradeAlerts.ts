'use client'

import { useLocale } from 'next-intl'
import { useCallback, useEffect } from 'react'
import { useSignMessage } from 'wagmi'

import { usePublicRuntimeConfig } from '@/hooks/usePublicRuntimeConfig'
import { useSignaturePromptRunner } from '@/hooks/useSignaturePromptRunner'
import { clearCommunityAuth, ensureCommunityToken, loadCommunityAuth } from '@/lib/community-auth'
import {
  deleteCommunityPushSubscription,
  getCommunityVapidPublicKey,
  hashPushEndpoint,
  upsertCommunityPushSubscription,
} from '@/lib/community-push'
import { decodeVapidPublicKey } from '@/lib/trade-alerts'
import { setTradeAlertsNeedsSync } from '@/lib/trade-alerts-idb'
import { useTradeAlertsStore } from '@/stores/useTradeAlerts'
import { useUser } from '@/stores/useUser'

const SUBSCRIPTION_STATE_KEY = 'community_trade_alert_subscription_v1'

interface StoredSubscriptionState {
  address: string
  endpointHash: string
  profileId: string | null
}

function supportsWebPush() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

function loadSubscriptionState(address?: string) {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    const state = JSON.parse(window.localStorage.getItem(SUBSCRIPTION_STATE_KEY) ?? 'null') as StoredSubscriptionState
    if (!state?.endpointHash || (address && state.address.toLowerCase() !== address.toLowerCase())) {
      return null
    }
    return state
  } catch {
    return null
  }
}

function saveSubscriptionState(state: StoredSubscriptionState | null) {
  if (typeof window === 'undefined') {
    return
  }
  if (state) {
    window.localStorage.setItem(SUBSCRIPTION_STATE_KEY, JSON.stringify(state))
  } else {
    window.localStorage.removeItem(SUBSCRIPTION_STATE_KEY)
  }
}

export function useTradeAlerts() {
  const user = useUser()
  const locale = useLocale()
  const { communityUrl } = usePublicRuntimeConfig()
  const { signMessageAsync } = useSignMessage()
  const { runWithSignaturePrompt } = useSignaturePromptRunner()
  const enabled = useTradeAlertsStore((state) => state.enabled)
  const loading = useTradeAlertsStore((state) => state.loading)
  const permission = useTradeAlertsStore((state) => state.permission)

  const refreshState = useCallback(async () => {
    if (!supportsWebPush()) {
      useTradeAlertsStore.setState({ enabled: false, permission: 'unsupported' })
      return
    }
    const registration = await navigator.serviceWorker.getRegistration('/')
    const subscription = await registration?.pushManager.getSubscription()
    const stored = loadSubscriptionState(user?.address)
    useTradeAlertsStore.setState({
      enabled: Boolean(subscription && stored),
      permission: Notification.permission,
      profileId: stored?.profileId ?? null,
    })
  }, [user?.address])

  useEffect(() => {
    void refreshState()
  }, [refreshState])

  const enable = useCallback(async () => {
    if (!user?.address || !supportsWebPush()) {
      useTradeAlertsStore.setState({ permission: 'unsupported' })
      return false
    }
    useTradeAlertsStore.setState({ loading: true })
    try {
      const result = await Notification.requestPermission()
      useTradeAlertsStore.setState({ permission: result })
      if (result !== 'granted') {
        return false
      }
      const [registration, publicKey] = await Promise.all([
        navigator.serviceWorker.ready,
        getCommunityVapidPublicKey(communityUrl),
      ])
      const existing = await registration.pushManager.getSubscription()
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidPublicKey(publicKey),
        }))
      const token = await ensureCommunityToken({
        address: user.address,
        depositWalletAddress: user.deposit_wallet_address ?? null,
        communityApiUrl: communityUrl,
        signMessageAsync: (args) => runWithSignaturePrompt(() => signMessageAsync(args)),
      })
      const response = await upsertCommunityPushSubscription({
        communityApiUrl: communityUrl,
        token,
        subscription,
        locale,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      })
      const state = {
        address: user.address.toLowerCase(),
        endpointHash: response.endpointHash,
        profileId: response.profileId,
      }
      saveSubscriptionState(state)
      await setTradeAlertsNeedsSync(false)
      useTradeAlertsStore.setState({ enabled: true, profileId: response.profileId })
      return true
    } catch (error) {
      if (error instanceof Error && /session|authorization/i.test(error.message)) {
        clearCommunityAuth()
      }
      throw error
    } finally {
      useTradeAlertsStore.setState({ loading: false })
    }
  }, [communityUrl, locale, runWithSignaturePrompt, signMessageAsync, user])

  const address = user?.address
  const disable = useCallback(async () => {
    useTradeAlertsStore.setState({ loading: true })
    try {
      const registration = supportsWebPush() ? await navigator.serviceWorker.getRegistration('/') : undefined
      const subscription = await registration?.pushManager.getSubscription()
      const stored = loadSubscriptionState(address)
      const token = address ? loadCommunityAuth(address)?.token : null
      const endpointHash = stored?.endpointHash ?? (subscription ? await hashPushEndpoint(subscription.endpoint) : null)
      if (token && endpointHash) {
        await deleteCommunityPushSubscription({ communityApiUrl: communityUrl, token, endpointHash })
      }
      await subscription?.unsubscribe()
      saveSubscriptionState(null)
      useTradeAlertsStore.setState({ enabled: false, profileId: null })
      return true
    } finally {
      useTradeAlertsStore.setState({ loading: false })
    }
  }, [address, communityUrl])

  return { enabled, loading, permission, enable, disable, refreshState, supported: permission !== 'unsupported' }
}

export async function detachTradeAlertsBeforeLogout(communityApiUrl: string, address: string) {
  const stored = loadSubscriptionState(address)
  const token = loadCommunityAuth(address)?.token
  try {
    if (stored && token) {
      await deleteCommunityPushSubscription({ communityApiUrl, token, endpointHash: stored.endpointHash })
    }
  } finally {
    if (supportsWebPush()) {
      const registration = await navigator.serviceWorker.getRegistration('/')
      const subscription = await registration?.pushManager.getSubscription()
      await subscription?.unsubscribe()
    }
    saveSubscriptionState(null)
  }
}
