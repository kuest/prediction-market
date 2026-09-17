import type { AppKitNetwork } from '@reown/appkit/networks'

import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { cookieStorage, createStorage } from '@wagmi/core'

import { appKitNetworks, defaultAppKitNetwork } from '@/lib/supported-networks'
import { WAGMI_STORAGE_KEY } from '@/lib/wagmi-storage'

export const defaultNetwork = defaultAppKitNetwork as unknown as AppKitNetwork & { id: number }
export const networks = appKitNetworks

export function createAppKitWagmiAdapter(projectId: string) {
  return new WagmiAdapter({
    storage: createStorage({ key: WAGMI_STORAGE_KEY, storage: cookieStorage }),
    projectId,
    networks,
    ssr: true,
  })
}
