const EMBED_SCRIPT_URL = 'https://unpkg.com/@kuest/embeds@1.3.14/dist/embeds/market/index.js'

type EmbedTheme = 'light' | 'dark'
const CUSTOM_ELEMENT_NAME_PATTERN = /^[a-z](?:[a-z0-9-]*[a-z0-9])?$/

export function requireEmbedValue(value: string | undefined, name: string) {
  if (!value || !value.trim()) {
    throw new Error(`${name} is required for embeds.`)
  }

  return value.trim()
}

export function normalizeEmbedBaseUrl(value: string) {
  return value.replace(/\/$/, '')
}

function appendAffiliateRef(params: URLSearchParams, affiliateCode?: string) {
  const sanitized = affiliateCode?.trim()
  if (!sanitized || params.has('r')) {
    return
  }
  params.set('r', sanitized)
}

export function buildFeatureList(showVolume: boolean, showChart: boolean, showTimeRange: boolean) {
  const features: string[] = []
  if (showVolume) {
    features.push('volume')
  }
  if (showChart) {
    features.push('chart')
  }
  if (showChart && showTimeRange) {
    features.push('filters')
  }
  return features
}

export function buildIframeSrc(
  baseUrl: string,
  marketSlug: string,
  theme: EmbedTheme,
  features: string[],
  affiliateCode?: string,
) {
  if (!marketSlug) {
    return ''
  }

  const params = new URLSearchParams({ market: marketSlug, theme })
  if (features.length > 0) {
    params.set('features', features.join(','))
  }
  appendAffiliateRef(params, affiliateCode)

  return `${baseUrl}/market.html?${params.toString()}`
}

export function buildPreviewSrc(marketSlug: string, theme: EmbedTheme, features: string[], affiliateCode?: string) {
  if (!marketSlug) {
    return ''
  }

  const params = new URLSearchParams({ market: marketSlug, theme })
  if (features.length > 0) {
    params.set('features', features.join(','))
  }
  appendAffiliateRef(params, affiliateCode)

  return `/market.html?${params.toString()}`
}

export function buildIframeCode(src: string, height: number, iframeTitle: string) {
  const safeTitle = escapeHtmlAttr(iframeTitle)
  const safeSrc = escapeHtmlAttr(src)

  return [
    '<iframe',
    `\ttitle="${safeTitle}"`,
    `\tsrc="${safeSrc}"`,
    '\twidth="400"',
    `\theight="${height}"`,
    '\tframeBorder="0"',
    '\tstyle="border-radius: 12px; background: transparent"',
    '/>',
  ].join('\n')
}

export function buildWebComponentCode(
  elementName: string,
  marketSlug: string,
  theme: EmbedTheme,
  showVolume: boolean,
  showChart: boolean,
  showTimeRange: boolean,
  affiliateCode?: string,
) {
  const safeElementName = sanitizeCustomElementName(elementName)
  const safeMarketSlug = escapeHtmlAttr(marketSlug)
  const safeTheme = escapeHtmlAttr(theme)
  const safeAffiliateCode = affiliateCode?.trim() ? escapeHtmlAttr(affiliateCode.trim()) : ''

  const lines = [
    `<div id="${safeElementName}">`,
    '\t<script',
    '\t\ttype="module"',
    `\t\tsrc="${EMBED_SCRIPT_URL}"`,
    '\t>',
    '\t</script>',
    `\t<${safeElementName}`,
    `\t\tmarket="${safeMarketSlug}"`,
  ]

  if (showVolume) {
    lines.push('\t\tvolume="true"')
  }
  if (showChart) {
    lines.push('\t\tchart="true"')
  }
  if (showChart && showTimeRange) {
    lines.push('\t\tfilters="true"')
  }
  if (safeAffiliateCode) {
    lines.push(`\t\taffiliate="${safeAffiliateCode}"`)
  }

  lines.push(`\t\ttheme="${safeTheme}"`)
  lines.push('\t/>')
  lines.push('</div>')
  return lines.join('\n')
}

function escapeHtmlAttr(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;')
}

function sanitizeCustomElementName(value: string) {
  const normalized = value.trim().toLowerCase()
  if (!normalized.includes('-') || !CUSTOM_ELEMENT_NAME_PATTERN.test(normalized)) {
    return 'market-embed-widget'
  }
  return normalized
}

export { EMBED_SCRIPT_URL }
export type { EmbedTheme }
