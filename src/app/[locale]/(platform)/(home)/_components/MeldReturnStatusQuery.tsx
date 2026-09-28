'use client'

import { useSearchParams } from 'next/navigation'
import { useState } from 'react'

import { MeldReturnStatus } from '@/app/[locale]/payments/meld/return/MeldReturnStatus'
import { isMeldCheckoutId } from '@/lib/payments/meld-return-channel'

export default function MeldReturnStatusQuery() {
  const checkoutId = useSearchParams().get('meldCheckoutId')

  if (!isMeldCheckoutId(checkoutId)) {
    return null
  }

  return <MeldReturnStatusFromQuery key={checkoutId} checkoutId={checkoutId} />
}

function MeldReturnStatusFromQuery({ checkoutId }: { checkoutId: string }) {
  const [isOpen, setIsOpen] = useState(true)

  function handleClose() {
    setIsOpen(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('meldCheckoutId')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }

  return <MeldReturnStatus checkoutId={checkoutId} open={isOpen} onClose={handleClose} />
}
