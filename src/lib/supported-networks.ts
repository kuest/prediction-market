import type { AppKitNetwork } from '@reown/appkit/networks'

import {
  arbitrum,
  avalanche,
  base,
  blast,
  bsc,
  celo,
  cronos,
  gnosis,
  linea,
  mainnet,
  mantle,
  opBNB,
  optimism,
  polygon,
  polygonAmoy,
  scroll,
  sonic,
  unichain,
  worldchain,
  zkSync,
} from '@reown/appkit/networks'

import type { DefaultNetworkKey } from '@/lib/network'

import { DEFAULT_NETWORK_KEY } from '@/lib/network'

const APPKIT_NETWORKS_BY_KEY = {
  amoy: polygonAmoy,
  polygon,
} as const satisfies Record<DefaultNetworkKey, AppKitNetwork>

export const defaultAppKitNetwork = APPKIT_NETWORKS_BY_KEY[DEFAULT_NETWORK_KEY]

const SUPPORTED_EVM_SOURCE_NETWORKS = [
  mainnet,
  arbitrum,
  base,
  bsc,
  optimism,
  avalanche,
  gnosis,
  linea,
  scroll,
  zkSync,
  blast,
  mantle,
  opBNB,
  worldchain,
  unichain,
  celo,
  cronos,
  sonic,
] as const

function uniqueNetworks(networksToDeduplicate: readonly { id: number | string }[]) {
  return [...new Map(networksToDeduplicate.map((network) => [network.id, network])).values()]
}

export const appKitNetworks = uniqueNetworks([
  defaultAppKitNetwork,
  polygon,
  ...SUPPORTED_EVM_SOURCE_NETWORKS,
]) as unknown as [AppKitNetwork, ...AppKitNetwork[]]

export const supportedEvmChainIds = SUPPORTED_EVM_SOURCE_NETWORKS.map(({ id }) => Number(id))
