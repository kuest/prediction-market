import type {
  ReplaceHomeFeaturedContextItemInput,
  ReplaceHomeFeaturedEventsInput,
} from '@/lib/db/queries/home-featured-events'
import type { HomeFeaturedContextMode, HomeFeaturedSettings } from '@/types'

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@/i18n/locales'
import {
  HOME_FEATURED_COMMENT_BLACKLIST_KEY,
  HOME_FEATURED_DEFAULT_CONTEXT_MODE_KEY,
  HOME_FEATURED_ENABLED_KEY,
  HOME_FEATURED_INCLUDE_NEW_EVENTS_KEY,
  HOME_FEATURED_INCLUDE_SPORTS_TODAY_KEY,
  HOME_FEATURED_MAX_CARDS_KEY,
  HOME_FEATURED_MIN_VOLUME_24H_KEY,
  HOME_FEATURED_NEWS_LIMIT,
  HOME_FEATURED_NEWS_SOURCES_KEY,
  HOME_FEATURED_SETTINGS_GROUP,
  HOME_FEATURED_SIDE_CARD_CTA_HREF_KEY,
  HOME_FEATURED_SIDE_CARD_CTA_LABEL_KEY,
  HOME_FEATURED_SIDE_CARD_ICON_KEY,
  HOME_FEATURED_SIDE_CARD_IMAGE_PATH_KEY,
  HOME_FEATURED_SIDE_CARD_SLIDES_KEY,
  HOME_FEATURED_SIDE_CARD_TEXT_KEY,
  HOME_FEATURED_SIDE_CARD_TITLE_KEY,
  HOME_FEATURED_SIDE_CARD_USE_AI_KEY,
  HOME_FEATURED_SIDE_CARD_USE_IMAGE_KEY,
  HOME_FEATURED_USE_AI_KEY,
  serializeCommentBlacklist,
  serializeHomeFeaturedSideCardSlides,
  serializeNewsSources,
} from '@/lib/home-featured-settings'

const VALID_HOME_FEATURED_CONTEXT_MODES = new Set(['auto', 'news', 'comments', 'hidden'])
const VALID_HOME_FEATURED_TARGET_TYPES = new Set(['event', 'series'])
const VALID_HOME_FEATURED_SOURCES = new Set(['manual', 'ai'])
const POSTGRES_INTEGER_MIN = -2_147_483_648
const POSTGRES_INTEGER_MAX = 2_147_483_647

function parseRank(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= POSTGRES_INTEGER_MIN && parsed <= POSTGRES_INTEGER_MAX
    ? parsed
    : fallback
}

function parseOptionalDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function parseContextLocale(value: unknown) {
  if (typeof value !== 'string') {
    return DEFAULT_LOCALE
  }

  const locale = value.trim()
  return SUPPORTED_LOCALES.includes(locale as (typeof SUPPORTED_LOCALES)[number]) ? locale : DEFAULT_LOCALE
}

function parseContextItems(value: unknown): ReplaceHomeFeaturedContextItemInput[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.slice(0, HOME_FEATURED_NEWS_LIMIT).flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return []
    }

    const record = item as Record<string, unknown>
    const source = typeof record.source === 'string' ? record.source.trim() : ''
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    const itemType: ReplaceHomeFeaturedContextItemInput['itemType'] =
      record.type === 'comment' || record.itemType === 'comment' ? 'comment' : 'news'
    const locale = parseContextLocale(record.locale)
    if (!source || !title) {
      return []
    }

    return [
      {
        locale,
        itemType,
        source,
        title,
        url: typeof record.url === 'string' && record.url.trim() ? record.url.trim() : null,
        faviconUrl: typeof record.faviconUrl === 'string' && record.faviconUrl.trim() ? record.faviconUrl.trim() : null,
        publishedAt: parseOptionalDate(record.publishedAt),
        relevanceScore: typeof record.relevanceScore === 'number' ? record.relevanceScore : null,
        expiresAt: parseOptionalDate(record.expiresAt),
        isManual: record.isManual !== false,
      },
    ]
  })
}

function parseJsonArrayPayload(value: unknown) {
  if (Array.isArray(value)) {
    return { data: value, error: null as string | null }
  }

  if (typeof value !== 'string' || !value.trim()) {
    return { data: [], error: null as string | null }
  }

  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? { data: parsed, error: null }
      : { data: null, error: 'Invalid featured markets payload.' }
  } catch {
    return { data: null, error: 'Invalid featured markets payload.' }
  }
}

export function parseHomeFeaturedEventsPayload(value: unknown) {
  const parsed = parseJsonArrayPayload(value)
  if (!parsed.data) {
    return { data: null, error: parsed.error }
  }

  const items = parsed.data
    .slice(0, 8)
    .map((item, index): ReplaceHomeFeaturedEventsInput | null => {
      if (!item || typeof item !== 'object') {
        return null
      }

      const record = item as Record<string, unknown>
      const targetType =
        typeof record.targetType === 'string' && VALID_HOME_FEATURED_TARGET_TYPES.has(record.targetType)
          ? (record.targetType as 'event' | 'series')
          : 'event'
      const source =
        typeof record.source === 'string' && VALID_HOME_FEATURED_SOURCES.has(record.source)
          ? (record.source as 'manual' | 'ai')
          : 'manual'
      const contextMode =
        typeof record.contextMode === 'string' && VALID_HOME_FEATURED_CONTEXT_MODES.has(record.contextMode)
          ? (record.contextMode as HomeFeaturedContextMode)
          : 'auto'
      const eventId = typeof record.eventId === 'string' && record.eventId.trim() ? record.eventId.trim() : null
      const seriesSlug =
        typeof record.seriesSlug === 'string' && record.seriesSlug.trim() ? record.seriesSlug.trim() : null

      if (targetType === 'event' && !eventId) {
        return null
      }
      if (targetType === 'series' && !seriesSlug) {
        return null
      }

      return {
        targetType,
        eventId: targetType === 'event' ? eventId : null,
        seriesSlug: targetType === 'series' ? seriesSlug : null,
        enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
        rank: parseRank(record.rank, index),
        source,
        startsAt: parseOptionalDate(record.startsAt),
        endsAt: parseOptionalDate(record.endsAt),
        contextMode,
        autoRolloverEnabled: typeof record.autoRolloverEnabled === 'boolean' ? record.autoRolloverEnabled : true,
        contextLocale: parseContextLocale(record.contextLocale),
        contextEventId: eventId,
        contextItems: parseContextItems(record.contextItems),
      }
    })
    .filter((item): item is ReplaceHomeFeaturedEventsInput => item !== null)

  return { data: items, error: null as string | null }
}

export function buildHomeFeaturedSettingsUpdateRows(settings: HomeFeaturedSettings) {
  return [
    { group: HOME_FEATURED_SETTINGS_GROUP, key: HOME_FEATURED_ENABLED_KEY, value: String(settings.enabled) },
    { group: HOME_FEATURED_SETTINGS_GROUP, key: HOME_FEATURED_USE_AI_KEY, value: String(settings.useAi) },
    { group: HOME_FEATURED_SETTINGS_GROUP, key: HOME_FEATURED_MAX_CARDS_KEY, value: String(settings.maxCards) },
    {
      group: HOME_FEATURED_SETTINGS_GROUP,
      key: HOME_FEATURED_DEFAULT_CONTEXT_MODE_KEY,
      value: settings.defaultContextMode,
    },
    {
      group: HOME_FEATURED_SETTINGS_GROUP,
      key: HOME_FEATURED_NEWS_SOURCES_KEY,
      value: serializeNewsSources(settings.newsSources),
    },
    {
      group: HOME_FEATURED_SETTINGS_GROUP,
      key: HOME_FEATURED_COMMENT_BLACKLIST_KEY,
      value: serializeCommentBlacklist(settings.commentBlacklist),
    },
    {
      group: HOME_FEATURED_SETTINGS_GROUP,
      key: HOME_FEATURED_MIN_VOLUME_24H_KEY,
      value: String(settings.minVolume24h),
    },
    {
      group: HOME_FEATURED_SETTINGS_GROUP,
      key: HOME_FEATURED_INCLUDE_SPORTS_TODAY_KEY,
      value: String(settings.includeSportsToday),
    },
    {
      group: HOME_FEATURED_SETTINGS_GROUP,
      key: HOME_FEATURED_INCLUDE_NEW_EVENTS_KEY,
      value: String(settings.includeNewEvents),
    },
    { group: HOME_FEATURED_SETTINGS_GROUP, key: HOME_FEATURED_SIDE_CARD_TITLE_KEY, value: settings.sideCard.title },
    { group: HOME_FEATURED_SETTINGS_GROUP, key: HOME_FEATURED_SIDE_CARD_TEXT_KEY, value: settings.sideCard.text },
    {
      group: HOME_FEATURED_SETTINGS_GROUP,
      key: HOME_FEATURED_SIDE_CARD_CTA_LABEL_KEY,
      value: settings.sideCard.ctaLabel,
    },
    {
      group: HOME_FEATURED_SETTINGS_GROUP,
      key: HOME_FEATURED_SIDE_CARD_CTA_HREF_KEY,
      value: settings.sideCard.ctaHref,
    },
    { group: HOME_FEATURED_SETTINGS_GROUP, key: HOME_FEATURED_SIDE_CARD_ICON_KEY, value: settings.sideCard.icon },
    {
      group: HOME_FEATURED_SETTINGS_GROUP,
      key: HOME_FEATURED_SIDE_CARD_USE_AI_KEY,
      value: String(settings.sideCard.useAi),
    },
    {
      group: HOME_FEATURED_SETTINGS_GROUP,
      key: HOME_FEATURED_SIDE_CARD_USE_IMAGE_KEY,
      value: String(settings.sideCard.useImage),
    },
    {
      group: HOME_FEATURED_SETTINGS_GROUP,
      key: HOME_FEATURED_SIDE_CARD_IMAGE_PATH_KEY,
      value: settings.sideCard.imagePath,
    },
    {
      group: HOME_FEATURED_SETTINGS_GROUP,
      key: HOME_FEATURED_SIDE_CARD_SLIDES_KEY,
      value: serializeHomeFeaturedSideCardSlides(settings.sideCard.slides),
    },
  ]
}
