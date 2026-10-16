import type {
  HomeFeaturedContextMode,
  HomeFeaturedSettings,
  HomeFeaturedSideCardIcon,
  HomeFeaturedSideCardSlide,
  HomeFeaturedSideCardSlideType,
} from '@/types'

type SettingsGroup = Record<string, { value: string; updated_at: string }>
type SettingsMap = Record<string, SettingsGroup | undefined>

export const HOME_FEATURED_SETTINGS_GROUP = 'home_featured'
export const HOME_FEATURED_ENABLED_KEY = 'enabled'
export const HOME_FEATURED_USE_AI_KEY = 'use_ai'
export const HOME_FEATURED_MAX_CARDS_KEY = 'max_cards'
export const HOME_FEATURED_DEFAULT_CONTEXT_MODE_KEY = 'default_context_mode'
export const HOME_FEATURED_NEWS_SOURCES_KEY = 'news_sources'
export const HOME_FEATURED_COMMENT_BLACKLIST_KEY = 'comment_blacklist'
export const HOME_FEATURED_MIN_VOLUME_24H_KEY = 'min_volume_24h'
export const HOME_FEATURED_INCLUDE_SPORTS_TODAY_KEY = 'include_sports_today'
export const HOME_FEATURED_INCLUDE_NEW_EVENTS_KEY = 'include_new_events'
export const HOME_FEATURED_SIDE_CARD_TITLE_KEY = 'side_card_title'
export const HOME_FEATURED_SIDE_CARD_TEXT_KEY = 'side_card_text'
export const HOME_FEATURED_SIDE_CARD_CTA_LABEL_KEY = 'side_card_cta_label'
export const HOME_FEATURED_SIDE_CARD_CTA_HREF_KEY = 'side_card_cta_href'
export const HOME_FEATURED_SIDE_CARD_ICON_KEY = 'side_card_icon'
export const HOME_FEATURED_SIDE_CARD_USE_AI_KEY = 'side_card_use_ai'
export const HOME_FEATURED_SIDE_CARD_USE_IMAGE_KEY = 'side_card_use_image'
export const HOME_FEATURED_SIDE_CARD_IMAGE_PATH_KEY = 'side_card_image_path'
export const HOME_FEATURED_SIDE_CARD_SLIDES_KEY = 'side_card_slides_v1'

export const HOME_FEATURED_NEWS_LIMIT = 5
export const HOME_FEATURED_NEWS_TTL_MS = 2 * 60 * 60 * 1000
export const HOME_FEATURED_SIDE_CARD_MAX_SLIDES = 8

const HOME_FEATURED_CONTEXT_MODES: HomeFeaturedContextMode[] = ['auto', 'news', 'comments', 'hidden']
export const HOME_FEATURED_SIDE_CARD_ICONS: HomeFeaturedSideCardIcon[] = [
  'sparkles',
  'activity',
  'trending-up',
  'chart-line',
  'line-chart',
  'badge-percent',
  'ticket-percent',
  'badge-dollar-sign',
  'badge-info',
  'badge-alert',
  'badge-plus',
  'badge-euro',
  'badge-x',
  'badge-cent',
  'badge-japanese-yen',
  'badge-russian-ruble',
  'tags',
  'badge-check',
  'award',
  'id-card',
  'circle-user-round',
  'chart-candlestick',
  'target',
  'trophy',
  'goal',
  'medal',
  'bitcoin',
  'coins',
  'wallet',
  'vote',
  'landmark',
  'scale',
  'globe',
  'map',
  'flag',
  'rocket',
  'satellite',
  'bot',
  'brain',
  'building-2',
  'briefcase-business',
  'gamepad-2',
  'clapperboard',
  'cloud-sun',
  'shield-check',
  'zap',
  'flame',
  'calendar-clock',
  'volleyball',
  'newspaper',
]
export const HOME_FEATURED_SIDE_CARD_LIMITS = {
  title: 56,
  text: 150,
  ctaLabel: 80,
  ctaHref: 240,
  imagePath: 240,
  videoUrl: 500,
} as const

export const DEFAULT_HOME_FEATURED_SIDE_CARD_TITLE = 'Market pulse'
export const DEFAULT_HOME_FEATURED_SIDE_CARD_TEXT = 'Fast movers across active markets.'

const DEFAULT_HOME_FEATURED_SIDE_CARD_SLIDE: HomeFeaturedSideCardSlide = {
  id: 'legacy',
  enabled: true,
  type: 'text',
  title: DEFAULT_HOME_FEATURED_SIDE_CARD_TITLE,
  text: DEFAULT_HOME_FEATURED_SIDE_CARD_TEXT,
  ctaLabel: '',
  ctaHref: '',
  icon: 'trending-up',
  useAi: false,
  useImage: false,
  imagePath: '',
  imageUrl: '',
  videoUrl: '',
  videoEmbedUrl: '',
}

export const DEFAULT_HOME_FEATURED_SETTINGS: HomeFeaturedSettings = {
  enabled: false,
  useAi: false,
  maxCards: 6,
  defaultContextMode: 'auto',
  newsSources: [],
  commentBlacklist: [],
  minVolume24h: 0,
  includeSportsToday: true,
  includeNewEvents: true,
  sideCard: {
    ...DEFAULT_HOME_FEATURED_SIDE_CARD_SLIDE,
    slides: [{ ...DEFAULT_HOME_FEATURED_SIDE_CARD_SLIDE }],
  },
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback
  }

  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) {
    return true
  }
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) {
    return false
  }

  return fallback
}

function parseInteger(value: string | undefined, fallback: number, min: number, max: number) {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(Math.max(parsed, min), max)
}

function parseNumber(value: string | undefined, fallback: number, min: number, max: number) {
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(Math.max(parsed, min), max)
}

function parseContextMode(value: string | undefined, fallback: HomeFeaturedContextMode) {
  const normalized = value?.trim().toLowerCase()
  return HOME_FEATURED_CONTEXT_MODES.includes(normalized as HomeFeaturedContextMode)
    ? (normalized as HomeFeaturedContextMode)
    : fallback
}

function normalizeCompactText(value: string | undefined, fallback: string, maxLength: number) {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim()
  return (normalized || fallback).slice(0, maxLength)
}

function normalizeOptionalCompactText(value: string | undefined, maxLength: number) {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function parseSideCardIcon(value: string | undefined, fallback: HomeFeaturedSideCardIcon) {
  const normalized = value?.trim().toLowerCase()
  return HOME_FEATURED_SIDE_CARD_ICONS.includes(normalized as HomeFeaturedSideCardIcon)
    ? (normalized as HomeFeaturedSideCardIcon)
    : fallback
}

function parseSideCardHref(value: string | undefined) {
  const trimmed = normalizeOptionalCompactText(value, HOME_FEATURED_SIDE_CARD_LIMITS.ctaHref)
  if (!trimmed) {
    return ''
  }

  if ((trimmed.startsWith('/') && !trimmed.startsWith('//')) || /^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  return ''
}

function parseSideCardImagePath(value: string | undefined) {
  const normalized = normalizeOptionalCompactText(value, HOME_FEATURED_SIDE_CARD_LIMITS.imagePath)
  return /^home-featured\/side-card-[a-z0-9-]+\.(?:jpe?g|png|webp)$/i.test(normalized) ? normalized : ''
}

function parseSideCardSlideType(value: unknown): HomeFeaturedSideCardSlideType {
  return value === 'image' || value === 'video' ? value : 'text'
}

function parseSideCardSlideId(value: unknown, index: number) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(normalized) ? normalized : `slide-${index + 1}`
}

function parseSideCardVideoUrl(value: unknown) {
  const normalized =
    typeof value === 'string' ? normalizeOptionalCompactText(value, HOME_FEATURED_SIDE_CARD_LIMITS.videoUrl) : ''
  if (!normalized) {
    return { videoUrl: '', videoEmbedUrl: '' }
  }

  try {
    const url = new URL(normalized)
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    let videoId = ''
    let videoEmbedUrl = ''

    if (hostname === 'youtu.be') {
      videoId = url.pathname.split('/').filter(Boolean)[0] ?? ''
    } else if (hostname === 'youtube.com' || hostname === 'm.youtube.com') {
      if (url.pathname === '/watch') {
        videoId = url.searchParams.get('v') ?? ''
      } else if (/^\/(?:embed|shorts)\//.test(url.pathname)) {
        videoId = url.pathname.split('/').filter(Boolean)[1] ?? ''
      }
    } else if (hostname === 'vimeo.com' || hostname === 'player.vimeo.com') {
      const vimeoId =
        url.pathname
          .split('/')
          .filter(Boolean)
          .findLast((segment) => /^\d+$/.test(segment)) ?? ''
      if (vimeoId) {
        videoEmbedUrl = `https://player.vimeo.com/video/${vimeoId}`
      }
    }

    if (/^[\w-]{6,20}$/.test(videoId)) {
      videoEmbedUrl = `https://www.youtube-nocookie.com/embed/${videoId}`
    }

    return videoEmbedUrl ? { videoUrl: normalized, videoEmbedUrl } : { videoUrl: '', videoEmbedUrl: '' }
  } catch {
    return { videoUrl: '', videoEmbedUrl: '' }
  }
}

function parseSideCardSlide(value: unknown, index: number): HomeFeaturedSideCardSlide | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const type = parseSideCardSlideType(record.type)
  const video = parseSideCardVideoUrl(record.videoUrl)

  return {
    id: parseSideCardSlideId(record.id, index),
    enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
    type,
    title: normalizeCompactText(
      typeof record.title === 'string' ? record.title : '',
      DEFAULT_HOME_FEATURED_SIDE_CARD_SLIDE.title,
      HOME_FEATURED_SIDE_CARD_LIMITS.title,
    ),
    text: normalizeCompactText(
      typeof record.text === 'string' ? record.text : '',
      DEFAULT_HOME_FEATURED_SIDE_CARD_SLIDE.text,
      HOME_FEATURED_SIDE_CARD_LIMITS.text,
    ),
    ctaLabel: normalizeOptionalCompactText(
      typeof record.ctaLabel === 'string' ? record.ctaLabel : '',
      HOME_FEATURED_SIDE_CARD_LIMITS.ctaLabel,
    ),
    ctaHref: parseSideCardHref(typeof record.ctaHref === 'string' ? record.ctaHref : ''),
    icon: parseSideCardIcon(
      typeof record.icon === 'string' ? record.icon : '',
      DEFAULT_HOME_FEATURED_SIDE_CARD_SLIDE.icon,
    ),
    useAi: type === 'text' && record.useAi === true,
    useImage: type === 'image',
    imagePath:
      type === 'image' ? parseSideCardImagePath(typeof record.imagePath === 'string' ? record.imagePath : '') : '',
    imageUrl: '',
    videoUrl: type === 'video' ? video.videoUrl : '',
    videoEmbedUrl: type === 'video' ? video.videoEmbedUrl : '',
  }
}

function parseSideCardSlides(value: string | undefined) {
  if (!value) {
    return []
  }

  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return []
    }

    const usedIds = new Set<string>()
    return parsed
      .slice(0, HOME_FEATURED_SIDE_CARD_MAX_SLIDES)
      .map(parseSideCardSlide)
      .filter((slide): slide is HomeFeaturedSideCardSlide => {
        if (!slide || usedIds.has(slide.id)) {
          return false
        }
        usedIds.add(slide.id)
        return true
      })
  } catch {
    return []
  }
}

function resolvePrimarySideCardSlide(slides: HomeFeaturedSideCardSlide[], fallback: HomeFeaturedSideCardSlide) {
  return slides.find((slide) => slide.enabled) ?? slides[0] ?? fallback
}

export function serializeHomeFeaturedSideCardSlides(slides: HomeFeaturedSideCardSlide[]) {
  return JSON.stringify(slides.map(({ imageUrl: _imageUrl, videoEmbedUrl: _videoEmbedUrl, ...slide }) => slide))
}

function parseNewsSourcesInput(input: string) {
  return Array.from(
    new Set(
      input
        .split(/\r?\n|,/)
        .map((source) => source.trim())
        .filter(Boolean),
    ),
  ).slice(0, 24)
}

function parseCommentBlacklistInput(input: string) {
  return Array.from(
    new Set(
      input
        .split(/\r?\n|,/)
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean)
        .map((term) => term.slice(0, 80)),
    ),
  ).slice(0, 50)
}

export function serializeNewsSources(sources: string[]) {
  return JSON.stringify(Array.from(new Set(sources.map((source) => source.trim()).filter(Boolean))).slice(0, 24))
}

export function serializeCommentBlacklist(terms: string[]) {
  return JSON.stringify(parseCommentBlacklistInput(terms.join('\n')))
}

function parseNewsSources(value: string | undefined) {
  if (!value) {
    return []
  }

  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed
        .map((source) => (typeof source === 'string' ? source.trim() : ''))
        .filter(Boolean)
        .slice(0, 24)
    }
  } catch {}

  return parseNewsSourcesInput(value)
}

function parseCommentBlacklist(value: string | undefined) {
  if (!value) {
    return []
  }

  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parseCommentBlacklistInput(parsed.map((term) => (typeof term === 'string' ? term : '')).join('\n'))
    }
  } catch {}

  return parseCommentBlacklistInput(value)
}

export function getHomeFeaturedSettingsFromSettings(allSettings?: SettingsMap): HomeFeaturedSettings {
  const settings = allSettings?.[HOME_FEATURED_SETTINGS_GROUP]
  const defaults = DEFAULT_HOME_FEATURED_SETTINGS
  const legacySlide: HomeFeaturedSideCardSlide = {
    id: 'legacy',
    enabled: true,
    type: parseBoolean(settings?.[HOME_FEATURED_SIDE_CARD_USE_IMAGE_KEY]?.value, defaults.sideCard.useImage)
      ? 'image'
      : 'text',
    title: normalizeCompactText(
      settings?.[HOME_FEATURED_SIDE_CARD_TITLE_KEY]?.value,
      defaults.sideCard.title,
      HOME_FEATURED_SIDE_CARD_LIMITS.title,
    ),
    text: normalizeCompactText(
      settings?.[HOME_FEATURED_SIDE_CARD_TEXT_KEY]?.value,
      defaults.sideCard.text,
      HOME_FEATURED_SIDE_CARD_LIMITS.text,
    ),
    ctaLabel: normalizeOptionalCompactText(
      settings?.[HOME_FEATURED_SIDE_CARD_CTA_LABEL_KEY]?.value,
      HOME_FEATURED_SIDE_CARD_LIMITS.ctaLabel,
    ),
    ctaHref: parseSideCardHref(settings?.[HOME_FEATURED_SIDE_CARD_CTA_HREF_KEY]?.value),
    icon: parseSideCardIcon(settings?.[HOME_FEATURED_SIDE_CARD_ICON_KEY]?.value, defaults.sideCard.icon),
    useAi: parseBoolean(settings?.[HOME_FEATURED_SIDE_CARD_USE_AI_KEY]?.value, defaults.sideCard.useAi),
    useImage: parseBoolean(settings?.[HOME_FEATURED_SIDE_CARD_USE_IMAGE_KEY]?.value, defaults.sideCard.useImage),
    imagePath: parseSideCardImagePath(settings?.[HOME_FEATURED_SIDE_CARD_IMAGE_PATH_KEY]?.value),
    imageUrl: '',
    videoUrl: '',
    videoEmbedUrl: '',
  }
  const parsedSlides = parseSideCardSlides(settings?.[HOME_FEATURED_SIDE_CARD_SLIDES_KEY]?.value)
  const slides = parsedSlides.length > 0 ? parsedSlides : [legacySlide]
  const primarySlide = resolvePrimarySideCardSlide(slides, legacySlide)

  return {
    enabled: parseBoolean(settings?.[HOME_FEATURED_ENABLED_KEY]?.value, defaults.enabled),
    useAi: parseBoolean(settings?.[HOME_FEATURED_USE_AI_KEY]?.value, defaults.useAi),
    maxCards: parseInteger(settings?.[HOME_FEATURED_MAX_CARDS_KEY]?.value, defaults.maxCards, 1, 8),
    defaultContextMode: parseContextMode(
      settings?.[HOME_FEATURED_DEFAULT_CONTEXT_MODE_KEY]?.value,
      defaults.defaultContextMode,
    ),
    newsSources: parseNewsSources(settings?.[HOME_FEATURED_NEWS_SOURCES_KEY]?.value),
    commentBlacklist: parseCommentBlacklist(settings?.[HOME_FEATURED_COMMENT_BLACKLIST_KEY]?.value),
    minVolume24h: parseNumber(
      settings?.[HOME_FEATURED_MIN_VOLUME_24H_KEY]?.value,
      defaults.minVolume24h,
      0,
      1_000_000_000,
    ),
    includeSportsToday: parseBoolean(
      settings?.[HOME_FEATURED_INCLUDE_SPORTS_TODAY_KEY]?.value,
      defaults.includeSportsToday,
    ),
    includeNewEvents: parseBoolean(settings?.[HOME_FEATURED_INCLUDE_NEW_EVENTS_KEY]?.value, defaults.includeNewEvents),
    sideCard: {
      ...primarySlide,
      slides,
    },
  }
}

export function validateHomeFeaturedSettingsInput(input: {
  enabled: string
  useAi: string
  maxCards: string
  defaultContextMode: string
  newsSources: string
  commentBlacklist: string
  minVolume24h: string
  includeSportsToday: string
  includeNewEvents: string
  sideCardTitle?: string
  sideCardText?: string
  sideCardCtaLabel?: string
  sideCardCtaHref?: string
  sideCardIcon?: string
  sideCardUseAi?: string
  sideCardUseImage?: string
  sideCardImagePath?: string
  sideCardSlidesJson?: string
}): { data: HomeFeaturedSettings; error: null } | { data: null; error: string } {
  const defaultContextMode = parseContextMode(input.defaultContextMode, 'auto')
  const maxCards = parseInteger(input.maxCards, DEFAULT_HOME_FEATURED_SETTINGS.maxCards, 1, 8)
  const minVolume24h = parseNumber(input.minVolume24h, 0, 0, 1_000_000_000)
  const newsSources = parseNewsSourcesInput(input.newsSources)
  const commentBlacklist = parseCommentBlacklistInput(input.commentBlacklist)
  const sideCardDefaults = DEFAULT_HOME_FEATURED_SETTINGS.sideCard
  const legacyType: HomeFeaturedSideCardSlideType = parseBoolean(input.sideCardUseImage, sideCardDefaults.useImage)
    ? 'image'
    : 'text'
  const legacySlide = parseSideCardSlide(
    {
      id: 'legacy',
      enabled: true,
      type: legacyType,
      title: input.sideCardTitle,
      text: input.sideCardText,
      ctaLabel: input.sideCardCtaLabel,
      ctaHref: input.sideCardCtaHref,
      icon: input.sideCardIcon,
      useAi: parseBoolean(input.sideCardUseAi, sideCardDefaults.useAi),
      imagePath: input.sideCardImagePath,
    },
    0,
  ) ?? { ...DEFAULT_HOME_FEATURED_SIDE_CARD_SLIDE }
  const parsedSlides = parseSideCardSlides(input.sideCardSlidesJson)
  const slides = parsedSlides.length > 0 ? parsedSlides : [legacySlide]
  const primarySlide = resolvePrimarySideCardSlide(slides, legacySlide)

  return {
    data: {
      enabled: parseBoolean(input.enabled, false),
      useAi: parseBoolean(input.useAi, false),
      maxCards,
      defaultContextMode,
      newsSources,
      commentBlacklist,
      minVolume24h,
      includeSportsToday: parseBoolean(input.includeSportsToday, true),
      includeNewEvents: parseBoolean(input.includeNewEvents, true),
      sideCard: {
        ...primarySlide,
        slides,
      },
    },
    error: null,
  }
}
