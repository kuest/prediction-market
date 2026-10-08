'use client'

import { usePathname } from 'next/navigation'
import { Suspense, useMemo } from 'react'

import type { CustomJavascriptCodeDisablePage } from '@/lib/custom-javascript-code'

import { isCustomJavascriptCodeEnabledOnPathname } from '@/lib/custom-javascript-code'
import { localizeGlobalAnnouncementMessage } from '@/lib/global-announcement-localization'

interface GlobalAnnouncementBannerProps {
  locale: string
  message: string
  linkUrl: string
  disabledOn: CustomJavascriptCodeDisablePage[]
}

function isExternalHttpUrl(value: string) {
  return value.startsWith('https://') || value.startsWith('http://')
}

function stripLocalePrefix(pathname: string | null, locale: string) {
  if (!pathname) {
    return pathname
  }

  const localePrefix = `/${locale}`
  if (pathname === localePrefix) {
    return '/'
  }

  if (pathname.startsWith(`${localePrefix}/`)) {
    return pathname.slice(localePrefix.length)
  }

  return pathname
}

function useLocalizedPathname(locale: string) {
  const pathname = usePathname()
  return useMemo(() => stripLocalePrefix(pathname, locale), [locale, pathname])
}

function GlobalAnnouncementBannerContent({
  locale,
  message,
  linkUrl,
}: Pick<GlobalAnnouncementBannerProps, 'locale' | 'message' | 'linkUrl'>) {
  const localizedMessage = localizeGlobalAnnouncementMessage(locale, message)
  const hasMessage = localizedMessage.length > 0

  if (!hasMessage) {
    return null
  }

  const content = (
    <div className="w-full bg-primary text-primary-foreground">
      <div className="container py-2 text-center text-xs font-semibold sm:text-sm">{localizedMessage}</div>
    </div>
  )

  if (!linkUrl) {
    return content
  }

  const opensInNewTab = isExternalHttpUrl(linkUrl)

  return (
    <a
      href={linkUrl}
      className="block transition-opacity hover:opacity-95"
      target={opensInNewTab ? '_blank' : undefined}
      rel={opensInNewTab ? 'noopener noreferrer' : undefined}
    >
      {content}
    </a>
  )
}

function PathnameGlobalAnnouncementBanner(props: GlobalAnnouncementBannerProps) {
  const localizedPathname = useLocalizedPathname(props.locale)
  if (!isCustomJavascriptCodeEnabledOnPathname({ disabledOn: props.disabledOn }, localizedPathname)) {
    return null
  }

  return <GlobalAnnouncementBannerContent {...props} />
}

export default function GlobalAnnouncementBanner(props: GlobalAnnouncementBannerProps) {
  if (props.disabledOn.length === 0) {
    return <GlobalAnnouncementBannerContent {...props} />
  }

  return (
    <Suspense fallback={null}>
      <PathnameGlobalAnnouncementBanner {...props} />
    </Suspense>
  )
}
