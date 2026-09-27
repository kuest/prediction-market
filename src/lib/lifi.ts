import type {
  LiFiStep,
  QuoteRequestFromAmount,
  QuoteRequestToAmount,
  RequestOptions,
  WalletTokenExtended,
} from '@lifi/sdk'

import { actions, createClient } from '@lifi/sdk'

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
  getWalletBalances: (walletAddress: string) => Promise<Record<number, WalletTokenExtended[]>>
}

let configuredSignature: string | null = null
let configuredActions: LiFiServerActions | null = null

function normalizeSettingValue(value: string | undefined) {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : null
}

function createLiFiServerActions(integrator: string, apiKey: string | null) {
  const client = createClient(apiKey ? { integrator, apiKey } : { integrator })
  const clientActions = actions(client) as Omit<LiFiServerActions, 'getWalletBalances'>

  return Object.assign(clientActions, {
    async getWalletBalances(walletAddress: string) {
      const headers: Record<string, string> = {
        'x-lifi-integrator': client.config.integrator,
      }
      if (client.config.apiKey) {
        headers['x-lifi-api-key'] = client.config.apiKey
      }

      const response = await fetch(
        `${client.config.apiUrl}/wallets/${encodeURIComponent(walletAddress)}/balances?extended=true`,
        { headers },
      )
      if (!response.ok) {
        throw new Error(`LI.FI wallet balances request failed with status ${response.status}.`)
      }

      const result = (await response.json()) as { balances?: Record<number, WalletTokenExtended[]> }
      return result.balances ?? {}
    },
  }) as LiFiServerActions
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
