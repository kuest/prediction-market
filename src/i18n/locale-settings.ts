import type { SupportedLocale } from '@/i18n/locales'

import {
  DEFAULT_LOCALE,
  normalizeEnabledLocales,
  normalizeLocaleOrder,
  parseEnabledLocales,
  SUPPORTED_LOCALES,
} from '@/i18n/locales'
import { SettingsRepository } from '@/lib/db/queries/settings'

const LOCALE_SETTINGS_GROUP = 'i18n'
const LOCALE_SETTINGS_KEY = 'enabled_locales'
const LOCALE_ORDER_SETTINGS_KEY = 'locale_order'
const AUTOMATIC_TRANSLATIONS_SETTINGS_KEY = 'automatic_translations_enabled'
const RULES_TRANSLATIONS_SETTINGS_KEY = 'rules_translations_enabled'

type SettingsGroup = Record<string, { value: string; updated_at: string }>
interface SettingsMap {
  [group: string]: SettingsGroup | undefined
}

function normalizeBooleanSetting(value: string | undefined, fallback: boolean): boolean {
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

export function getEnabledLocalesFromSettings(settings?: SettingsMap): SupportedLocale[] {
  const rawValue = settings?.[LOCALE_SETTINGS_GROUP]?.[LOCALE_SETTINGS_KEY]?.value
  const parsed = parseEnabledLocales(rawValue)
  return parsed.length > 0 ? parsed : [DEFAULT_LOCALE]
}

export function getLocaleOrderFromSettings(settings?: SettingsMap): SupportedLocale[] | null {
  const rawValue = settings?.[LOCALE_SETTINGS_GROUP]?.[LOCALE_ORDER_SETTINGS_KEY]?.value
  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue)
    if (!Array.isArray(parsed)) {
      return null
    }

    const locales = parsed.filter((locale): locale is string => typeof locale === 'string')
    return normalizeLocaleOrder(locales)
  } catch {
    return null
  }
}

export function getEnabledLocalesInOrderFromSettings(settings?: SettingsMap): SupportedLocale[] {
  const enabledLocales = getEnabledLocalesFromSettings(settings)
  const enabledSet = new Set(enabledLocales)
  const localeOrder = getLocaleOrderFromSettings(settings)
  const orderedLocales = (localeOrder ?? enabledLocales).filter((locale) => enabledSet.has(locale))

  return normalizeEnabledLocales(orderedLocales)
}

export async function loadEnabledLocales(): Promise<SupportedLocale[]> {
  const { data } = await SettingsRepository.getSettings()
  return getEnabledLocalesInOrderFromSettings(data ?? undefined)
}

export function getAutomaticTranslationsEnabledFromSettings(settings?: SettingsMap): boolean {
  const rawValue = settings?.[LOCALE_SETTINGS_GROUP]?.[AUTOMATIC_TRANSLATIONS_SETTINGS_KEY]?.value
  return normalizeBooleanSetting(rawValue, true)
}

export async function loadAutomaticTranslationsEnabled(): Promise<boolean> {
  const { data } = await SettingsRepository.getSettings()
  return getAutomaticTranslationsEnabledFromSettings(data ?? undefined)
}

export function getRulesTranslationsEnabledFromSettings(settings?: SettingsMap): boolean {
  const rawValue = settings?.[LOCALE_SETTINGS_GROUP]?.[RULES_TRANSLATIONS_SETTINGS_KEY]?.value
  return normalizeBooleanSetting(rawValue, false)
}

export async function loadRulesTranslationsEnabled(): Promise<boolean> {
  const { data } = await SettingsRepository.getSettings()
  return getRulesTranslationsEnabledFromSettings(data ?? undefined)
}

export function serializeEnabledLocales(locales: SupportedLocale[]): string {
  return JSON.stringify(locales)
}

export function serializeLocaleOrder(locales: SupportedLocale[]): string {
  return JSON.stringify(normalizeLocaleOrder(locales))
}

export function ensureEnabledLocales(locales: string[]): SupportedLocale[] {
  const normalized = normalizeEnabledLocales(locales)
  return normalized.length > 0 ? normalized : [DEFAULT_LOCALE]
}

export function ensureLocaleOrder(locales: string[]): SupportedLocale[] {
  return normalizeLocaleOrder(locales, SUPPORTED_LOCALES)
}
