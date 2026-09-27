import type { LiFiStep, QuoteRequestFromAmount, QuoteRequestToAmount, RequestOptions } from '@lifi/sdk'

import { actions, createClient } from '@lifi/sdk'
import { EthereumProvider } from '@lifi/sdk-provider-ethereum'

import { SettingsRepository } from '@/lib/db/queries/settings'
import { decryptSecret } from '@/lib/encryption'
import 'server-only'

const GENERAL_SETTINGS_GROUP = 'general'
const LIFI_INTEGRATOR_KEY = 'lifi_integrator'
const LIFI_API_KEY = 'lifi_api_key'
const DEFAULT_LIFI_INTEGRATOR = 'lifi-sdk'

type LiFiServerActions = Omit<ReturnType<typeof actions>, 'getQuote'> & {
  getQuote: ((params: QuoteRequestFromAmount, options?: RequestOptions) => Promise<LiFiStep>) &
    ((params: QuoteRequestToAmount, options?: RequestOptions) => Promise<LiFiStep>)
}

let configuredSignature: string | null = null
let configuredActions: LiFiServerActions | null = null

function normalizeSettingValue(value: string | undefined) {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : null
}

function createLiFiServerActions(integrator: string, apiKey: string | null) {
  const config = { integrator, providers: [EthereumProvider()] }
  const client = createClient(apiKey ? { ...config, apiKey } : config)

  return actions(client) as LiFiServerActions
}

export async function getLiFiServerActions() {
  const { data: allSettings, error } = await SettingsRepository.getSettings()
  if (error) {
    if (configuredActions) {
      return configuredActions
    }

    configuredActions = createLiFiServerActions(DEFAULT_LIFI_INTEGRATOR, null)
    configuredSignature = `${DEFAULT_LIFI_INTEGRATOR}::`
    return configuredActions
  }

  const generalSettings = allSettings?.[GENERAL_SETTINGS_GROUP]
  const integrator = normalizeSettingValue(generalSettings?.[LIFI_INTEGRATOR_KEY]?.value) ?? DEFAULT_LIFI_INTEGRATOR
  const encryptedApiKey = generalSettings?.[LIFI_API_KEY]?.value
  const apiKey = normalizeSettingValue(decryptSecret(encryptedApiKey))

  const nextSignature = `${integrator}::${apiKey ?? ''}`
  if (configuredActions && configuredSignature === nextSignature) {
    return configuredActions
  }

  configuredActions = createLiFiServerActions(integrator, apiKey)
  configuredSignature = nextSignature
  return configuredActions
}
