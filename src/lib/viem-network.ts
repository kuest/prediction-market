import type { Chain } from 'viem/chains'

import { fallback, http } from 'viem'
import { polygon, polygonAmoy } from 'viem/chains'

import type { DefaultNetworkKey } from '@/lib/network'

import { resolveDefaultNetworkKey } from '@/lib/network'
import { resolvePublicRuntimeEnv } from '@/lib/public-runtime-config.shared'

const VIEM_NETWORKS_BY_KEY = {
  amoy: polygonAmoy,
  polygon,
} as const satisfies Record<DefaultNetworkKey, Chain>

const VIEM_NETWORKS_BY_CHAIN_ID = new Map<number, Chain>(
  Object.values(VIEM_NETWORKS_BY_KEY).map((network) => [network.id, network]),
)

export const defaultViemNetwork = VIEM_NETWORKS_BY_KEY[resolveDefaultNetworkKey()]

export type ViemRpcUrls = readonly string[]

export function resolveViemRpcUrls(configuredRpcUrlValue?: string): ViemRpcUrls {
  const configuredRpcUrls = configuredRpcUrlValue
    ?.split(',')
    .map((rpcUrl) => rpcUrl.trim())
    .filter(Boolean)

  if (!configuredRpcUrls?.length) {
    return [defaultViemNetwork.rpcUrls.default.http[0]]
  }

  for (const configuredRpcUrl of configuredRpcUrls) {
    try {
      const parsedUrl = new URL(configuredRpcUrl)
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('invalid protocol')
      }
    } catch {
      throw new Error('Invalid POLYGON_RPC_URL. Expected comma-separated absolute http(s) URLs.')
    }
  }

  return configuredRpcUrls
}

export const defaultViemRpcUrls = resolveViemRpcUrls()

export function createViemTransport(rpcUrls: ViemRpcUrls = defaultViemRpcUrls) {
  return fallback(rpcUrls.map((rpcUrl) => http(rpcUrl)))
}

export function resolveRuntimeViemRpcUrls(env: NodeJS.ProcessEnv = process.env) {
  return resolveViemRpcUrls(resolvePublicRuntimeEnv(env).polygonRpcUrl)
}

export function resolveViemNetworkByChainId(chainId: number | string | null | undefined) {
  if (typeof chainId === 'number' && Number.isFinite(chainId)) {
    return VIEM_NETWORKS_BY_CHAIN_ID.get(chainId) ?? null
  }

  if (typeof chainId === 'string' && chainId.trim()) {
    const parsed = Number(chainId)
    return Number.isFinite(parsed) ? (VIEM_NETWORKS_BY_CHAIN_ID.get(parsed) ?? null) : null
  }

  return null
}
