import type { Metadata } from 'next'

import { cacheTag } from 'next/cache'

import PlatformViewerState from '@/app/[locale]/(platform)/_components/PlatformViewerState'
import AdminHeader from '@/app/[locale]/admin/_components/AdminHeader'
import AdminOnboardingSupportWidget from '@/app/[locale]/admin/_components/AdminOnboardingSupportWidget'
import AdminSidebar from '@/app/[locale]/admin/_components/AdminSidebar'
import CopyVersion from '@/app/[locale]/admin/_components/CopyVersion'
import {
  getCompletedAdminOnboardingTasks,
  getKuestSupportSettings,
  getSupportAnnouncementDismissedAt,
} from '@/lib/admin-support-settings'
import { cacheTags } from '@/lib/cache-tags'
import { SettingsRepository } from '@/lib/db/queries/settings'
import AppKitProvider from '@/providers/AppKitProvider'
import { CommunityFollowsProvider } from '@/providers/CommunityFollowsProvider'

export const instant = false

export const metadata: Metadata = {
  title: 'Admin',
}

function getForkRepositoryUrl() {
  const repoOwner = process.env.VERCEL_GIT_REPO_OWNER?.trim()
  const repoSlug = process.env.VERCEL_GIT_REPO_SLUG?.trim()

  if (!process.env.VERCEL_ENV || !repoOwner || !repoSlug) {
    return null
  }

  return `https://github.com/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoSlug)}`
}

export default async function AdminLayout({ children }: LayoutProps<'/[locale]/admin'>) {
  'use cache'

  cacheTag(cacheTags.settings)
  const forkRepositoryUrl = getForkRepositoryUrl()
  const { data: settings } = await SettingsRepository.getSettings()
  const supportSettings = getKuestSupportSettings(settings)

  return (
    <AppKitProvider>
      <CommunityFollowsProvider>
        <PlatformViewerState />
        <AdminHeader />
        <main className="container py-4 lg:py-8">
          <div className="grid min-w-0 gap-8 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16">
            <AdminSidebar />
            <div className="min-w-0 space-y-8">{children}</div>
          </div>
          <CopyVersion forkRepositoryUrl={forkRepositoryUrl} />
        </main>
        {supportSettings.enabled && (
          <AdminOnboardingSupportWidget
            announcementDismissedAt={getSupportAnnouncementDismissedAt(settings)}
            initialCompletedTasks={getCompletedAdminOnboardingTasks(settings)}
            position={supportSettings.position}
          />
        )}
      </CommunityFollowsProvider>
    </AppKitProvider>
  )
}
