import { DEFAULT_LIFI_INTEGRATOR } from '@/lib/lifi-config.shared'
import { AMOY_CHAIN_ID, parseNetworkChainId, POLYGON_MAINNET_CHAIN_ID } from '@/lib/network'

export interface PublicRuntimeConfig {
  clobUrl: string
  commitSha: string
  communityUrl: string
  createMarketUrl: string
  dataUrl: string
  escrowUrl: string
  gammaUrl: string
  geoblockUrl: string
  isVercel: string
  lifiIntegrator: string
  notificationsUrl: string
  chainId: number
  polygonRpcUrl: string
  polymarketGammaUrl: string
  priceReferenceUrl: string
  relayerUrl: string
  reownAppKitProjectId: string
  sdkDownloadUrl: string
  sentryDsn: string
  subgraphsUrl: string
  siteUrl: string
  userPnlUrl: string
  wsClobUrl: string
  wsLiveDataUrl: string
}

const NETWORK_SERVICE_URLS = {
  amoy: {
    clobUrl: 'https://clob-staging.kuest.com',
    communityUrl: 'https://community-staging.kuest.com',
    dataUrl: 'https://data-api-staging.kuest.com',
    gammaUrl: 'https://gamma-api-staging.kuest.com',
    relayerUrl: 'https://relayer-staging.kuest.com',
    subgraphsUrl: 'https://subgraphs-staging.kuest.com',
    userPnlUrl: 'https://user-pnl-api-staging.kuest.com',
    wsClobUrl: 'wss://ws-subscriptions-clob-staging.kuest.com',
    wsLiveDataUrl: 'wss://ws-live-data-staging.kuest.com',
  },
  mainnet: {
    clobUrl: 'https://clob.kuest.com',
    communityUrl: 'https://community.kuest.com',
    dataUrl: 'https://data-api.kuest.com',
    gammaUrl: 'https://gamma-api.kuest.com',
    relayerUrl: 'https://relayer.kuest.com',
    subgraphsUrl: 'https://subgraphs.kuest.com',
    userPnlUrl: 'https://user-pnl-api.kuest.com',
    wsClobUrl: 'wss://ws-subscriptions-clob.kuest.com',
    wsLiveDataUrl: 'wss://ws-live-data.kuest.com',
  },
} as const

function getNetworkServiceUrls(chainId: number) {
  return chainId === POLYGON_MAINNET_CHAIN_ID ? NETWORK_SERVICE_URLS.mainnet : NETWORK_SERVICE_URLS.amoy
}

const DEFAULT_AMOY_SERVICE_URLS = getNetworkServiceUrls(AMOY_CHAIN_ID)

export const defaultPublicRuntimeConfig: PublicRuntimeConfig = {
  clobUrl: DEFAULT_AMOY_SERVICE_URLS.clobUrl,
  commitSha: 'unknown',
  communityUrl: DEFAULT_AMOY_SERVICE_URLS.communityUrl,
  createMarketUrl: 'https://create-market.kuest.com',
  dataUrl: DEFAULT_AMOY_SERVICE_URLS.dataUrl,
  escrowUrl: 'https://escrow.kuest.com',
  gammaUrl: DEFAULT_AMOY_SERVICE_URLS.gammaUrl,
  geoblockUrl: 'https://geoblock.kuest.com',
  isVercel: 'false',
  lifiIntegrator: DEFAULT_LIFI_INTEGRATOR,
  notificationsUrl: 'https://notifications.kuest.com',
  chainId: AMOY_CHAIN_ID,
  polygonRpcUrl: '',
  polymarketGammaUrl: 'https://gamma-api.polymarket.com',
  priceReferenceUrl: 'https://price-reference.kuest.com',
  relayerUrl: DEFAULT_AMOY_SERVICE_URLS.relayerUrl,
  reownAppKitProjectId: '',
  sdkDownloadUrl: 'https://sdk-download.kuest.com',
  sentryDsn: '',
  siteUrl: 'http://localhost:3000',
  subgraphsUrl: DEFAULT_AMOY_SERVICE_URLS.subgraphsUrl,
  userPnlUrl: DEFAULT_AMOY_SERVICE_URLS.userPnlUrl,
  wsClobUrl: DEFAULT_AMOY_SERVICE_URLS.wsClobUrl,
  wsLiveDataUrl: DEFAULT_AMOY_SERVICE_URLS.wsLiveDataUrl,
}

export function normalizePublicRuntimeEnvValue(value: string | undefined, fallback = '') {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : fallback
}

export function resolvePublicRuntimeEnv(
  env: Readonly<Partial<NodeJS.ProcessEnv>>,
): Omit<PublicRuntimeConfig, 'commitSha' | 'siteUrl'> {
  const chainId = parseNetworkChainId(env.CHAIN_ID, defaultPublicRuntimeConfig.chainId)
  const networkServiceUrls = getNetworkServiceUrls(chainId)

  return {
    clobUrl: normalizePublicRuntimeEnvValue(env.CLOB_URL, networkServiceUrls.clobUrl),
    communityUrl: normalizePublicRuntimeEnvValue(env.COMMUNITY_URL, networkServiceUrls.communityUrl),
    createMarketUrl: normalizePublicRuntimeEnvValue(env.CREATE_MARKET_URL, defaultPublicRuntimeConfig.createMarketUrl),
    dataUrl: normalizePublicRuntimeEnvValue(env.DATA_URL, networkServiceUrls.dataUrl),
    escrowUrl: normalizePublicRuntimeEnvValue(env.ESCROW_URL, defaultPublicRuntimeConfig.escrowUrl),
    gammaUrl: normalizePublicRuntimeEnvValue(env.GAMMA_URL, networkServiceUrls.gammaUrl),
    geoblockUrl: normalizePublicRuntimeEnvValue(env.GEOBLOCK_URL, defaultPublicRuntimeConfig.geoblockUrl),
    isVercel: env.VERCEL_ENV ? 'true' : 'false',
    lifiIntegrator: DEFAULT_LIFI_INTEGRATOR,
    notificationsUrl: normalizePublicRuntimeEnvValue(
      env.NOTIFICATIONS_URL,
      defaultPublicRuntimeConfig.notificationsUrl,
    ),
    chainId,
    polygonRpcUrl: normalizePublicRuntimeEnvValue(env.POLYGON_RPC_URL),
    polymarketGammaUrl: normalizePublicRuntimeEnvValue(
      env.POLYMARKET_GAMMA_URL,
      defaultPublicRuntimeConfig.polymarketGammaUrl,
    ),
    priceReferenceUrl: normalizePublicRuntimeEnvValue(
      env.PRICE_REFERENCE_URL,
      defaultPublicRuntimeConfig.priceReferenceUrl,
    ),
    relayerUrl: normalizePublicRuntimeEnvValue(env.RELAYER_URL, networkServiceUrls.relayerUrl),
    reownAppKitProjectId: normalizePublicRuntimeEnvValue(env.REOWN_APPKIT_PROJECT_ID),
    sdkDownloadUrl: normalizePublicRuntimeEnvValue(env.SDK_DOWNLOAD_URL, defaultPublicRuntimeConfig.sdkDownloadUrl),
    sentryDsn: normalizePublicRuntimeEnvValue(env.SENTRY_DSN),
    subgraphsUrl: networkServiceUrls.subgraphsUrl,
    userPnlUrl: normalizePublicRuntimeEnvValue(env.USER_PNL_URL, networkServiceUrls.userPnlUrl),
    wsClobUrl: normalizePublicRuntimeEnvValue(env.WS_CLOB_URL, networkServiceUrls.wsClobUrl),
    wsLiveDataUrl: normalizePublicRuntimeEnvValue(env.WS_LIVE_DATA_URL, networkServiceUrls.wsLiveDataUrl),
  }
}
