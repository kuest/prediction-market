import {
  loadAutomaticTranslationsEnabled,
  loadEnabledLocales,
  loadRulesTranslationsEnabled,
} from '@/i18n/locale-settings'
import resolveSiteUrl from '@/lib/site-url'
import { isNonDefaultLocale } from '@/lib/translations/jobs'

export async function triggerTranslationEnqueue(): Promise<void> {
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) {
    return
  }

  try {
    const [automaticTranslationsEnabled, rulesTranslationsEnabled, enabledLocales] = await Promise.all([
      loadAutomaticTranslationsEnabled(),
      loadRulesTranslationsEnabled(),
      loadEnabledLocales(),
    ])
    if ((!automaticTranslationsEnabled && !rulesTranslationsEnabled) || !enabledLocales.some(isNonDefaultLocale)) {
      return
    }

    const baseUrl = resolveSiteUrl({
      ...process.env,
      VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_URL?.trim() || process.env.VERCEL_PROJECT_PRODUCTION_URL,
    })
    const response = await fetch(new URL('/api/sync/translations/enqueue', baseUrl), {
      headers: { Authorization: `Bearer ${cronSecret}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(25_000),
    })

    if (!response.ok) {
      console.error(`Translation enqueue trigger failed (${response.status}).`)
    }
  } catch (error) {
    console.error('Translation enqueue trigger failed:', error)
  }
}
