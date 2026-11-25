import type { ClientRequest, RequestOptions as HttpRequestOptions, IncomingMessage } from 'node:http'
import type { RequestOptions as HttpsRequestOptions } from 'node:https'

import { Buffer } from 'node:buffer'
import { lookup } from 'node:dns/promises'
import * as http from 'node:http'
import * as https from 'node:https'
import { isIP } from 'node:net'

import { isRetiredAssetHost } from '@/lib/public-runtime-config.shared'
import 'server-only'

const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 1200
const DEFAULT_MAX_REDIRECTS = 3
const MAX_URL_LENGTH = 2048
const MAX_TRUSTED_DATA_URI_LENGTH = DEFAULT_MAX_IMAGE_BYTES * 2
const WEBP_RENDERABLE_MAX_BYTE_MULTIPLIER = 4
const WEBP_JPEG_QUALITY = 90

const IMAGE_DATA_URI_CONTENT_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/svg+xml',
  'image/webp',
])

interface SafeImageOptions {
  siteUrl?: string
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
}

interface ResolvedAddress {
  address: string
  family: 4 | 6
}

interface ImageResponsePayload {
  body: Uint8Array | null
  contentType: string
  location: string
  statusCode: number
}

interface RenderableImagePayload {
  body: Uint8Array
  contentType: string
}

type WebpRenderableContentType = 'image/jpeg' | 'image/png'

let sharpModulePromise: Promise<typeof import('sharp')> | null = null

async function loadSharp() {
  sharpModulePromise ??= import('sharp')
  return (await sharpModulePromise).default
}

function normalizeHostname(hostname: string) {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
}

function isTrustedImageDataUri(rawUrl: string) {
  if (rawUrl.length > MAX_TRUSTED_DATA_URI_LENGTH) {
    return false
  }

  const commaIndex = rawUrl.indexOf(',')
  if (commaIndex === -1 || !rawUrl.toLowerCase().startsWith('data:')) {
    return false
  }

  const metadata = rawUrl.slice('data:'.length, commaIndex).toLowerCase()
  const contentType = metadata.split(';')[0]?.trim() ?? ''
  return IMAGE_DATA_URI_CONTENT_TYPES.has(contentType)
}

function parseIpv4Address(address: string): [number, number, number, number] | null {
  const octets = address.split('.')
  if (octets.length !== 4) {
    return null
  }

  const parsed = octets.map((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      return Number.NaN
    }
    return Number(part)
  })

  if (parsed.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null
  }

  return [parsed[0]!, parsed[1]!, parsed[2]!, parsed[3]!]
}

function isPublicIpv4Address(address: string) {
  const octets = parseIpv4Address(address)
  if (!octets) {
    return false
  }

  const [first, second, third] = octets
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  )
}

function parseIpv6Address(address: string) {
  let normalized = normalizeHostname(address)
  const zoneIndex = normalized.indexOf('%')
  if (zoneIndex !== -1) {
    normalized = normalized.slice(0, zoneIndex)
  }

  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':')
    if (lastColon === -1) {
      return null
    }

    const ipv4 = parseIpv4Address(normalized.slice(lastColon + 1))
    if (!ipv4) {
      return null
    }

    const high = ((ipv4[0] << 8) | ipv4[1]).toString(16)
    const low = ((ipv4[2] << 8) | ipv4[3]).toString(16)
    normalized = `${normalized.slice(0, lastColon)}:${high}:${low}`
  }

  const compressedParts = normalized.split('::')
  if (compressedParts.length > 2) {
    return null
  }

  const left = compressedParts[0] ? compressedParts[0].split(':') : []
  const right = compressedParts[1] ? compressedParts[1].split(':') : []
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) {
    return null
  }

  const hasCompression = compressedParts.length === 2
  const missingGroups = 8 - left.length - right.length
  if ((!hasCompression && missingGroups !== 0) || (hasCompression && missingGroups < 1)) {
    return null
  }

  const compressedGroups = Array.from({ length: hasCompression ? missingGroups : 0 }).fill('0') as string[]
  const groups = [...left, ...compressedGroups, ...right]
  if (groups.length !== 8) {
    return null
  }

  return groups.reduce((value, group) => (value << 16n) + BigInt(Number.parseInt(group, 16)), 0n)
}

function isIpv6InRange(address: bigint, baseAddress: string, prefixLength: number) {
  const base = parseIpv6Address(baseAddress)
  if (base == null) {
    return false
  }

  const shift = 128n - BigInt(prefixLength)
  return address >> shift === base >> shift
}

function isPublicIpv6Address(address: string) {
  const parsed = parseIpv6Address(address)
  if (parsed == null) {
    return false
  }

  if (parsed <= 1n) {
    return false
  }

  if (parsed >> 32n === 0xffffn) {
    const ipv4Number = Number(parsed & 0xffffffffn)
    const ipv4Address = [
      (ipv4Number >>> 24) & 255,
      (ipv4Number >>> 16) & 255,
      (ipv4Number >>> 8) & 255,
      ipv4Number & 255,
    ].join('.')
    return isPublicIpv4Address(ipv4Address)
  }

  if (parsed <= 0xffffffffn) {
    return false
  }

  return !(
    isIpv6InRange(parsed, '64:ff9b:1::', 48) ||
    isIpv6InRange(parsed, '100::', 64) ||
    isIpv6InRange(parsed, '2001::', 23) ||
    isIpv6InRange(parsed, '2001:db8::', 32) ||
    isIpv6InRange(parsed, '2002::', 16) ||
    isIpv6InRange(parsed, 'fc00::', 7) ||
    isIpv6InRange(parsed, 'fe80::', 10) ||
    isIpv6InRange(parsed, 'fec0::', 10) ||
    isIpv6InRange(parsed, 'ff00::', 8)
  )
}

export function isPublicIpAddress(address: string) {
  const normalized = normalizeHostname(address)
  const family = isIP(normalized)
  if (family === 4) {
    return isPublicIpv4Address(normalized)
  }
  if (family === 6) {
    return isPublicIpv6Address(normalized)
  }
  return false
}

function isDisallowedHostname(hostname: string) {
  const normalized = normalizeHostname(hostname)
  if (!normalized) {
    return true
  }

  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return true
  }

  const family = isIP(normalized)
  if (family) {
    return !isPublicIpAddress(normalized)
  }

  return !normalized.includes('.')
}

export function normalizeOutboundImageUrl(
  rawUrl: string | null | undefined,
  options: Pick<SafeImageOptions, 'siteUrl'> = {},
) {
  const trimmed = rawUrl?.trim()
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) {
    return ''
  }

  try {
    const baseUrl = options.siteUrl ? `${options.siteUrl.replace(/\/+$/, '')}/` : undefined
    const parsed = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return ''
    }
    if (parsed.username || parsed.password) {
      return ''
    }
    if (isDisallowedHostname(parsed.hostname) || isRetiredAssetHost(parsed.hostname)) {
      return ''
    }
    return parsed.toString()
  } catch {
    return ''
  }
}

async function resolvePublicAddress(url: URL): Promise<ResolvedAddress | null> {
  const hostname = normalizeHostname(url.hostname)
  if (isDisallowedHostname(hostname)) {
    return null
  }

  const family = isIP(hostname)
  if (family) {
    return isPublicIpAddress(hostname) ? { address: hostname, family: family as 4 | 6 } : null
  }

  const addresses = await lookup(hostname, { all: true, verbatim: false })
  if (addresses.length === 0) {
    return null
  }

  if (addresses.some((address) => !isPublicIpAddress(address.address))) {
    return null
  }

  const firstAddress = addresses[0]
  if (!firstAddress || (firstAddress.family !== 4 && firstAddress.family !== 6)) {
    return null
  }

  return {
    address: firstAddress.address,
    family: firstAddress.family,
  }
}

export async function validateOutboundImageUrl(
  rawUrl: string | null | undefined,
  options: Pick<SafeImageOptions, 'siteUrl'> = {},
) {
  const normalized = normalizeOutboundImageUrl(rawUrl, options)
  if (!normalized) {
    return false
  }

  try {
    const parsed = new URL(normalized)
    return Boolean(await resolvePublicAddress(parsed))
  } catch {
    return false
  }
}

function isRedirectStatus(statusCode: number) {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308
}

function getHeaderValue(header: string | string[] | undefined) {
  return Array.isArray(header) ? (header[0] ?? '') : (header ?? '')
}

function readIncomingMessageWithLimit(response: IncomingMessage, maxBytes: number) {
  const contentLengthHeader = getHeaderValue(response.headers['content-length'])
  const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : Number.NaN
  if (Number.isFinite(contentLength) && (contentLength < 0 || contentLength > maxBytes)) {
    response.resume()
    return Promise.resolve(null)
  }

  return new Promise<Uint8Array | null>((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let settled = false

    function cleanup() {
      response.off('data', handleData)
      response.off('end', handleEnd)
      response.off('error', handleError)
    }

    function settle(value: Uint8Array | null) {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(value)
    }

    function fail(error: Error) {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(error)
    }

    function handleData(chunk: Buffer | Uint8Array) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += buffer.byteLength
      if (totalBytes > maxBytes) {
        response.destroy()
        settle(null)
        return
      }
      chunks.push(buffer)
    }

    function handleEnd() {
      settle(Buffer.concat(chunks, totalBytes))
    }

    function handleError(error: Error) {
      fail(error)
    }

    response.on('data', handleData)
    response.on('end', handleEnd)
    response.on('error', handleError)
  })
}

function requestImage(url: URL, address: string, timeoutMs: number, maxBytes: number) {
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80

  return new Promise<ImageResponsePayload>((resolve, reject) => {
    let settled = false
    let request: ClientRequest | null = null
    const timeout = setTimeout(() => {
      request?.destroy(new Error('Image request timed out.'))
    }, timeoutMs)

    function settleWithPayload(payload: ImageResponsePayload) {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      resolve(payload)
    }

    function fail(error: Error) {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      reject(error)
    }

    const requestOptions: HttpRequestOptions = {
      hostname: address,
      port,
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        Host: url.host,
        'User-Agent': 'kuest-og-image-fetcher',
      },
    }

    function handleResponse(response: IncomingMessage) {
      const statusCode = response.statusCode ?? 0
      const location = getHeaderValue(response.headers.location)
      const contentType = getHeaderValue(response.headers['content-type']).split(';')[0]?.trim().toLowerCase() ?? ''

      if (
        isRedirectStatus(statusCode) ||
        statusCode < 200 ||
        statusCode >= 300 ||
        !IMAGE_DATA_URI_CONTENT_TYPES.has(contentType)
      ) {
        response.resume()
        settleWithPayload({ body: null, contentType, location, statusCode })
        return
      }

      readIncomingMessageWithLimit(response, maxBytes)
        .then((body) => settleWithPayload({ body, contentType, location, statusCode }))
        .catch(fail)
    }

    if (url.protocol === 'https:') {
      request = https.request(
        {
          ...requestOptions,
          servername: url.hostname,
        } satisfies HttpsRequestOptions,
        handleResponse,
      )
    } else {
      request = http.request(requestOptions, handleResponse)
    }

    if (!request) {
      fail(new Error('Failed to create image request.'))
      return
    }

    request.on('error', fail)
    request.end()
  })
}

async function fetchValidatedImageDataUrl(
  url: URL,
  options: Required<Omit<SafeImageOptions, 'siteUrl'>>,
  redirectCount = 0,
): Promise<string> {
  if (redirectCount > options.maxRedirects) {
    return ''
  }

  const resolved = await resolvePublicAddress(url)
  if (!resolved) {
    return ''
  }

  const response = await requestImage(url, resolved.address, options.timeoutMs, options.maxBytes)
  if (isRedirectStatus(response.statusCode)) {
    if (!response.location) {
      return ''
    }

    const redirectUrl = normalizeOutboundImageUrl(new URL(response.location, url).toString())
    return redirectUrl ? fetchValidatedImageDataUrl(new URL(redirectUrl), options, redirectCount + 1) : ''
  }

  if (!response.body || response.body.byteLength === 0 || !IMAGE_DATA_URI_CONTENT_TYPES.has(response.contentType)) {
    return ''
  }

  const renderablePayload = await normalizeRenderableImagePayload(response.body, response.contentType, options.maxBytes)
  if (!renderablePayload) {
    return ''
  }

  return `data:${renderablePayload.contentType};base64,${Buffer.from(renderablePayload.body).toString('base64')}`
}

async function normalizeRenderableImagePayload(
  body: Uint8Array,
  contentType: string,
  maxBytes: number,
): Promise<RenderableImagePayload | null> {
  if (contentType !== 'image/webp') {
    return { body, contentType }
  }

  try {
    const sourceBuffer = Buffer.from(body)
    const sharp = await loadSharp()
    const metadata = await sharp(sourceBuffer).metadata()
    const preferredContentTypes: WebpRenderableContentType[] = metadata.hasAlpha
      ? ['image/png', 'image/jpeg']
      : ['image/jpeg', 'image/png']

    for (const preferredContentType of preferredContentTypes) {
      const converted = await convertWebpToRenderableImage(sourceBuffer, preferredContentType, sharp)
      if (!isRenderableConvertedImage(converted, maxBytes)) {
        continue
      }

      return {
        body: converted,
        contentType: preferredContentType,
      }
    }

    return null
  } catch {
    return null
  }
}

async function convertWebpToRenderableImage(
  sourceBuffer: Buffer,
  contentType: WebpRenderableContentType,
  sharp: Awaited<ReturnType<typeof loadSharp>>,
) {
  const image = sharp(sourceBuffer)
  return contentType === 'image/png' ? image.png().toBuffer() : image.jpeg({ quality: WEBP_JPEG_QUALITY }).toBuffer()
}

function isRenderableConvertedImage(body: Uint8Array, maxBytes: number) {
  const maxRenderableBytes = maxBytes * WEBP_RENDERABLE_MAX_BYTE_MULTIPLIER
  return body.byteLength > 0 && body.byteLength <= maxRenderableBytes
}

export async function fetchSafeOgImageDataUrl(rawUrl: string | null | undefined, options: SafeImageOptions = {}) {
  const normalized = normalizeOutboundImageUrl(rawUrl, options)
  if (!normalized) {
    return ''
  }

  try {
    return await fetchValidatedImageDataUrl(new URL(normalized), {
      maxBytes: options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES,
      maxRedirects: options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
  } catch {
    return ''
  }
}

export async function resolveTrustedOgImageSource(rawUrl: string | null | undefined, options: SafeImageOptions = {}) {
  const trimmed = rawUrl?.trim()
  if (!trimmed) {
    return ''
  }

  if (isTrustedImageDataUri(trimmed)) {
    return trimmed
  }

  return fetchSafeOgImageDataUrl(trimmed, options)
}
