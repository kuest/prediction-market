import { OUTCOME_INDEX } from '@/lib/constants'
import { formatCentsLabel, formatCurrency, formatPercent } from '@/lib/formatters'
import { resolveMarketAssetUrl } from '@/lib/image/asset-reference'

type ShareCardVariant = 'yes' | 'no'

export interface ShareCardPayload {
  title: string
  outcome: string
  avgPrice: string
  odds: string
  cost: string
  invested: string
  toWin: string
  imageUrl?: string
  userName?: string
  userImage?: string
  variant: ShareCardVariant
  eventSlug: string
}

export interface ShareCardPosition {
  title?: string | null
  outcome?: string | null
  outcomeIndex?: number | null
  avgPrice?: number | null
  curPrice?: number | null
  size?: number | null
  icon?: string | null
  eventSlug?: string | null
  slug?: string | null
}

export interface ShareCardUserInfo {
  userName?: string
  userImage?: string
}

function formatCurrencyValue(value?: number | null) {
  return Number.isFinite(value) ? formatCurrency(value ?? 0) : '—'
}

function getOutcomeLabel(position: ShareCardPosition) {
  if (position.outcome && position.outcome.trim()) {
    return position.outcome
  }
  return position.outcomeIndex === OUTCOME_INDEX.NO ? 'No' : 'Yes'
}

function getOutcomeVariant(position: ShareCardPosition, outcomeLabel: string): ShareCardVariant {
  if (position.outcomeIndex === OUTCOME_INDEX.NO) {
    return 'no'
  }
  if (position.outcomeIndex === OUTCOME_INDEX.YES) {
    return 'yes'
  }
  if (/\bno\b/i.test(outcomeLabel)) {
    return 'no'
  }
  if (/\byes\b/i.test(outcomeLabel)) {
    return 'yes'
  }
  return 'yes'
}

function resolveShareImageUrl(icon?: string | null): string | undefined {
  return resolveMarketAssetUrl(icon) ?? undefined
}

export function buildShareCardPayload(position: ShareCardPosition, user?: ShareCardUserInfo): ShareCardPayload {
  const avgPrice = Number.isFinite(position.avgPrice) ? position.avgPrice! : 0
  const shares = Number.isFinite(position.size) ? position.size! : 0
  const tradeValue = shares * avgPrice
  const nowPrice = Number.isFinite(position.curPrice) ? position.curPrice! : avgPrice
  const outcome = getOutcomeLabel(position)
  const imageUrl = resolveShareImageUrl(position.icon)
  const eventSlug = position.eventSlug || position.slug || 'unknown-market'

  return {
    title: position.title || 'Untitled market',
    outcome,
    avgPrice: formatCentsLabel(avgPrice, { fallback: '—' }),
    odds: formatPercent(nowPrice * 100, { digits: 0 }),
    cost: formatCurrencyValue(tradeValue),
    invested: formatCurrencyValue(tradeValue),
    toWin: formatCurrencyValue(shares),
    imageUrl,
    variant: getOutcomeVariant(position, outcome),
    eventSlug,
    userName: user?.userName,
    userImage: user?.userImage,
  }
}

function encodeSharePayload(payload: ShareCardPayload) {
  const json = JSON.stringify(payload)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  const base64 = btoa(binary)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function buildShareCardUrl(payload: ShareCardPayload) {
  const encodedPayload = encodeSharePayload(payload)
  const params = new URLSearchParams({
    position: encodedPayload,
  })
  return `/api/og/position?${params.toString()}`
}
