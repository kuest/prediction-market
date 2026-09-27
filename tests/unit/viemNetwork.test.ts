import { afterEach, describe, expect, it, mock } from 'bun:test'

import { stubEnv, stubGlobal, unstubAllEnvs, unstubAllGlobals } from '../bun-test-helpers'

async function importViemNetwork() {
  return await import(`@/lib/viem-network?bun-test=${Math.random()}`)
}

describe('viem-network RPC URL resolution', () => {
  afterEach(() => {
    unstubAllEnvs()
    unstubAllGlobals()
    if (typeof window !== 'undefined') {
      delete (window as Window & { __PUBLIC_RUNTIME_CONFIG__?: unknown }).__PUBLIC_RUNTIME_CONFIG__
    }
  })

  it('uses the default network RPC when POLYGON_RPC_URL is empty', async () => {
    stubEnv('CHAIN_ID', '')
    stubEnv('POLYGON_RPC_URL', '')

    const { defaultViemNetwork, defaultViemRpcUrls } = await importViemNetwork()

    expect(defaultViemRpcUrls).toEqual([defaultViemNetwork.rpcUrls.default.http[0]])
  })

  it('uses a valid POLYGON_RPC_URL override', async () => {
    stubEnv('CHAIN_ID', '')
    stubEnv('POLYGON_RPC_URL', ' https://rpc.example.com/path ')

    const { resolveRuntimeViemRpcUrls } = await importViemNetwork()

    expect(resolveRuntimeViemRpcUrls()).toEqual(['https://rpc.example.com/path'])
  })

  it('parses comma-separated POLYGON_RPC_URL values in priority order', async () => {
    stubEnv('CHAIN_ID', '')
    stubEnv('POLYGON_RPC_URL', ' https://rpc-1.example.com , https://rpc-2.example.com/path ')

    const { resolveRuntimeViemRpcUrls } = await importViemNetwork()

    expect(resolveRuntimeViemRpcUrls()).toEqual(['https://rpc-1.example.com', 'https://rpc-2.example.com/path'])
  })

  it('uses Polygon mainnet when CHAIN_ID is set to 137', async () => {
    stubEnv('CHAIN_ID', '137')
    stubEnv('POLYGON_RPC_URL', '')

    const { defaultViemNetwork, defaultViemRpcUrls } = await importViemNetwork()

    expect(defaultViemNetwork.id).toBe(137)
    expect(defaultViemRpcUrls).toEqual([defaultViemNetwork.rpcUrls.default.http[0]])
  })

  it('uses the runtime chain id from the public config when present', async () => {
    stubEnv('CHAIN_ID', '')
    stubEnv('POLYGON_RPC_URL', '')
    ;(
      window as Window & {
        __PUBLIC_RUNTIME_CONFIG__?: { chainId?: number }
      }
    ).__PUBLIC_RUNTIME_CONFIG__ = {
      chainId: 137,
    }

    const { defaultViemNetwork, defaultViemRpcUrls } = await importViemNetwork()

    expect(defaultViemNetwork.id).toBe(137)
    expect(defaultViemRpcUrls).toEqual([defaultViemNetwork.rpcUrls.default.http[0]])
  })

  it('tries the next RPC URL when the current endpoint is offline', async () => {
    stubEnv('CHAIN_ID', '137')
    stubEnv('POLYGON_RPC_URL', 'https://rpc-1.example.com,https://rpc-2.example.com')
    const fetchMock = mock()
      .mockRejectedValueOnce(new TypeError('RPC offline'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: '0x89',
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        ),
      )
    stubGlobal('fetch', fetchMock)

    const { createViemTransport, defaultViemNetwork, resolveRuntimeViemRpcUrls } = await importViemNetwork()
    const transport = createViemTransport(resolveRuntimeViemRpcUrls())({
      chain: defaultViemNetwork,
      retryCount: 0,
      timeout: 100,
    })

    await expect(transport.request({ method: 'eth_chainId' })).resolves.toBe('0x89')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://rpc-1.example.com/',
      'https://rpc-2.example.com/',
    ])
  })

  it.each([
    'rpc.example.com',
    'ftp://rpc.example.com',
    'ws://rpc.example.com',
    'https://rpc.example.com,ftp://invalid.example.com',
  ])('rejects invalid POLYGON_RPC_URL value %s', async (rpcUrl) => {
    stubEnv('CHAIN_ID', '')
    stubEnv('POLYGON_RPC_URL', rpcUrl)

    const { resolveRuntimeViemRpcUrls } = await importViemNetwork()

    expect(() => resolveRuntimeViemRpcUrls()).toThrow('Invalid POLYGON_RPC_URL')
  })
})
