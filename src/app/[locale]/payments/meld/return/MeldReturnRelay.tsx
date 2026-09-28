'use client'

import { CircleCheck, LoaderCircle } from 'lucide-react'
import { useExtracted } from 'next-intl'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useSiteIdentity } from '@/hooks/useSiteIdentity'
import { useRouter } from '@/i18n/navigation'
import {
  isMeldCheckoutId,
  isMeldCheckoutReturnMessage,
  MELD_CHECKOUT_RETURN_CHANNEL,
} from '@/lib/payments/meld-return-channel'

export function MeldReturnRelay({ checkoutId }: { checkoutId: string | null }) {
  const t = useExtracted()
  const router = useRouter()
  const site = useSiteIdentity()
  const [showCloseFallback, setShowCloseFallback] = useState(false)
  const isValidCheckoutId = isMeldCheckoutId(checkoutId)

  useEffect(() => {
    function goToStatus() {
      if (isValidCheckoutId && checkoutId) {
        router.replace({ pathname: '/', query: { meldCheckoutId: checkoutId } })
      } else {
        router.replace('/')
      }
    }

    if (!isValidCheckoutId || !checkoutId) {
      goToStatus()
      return
    }

    if (typeof BroadcastChannel === 'undefined') {
      goToStatus()
      return
    }

    const channel = new BroadcastChannel(MELD_CHECKOUT_RETURN_CHANNEL)
    let fallbackTimeout = window.setTimeout(goToStatus, 1_000)
    let closeFallbackTimeout: number | undefined
    let receivedAcknowledgement = false

    function handleMessage(event: MessageEvent<unknown>) {
      if (
        receivedAcknowledgement ||
        !isMeldCheckoutReturnMessage(event.data) ||
        event.data.type !== 'ack' ||
        event.data.checkoutId !== checkoutId
      ) {
        return
      }

      receivedAcknowledgement = true
      window.clearTimeout(fallbackTimeout)
      window.close()
      closeFallbackTimeout = window.setTimeout(() => setShowCloseFallback(true), 500)
    }

    channel.addEventListener('message', handleMessage)
    channel.postMessage({ type: 'return', checkoutId })
    return () => {
      window.clearTimeout(fallbackTimeout)
      if (closeFallbackTimeout !== undefined) {
        window.clearTimeout(closeFallbackTimeout)
      }
      channel.removeEventListener('message', handleMessage)
      channel.close()
    }
  }, [checkoutId, isValidCheckoutId, router])

  if (showCloseFallback) {
    return (
      <main className="fixed inset-0 flex items-center justify-center bg-background px-6 py-10">
        <div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <CircleCheck aria-hidden="true" className="size-8" />
          </div>
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground">Meld</p>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {t(
                'Your payment status is open in the original tab. Close this tab manually if it stays open, or go to the home page.',
              )}
            </p>
          </div>
          <Button className="w-full" onClick={() => router.replace('/')}>
            {t('Go to home')}
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="fixed inset-0 flex items-center justify-center bg-background px-6 py-10">
      <div className="flex flex-col items-center gap-4 text-center" role="status" aria-live="polite">
        <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <LoaderCircle aria-hidden="true" className="size-8 animate-spin" />
        </div>
        <p className="text-sm text-muted-foreground">{t('Returning to {siteName}…', { siteName: site.name })}</p>
      </div>
    </main>
  )
}
