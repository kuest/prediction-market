import { describe, expect, it } from 'bun:test'

import { buildDataApiUrl } from '@/lib/data-api/client'

describe('buildDataApiUrl', () => {
  it('preserves a Data API path prefix and query parameters with an explicit client base', () => {
    const params = new URLSearchParams({
      user_address: '0xabc',
      interval: 'all',
      fidelity: '12h',
    })

    expect(buildDataApiUrl('/user-pnl', params, 'https://data-api.test/gateway/')).toBe(
      'https://data-api.test/gateway/user-pnl?user_address=0xabc&interval=all&fidelity=12h',
    )
    expect(buildDataApiUrl('value', 'user=0xabc', 'https://data-api.test/gateway///')).toBe(
      'https://data-api.test/gateway/value?user=0xabc',
    )
  })
})
