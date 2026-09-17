import type { AppKitNetwork } from '@reown/appkit/networks'

import {
  arbitrum,
  avalanche,
  base,
  blast,
  bsc,
  celo,
  cronos,
  fantom,
  gnosis,
  linea,
  mainnet,
  mantle,
  moonbeam,
  opBNB,
  optimism,
  polygon,
  polygonAmoy,
  polygonZkEvm,
  scroll,
  unichain,
  worldchain,
  zkSync,
} from '@reown/appkit/networks'

import type { DefaultNetworkKey } from '@/lib/network'

import { DEFAULT_NETWORK_KEY } from '@/lib/network'

const APPKIT_NETWORKS_BY_KEY = {
  amoy: polygonAmoy,
  polygon,
} as const satisfies Record<DefaultNetworkKey, typeof polygon | typeof polygonAmoy>

const defaultNetwork = APPKIT_NETWORKS_BY_KEY[DEFAULT_NETWORK_KEY]
const commonEvmNetworks = [
  mainnet,
  polygon,
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
  fantom,
  moonbeam,
  polygonZkEvm,
] as const

function uniqueNetworks(networksToDeduplicate: readonly { id: number | string }[]) {
  return [...new Map(networksToDeduplicate.map((network) => [network.id, network])).values()]
}

export const appKitNetworks = uniqueNetworks([defaultNetwork, ...commonEvmNetworks]) as unknown as [
  AppKitNetwork,
  ...AppKitNetwork[],
]

export const defaultAppKitNetwork = defaultNetwork
export const supportedEvmChainIds = appKitNetworks.map(({ id }) => Number(id))
