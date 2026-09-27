import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { cookieStorage, createStorage } from '@wagmi/core'

import { appKitNetworks, defaultAppKitNetwork } from '@/lib/supported-networks'
import { WAGMI_STORAGE_KEY } from '@/lib/wagmi-storage'

export { appKitNetworks as networks }
export const defaultNetwork = defaultAppKitNetwork

export function createAppKitWagmiAdapter(projectId: string) {
  return new WagmiAdapter({
    storage: createStorage({ key: WAGMI_STORAGE_KEY, storage: cookieStorage }),
    projectId,
    networks: appKitNetworks,
    ssr: true,
  })
}
