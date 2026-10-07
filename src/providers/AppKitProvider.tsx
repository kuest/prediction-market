'use client'

import type { AppKit } from '@reown/appkit'
import type { AppKitSIWEClient, SIWECreateMessageArgs, SIWESession, SIWEVerifyMessageArgs } from '@reown/appkit-siwe'
import type { ReactNode } from 'react'
import type { Config } from 'wagmi'

import { ChainController, SIWXUtil } from '@reown/appkit-controllers'
import { createSIWEConfig, formatMessage, getAddressFromMessage, getDidAddress } from '@reown/appkit-siwe'
import { createAppKit, useAppKitAccount, useAppKitTheme } from '@reown/appkit/react'
import { useExtracted } from 'next-intl'
import { useTheme } from 'next-themes'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getAddress, isAddress } from 'viem'
import { WagmiProvider } from 'wagmi'

import type { User } from '@/types'

import { SignaturePromptHost } from '@/components/SignaturePromptHost'
import { toast } from '@/components/ui/toast'
import { AppKitContext, defaultAppKitValue } from '@/hooks/useAppKit'
import { useHasHydrated } from '@/hooks/useHasHydrated'
import { usePolymarketWalletConnection } from '@/hooks/usePolymarketWalletConnection'
import { usePublicRuntimeConfig } from '@/hooks/usePublicRuntimeConfig'
import { useSiteIdentity } from '@/hooks/useSiteIdentity'
import { detachTradeAlertsBeforeLogout } from '@/hooks/useTradeAlerts'
import { createAppKitWagmiAdapter, defaultNetwork, networks } from '@/lib/appkit'
import { authClient } from '@/lib/auth-client'
import { IS_BROWSER } from '@/lib/constants'
import { clearBrowserStorage, clearNonHttpOnlyCookies } from '@/lib/utils'
import { mergeSessionUserState, useUser } from '@/stores/useUser'

let hasInitializedAppKit = false
let appKitInstance: AppKit | null = null
let appKitSiweClient: AppKitSIWEClient | null = null
let hasInstalledSiwxRequestSignMessageLock = false
const appKitStateListeners = new Set<() => void>()
const APPKIT_INIT_RETRY_DELAY_MS = 3000
const AUTOMATIC_SIWE_SETTLE_DELAY_MS = 750
const SIWE_ACCOUNT_PLACEHOLDER = '<<AccountAddress>>'
const pendingSiweNonces = new Set<string>()

type SiweFormatMessageParams = Parameters<typeof formatMessage>[0]
interface AuthSessionUser {
  address?: unknown
}

function isPendingSiweAccountAddress(address: string | undefined) {
  const normalized = address?.trim()
  if (!normalized || normalized.includes(SIWE_ACCOUNT_PLACEHOLDER)) {
    return true
  }

  const parts = normalized.split(':')
  return parts.length > 1 && !parts[parts.length - 1]?.trim()
}

function normalizeSiweAddressCandidate(address: string | undefined) {
  const normalized = address?.trim().replace(/^0X/u, '0x')
  if (!normalized || !isAddress(normalized)) {
    return null
  }

  return getAddress(normalized)
}

function normalizeSiweWalletAddress(address: string | undefined) {
  const normalizedAddress = address?.trim()
  if (!normalizedAddress) {
    throw new Error('SIWE wallet address is required')
  }

  const parts = normalizedAddress.split(':')
  const candidates = [
    normalizedAddress,
    getDidAddress(normalizedAddress),
    parts.length > 1 ? parts[parts.length - 1] : undefined,
  ]

  for (const candidate of candidates) {
    const walletAddress = normalizeSiweAddressCandidate(candidate)
    if (walletAddress) {
      return walletAddress
    }
  }

  throw new Error(`SIWE wallet address is invalid: ${normalizedAddress}`)
}

function normalizeSiweMessageIssuer(address: string, chainId: number) {
  if (isPendingSiweAccountAddress(address)) {
    return `did:pkh:eip155:${chainId}:${SIWE_ACCOUNT_PLACEHOLDER}`
  }

  const walletAddress = normalizeSiweWalletAddress(address)
  const parts = address.split(':')

  if (parts.length <= 1) {
    return `did:pkh:eip155:${chainId}:${walletAddress}`
  }

  parts[parts.length - 1] = walletAddress
  return parts.join(':')
}

function getSiweNonceErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object') {
    return 'Unable to create SIWE nonce'
  }

  const fields = error as Record<string, unknown>
  const details = [
    typeof fields.code === 'string' ? fields.code : '',
    typeof fields.message === 'string' ? fields.message : '',
    typeof fields.status === 'number' ? `status ${fields.status}` : '',
  ]
    .filter(Boolean)
    .join(' - ')

  return details ? `Unable to create SIWE nonce: ${details}` : 'Unable to create SIWE nonce'
}

function getSiweMessageNonce(message: string) {
  return message.match(/^Nonce: (?<nonce>.+)$/mu)?.groups?.nonce ?? null
}

function waitForAutomaticSiwe(delayMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

function getSiweAccountLockKey() {
  return ChainController.getActiveCaipAddress()?.toLowerCase() ?? null
}

function installSiwxRequestSignMessageLock() {
  if (hasInstalledSiwxRequestSignMessageLock) {
    return
  }

  const requestSignMessage = SIWXUtil.requestSignMessage.bind(SIWXUtil)
  const requestPromises = new Map<string, Promise<void>>()

  SIWXUtil.requestSignMessage = () => {
    const accountKey = getSiweAccountLockKey()
    if (!accountKey) {
      return requestSignMessage()
    }

    const existingRequest = requestPromises.get(accountKey)
    if (existingRequest) {
      return existingRequest
    }

    const requestPromise = requestSignMessage().finally(() => {
      if (requestPromises.get(accountKey) === requestPromise) {
        requestPromises.delete(accountKey)
      }
    })
    requestPromises.set(accountKey, requestPromise)
    return requestPromise
  }
  hasInstalledSiwxRequestSignMessageLock = true
}

function installSiweSignInLock(siweClient: AppKitSIWEClient) {
  const signIn = siweClient.signIn.bind(siweClient)
  const signInPromises = new Map<string, Promise<SIWESession>>()

  siweClient.signIn = () => {
    const accountKey = getSiweAccountLockKey()
    if (!accountKey) {
      return signIn()
    }

    const existingSignIn = signInPromises.get(accountKey)
    if (existingSignIn) {
      return existingSignIn
    }

    const signInPromise = signIn().finally(() => {
      if (signInPromises.get(accountKey) === signInPromise) {
        signInPromises.delete(accountKey)
      }
    })
    signInPromises.set(accountKey, signInPromise)
    return signInPromise
  }
}

function AutoSiweAuthentication({ siweClient }: { siweClient: AppKitSIWEClient }) {
  const t = useExtracted()
  const { address, embeddedWalletInfo, isConnected } = useAppKitAccount({ namespace: 'eip155' })
  const attemptedAddressRef = useRef<string | null>(null)

  useEffect(() => {
    const normalizedAddress = address?.toLowerCase()
    if (!isConnected || !normalizedAddress) {
      attemptedAddressRef.current = null
      return
    }

    // Embedded wallets already perform SIWX as part of their AppKit auth flow.
    if (embeddedWalletInfo || attemptedAddressRef.current === normalizedAddress) {
      return
    }

    attemptedAddressRef.current = normalizedAddress
    let cancelled = false
    let attemptInFlight = true
    function resetAttemptedAddress() {
      if (attemptedAddressRef.current === normalizedAddress) {
        attemptedAddressRef.current = null
      }
    }

    void (async () => {
      const session = await authClient.getSession()
      if (cancelled) {
        return
      }
      if (session.error) {
        attemptInFlight = false
        resetAttemptedAddress()
        return
      }
      if (session.data?.user) {
        attemptInFlight = false
        return
      }

      await waitForAutomaticSiwe(AUTOMATIC_SIWE_SETTLE_DELAY_MS)
      if (cancelled) {
        return
      }

      const latestSession = await authClient.getSession()
      if (cancelled) {
        return
      }
      if (latestSession.error) {
        attemptInFlight = false
        resetAttemptedAddress()
        return
      }
      if (latestSession.data?.user) {
        attemptInFlight = false
        return
      }

      if (await isCurrentRegionBlocked()) {
        if (cancelled) {
          return
        }

        attemptInFlight = false
        toast.warning(t('This platform is not currently available in your region.'))
        return
      }

      await siweClient.signIn()
      attemptInFlight = false
    })().catch((error) => {
      if (!cancelled) {
        attemptInFlight = false
        resetAttemptedAddress()
        console.warn('[SIWE] Automatic wallet authentication failed', error)
        toast.error(t('An unexpected error occurred. Please try again.'))
      }
    })

    return () => {
      cancelled = true
      if (attemptInFlight) {
        resetAttemptedAddress()
      }
    }
  }, [address, embeddedWalletInfo, isConnected, siweClient, t])

  return null
}

function createSiweMessage(args: SIWECreateMessageArgs, chainId: number) {
  const { address, chainId: _messageChainId, ...messageParams } = args

  return formatMessage(messageParams satisfies SiweFormatMessageParams, normalizeSiweMessageIssuer(address, chainId))
}

function getAuthSessionUserAddress(user: unknown) {
  const address = (user as AuthSessionUser).address
  return typeof address === 'string' ? address : null
}

async function createPendingSiweNonce() {
  const response = await fetch('/api/siwe/pending-nonce', {
    method: 'POST',
    headers: {
      accept: 'application/json',
    },
  })

  const payload = (await response.json().catch(() => null)) as { nonce?: unknown; error?: unknown } | null
  if (!response.ok || typeof payload?.nonce !== 'string') {
    const message = typeof payload?.error === 'string' ? payload.error : `status ${response.status}`
    throw new Error(`Unable to create pending SIWE nonce: ${message}`)
  }

  pendingSiweNonces.add(payload.nonce)
  return payload.nonce
}

async function bindPendingSiweNonce({
  chainId,
  message,
  walletAddress,
}: {
  chainId: number
  message: string
  walletAddress: string
}) {
  const nonce = getSiweMessageNonce(message)
  if (!nonce || !pendingSiweNonces.has(nonce)) {
    return
  }

  const response = await fetch('/api/siwe/bind-nonce', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      chainId,
      nonce,
      walletAddress,
    }),
  })

  pendingSiweNonces.delete(nonce)

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null
    const message = typeof payload?.error === 'string' ? payload.error : `status ${response.status}`
    throw new Error(`Unable to bind pending SIWE nonce: ${message}`)
  }
}

function logSiweVerificationFailure(reason: string, details?: Record<string, unknown>) {
  console.error(`[SIWE] ${reason}`, details)
}

function clearAppKitState() {
  if (!IS_BROWSER) {
    return
  }

  clearBrowserStorage()
  clearNonHttpOnlyCookies()
}

function notifyAppKitStateChange() {
  appKitStateListeners.forEach((listener) => {
    listener()
  })
}

function subscribeAppKitStateChange(onStoreChange: () => void) {
  appKitStateListeners.add(onStoreChange)
  return () => {
    appKitStateListeners.delete(onStoreChange)
  }
}

function getAppKitInstanceSnapshot() {
  return appKitInstance
}

function getAppKitSiweClientSnapshot() {
  return appKitSiweClient
}

function initializeAppKitSingleton(
  themeMode: 'light' | 'dark',
  site: { name: string; description: string; logoUrl: string },
  runtimeConfig: { projectId: string; siteUrl: string },
  wagmiAdapter: ReturnType<typeof createAppKitWagmiAdapter>,
) {
  if (hasInitializedAppKit || !IS_BROWSER || !runtimeConfig.projectId) {
    return appKitInstance
  }

  try {
    const siweClient = createSIWEConfig({
      // Multi-wallet arbitrage briefly activates the second wallet before restoring
      // the authenticated Kuest wallet. Keep the Better Auth session intact.
      signOutOnAccountChange: false,
      // Same-wallet arbitrage temporarily switches from the site chain to Polygon.
      // That network change must not start a second SIWE flow or end the site session.
      signOutOnNetworkChange: false,
      getMessageParams: async () => ({
        domain: new URL(runtimeConfig.siteUrl).host,
        uri: typeof window !== 'undefined' ? window.location.origin : '',
        chains: [defaultNetwork.id],
        statement: 'Please sign with your account',
      }),
      createMessage: ({ address, ...args }: SIWECreateMessageArgs) => {
        const chainId = defaultNetwork.id
        return createSiweMessage({ ...args, address, chainId }, chainId)
      },
      getNonce: async (address?: string) => {
        try {
          if (isPendingSiweAccountAddress(address)) {
            return await createPendingSiweNonce()
          }

          const { data, error } = await authClient.siwe.nonce()

          if (!data?.nonce) {
            throw new Error(getSiweNonceErrorMessage(error))
          }

          return data.nonce
        } catch (error) {
          logSiweVerificationFailure('SIWE nonce creation failed', {
            address,
            chainId: defaultNetwork.id,
            error,
          })
          throw error
        }
      },
      getSession: async () => {
        try {
          const session = await authClient.getSession()
          if (!session.data?.user) {
            return null
          }

          const address = getAuthSessionUserAddress(session.data.user)
          if (!address) {
            return null
          }

          return {
            address,
            chainId: defaultNetwork.id,
          } satisfies SIWESession
        } catch {
          return null
        }
      },
      verifyMessage: async ({ message, signature }: SIWEVerifyMessageArgs) => {
        try {
          const address = normalizeSiweWalletAddress(getAddressFromMessage(message))
          await bindPendingSiweNonce({
            walletAddress: address,
            chainId: defaultNetwork.id,
            message,
          })

          const { data, error } = await authClient.siwe.verify({ message, signature })

          if (error) {
            return false
          }

          return Boolean(data?.success)
        } catch (error) {
          logSiweVerificationFailure('SIWE verification failed before Better Auth returned', {
            error,
          })
          return false
        }
      },
      signOut: async () => {
        try {
          const currentUser = useUser.getState()
          const communityApiUrl = window.__PUBLIC_RUNTIME_CONFIG__?.communityUrl
          if (currentUser?.address && communityApiUrl) {
            await detachTradeAlertsBeforeLogout(communityApiUrl, currentUser.address).catch(() => undefined)
          }
          await authClient.signOut()
          useUser.setState(null)
          return true
        } catch {
          return false
        }
      },
      onSignIn: () => {
        authClient
          .getSession()
          .then((session) => {
            const user = session?.data?.user
            if (user) {
              useUser.setState((previous) => {
                return mergeSessionUserState(previous, user as unknown as User)
              })
            }
          })
          .catch(() => {})
      },
      onSignOut: () => {
        clearAppKitState()
        window.location.reload()
      },
    })

    appKitInstance = createAppKit({
      projectId: runtimeConfig.projectId,
      adapters: [wagmiAdapter],
      themeMode,
      defaultAccountTypes: { eip155: 'eoa' },
      metadata: {
        name: site.name,
        description: site.description,
        url: runtimeConfig.siteUrl,
        icons: [site.logoUrl],
      },
      themeVariables: {
        '--w3m-font-family': 'var(--font-sans)',
        '--w3m-border-radius-master': '2px',
        '--w3m-accent': 'var(--primary)',
      },
      networks,
      defaultNetwork,
      featuredWalletIds: ['c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96'],
      features: {
        analytics: false,
        swaps: false,
        onramp: false,
        receive: false,
        send: false,
        history: false,
        pay: false,
        headless: false,
      },
      siweConfig: siweClient,
    })

    appKitSiweClient = siweClient
    installSiwxRequestSignMessageLock()
    installSiweSignInLock(siweClient)
    hasInitializedAppKit = true
    notifyAppKitStateChange()
    return appKitInstance
  } catch (error) {
    console.warn('Wallet initialization failed. Using local/default values.', error)
    return null
  }
}

function AppKitThemeSynchronizer({ themeMode }: { themeMode: 'light' | 'dark' }) {
  useSyncAppKitThemeMode(themeMode)

  return null
}

function PolymarketWalletConnectionRestorer() {
  usePolymarketWalletConnection()

  return null
}

function useSyncAppKitThemeMode(themeMode: 'light' | 'dark') {
  const { setThemeMode } = useAppKitTheme()

  useEffect(() => {
    setThemeMode(themeMode)
  }, [setThemeMode, themeMode])
}

function useResolvedThemeMode() {
  const { resolvedTheme } = useTheme()
  return resolvedTheme
}

async function isCurrentRegionBlocked() {
  try {
    const response = await fetch('/api/geoblock-status', {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
      },
    })
    if (!response.ok) {
      return false
    }

    const payload = (await response.json()) as { blocked?: boolean }
    return payload?.blocked === true
  } catch {
    return false
  }
}

function createAppKitContextValue({
  instance,
  hasAuthenticatedUser,
  regionBlockedMessage,
}: {
  instance: AppKit | null
  hasAuthenticatedUser: boolean
  regionBlockedMessage: string
}) {
  if (!instance) {
    return defaultAppKitValue
  }

  return {
    open: async (options: Parameters<AppKit['open']>[0]) => {
      if (!hasAuthenticatedUser && (await isCurrentRegionBlocked())) {
        toast.warning(regionBlockedMessage)
        return
      }

      await instance.open(options)
    },
    close: async () => {
      await instance.close()
    },
    isReady: true,
  }
}

function useAppKitInstance({
  appKitThemeMode,
  projectId,
  siteName,
  siteDescription,
  siteLogoUrl,
  siteUrl,
  wagmiAdapter,
}: {
  appKitThemeMode: 'light' | 'dark'
  projectId: string
  siteName: string
  siteDescription: string
  siteLogoUrl: string
  siteUrl: string
  wagmiAdapter: ReturnType<typeof createAppKitWagmiAdapter>
}) {
  const [appKitInitRetryToken, setAppKitInitRetryToken] = useState(0)
  const instance = useSyncExternalStore(subscribeAppKitStateChange, getAppKitInstanceSnapshot, () => null)

  useEffect(
    function initializeAppKitWithRetry() {
      if (instance || !projectId) {
        return
      }

      const initializedInstance = initializeAppKitSingleton(
        appKitThemeMode,
        {
          name: siteName,
          description: siteDescription,
          logoUrl: siteLogoUrl,
        },
        {
          projectId,
          siteUrl,
        },
        wagmiAdapter,
      )
      if (initializedInstance) {
        return
      }

      const retryTimeout = window.setTimeout(() => {
        setAppKitInitRetryToken((previous) => previous + 1)
      }, APPKIT_INIT_RETRY_DELAY_MS)
      return function cancelAppKitInitRetry() {
        window.clearTimeout(retryTimeout)
      }
    },
    [
      appKitThemeMode,
      appKitInitRetryToken,
      instance,
      projectId,
      siteDescription,
      siteLogoUrl,
      siteName,
      siteUrl,
      wagmiAdapter,
    ],
  )

  return instance
}

function useAppKitSiweClient() {
  return useSyncExternalStore(subscribeAppKitStateChange, getAppKitSiweClientSnapshot, () => null)
}

function useAppKitContextValue({
  instance,
  hasAuthenticatedUser,
  regionBlockedMessage,
}: {
  instance: AppKit | null
  hasAuthenticatedUser: boolean
  regionBlockedMessage: string
}) {
  return useMemo(
    () =>
      createAppKitContextValue({
        instance,
        hasAuthenticatedUser,
        regionBlockedMessage,
      }),
    [hasAuthenticatedUser, instance, regionBlockedMessage],
  )
}

export default function AppKitProvider({ children }: { children: ReactNode }) {
  const t = useExtracted()
  const site = useSiteIdentity()
  const { reownAppKitProjectId, siteUrl } = usePublicRuntimeConfig()
  const hasHydrated = useHasHydrated()
  const currentUser = useUser()
  const resolvedTheme = useResolvedThemeMode()
  const appKitThemeMode: 'light' | 'dark' = resolvedTheme === 'dark' ? 'dark' : 'light'
  const wagmiAdapter = useMemo(() => createAppKitWagmiAdapter(reownAppKitProjectId), [reownAppKitProjectId])
  const wagmiConfig = wagmiAdapter.wagmiConfig as Config
  const instance = useAppKitInstance({
    appKitThemeMode,
    projectId: reownAppKitProjectId,
    siteName: site.name,
    siteDescription: site.description,
    siteLogoUrl: site.logoUrl,
    siteUrl,
    wagmiAdapter,
  })
  const siweClient = useAppKitSiweClient()
  const appKitValue = useAppKitContextValue({
    instance,
    hasAuthenticatedUser: Boolean(currentUser?.id),
    regionBlockedMessage: t('This platform is not currently available in your region.'),
  })
  const canSyncTheme = Boolean(instance)

  return (
    <WagmiProvider config={wagmiConfig}>
      <AppKitContext value={appKitValue}>
        <PolymarketWalletConnectionRestorer />
        {instance && siweClient && <AutoSiweAuthentication siweClient={siweClient} />}
        {children}
        {hasHydrated && <SignaturePromptHost />}
        {canSyncTheme && <AppKitThemeSynchronizer themeMode={appKitThemeMode} />}
      </AppKitContext>
    </WagmiProvider>
  )
}
