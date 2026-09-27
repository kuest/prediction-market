import type { LiFiStep, QuoteRequestFromAmount, QuoteRequestToAmount, RequestOptions } from '@lifi/sdk'

import { actions, createClient } from '@lifi/sdk'
import { EthereumProvider } from '@lifi/sdk-provider-ethereum'

import { getLiFiServerConfig } from '@/lib/lifi-config.server'
import 'server-only'

type LiFiServerActions = Omit<ReturnType<typeof actions>, 'getQuote'> & {
  getQuote: ((params: QuoteRequestFromAmount, options?: RequestOptions) => Promise<LiFiStep>) &
    ((params: QuoteRequestToAmount, options?: RequestOptions) => Promise<LiFiStep>)
}

let configuredSignature: string | null = null
let configuredActions: LiFiServerActions | null = null

function createLiFiServerActions(integrator: string, apiKey: string | null) {
  const config = { integrator, providers: [EthereumProvider()] }
  const client = createClient(apiKey ? { ...config, apiKey } : config)

  return actions(client) as LiFiServerActions
}

export async function getLiFiServerActions() {
  const { integrator, apiKey } = await getLiFiServerConfig()

  const nextSignature = `${integrator}::${apiKey ?? ''}`
  if (configuredActions && configuredSignature === nextSignature) {
    return configuredActions
  }

  configuredActions = createLiFiServerActions(integrator, apiKey)
  configuredSignature = nextSignature
  return configuredActions
}
