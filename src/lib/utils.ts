import type { ClassValue } from 'clsx'

import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

import { IS_BROWSER } from '@/lib/constants'

const NEW_MARKET_MAX_AGE_DAYS = 2
const MS_IN_DAY = 86_400_000

export function isMarketNew(
  createdAt: string,
  thresholdDays: number = NEW_MARKET_MAX_AGE_DAYS,
  currentTime?: number | null,
) {
  const createdDate = new Date(createdAt)
  if (Number.isNaN(createdDate.getTime())) {
    return false
  }

  if (currentTime === null || currentTime === undefined) {
    return false
  }

  const diffInMs = currentTime - createdDate.getTime()
  return diffInMs <= thresholdDays * MS_IN_DAY
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const DISALLOWED_ELEMENT_TAGS_WITH_CONTENT = ['script', 'foreignobject', 'iframe', 'object', 'embed', 'style'] as const

const DISALLOWED_ELEMENT_TAGS_SELF_CLOSING = ['link', 'meta', 'base'] as const

const DROP_TAGS_BUT_KEEP_CONTENT = ['a', 'use'] as const

function stripElementBlocks(svg: string, tag: string) {
  const openTag = `<${tag}`
  const closeTag = `</${tag}>`
  const lower = svg.toLowerCase()
  let cursor = 0
  let sanitized = ''

  while (cursor < svg.length) {
    const start = lower.indexOf(openTag, cursor)
    if (start === -1) {
      sanitized += svg.slice(cursor)
      break
    }

    sanitized += svg.slice(cursor, start)
    const end = lower.indexOf(closeTag, start)
    if (end === -1) {
      break
    }

    cursor = end + closeTag.length
  }

  return sanitized
}

function stripScriptTags(svg: string) {
  return stripElementBlocks(svg, 'script')
}

function stripDangerousElements(svg: string) {
  let sanitized = svg

  for (const tag of DISALLOWED_ELEMENT_TAGS_WITH_CONTENT) {
    sanitized = stripElementBlocks(sanitized, tag)
  }

  if (DISALLOWED_ELEMENT_TAGS_SELF_CLOSING.length) {
    const selfClosingTags = DISALLOWED_ELEMENT_TAGS_SELF_CLOSING.join('|')
    sanitized = sanitized.replace(new RegExp(`<\\s*(?:${selfClosingTags})\\b[^>]*\>`, 'gi'), '')
  }

  if (DROP_TAGS_BUT_KEEP_CONTENT.length) {
    const droppedTags = DROP_TAGS_BUT_KEEP_CONTENT.join('|')
    sanitized = sanitized.replace(new RegExp(`<\\/?\\s*(?:${droppedTags})\\b[^>]*>`, 'gi'), '')
  }

  sanitized = sanitized
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!doctype[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[cdata\[[\s\S]*?\]\]>/gi, '')

  return sanitized
}

function isSafeDataImageUrl(value: string) {
  const normalized = value.trim().toLowerCase()
  return /^data:image\/(?:png|jpe?g|gif|webp)\b/.test(normalized)
}

function sanitizeUrlAttribute(match: string, quotedValue?: string, singleQuotedValue?: string, rawValue?: string) {
  const value = (quotedValue ?? singleQuotedValue ?? rawValue ?? '').trim()
  const normalized = value.toLowerCase()

  if (!value) {
    return ''
  }

  if (value.startsWith('#')) {
    const escaped = value.replace(/"/g, '&quot;')
    return match.startsWith(' xlink:href') ? ` xlink:href="${escaped}"` : ` href="${escaped}"`
  }

  if (isSafeDataImageUrl(value)) {
    const escaped = value.replace(/"/g, '&quot;')
    return match.startsWith(' xlink:href') ? ` xlink:href="${escaped}"` : ` href="${escaped}"`
  }

  if (
    normalized.startsWith('data:') ||
    normalized.startsWith('javascript:') ||
    normalized.startsWith('http:') ||
    normalized.startsWith('https:')
  ) {
    return ''
  }

  return ''
}

function stripUnsafeUrlPaintAttributes(svg: string) {
  const urlPaintAttrs = ['fill', 'stroke', 'filter', 'clip-path', 'mask']

  let sanitized = svg

  for (const attr of urlPaintAttrs) {
    const pattern = new RegExp(`\\s${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'gi')
    sanitized = sanitized.replace(pattern, (full, q1, q2, q3) => {
      const value = String(q1 ?? q2 ?? q3 ?? '').trim()
      const normalized = value.toLowerCase()

      if (!value) {
        return ''
      }

      if (normalized.includes('url(')) {
        const isInternal = /url\(\s*['"]?#/i.test(value)
        return isInternal ? full : ''
      }

      return full
    })
  }

  return sanitized
}

export function sanitizeSvg(svg: string) {
  let sanitized = stripDangerousElements(svg)

  sanitized = stripScriptTags(sanitized)
  sanitized = sanitized.replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  sanitized = sanitized.replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  sanitized = sanitized.replace(/javascript:/gi, '')
  sanitized = sanitized.replace(/data:(?!image\/(?:png|jpe?g|gif|webp)\b)/gi, '')
  sanitized = sanitized.replace(/\s(?:href|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, sanitizeUrlAttribute)
  sanitized = sanitized.replace(/\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, '')

  sanitized = stripUnsafeUrlPaintAttributes(sanitized)

  return sanitized
}

export function calculateWinnings(amount: number, price: number): number {
  if (!Number.isFinite(amount) || !Number.isFinite(price) || amount <= 0 || price <= 0) {
    return 0
  }

  return amount / price - amount
}

export function clearBrowserStorage() {
  if (!IS_BROWSER) {
    return
  }

  try {
    window.localStorage.clear()
    window.sessionStorage.clear()
  } catch {
    //
  }
}

export function clearNonHttpOnlyCookies() {
  if (typeof document === 'undefined') {
    return
  }

  const cookies = document.cookie.split(';')
  cookies.forEach((cookie) => {
    const name = cookie.split('=')[0]?.trim()
    if (!name) {
      return
    }

    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure`
  })
}
