'use client'

import type { ComponentProps, ReactNode } from 'react'

import { FrameworkProvider } from 'fumadocs-core/framework'
import { RootProvider } from 'fumadocs-ui/provider/base'
import { useParams } from 'next/navigation'

import { Link, usePathname, useRouter } from '@/i18n/navigation'
import { stripLocalePrefix } from '@/lib/locale-path'

interface DocsRootProviderProps {
  children: ReactNode
}

function DocsLink({ href, prefetch, ...props }: ComponentProps<typeof Link>) {
  const pathname = typeof href === 'string' ? (href.split(/[?#]/, 1)[0] ?? '') : (href.pathname ?? '')
  const normalizedPath = stripLocalePrefix(pathname)
  const isApiReference = normalizedPath === '/docs/api-reference' || normalizedPath.startsWith('/docs/api-reference/')

  return <Link {...props} href={href} prefetch={isApiReference ? false : prefetch} />
}

export function DocsRootProvider({ children }: DocsRootProviderProps) {
  return (
    <FrameworkProvider
      Link={DocsLink as never}
      usePathname={usePathname as never}
      useRouter={useRouter as never}
      useParams={useParams as never}
    >
      <RootProvider
        search={{
          options: {
            api: '/docs/api/search',
          },
        }}
      >
        {children}
      </RootProvider>
    </FrameworkProvider>
  )
}
