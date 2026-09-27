'use server'

import { revalidatePath, updateTag } from 'next/cache'

import type { KuestSupportContext } from '@/lib/kuest-support-assertion'

import {
  ADMIN_ONBOARDING_SETTINGS_GROUP,
  ADMIN_SUPPORT_ANNOUNCEMENT_DISMISSED_AT_KEY,
  ADMIN_SUPPORT_SETTINGS_GROUP,
  isAdminOnboardingTaskId,
} from '@/lib/admin-support-settings'
import { cacheTags } from '@/lib/cache-tags'
import { SettingsRepository } from '@/lib/db/queries/settings'
import { UserRepository } from '@/lib/db/queries/user'
import { createKuestSupportAssertion, normalizeKuestSupportContext } from '@/lib/kuest-support-assertion'
import { getPublicRuntimeConfig } from '@/lib/public-runtime-config.server'
import { getFeeRecipientWalletFormValue, getThemeSiteSettingsFormState } from '@/lib/theme-settings'

async function requireAdmin() {
  const user = await UserRepository.getCurrentUser({ minimal: true })
  if (!user?.is_admin) {
    throw new Error('Unauthenticated.')
  }

  return user
}

export async function createAdminSupportContextAction() {
  const user = await requireAdmin()
  if (typeof user.address !== 'string') {
    throw new TypeError('The admin wallet is unavailable.')
  }

  const [{ data: settings }, runtimeConfig] = await Promise.all([
    SettingsRepository.getSettings(),
    getPublicRuntimeConfig(),
  ])
  const siteSettings = getThemeSiteSettingsFormState(settings ?? undefined)
  const context = normalizeKuestSupportContext({
    appVersion: runtimeConfig.commitSha,
    feeRecipientWallet: getFeeRecipientWalletFormValue(settings ?? undefined) || null,
    isVercel: runtimeConfig.isVercel === 'true',
    siteName: siteSettings.siteName,
    siteUrl: runtimeConfig.siteUrl,
    visitorEoa: user.address,
    visitorUsername: typeof user.username === 'string' && user.username.trim() ? user.username.trim() : null,
  } satisfies KuestSupportContext)

  return {
    assertion: createKuestSupportAssertion(context),
    context,
  }
}

export async function updateAdminOnboardingTaskAction(taskId: string, completed: boolean) {
  await requireAdmin()
  if (!isAdminOnboardingTaskId(taskId) || typeof completed !== 'boolean') {
    throw new Error('Invalid onboarding task.')
  }

  const { error } = await SettingsRepository.updateSettings([
    {
      group: ADMIN_ONBOARDING_SETTINGS_GROUP,
      key: taskId,
      value: completed ? 'true' : 'false',
    },
  ])
  if (error) {
    throw new Error('Could not save onboarding progress.')
  }

  updateTag(cacheTags.settings)
  revalidatePath('/[locale]/admin', 'layout')
}

export async function dismissSupportAnnouncementAction(publishedAt: string) {
  await requireAdmin()
  const timestamp = Date.parse(publishedAt)
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Invalid announcement timestamp.')
  }

  const normalized = new Date(timestamp).toISOString()
  const { error } = await SettingsRepository.updateSettingMaxValue({
    group: ADMIN_SUPPORT_SETTINGS_GROUP,
    key: ADMIN_SUPPORT_ANNOUNCEMENT_DISMISSED_AT_KEY,
    value: normalized,
  })
  if (error) {
    throw new Error('Could not dismiss the support announcement.')
  }

  updateTag(cacheTags.settings)
  revalidatePath('/[locale]/admin', 'layout')
}
