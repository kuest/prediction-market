import * as Sentry from '@sentry/nextjs'

import type { PublicRuntimeConfig } from '@/lib/public-runtime-config.shared'

import { isNextClientStaleAssetError } from '@/lib/errors/next-client-stale-assets'
import { isNextNotFoundError } from '@/lib/errors/next-http-fallback'
import { isSiweVerificationError } from '@/lib/errors/siwe'

declare global {
  interface Window {
    __PUBLIC_RUNTIME_CONFIG__?: Partial<PublicRuntimeConfig>
  }
}

function normalizeSentryDsn(value: string | undefined) {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : undefined
}

function resolveSentryDsn() {
  return typeof window === 'undefined' ? undefined : normalizeSentryDsn(window.__PUBLIC_RUNTIME_CONFIG__?.sentryDsn)
}

Sentry.init({
  dsn: resolveSentryDsn(),
  tracesSampleRate: 0.1,
  beforeSend(event, hint) {
    if (isNextNotFoundError(hint.originalException)) {
      return null
    }

    if (isNextClientStaleAssetError(hint.originalException)) {
      return null
    }

    if (isSiweVerificationError(hint.originalException)) {
      return null
    }

    return event
  },
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
