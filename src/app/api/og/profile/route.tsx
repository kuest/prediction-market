import { ImageResponse } from 'next/og'

import OgImage from '@/app/api/og/_components/OgImage'
import { normalizeOgText } from '@/app/api/og/_utils'
import {
  COMMUNITY_PROFILE_LOOKUP_TIMEOUT_MS,
  fetchCommunityProfileByAddress,
  fetchCommunityProfileByUsername,
} from '@/lib/community-profile'
import { UserRepository } from '@/lib/db/queries/user'
import { formatCurrency, formatSignedCurrency, truncateAddress } from '@/lib/formatters'
import { resolveMarketAssetUrl } from '@/lib/image/asset-reference'
import {
  fetchSafeOgImageDataUrl,
  normalizeOutboundImageUrl,
  resolveTrustedOgImageSource,
} from '@/lib/og-image-security'
import { normalizePublicProfileSlug } from '@/lib/platform-routing'
import { fetchPortfolioSnapshot } from '@/lib/portfolio'
import { resolvePublicRuntimeEnv } from '@/lib/public-runtime-config.shared'
import resolveSiteUrl from '@/lib/site-url'
import { loadRuntimeThemeState } from '@/lib/theme-settings'

const OG_IMAGE_WIDTH = 1200
const OG_IMAGE_HEIGHT = 630

interface ProfilePositionRow {
  title: string
  iconUrl: string
  tradeValue: number
  currentValue: number
  outcomeLabel: 'Yes' | 'No'
  outcomePriceCents: number
}

async function fetchProfileForOg(normalized: ReturnType<typeof normalizePublicProfileSlug>) {
  const localProfilePromise = UserRepository.getProfileByUsernameOrDepositWalletAddress(normalized.value)
  const { communityUrl: communityApiUrl } = resolvePublicRuntimeEnv(process.env)
  if (communityApiUrl) {
    try {
      const communityProfile =
        normalized.type === 'address'
          ? await fetchCommunityProfileByAddress({
              communityApiUrl,
              address: normalized.value,
              signal: AbortSignal.timeout(COMMUNITY_PROFILE_LOOKUP_TIMEOUT_MS),
            })
          : await fetchCommunityProfileByUsername({
              communityApiUrl,
              username: normalized.value,
              signal: AbortSignal.timeout(COMMUNITY_PROFILE_LOOKUP_TIMEOUT_MS),
            })

      const depositWalletAddress = communityProfile?.deposit_wallet_address?.trim()
      if (communityProfile && depositWalletAddress) {
        return {
          username: communityProfile.username ?? '',
          image: communityProfile.avatar_url ?? '',
          deposit_wallet_address: depositWalletAddress,
        }
      }
    } catch (error) {
      console.error('Failed to load community profile for OG image', error)
    }
  }

  const { data: localProfile } = await localProfilePromise
  return localProfile
}

function parseNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : Number.NaN
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }

  return Number.NaN
}

function normalizePrice(rawValue: unknown) {
  const parsed = parseNumber(rawValue)
  if (!Number.isFinite(parsed)) {
    return null
  }

  let normalized = parsed
  if (normalized > 0) {
    while (normalized > 1) {
      normalized /= 100
    }
  }

  return Math.max(0, Math.min(1, normalized))
}

function resolvePositionIconUrl(rawIcon: unknown, siteUrl: string) {
  const url = resolveMarketAssetUrl(rawIcon)
  return normalizeOutboundImageUrl(url, { siteUrl })
}

function resolveProfileAvatarUrl(rawAvatar: unknown, siteUrl: string) {
  const url = resolveMarketAssetUrl(rawAvatar)
  return normalizeOutboundImageUrl(url, { siteUrl })
}

function resolveOutcomeLabel(rawPosition: Record<string, unknown>): 'Yes' | 'No' {
  const outcome = typeof rawPosition.outcome === 'string' ? rawPosition.outcome.trim().toLowerCase() : ''
  if (outcome.includes('no')) {
    return 'No'
  }

  const outcomeIndex = parseNumber(rawPosition.outcomeIndex ?? rawPosition.outcome_index)
  if (Number.isFinite(outcomeIndex) && outcomeIndex === 1) {
    return 'No'
  }

  return 'Yes'
}

function resolveOutcomePriceCents(rawPosition: Record<string, unknown>) {
  const normalizedPrice = normalizePrice(rawPosition.curPrice)
  if (normalizedPrice == null) {
    return 50
  }

  return Math.max(0, Math.min(99, Math.round(normalizedPrice * 100)))
}

function formatCompactCurrency(value: number) {
  if (!Number.isFinite(value)) {
    return '$0'
  }

  const abs = Math.abs(value)
  if (abs >= 1_000_000) {
    const compact = (abs / 1_000_000).toFixed(1).replace(/\.0$/, '')
    return `${value < 0 ? '-' : ''}$${compact}M`
  }

  if (abs >= 1_000) {
    const compact = (abs / 1_000).toFixed(1).replace(/\.0$/, '')
    return `${value < 0 ? '-' : ''}$${compact}K`
  }

  const formatted = formatCurrency(abs, {
    minimumFractionDigits: abs >= 10 ? 0 : 2,
    maximumFractionDigits: abs >= 10 ? 0 : 2,
  })

  return value < 0 ? `-${formatted}` : formatted
}

function buildSeed(text: string) {
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash)
}

function buildSparklineValues(seedText: string, profitLoss: number) {
  const seed = buildSeed(seedText)
  const points: number[] = []
  let value = 0
  const bias = profitLoss < 0 ? -0.08 : 0.08

  for (let index = 0; index < 24; index += 1) {
    const wave = Math.sin((seed % 97) + index * 0.9) * 0.14
    const noise = Math.cos((seed % 43) + index * 1.3) * 0.06
    value += bias + wave + noise
    points.push(value)
  }

  return points
}

function buildSparklinePath(values: number[], width: number, height: number) {
  if (values.length === 0) {
    return ''
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(1e-6, max - min)
  const innerWidth = width - 8
  const innerHeight = height - 8

  return values
    .map((value, index) => {
      const x = 4 + (index / Math.max(values.length - 1, 1)) * innerWidth
      const y = 4 + ((max - value) / span) * innerHeight
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

async function fetchProfilePositions(userAddress: string, siteUrl: string): Promise<ProfilePositionRow[]> {
  const { dataUrl } = resolvePublicRuntimeEnv(process.env)
  if (!dataUrl) {
    return []
  }

  const params = new URLSearchParams({
    user: userAddress,
    limit: '10',
    offset: '0',
    sizeThreshold: '0.01',
  })

  try {
    const response = await fetch(`${dataUrl}/positions?${params.toString()}`, {
      next: {
        revalidate: 900,
      },
    })

    if (!response.ok) {
      return []
    }

    const payload = await response.json().catch(() => null)
    if (!Array.isArray(payload)) {
      return []
    }

    const positions = payload
      .map((entry) => {
        const raw = (entry ?? {}) as Record<string, unknown>
        const title =
          normalizeOgText(typeof raw.title === 'string' ? raw.title : 'Untitled market', 52) ?? 'Untitled market'
        const size = parseNumber(raw.size)
        const avgPrice = normalizePrice(raw.avgPrice)
        const currentValueRaw = parseNumber(raw.currentValue)
        const tradeValueFromSize = Number.isFinite(size) && size > 0 && avgPrice != null ? size * avgPrice : Number.NaN
        const tradeValue = Number.isFinite(tradeValueFromSize) ? tradeValueFromSize : 0
        const currentValue = Number.isFinite(currentValueRaw) ? currentValueRaw : tradeValue

        return {
          title,
          iconUrl: resolvePositionIconUrl(raw.icon, siteUrl),
          tradeValue,
          currentValue,
          outcomeLabel: resolveOutcomeLabel(raw),
          outcomePriceCents: resolveOutcomePriceCents(raw),
        } satisfies ProfilePositionRow
      })
      .filter((position) => position.currentValue > 0 || position.tradeValue > 0)
      .sort((left, right) => right.currentValue - left.currentValue)
      .slice(0, 8)

    return await Promise.all(
      positions.map(async (position) => ({
        ...position,
        iconUrl: await fetchSafeOgImageDataUrl(position.iconUrl),
      })),
    )
  } catch {
    return []
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rawSlug = searchParams.get('slug')?.trim() ?? ''
  if (!rawSlug) {
    return new Response('Missing slug query parameter.', { status: 400 })
  }

  const normalized = normalizePublicProfileSlug(rawSlug)
  if (normalized.type === 'invalid') {
    return new Response('Invalid profile slug.', { status: 400 })
  }

  try {
    const [runtimeTheme, profileResult] = await Promise.all([loadRuntimeThemeState(), fetchProfileForOg(normalized)])
    const profile = profileResult
    const profileUsername = normalizeOgText(profile?.username ?? null, 28)
    const displayName =
      profileUsername ?? (normalized.type === 'username' ? normalized.value : truncateAddress(normalized.value))
    const siteUrl = resolveSiteUrl(process.env)
    const avatarCandidate = resolveProfileAvatarUrl(profile?.image, siteUrl)
    const resolvedAddress = profile?.deposit_wallet_address ?? (normalized.type === 'address' ? normalized.value : null)

    const [siteLogoSrc, avatarUrl, snapshot, positions] = await Promise.all([
      resolveTrustedOgImageSource(runtimeTheme.site.logoUrl),
      fetchSafeOgImageDataUrl(avatarCandidate),
      fetchPortfolioSnapshot(resolvedAddress),
      resolvedAddress ? fetchProfilePositions(resolvedAddress, siteUrl) : Promise.resolve([]),
    ])

    const sparklineValues = buildSparklineValues(resolvedAddress ?? rawSlug, snapshot.profitLoss)
    const sparklinePath = buildSparklinePath(sparklineValues, 520, 122)
    const pnlLabel = formatSignedCurrency(snapshot.profitLoss, {
      fallback: '$0.00',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    const pnlColor = snapshot.profitLoss < 0 ? '#ff4b5c' : '#23c36b'
    const rowPlaceholders =
      positions.length > 0
        ? positions
        : Array.from({ length: 6 }).map(
            (_, index) =>
              ({
                title: `Position ${index + 1}`,
                iconUrl: '',
                tradeValue: 0,
                currentValue: 0,
                outcomeLabel: index % 2 === 0 ? 'Yes' : 'No',
                outcomePriceCents: 50,
              }) satisfies ProfilePositionRow,
          )

    const response = new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          backgroundColor: '#0a0c11',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif',
        }}
      >
        <div
          style={{
            width: '50%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            padding: '28px 32px',
            background: 'linear-gradient(180deg, #b447d0 0%, #40124f 32%, #0a0c11 70%, #05070a 100%)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            {siteLogoSrc ? (
              <OgImage
                src={siteLogoSrc}
                alt=""
                width={36}
                height={36}
                style={{
                  width: '36px',
                  height: '36px',
                  objectFit: 'contain',
                  filter: 'brightness(0) invert(1)',
                }}
              />
            ) : null}
            <div
              style={{ display: 'flex', color: '#f4f6fb', fontSize: '43px', fontWeight: 600, letterSpacing: '-0.02em' }}
            >
              {normalizeOgText(runtimeTheme.site.name, 18) ?? 'Market'}
            </div>
          </div>

          <div
            style={{
              marginTop: '88px',
              width: '94px',
              height: '94px',
              display: 'flex',
              borderRadius: '999px',
              boxShadow: '0 22px 42px rgba(7, 10, 16, 0.45)',
              overflow: 'hidden',
              background: 'radial-gradient(circle at 35% 28%, #ff76df 0%, #b447d0 52%, #31d35b 100%)',
            }}
          >
            {avatarUrl ? (
              <OgImage
                src={avatarUrl}
                alt=""
                width={94}
                height={94}
                style={{
                  width: '94px',
                  height: '94px',
                  objectFit: 'cover',
                }}
              />
            ) : null}
          </div>

          <div
            style={{
              marginTop: '24px',
              display: 'flex',
              color: '#f2f5fb',
              fontSize: '64px',
              fontWeight: 500,
              letterSpacing: '-0.03em',
              lineHeight: 1,
            }}
          >
            {displayName}
          </div>

          <div
            style={{
              marginTop: '10px',
              display: 'flex',
              color: pnlColor,
              fontSize: '70px',
              fontWeight: 700,
              letterSpacing: '-0.03em',
              lineHeight: 1,
            }}
          >
            {pnlLabel}
          </div>

          <div
            style={{
              marginTop: 'auto',
              width: '100%',
              height: '170px',
              borderRadius: '14px',
              backgroundColor: 'rgba(5, 7, 10, 0.4)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              display: 'flex',
              alignItems: 'center',
              padding: '18px 16px',
            }}
          >
            <svg width="100%" height="122" viewBox="0 0 520 122" role="img" aria-label="Profile performance chart">
              <path
                d={sparklinePath}
                fill="none"
                stroke={pnlColor}
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        <div
          style={{
            width: '50%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#f4f4f5',
            borderLeft: '6px solid #0a0c11',
            padding: '28px 28px 20px 28px',
          }}
        >
          <div style={{ display: 'flex', fontSize: '55px', fontWeight: 700, color: '#12151b' }}>Positions</div>

          <div
            style={{
              marginTop: '18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {rowPlaceholders.map((position, index) => {
              const isPositiveOutcome = position.outcomeLabel === 'Yes'
              const badgeColor = isPositiveOutcome ? '#2f9e62' : '#d74b52'
              const badgeBackground = isPositiveOutcome ? 'rgba(47, 158, 98, 0.12)' : 'rgba(215, 75, 82, 0.12)'

              return (
                <div
                  key={`position-row-${index}`}
                  style={{
                    height: '67px',
                    borderRadius: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 12px',
                    backgroundColor: '#ffffff',
                    border: '1px solid rgba(15, 23, 42, 0.08)',
                    gap: '12px',
                  }}
                >
                  <div
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '11px',
                      overflow: 'hidden',
                      backgroundColor: '#dbe0e8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {position.iconUrl ? (
                      <OgImage
                        src={position.iconUrl}
                        alt=""
                        width={38}
                        height={38}
                        style={{
                          width: '38px',
                          height: '38px',
                          objectFit: 'cover',
                        }}
                      />
                    ) : null}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        display: 'flex',
                        color: '#111827',
                        fontSize: '22px',
                        fontWeight: 600,
                        lineHeight: 1.15,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {position.title}
                    </div>
                    <div
                      style={{
                        marginTop: '5px',
                        display: 'flex',
                        color: '#22a06b',
                        fontSize: '22px',
                        fontWeight: 600,
                      }}
                    >
                      {`${formatCompactCurrency(position.tradeValue)} → ${formatCompactCurrency(position.currentValue)}`}
                    </div>
                  </div>

                  <div
                    style={{
                      minWidth: '128px',
                      height: '40px',
                      borderRadius: '12px',
                      backgroundColor: badgeBackground,
                      color: badgeColor,
                      fontSize: '24px',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 10px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {`${position.outcomeLabel} @ ${position.outcomePriceCents}c`}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>,
      {
        width: OG_IMAGE_WIDTH,
        height: OG_IMAGE_HEIGHT,
      },
    )

    response.headers.set('Cache-Control', 'public, max-age=1800, s-maxage=1800, stale-while-revalidate=1800')
    return response
  } catch (error) {
    console.error('Failed to generate profile OG image', error)

    return new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0a0c11',
          color: '#f4f6fb',
          fontSize: '64px',
          fontWeight: 700,
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif',
        }}
      >
        {normalized.type === 'username' ? `@${normalized.value}` : truncateAddress(normalized.value)}
      </div>,
      {
        width: OG_IMAGE_WIDTH,
        height: OG_IMAGE_HEIGHT,
        status: 200,
        headers: {
          'Cache-Control': 'public, max-age=1800, s-maxage=1800, stale-while-revalidate=1800',
        },
      },
    )
  }
}
