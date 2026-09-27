import type { AppKitNetwork } from '@reown/appkit/networks'

import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { polygon, polygonAmoy } from '@reown/appkit/networks'
import { cookieStorage, createStorage } from '@wagmi/core'

import type { DefaultNetworkKey } from '@/lib/network'

import { DEFAULT_NETWORK_KEY } from '@/lib/network'
import { WAGMI_STORAGE_KEY } from '@/lib/wagmi-storage'

const APPKIT_NETWORKS_BY_KEY = {
  amoy: polygonAmoy,
  polygon,
} as const satisfies Record<DefaultNetworkKey, AppKitNetwork>

export const defaultNetwork = APPKIT_NETWORKS_BY_KEY[DEFAULT_NETWORK_KEY]
export const networks = (defaultNetwork.id === polygon.id ? [polygon] : [defaultNetwork, polygon]) as [
  AppKitNetwork,
  ...AppKitNetwork[],
]

export function createAppKitWagmiAdapter(projectId: string) {
  return new WagmiAdapter({
    storage: createStorage({ key: WAGMI_STORAGE_KEY, storage: cookieStorage }),
    projectId,
    networks,
    ssr: true,
  })
}
