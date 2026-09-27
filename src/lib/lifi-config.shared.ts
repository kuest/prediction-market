export const DEFAULT_LIFI_INTEGRATOR = 'lifi-sdk'
export const GENERAL_SETTINGS_GROUP = 'general'
export const LIFI_INTEGRATOR_SETTING_KEY = 'lifi_integrator'

export function resolveLiFiIntegrator(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : DEFAULT_LIFI_INTEGRATOR
}
