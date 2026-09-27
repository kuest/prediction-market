import { SettingsRepository } from '@/lib/db/queries/settings'
import { decryptSecret } from '@/lib/encryption'
import {
  DEFAULT_LIFI_INTEGRATOR,
  GENERAL_SETTINGS_GROUP,
  LIFI_INTEGRATOR_SETTING_KEY,
  resolveLiFiIntegrator,
} from '@/lib/lifi-config.shared'
import 'server-only'

export interface LiFiServerConfig {
  apiKey: string | null
  integrator: string
}

let cachedConfig: LiFiServerConfig | null = null

function normalizeSettingValue(value: string | undefined) {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : null
}

export async function getLiFiServerConfig(): Promise<LiFiServerConfig> {
  const { data: allSettings, error } = await SettingsRepository.getSettings()
  if (error) {
    return cachedConfig ?? { integrator: DEFAULT_LIFI_INTEGRATOR, apiKey: null }
  }

  const generalSettings = allSettings?.[GENERAL_SETTINGS_GROUP]
  const integrator = resolveLiFiIntegrator(generalSettings?.[LIFI_INTEGRATOR_SETTING_KEY]?.value)
  const apiKey = normalizeSettingValue(decryptSecret(generalSettings?.lifi_api_key?.value))
  cachedConfig = { integrator, apiKey }
  return cachedConfig
}

export async function getLiFiIntegrator() {
  return (await getLiFiServerConfig()).integrator
}
