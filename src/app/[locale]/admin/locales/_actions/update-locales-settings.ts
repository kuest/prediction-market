'use server'

import { getExtracted } from 'next-intl/server'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { z } from 'zod'

import {
  ensureEnabledLocales,
  ensureLocaleOrder,
  getAutomaticTranslationsEnabledFromSettings,
  getEnabledLocalesFromSettings,
  getRulesTranslationsEnabledFromSettings,
  serializeEnabledLocales,
  serializeLocaleOrder,
} from '@/i18n/locale-settings'
import { DEFAULT_LOCALE, resolveSupportedLocale, SUPPORTED_LOCALES } from '@/i18n/locales'
import { loadOpenRouterProviderSettings } from '@/lib/ai/market-context-config'
import { DEFAULT_ERROR_MESSAGE } from '@/lib/constants'
import { SettingsRepository } from '@/lib/db/queries/settings'
import { UserRepository } from '@/lib/db/queries/user'
import { triggerTranslationEnqueue } from '@/lib/translations/trigger-enqueue'

export interface LocalesSettingsActionState {
  error: string | null
}

const LocaleSchema = z.enum(SUPPORTED_LOCALES)

function normalizeBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback
  }

  const normalized = value.trim().toLowerCase()
  if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) {
    return true
  }
  if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) {
    return false
  }

  return fallback
}

const UpdateLocalesSettingsSchema = z
  .object({
    enabled_locales: z.array(LocaleSchema).optional(),
    locale_order: z.array(LocaleSchema).optional(),
    automatic_translations_enabled: z.string().optional(),
    rules_translations_enabled: z.string().optional(),
  })
  .transform(({ enabled_locales, locale_order, automatic_translations_enabled, rules_translations_enabled }) => {
    const enabledLocales = ensureEnabledLocales(enabled_locales ?? [])

    return {
      enabledLocales,
      localeOrder: locale_order === undefined ? null : ensureLocaleOrder(locale_order),
      automaticTranslationsEnabled: normalizeBoolean(automatic_translations_enabled, false),
      rulesTranslationsEnabled: normalizeBoolean(rules_translations_enabled, false),
    }
  })

export async function updateLocalesSettingsAction(
  _prevState: LocalesSettingsActionState,
  formData: FormData,
): Promise<LocalesSettingsActionState> {
  const rawLocale = formData.get('locale')
  const locale = resolveSupportedLocale(typeof rawLocale === 'string' ? rawLocale : undefined)
  const t = await getExtracted({ locale })
  const user = await UserRepository.getCurrentUser({ minimal: true })

  if (!user || !user.is_admin) {
    return { error: t('Unauthenticated.') }
  }

  const rawLocales = formData.getAll('enabled_locales').filter((value): value is string => typeof value === 'string')
  const rawLocaleOrderValue = formData.get('locale_order')
  let rawLocaleOrder: unknown
  if (typeof rawLocaleOrderValue === 'string') {
    try {
      rawLocaleOrder = JSON.parse(rawLocaleOrderValue)
    } catch {
      rawLocaleOrder = null
    }
  }
  const automaticTranslationsEnabled =
    typeof formData.get('automatic_translations_enabled') === 'string'
      ? formData.get('automatic_translations_enabled')
      : undefined
  const rulesTranslationsEnabled =
    typeof formData.get('rules_translations_enabled') === 'string'
      ? formData.get('rules_translations_enabled')
      : undefined

  const parsed = UpdateLocalesSettingsSchema.safeParse({
    enabled_locales: rawLocales,
    locale_order: rawLocaleOrder,
    automatic_translations_enabled: automaticTranslationsEnabled,
    rules_translations_enabled: rulesTranslationsEnabled,
  })

  if (!parsed.success) {
    return { error: t('Invalid input.') }
  }

  const value = serializeEnabledLocales(parsed.data.enabledLocales)
  const openRouterSettings = await loadOpenRouterProviderSettings()
  const previousSettings = openRouterSettings.allSettings
  const previouslyEnabledLocales = getEnabledLocalesFromSettings(previousSettings)
  const previouslyAutomaticTranslationsEnabled = getAutomaticTranslationsEnabledFromSettings(previousSettings)
  const previouslyRulesTranslationsEnabled = getRulesTranslationsEnabledFromSettings(previousSettings)
  const canEnableAutomaticTranslations = openRouterSettings.configured
  const normalizedAutomaticTranslationsEnabled =
    canEnableAutomaticTranslations && parsed.data.automaticTranslationsEnabled
  const normalizedRulesTranslationsEnabled = canEnableAutomaticTranslations && parsed.data.rulesTranslationsEnabled

  const settingsToUpdate = [
    { group: 'i18n', key: 'enabled_locales', value },
    {
      group: 'i18n',
      key: 'automatic_translations_enabled',
      value: normalizedAutomaticTranslationsEnabled ? 'true' : 'false',
    },
    {
      group: 'i18n',
      key: 'rules_translations_enabled',
      value: normalizedRulesTranslationsEnabled ? 'true' : 'false',
    },
  ]

  if (parsed.data.localeOrder !== null) {
    settingsToUpdate.splice(1, 0, {
      group: 'i18n',
      key: 'locale_order',
      value: serializeLocaleOrder(parsed.data.localeOrder),
    })
  }

  const { error } = await SettingsRepository.updateSettings(settingsToUpdate)

  if (error) {
    return { error: DEFAULT_ERROR_MESSAGE }
  }

  if (
    parsed.data.enabledLocales.some((enabledLocale) => enabledLocale !== DEFAULT_LOCALE) &&
    (normalizedAutomaticTranslationsEnabled || normalizedRulesTranslationsEnabled) &&
    (parsed.data.enabledLocales.some((enabledLocale) => !previouslyEnabledLocales.includes(enabledLocale)) ||
      (normalizedAutomaticTranslationsEnabled && !previouslyAutomaticTranslationsEnabled) ||
      (normalizedRulesTranslationsEnabled && !previouslyRulesTranslationsEnabled))
  ) {
    after(() => triggerTranslationEnqueue())
  }

  revalidatePath('/admin/locales')

  return { error: null }
}
