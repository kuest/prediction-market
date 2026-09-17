import type { LiFiStep, QuoteRequestFromAmount, QuoteRequestToAmount, RequestOptions, SDKConfig } from '@lifi/sdk'

import { actions, createClient } from '@lifi/sdk'

import { SettingsRepository } from '@/lib/db/queries/settings'
import { decryptSecret } from '@/lib/encryption'
import { POLYGON_MAINNET_CHAIN_ID } from '@/lib/network'
import { resolveRuntimePolygonMainnetRpcUrls } from '@/lib/viem-network'
import 'server-only'

const GENERAL_SETTINGS_GROUP = 'general'
const LIFI_INTEGRATOR_KEY = 'lifi_integrator'
const LIFI_API_KEY = 'lifi_api_key'
const DEFAULT_LIFI_INTEGRATOR = 'lifi-sdk'

interface LiFiConfiguration {
  integrator: string
  apiKey: string | null
}

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

async function resolveLiFiConfiguration(): Promise<LiFiConfiguration | null> {
  const { data: allSettings, error } = await SettingsRepository.getSettings()
  if (error) {
    return null
  }

  const generalSettings = allSettings?.[GENERAL_SETTINGS_GROUP]
  const integrator = normalizeSettingValue(generalSettings?.[LIFI_INTEGRATOR_KEY]?.value) ?? DEFAULT_LIFI_INTEGRATOR
  const encryptedApiKey = generalSettings?.[LIFI_API_KEY]?.value
  const apiKey = normalizeSettingValue(decryptSecret(encryptedApiKey))

  return { integrator, apiKey }
}

const defaultLiFiConfiguration: LiFiConfiguration = {
  integrator: DEFAULT_LIFI_INTEGRATOR,
  apiKey: null,
}

function createLiFiClient(configuration: LiFiConfiguration, options: Omit<SDKConfig, 'integrator'> = {}) {
  return createClient({
    ...options,
    integrator: configuration.integrator,
    ...(configuration.apiKey ? { apiKey: configuration.apiKey } : {}),
  })
}

function createLiFiServerActions(configuration: LiFiConfiguration) {
  const client = createLiFiClient(configuration)

  return actions(client) as LiFiServerActions
}

export async function getLiFiServerActions() {
  const resolvedConfiguration = await resolveLiFiConfiguration()
  if (!resolvedConfiguration) {
    if (configuredActions) {
      return configuredActions
    }

    configuredActions = createLiFiServerActions(defaultLiFiConfiguration)
    configuredSignature = `${DEFAULT_LIFI_INTEGRATOR}::`
    return configuredActions
  }

  const nextSignature = `${resolvedConfiguration.integrator}::${resolvedConfiguration.apiKey ?? ''}`
  if (configuredActions && configuredSignature === nextSignature) {
    return configuredActions
  }

  configuredActions = createLiFiServerActions(resolvedConfiguration)
  configuredSignature = nextSignature
  return configuredActions
}

export async function getLiFiEvmBalanceClient() {
  const { EthereumProvider } = await import('@lifi/sdk-provider-ethereum')
  const configuration = (await resolveLiFiConfiguration()) ?? defaultLiFiConfiguration
  const rpcUrls = {
    [POLYGON_MAINNET_CHAIN_ID]: [...resolveRuntimePolygonMainnetRpcUrls()],
  }

  return createLiFiClient(configuration, {
    preloadChains: false,
    providers: [EthereumProvider()],
    rpcUrls,
  })
}
