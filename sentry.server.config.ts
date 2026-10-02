import * as Sentry from '@sentry/nextjs'

import { isNextNotFoundError } from '@/lib/errors/next-http-fallback'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  beforeSend(event, hint) {
    if (isNextNotFoundError(hint.originalException)) {
      return null
    }

    return event
  },
})
