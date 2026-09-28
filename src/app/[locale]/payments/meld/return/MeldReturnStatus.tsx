'use client'

import { CircleAlert, CircleCheck, CircleX, LoaderCircle, RotateCcw } from 'lucide-react'
import { useExtracted } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useBalance } from '@/hooks/useBalance'
import {
  clearMeldPendingCheckout,
  ensureMeldPendingCheckout,
  getMeldCheckoutPollDelay,
  isMeldCheckoutId,
  isMeldCheckoutUnauthorized,
  markMeldCheckoutUnauthorized,
} from '@/lib/payments/meld-return-channel'

const TERMINAL_STATUSES = new Set(['SETTLED', 'FAILED', 'DECLINED', 'CANCELLED', 'REFUNDED', 'AUTHORIZATION_EXPIRED'])

type MeldStatusPresentation = {
  title: string
  description: string
  action: string
  icon: typeof LoaderCircle
  iconClassName: string
  isPending: boolean
}

export function MeldReturnStatus({
  checkoutId,
  open,
  onClose,
  onExpired,
}: {
  checkoutId: string
  open: boolean
  onClose: () => void
  onExpired?: (checkoutId: string) => void
}) {
  const t = useExtracted()
  const { refetchBalance } = useBalance()
  const [status, setStatus] = useState<string | null>(null)
  const [hasError, setHasError] = useState(false)
  const hasValidCheckoutId = isMeldCheckoutId(checkoutId)

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  useEffect(() => {
    if (!open || !hasValidCheckoutId) {
      return
    }

    if (isMeldCheckoutUnauthorized(checkoutId)) {
      /* oxlint-disable react/set-state-in-effect */
      setHasError(true)
      /* oxlint-enable react/set-state-in-effect */
      return
    }

    const pendingCheckout = ensureMeldPendingCheckout(checkoutId)
    if (!pendingCheckout) {
      /* oxlint-disable react/set-state-in-effect */
      setHasError(true)
      /* oxlint-enable react/set-state-in-effect */
      onExpired?.(checkoutId)
      return
    }

    const expiresAt = pendingCheckout.expiresAt
    const controller = new AbortController()
    let attempts = 0
    let timeout: ReturnType<typeof setTimeout> | undefined

    function finishExpiredCheckout() {
      clearMeldPendingCheckout(checkoutId)
      setHasError(true)
      onExpired?.(checkoutId)
    }

    function schedulePoll() {
      const remainingMs = expiresAt - Date.now()
      if (remainingMs <= 0) {
        finishExpiredCheckout()
        return
      }
      const delay = Math.min(getMeldCheckoutPollDelay(attempts), remainingMs)
      attempts += 1
      timeout = setTimeout(() => void poll(), delay)
    }

    async function poll() {
      if (Date.now() >= expiresAt) {
        finishExpiredCheckout()
        return
      }

      try {
        const response = await fetch(`/api/payments/meld/checkouts/${encodeURIComponent(checkoutId)}/status`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (controller.signal.aborted) {
          return
        }
        if (response.status === 401) {
          markMeldCheckoutUnauthorized(checkoutId)
          setHasError(true)
          return
        }
        if (response.status === 404) {
          clearMeldPendingCheckout(checkoutId)
          setHasError(true)
          return
        }
        if (!response.ok) {
          throw new Error('checkout_status_unavailable')
        }

        const result: unknown = await response.json()
        if (
          typeof result !== 'object' ||
          result === null ||
          !('status' in result) ||
          typeof result.status !== 'string'
        ) {
          throw new Error('invalid_checkout_status')
        }
        if (controller.signal.aborted) {
          return
        }

        setStatus(result.status)
        setHasError(false)
        if (TERMINAL_STATUSES.has(result.status)) {
          clearMeldPendingCheckout(checkoutId)
        }
        if (result.status === 'SETTLED') {
          void refetchBalance()
        }
        if (!TERMINAL_STATUSES.has(result.status)) {
          schedulePoll()
        }
      } catch {
        if (!controller.signal.aborted) {
          setHasError(true)
          schedulePoll()
        }
      }
    }

    void poll()
    return () => {
      controller.abort()
      if (timeout) {
        clearTimeout(timeout)
      }
    }
  }, [checkoutId, hasValidCheckoutId, onExpired, open, refetchBalance])

  if (!hasValidCheckoutId) {
    return null
  }

  let presentation: MeldStatusPresentation
  if (hasError) {
    presentation = {
      title: t('Status temporarily unavailable'),
      description: t('Your payment may still be processing. Check your balance again shortly.'),
      action: t('Close'),
      icon: CircleAlert,
      iconClassName: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      isPending: false,
    }
  } else if (status === 'SETTLED') {
    presentation = {
      title: t('Payment confirmed'),
      description: t('Your purchase was confirmed. Your Deposit Wallet balance may take a moment to update.'),
      action: t('Done'),
      icon: CircleCheck,
      iconClassName: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
      isPending: false,
    }
  } else if (status === 'FAILED' || status === 'DECLINED') {
    presentation = {
      title: t('Payment not completed'),
      description: t('No funds were added. You can return and try another payment method.'),
      action: t('Close'),
      icon: CircleX,
      iconClassName: 'bg-red-500/10 text-red-600 dark:text-red-400',
      isPending: false,
    }
  } else if (status === 'CANCELLED' || status === 'AUTHORIZATION_EXPIRED') {
    presentation = {
      title: t('Payment cancelled'),
      description: t('You can start a new purchase whenever you are ready.'),
      action: t('Close'),
      icon: CircleX,
      iconClassName: 'bg-red-500/10 text-red-600 dark:text-red-400',
      isPending: false,
    }
  } else if (status === 'REFUNDED') {
    presentation = {
      title: t('Payment refunded'),
      description: t('Meld returned the payment. The arrival time depends on your payment method.'),
      action: t('Done'),
      icon: RotateCcw,
      iconClassName: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
      isPending: false,
    }
  } else {
    presentation = {
      title: t('Checking your payment'),
      description: t(
        'Meld is processing your purchase. You can close this window and your balance will update automatically.',
      ),
      action: t('Close'),
      icon: LoaderCircle,
      iconClassName: 'bg-primary/10 text-primary',
      isPending: true,
    }
  }
  const StatusIcon = presentation.icon

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogContent className="max-w-sm gap-6 sm:max-w-sm" closeLabel={t('Close')}>
        <DialogHeader className="items-center gap-3 text-center sm:text-center">
          <div
            aria-hidden="true"
            className={`flex size-16 items-center justify-center rounded-full ${presentation.iconClassName}`}
          >
            <StatusIcon className={`size-8 ${presentation.isPending ? 'animate-spin' : ''}`} />
          </div>
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground">Meld</p>
            <DialogTitle className="text-xl">{presentation.title}</DialogTitle>
            <DialogDescription aria-live="polite" className="text-center">
              {presentation.description}
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogFooter className="sm:flex-col">
          <Button className="w-full" onClick={handleClose}>
            {presentation.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
