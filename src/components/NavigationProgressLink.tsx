'use client'

import type { ComponentProps } from 'react'

import { useLinkStatus } from 'next/link'
import { useEffect, useRef } from 'react'

import { Link as BaseLink } from '@/i18n/navigation-base'
import { trackNavigationProgress } from '@/lib/navigation-progress'

function LinkProgress() {
  const { pending } = useLinkStatus()
  const marker = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const anchor = marker.current?.closest('a')
    if (pending && anchor) {
      return trackNavigationProgress(anchor)
    }
  }, [pending])

  return <span ref={marker} hidden />
}

export default function NavigationProgressLink({ children, ...props }: ComponentProps<typeof BaseLink>) {
  return (
    <BaseLink {...props}>
      {children}
      <LinkProgress />
    </BaseLink>
  )
}
