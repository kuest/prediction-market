import { cacheLife, cacheTag } from 'next/cache'

import type { CustomJavascriptCodeConfig } from '@/lib/custom-javascript-code'
import type { ResolvedThemeConfig, ThemeOverrides, ThemePresetId, ThemeRadius } from '@/lib/theme'
import type { ThemeSiteIdentity, ThemeSiteLogoMode } from '@/lib/theme-site-identity'

import { cacheTags } from '@/lib/cache-tags'
import { DEFAULT_FEE_RECEIVER_WALLET_ADDRESS, ZERO_ADDRESS } from '@/lib/contracts'
import { validateCustomJavascriptCodesJson } from '@/lib/custom-javascript-code'
import { hasDatabaseEnv } from '@/lib/db/env'
import { SettingsRepository } from '@/lib/db/queries/settings'
import { getPublicAssetUrl } from '@/lib/storage'
import {
  buildResolvedThemeConfig,
  DEFAULT_THEME_PRESET_ID,
  formatThemeOverridesJson,
  parseThemeOverridesJson,
  resolveThemePreset,
  sortThemeOverrides,
  validateThemeRadius,
} from '@/lib/theme'
import {
  buildSvgDataUri,
  createDefaultThemeSiteIdentity,
  DEFAULT_THEME_SITE_LOGO_SVG,
  sanitizeThemeSiteLogoSvg,
  validateThemeSiteDescription,
  validateThemeSiteExternalUrl,
  validateThemeSiteGoogleAnalyticsId,
  validateThemeSiteLogoImagePath,
  validateThemeSiteLogoMode,
  validateThemeSiteName,
  validateThemeSiteSupportUrl,
} from '@/lib/theme-site-identity'

const THEME_SETTINGS_GROUP = 'theme'
const GENERAL_SETTINGS_GROUP = 'general'
const THEME_PRESET_KEY = 'preset'
const THEME_LIGHT_JSON_KEY = 'light_json'
const THEME_DARK_JSON_KEY = 'dark_json'
const THEME_RADIUS_KEY = 'radius'
const THEME_SITE_NAME_KEY = 'site_name'
const THEME_SITE_DESCRIPTION_KEY = 'site_description'
const THEME_SITE_LOGO_MODE_KEY = 'site_logo_mode'
const THEME_SITE_LOGO_SVG_KEY = 'site_logo_svg'
const THEME_SITE_LOGO_IMAGE_PATH_KEY = 'site_logo_image_path'
const THEME_SITE_GOOGLE_ANALYTICS_KEY = 'site_google_analytics'
const THEME_SITE_DISCORD_LINK_KEY = 'site_discord_link'
const THEME_SITE_TWITTER_LINK_KEY = 'site_twitter_link'
const THEME_SITE_FACEBOOK_LINK_KEY = 'site_facebook_link'
const THEME_SITE_INSTAGRAM_LINK_KEY = 'site_instagram_link'
const THEME_SITE_TIKTOK_LINK_KEY = 'site_tiktok_link'
const THEME_SITE_LINKEDIN_LINK_KEY = 'site_linkedin_link'
const THEME_SITE_YOUTUBE_LINK_KEY = 'site_youtube_link'
const THEME_SITE_SUPPORT_URL_KEY = 'site_support_url'
const THEME_SITE_CUSTOM_JAVASCRIPT_CODES_KEY = 'site_custom_javascript_codes'
const GENERAL_PWA_ICON_192_PATH_KEY = 'pwa_icon_192_path'
const GENERAL_PWA_ICON_512_PATH_KEY = 'pwa_icon_512_path'
const GENERAL_FEE_RECIPIENT_WALLET_KEY = 'fee_recipient_wallet'
const GENERAL_LIFI_INTEGRATOR_KEY = 'lifi_integrator'
const GENERAL_LIFI_API_KEY = 'lifi_api_key'
const WALLET_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

type SettingsGroup = Record<string, { value: string; updated_at: string }>
interface SettingsMap {
  [group: string]: SettingsGroup | undefined
}

interface NormalizedThemeConfig {
  presetId: ThemePresetId
  lightOverrides: ThemeOverrides
  darkOverrides: ThemeOverrides
  radius: ThemeRadius | null
  radiusValue: string
  lightJson: string
  darkJson: string
}

interface NormalizedThemeSiteConfig {
  siteName: string
  siteNameValue: string
  siteDescription: string
  siteDescriptionValue: string
  logoMode: ThemeSiteLogoMode
  logoModeValue: ThemeSiteLogoMode
  logoSvg: string
  logoSvgValue: string
  logoImagePath: string | null
  logoImagePathValue: string
  pwaIcon192Path: string | null
  pwaIcon192PathValue: string
  pwaIcon512Path: string | null
  pwaIcon512PathValue: string
  googleAnalyticsId: string | null
  googleAnalyticsIdValue: string
  discordLink: string | null
  discordLinkValue: string
  twitterLink: string | null
  twitterLinkValue: string
  facebookLink: string | null
  facebookLinkValue: string
  instagramLink: string | null
  instagramLinkValue: string
  tiktokLink: string | null
  tiktokLinkValue: string
  linkedinLink: string | null
  linkedinLinkValue: string
  youtubeLink: string | null
  youtubeLinkValue: string
  supportUrl: string | null
  supportUrlValue: string
  customJavascriptCodes: CustomJavascriptCodeConfig[]
  customJavascriptCodesValue: string
  feeRecipientWallet: `0x${string}`
  feeRecipientWalletValue: string
  lifiIntegrator: string | null
  lifiIntegratorValue: string
  lifiApiKey: string | null
  lifiApiKeyValue: string
}

type RuntimeThemeSource = 'settings' | 'default'

export interface RuntimeThemeState {
  theme: ResolvedThemeConfig
  site: ThemeSiteIdentity
  source: RuntimeThemeSource
  /** False when the theme/site values are fallback output from an error or missing DB. */
  cacheable: boolean
}

export interface ThemeSettingsFormState {
  preset: ThemePresetId
  radius: string
  lightJson: string
  darkJson: string
}

export interface ThemeSiteSettingsFormState {
  siteName: string
  siteDescription: string
  logoMode: ThemeSiteLogoMode
  logoSvg: string
  logoImagePath: string
  pwaIcon192Path: string
  pwaIcon512Path: string
  googleAnalyticsId: string
  discordLink: string
  twitterLink: string
  facebookLink: string
  instagramLink: string
  tiktokLink: string
  linkedinLink: string
  youtubeLink: string
  supportUrl: string
  customJavascriptCodes: CustomJavascriptCodeConfig[]
  feeRecipientWallet: string
  lifiIntegrator: string
  lifiApiKey: string
  lifiApiKeyConfigured: boolean
}

export interface ThemeSettingsValidationResult {
  data: NormalizedThemeConfig | null
  error: string | null
}

export interface ThemeSiteSettingsValidationResult {
  data: NormalizedThemeSiteConfig | null
  error: string | null
}

function normalizeThemeConfig(params: {
  presetValue: string | null | undefined
  radiusValue: string | null | undefined
  lightJsonValue: string | null | undefined
  darkJsonValue: string | null | undefined
  presetErrorLabel: string
  radiusErrorLabel: string
  lightErrorLabel: string
  darkErrorLabel: string
}): ThemeSettingsValidationResult {
  const presetResolution = resolveThemePreset(params.presetValue)
  if (presetResolution.usedFallbackPreset && presetResolution.requestedPresetId) {
    return {
      data: null,
      error: `${params.presetErrorLabel} is invalid.`,
    }
  }

  const lightParsed = parseThemeOverridesJson(params.lightJsonValue, params.lightErrorLabel)
  if (lightParsed.error) {
    return { data: null, error: lightParsed.error }
  }

  const darkParsed = parseThemeOverridesJson(params.darkJsonValue, params.darkErrorLabel)
  if (darkParsed.error) {
    return { data: null, error: darkParsed.error }
  }

  const lightOverrides = sortThemeOverrides(lightParsed.data ?? {})
  const darkOverrides = sortThemeOverrides(darkParsed.data ?? {})
  const radiusValidated = validateThemeRadius(params.radiusValue, params.radiusErrorLabel)
  if (radiusValidated.error) {
    return { data: null, error: radiusValidated.error }
  }

  return {
    data: {
      presetId: presetResolution.preset.id,
      lightOverrides,
      darkOverrides,
      radius: radiusValidated.value,
      radiusValue: radiusValidated.value ?? '',
      lightJson: formatThemeOverridesJson(lightOverrides),
      darkJson: formatThemeOverridesJson(darkOverrides),
    },
    error: null,
  }
}

function resolveLogoSvgOrDefault(value: string | null | undefined, sourceLabel: string) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    return { value: DEFAULT_THEME_SITE_LOGO_SVG, error: null as string | null }
  }

  return sanitizeThemeSiteLogoSvg(normalized, sourceLabel)
}

export function normalizeFeeRecipientWalletAddress(value: string | null | undefined, sourceLabel: string) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    return { value: ZERO_ADDRESS, error: null as string | null }
  }

  if (!WALLET_ADDRESS_PATTERN.test(normalized)) {
    return { value: null as `0x${string}` | null, error: `${sourceLabel} must be a valid wallet address.` }
  }

  return { value: normalized as `0x${string}`, error: null as string | null }
}

function isZeroAddress(value: string | null | undefined) {
  return (value ?? '').toLowerCase() === ZERO_ADDRESS.toLowerCase()
}

function normalizeOptionalLiFiIntegrator(value: string | null | undefined, sourceLabel: string) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    return { value: null as string | null, error: null as string | null }
  }

  if (normalized.length > 120) {
    return { value: null as string | null, error: `${sourceLabel} is too long.` }
  }

  if (!/^[\w.-]+$/.test(normalized)) {
    return {
      value: null as string | null,
      error: `${sourceLabel} can only contain letters, numbers, dot, underscore, and hyphen.`,
    }
  }

  return { value: normalized, error: null as string | null }
}

function normalizeOptionalLiFiApiKey(value: string | null | undefined, sourceLabel: string) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    return { value: null as string | null, error: null as string | null }
  }

  if (normalized.length > 256) {
    return { value: null as string | null, error: `${sourceLabel} is too long.` }
  }

  if (/\s/.test(normalized)) {
    return { value: null as string | null, error: `${sourceLabel} cannot contain spaces.` }
  }

  return { value: normalized, error: null as string | null }
}

function normalizeThemeSiteConfig(params: {
  siteNameValue: string | null | undefined
  siteDescriptionValue: string | null | undefined
  logoModeValue: string | null | undefined
  logoSvgValue: string | null | undefined
  logoImagePathValue: string | null | undefined
  pwaIcon192PathValue: string | null | undefined
  pwaIcon512PathValue: string | null | undefined
  googleAnalyticsIdValue: string | null | undefined
  discordLinkValue: string | null | undefined
  twitterLinkValue: string | null | undefined
  facebookLinkValue: string | null | undefined
  instagramLinkValue: string | null | undefined
  tiktokLinkValue: string | null | undefined
  linkedinLinkValue: string | null | undefined
  youtubeLinkValue: string | null | undefined
  supportUrlValue: string | null | undefined
  customJavascriptCodesJsonValue?: string | null | undefined
  feeRecipientWalletValue: string | null | undefined
  lifiIntegratorValue?: string | null | undefined
  lifiApiKeyValue?: string | null | undefined
  siteNameErrorLabel: string
  siteDescriptionErrorLabel: string
  logoModeErrorLabel: string
  logoSvgErrorLabel: string
  logoImagePathErrorLabel: string
  pwaIcon192PathErrorLabel: string
  pwaIcon512PathErrorLabel: string
  googleAnalyticsIdErrorLabel: string
  discordLinkErrorLabel: string
  twitterLinkErrorLabel: string
  facebookLinkErrorLabel: string
  instagramLinkErrorLabel: string
  tiktokLinkErrorLabel: string
  linkedinLinkErrorLabel: string
  youtubeLinkErrorLabel: string
  supportUrlErrorLabel: string
  customJavascriptCodesErrorLabel?: string
  feeRecipientWalletErrorLabel: string
  lifiIntegratorErrorLabel?: string
  lifiApiKeyErrorLabel?: string
}): ThemeSiteSettingsValidationResult {
  const siteNameValidated = validateThemeSiteName(params.siteNameValue, params.siteNameErrorLabel)
  if (siteNameValidated.error) {
    return { data: null, error: siteNameValidated.error }
  }

  const siteDescriptionValidated = validateThemeSiteDescription(
    params.siteDescriptionValue,
    params.siteDescriptionErrorLabel,
  )
  if (siteDescriptionValidated.error) {
    return { data: null, error: siteDescriptionValidated.error }
  }

  const logoModeValidated = validateThemeSiteLogoMode(params.logoModeValue, params.logoModeErrorLabel)
  if (logoModeValidated.error) {
    return { data: null, error: logoModeValidated.error }
  }

  const logoImagePathValidated = validateThemeSiteLogoImagePath(
    params.logoImagePathValue,
    params.logoImagePathErrorLabel,
  )
  if (logoImagePathValidated.error) {
    return { data: null, error: logoImagePathValidated.error }
  }

  const pwaIcon192PathValidated = validateThemeSiteLogoImagePath(
    params.pwaIcon192PathValue,
    params.pwaIcon192PathErrorLabel,
  )
  if (pwaIcon192PathValidated.error) {
    return { data: null, error: pwaIcon192PathValidated.error }
  }

  const pwaIcon512PathValidated = validateThemeSiteLogoImagePath(
    params.pwaIcon512PathValue,
    params.pwaIcon512PathErrorLabel,
  )
  if (pwaIcon512PathValidated.error) {
    return { data: null, error: pwaIcon512PathValidated.error }
  }

  const googleAnalyticsValidated = validateThemeSiteGoogleAnalyticsId(
    params.googleAnalyticsIdValue,
    params.googleAnalyticsIdErrorLabel,
  )
  if (googleAnalyticsValidated.error) {
    return { data: null, error: googleAnalyticsValidated.error }
  }

  const discordLinkValidated = validateThemeSiteExternalUrl(params.discordLinkValue, params.discordLinkErrorLabel)
  if (discordLinkValidated.error) {
    return { data: null, error: discordLinkValidated.error }
  }

  const twitterLinkValidated = validateThemeSiteExternalUrl(params.twitterLinkValue, params.twitterLinkErrorLabel)
  if (twitterLinkValidated.error) {
    return { data: null, error: twitterLinkValidated.error }
  }

  const facebookLinkValidated = validateThemeSiteExternalUrl(params.facebookLinkValue, params.facebookLinkErrorLabel)
  if (facebookLinkValidated.error) {
    return { data: null, error: facebookLinkValidated.error }
  }

  const instagramLinkValidated = validateThemeSiteExternalUrl(params.instagramLinkValue, params.instagramLinkErrorLabel)
  if (instagramLinkValidated.error) {
    return { data: null, error: instagramLinkValidated.error }
  }

  const tiktokLinkValidated = validateThemeSiteExternalUrl(params.tiktokLinkValue, params.tiktokLinkErrorLabel)
  if (tiktokLinkValidated.error) {
    return { data: null, error: tiktokLinkValidated.error }
  }

  const linkedinLinkValidated = validateThemeSiteExternalUrl(params.linkedinLinkValue, params.linkedinLinkErrorLabel)
  if (linkedinLinkValidated.error) {
    return { data: null, error: linkedinLinkValidated.error }
  }

  const youtubeLinkValidated = validateThemeSiteExternalUrl(params.youtubeLinkValue, params.youtubeLinkErrorLabel)
  if (youtubeLinkValidated.error) {
    return { data: null, error: youtubeLinkValidated.error }
  }

  const supportUrlValidated = validateThemeSiteSupportUrl(params.supportUrlValue, params.supportUrlErrorLabel)
  if (supportUrlValidated.error) {
    return { data: null, error: supportUrlValidated.error }
  }

  const customJavascriptCodesValidated = validateCustomJavascriptCodesJson(
    params.customJavascriptCodesJsonValue,
    params.customJavascriptCodesErrorLabel ?? 'Custom javascript code',
  )
  if (customJavascriptCodesValidated.error || !customJavascriptCodesValidated.value) {
    return { data: null, error: customJavascriptCodesValidated.error ?? 'Custom javascript code is invalid.' }
  }

  const feeRecipientWalletValidated = normalizeFeeRecipientWalletAddress(
    params.feeRecipientWalletValue,
    params.feeRecipientWalletErrorLabel,
  )
  if (feeRecipientWalletValidated.error) {
    return { data: null, error: feeRecipientWalletValidated.error }
  }

  const lifiIntegratorValidated = normalizeOptionalLiFiIntegrator(
    params.lifiIntegratorValue,
    params.lifiIntegratorErrorLabel ?? 'LI.FI integrator',
  )
  if (lifiIntegratorValidated.error) {
    return { data: null, error: lifiIntegratorValidated.error }
  }

  const lifiApiKeyValidated = normalizeOptionalLiFiApiKey(
    params.lifiApiKeyValue,
    params.lifiApiKeyErrorLabel ?? 'LI.FI API key',
  )
  if (lifiApiKeyValidated.error) {
    return { data: null, error: lifiApiKeyValidated.error }
  }

  const logoSvgResolved = resolveLogoSvgOrDefault(params.logoSvgValue, params.logoSvgErrorLabel)
  if (logoSvgResolved.error) {
    return { data: null, error: logoSvgResolved.error }
  }

  if (logoModeValidated.value === 'image' && !logoImagePathValidated.value) {
    return {
      data: null,
      error: `${params.logoImagePathErrorLabel} is required when image logo is selected.`,
    }
  }

  return {
    data: {
      siteName: siteNameValidated.value!,
      siteNameValue: siteNameValidated.value!,
      siteDescription: siteDescriptionValidated.value!,
      siteDescriptionValue: siteDescriptionValidated.value!,
      logoMode: logoModeValidated.value!,
      logoModeValue: logoModeValidated.value!,
      logoSvg: logoSvgResolved.value!,
      logoSvgValue: logoSvgResolved.value!,
      logoImagePath: logoImagePathValidated.value,
      logoImagePathValue: logoImagePathValidated.value ?? '',
      pwaIcon192Path: pwaIcon192PathValidated.value,
      pwaIcon192PathValue: pwaIcon192PathValidated.value ?? '',
      pwaIcon512Path: pwaIcon512PathValidated.value,
      pwaIcon512PathValue: pwaIcon512PathValidated.value ?? '',
      googleAnalyticsId: googleAnalyticsValidated.value,
      googleAnalyticsIdValue: googleAnalyticsValidated.value ?? '',
      discordLink: discordLinkValidated.value,
      discordLinkValue: discordLinkValidated.value ?? '',
      twitterLink: twitterLinkValidated.value,
      twitterLinkValue: twitterLinkValidated.value ?? '',
      facebookLink: facebookLinkValidated.value,
      facebookLinkValue: facebookLinkValidated.value ?? '',
      instagramLink: instagramLinkValidated.value,
      instagramLinkValue: instagramLinkValidated.value ?? '',
      tiktokLink: tiktokLinkValidated.value,
      tiktokLinkValue: tiktokLinkValidated.value ?? '',
      linkedinLink: linkedinLinkValidated.value,
      linkedinLinkValue: linkedinLinkValidated.value ?? '',
      youtubeLink: youtubeLinkValidated.value,
      youtubeLinkValue: youtubeLinkValidated.value ?? '',
      supportUrl: supportUrlValidated.value,
      supportUrlValue: supportUrlValidated.value ?? '',
      customJavascriptCodes: customJavascriptCodesValidated.value,
      customJavascriptCodesValue: customJavascriptCodesValidated.valueJson,
      feeRecipientWallet: feeRecipientWalletValidated.value!,
      feeRecipientWalletValue: feeRecipientWalletValidated.value!,
      lifiIntegrator: lifiIntegratorValidated.value,
      lifiIntegratorValue: lifiIntegratorValidated.value ?? '',
      lifiApiKey: lifiApiKeyValidated.value,
      lifiApiKeyValue: lifiApiKeyValidated.value ?? '',
    },
    error: null,
  }
}

function buildThemeSiteIdentity(config: NormalizedThemeSiteConfig): ThemeSiteIdentity {
  const defaultSite = createDefaultThemeSiteIdentity()
  const logoImageUrl = config.logoMode === 'image' ? getPublicAssetUrl(config.logoImagePath) : null
  const pwaIcon192Url = getPublicAssetUrl(config.pwaIcon192Path) || defaultSite.pwaIcon192Url
  const pwaIcon512Url = getPublicAssetUrl(config.pwaIcon512Path) || defaultSite.pwaIcon512Url

  const useImageLogo = config.logoMode === 'image' && Boolean(logoImageUrl)

  return {
    name: config.siteName,
    description: config.siteDescription,
    logoMode: useImageLogo ? 'image' : 'svg',
    logoSvg: config.logoSvg,
    logoImagePath: useImageLogo ? config.logoImagePath : null,
    logoImageUrl: useImageLogo ? logoImageUrl : null,
    logoUrl: useImageLogo && logoImageUrl ? logoImageUrl : buildSvgDataUri(config.logoSvg),
    googleAnalyticsId: config.googleAnalyticsId,
    discordLink: config.discordLink,
    twitterLink: config.twitterLink,
    facebookLink: config.facebookLink,
    instagramLink: config.instagramLink,
    tiktokLink: config.tiktokLink,
    linkedinLink: config.linkedinLink,
    youtubeLink: config.youtubeLink,
    supportUrl: config.supportUrl,
    customJavascriptCodes: config.customJavascriptCodes,
    pwaIcon192Path: config.pwaIcon192Path,
    pwaIcon512Path: config.pwaIcon512Path,
    pwaIcon192Url,
    pwaIcon512Url,
    appleTouchIconUrl: pwaIcon192Url,
  }
}

function buildDefaultThemeState(): RuntimeThemeState {
  return {
    theme: buildResolvedThemeConfig(DEFAULT_THEME_PRESET_ID),
    site: createDefaultThemeSiteIdentity(),
    source: 'default',
    cacheable: false,
  }
}

function getThemeSettingsGroup(allSettings?: SettingsMap): SettingsGroup | undefined {
  return allSettings?.[THEME_SETTINGS_GROUP]
}

function getGeneralSettingsGroup(allSettings?: SettingsMap): SettingsGroup | undefined {
  return allSettings?.[GENERAL_SETTINGS_GROUP]
}

export function getFeeRecipientWalletFormValue(allSettings?: SettingsMap): string {
  const rawValue = getGeneralSettingsGroup(allSettings)?.[GENERAL_FEE_RECIPIENT_WALLET_KEY]?.value

  if (rawValue == null) {
    return ''
  }

  const normalized = normalizeFeeRecipientWalletAddress(rawValue, 'Fee recipient wallet')

  if (normalized.error) {
    return typeof rawValue === 'string' ? rawValue.trim() : ''
  }

  return isZeroAddress(normalized.value) ? '' : (normalized.value ?? '')
}

function hasStoredThemeSettings(themeSettings?: SettingsGroup) {
  if (!themeSettings) {
    return false
  }
  return Boolean(
    themeSettings[THEME_PRESET_KEY]?.value?.trim() ||
    themeSettings[THEME_RADIUS_KEY]?.value?.trim() ||
    themeSettings[THEME_LIGHT_JSON_KEY]?.value?.trim() ||
    themeSettings[THEME_DARK_JSON_KEY]?.value?.trim(),
  )
}

function hasStoredThemeSiteSettings(generalSettings?: SettingsGroup) {
  if (!generalSettings) {
    return false
  }

  return Boolean(
    generalSettings[THEME_SITE_NAME_KEY]?.value?.trim() ||
    generalSettings[THEME_SITE_DESCRIPTION_KEY]?.value?.trim() ||
    generalSettings[THEME_SITE_LOGO_MODE_KEY]?.value?.trim() ||
    generalSettings[THEME_SITE_LOGO_SVG_KEY]?.value?.trim() ||
    generalSettings[THEME_SITE_LOGO_IMAGE_PATH_KEY]?.value?.trim() ||
    generalSettings[THEME_SITE_GOOGLE_ANALYTICS_KEY]?.value?.trim() ||
    generalSettings[THEME_SITE_DISCORD_LINK_KEY]?.value?.trim() ||
    generalSettings[THEME_SITE_TWITTER_LINK_KEY]?.value?.trim() ||
    generalSettings[THEME_SITE_FACEBOOK_LINK_KEY]?.value?.trim() ||
    generalSettings[THEME_SITE_INSTAGRAM_LINK_KEY]?.value?.trim() ||
    generalSettings[THEME_SITE_TIKTOK_LINK_KEY]?.value?.trim() ||
    generalSettings[THEME_SITE_LINKEDIN_LINK_KEY]?.value?.trim() ||
    generalSettings[THEME_SITE_YOUTUBE_LINK_KEY]?.value?.trim() ||
    generalSettings[THEME_SITE_SUPPORT_URL_KEY]?.value?.trim() ||
    generalSettings[THEME_SITE_CUSTOM_JAVASCRIPT_CODES_KEY]?.value?.trim() ||
    generalSettings[GENERAL_PWA_ICON_192_PATH_KEY]?.value?.trim() ||
    generalSettings[GENERAL_PWA_ICON_512_PATH_KEY]?.value?.trim() ||
    generalSettings[GENERAL_FEE_RECIPIENT_WALLET_KEY]?.value?.trim() ||
    generalSettings[GENERAL_LIFI_INTEGRATOR_KEY]?.value?.trim() ||
    generalSettings[GENERAL_LIFI_API_KEY]?.value?.trim(),
  )
}

export function getThemeSettingsFormState(allSettings?: SettingsMap): ThemeSettingsFormState {
  const themeSettings = getThemeSettingsGroup(allSettings)
  const presetResolution = resolveThemePreset(themeSettings?.[THEME_PRESET_KEY]?.value)
  const radiusRaw = themeSettings?.[THEME_RADIUS_KEY]?.value ?? ''

  const lightRaw = themeSettings?.[THEME_LIGHT_JSON_KEY]?.value ?? ''
  const darkRaw = themeSettings?.[THEME_DARK_JSON_KEY]?.value ?? ''

  const radiusValidated = validateThemeRadius(radiusRaw, 'Theme radius')
  const lightParsed = parseThemeOverridesJson(lightRaw, 'Theme light overrides')
  const darkParsed = parseThemeOverridesJson(darkRaw, 'Theme dark overrides')

  return {
    preset: presetResolution.preset.id,
    radius: radiusValidated.error ? radiusRaw.trim() : (radiusValidated.value ?? ''),
    lightJson: lightParsed.error ? lightRaw || '{}' : formatThemeOverridesJson(lightParsed.data ?? {}),
    darkJson: darkParsed.error ? darkRaw || '{}' : formatThemeOverridesJson(darkParsed.data ?? {}),
  }
}

export function getThemeSiteSettingsFormState(allSettings?: SettingsMap): ThemeSiteSettingsFormState {
  const defaultSite = createDefaultThemeSiteIdentity()
  const generalSettings = getGeneralSettingsGroup(allSettings)
  const lifiIntegratorValidated = normalizeOptionalLiFiIntegrator(
    generalSettings?.[GENERAL_LIFI_INTEGRATOR_KEY]?.value,
    'LI.FI integrator',
  )
  const lifiIntegrator = lifiIntegratorValidated.error ? '' : (lifiIntegratorValidated.value ?? '')
  const lifiApiKeyConfigured = Boolean(generalSettings?.[GENERAL_LIFI_API_KEY]?.value?.trim())

  const normalized = normalizeThemeSiteConfig({
    siteNameValue: generalSettings?.[THEME_SITE_NAME_KEY]?.value ?? defaultSite.name,
    siteDescriptionValue: generalSettings?.[THEME_SITE_DESCRIPTION_KEY]?.value ?? defaultSite.description,
    logoModeValue: generalSettings?.[THEME_SITE_LOGO_MODE_KEY]?.value ?? defaultSite.logoMode,
    logoSvgValue: generalSettings?.[THEME_SITE_LOGO_SVG_KEY]?.value ?? defaultSite.logoSvg,
    logoImagePathValue: generalSettings?.[THEME_SITE_LOGO_IMAGE_PATH_KEY]?.value ?? defaultSite.logoImagePath,
    pwaIcon192PathValue: generalSettings?.[GENERAL_PWA_ICON_192_PATH_KEY]?.value ?? defaultSite.pwaIcon192Path,
    pwaIcon512PathValue: generalSettings?.[GENERAL_PWA_ICON_512_PATH_KEY]?.value ?? defaultSite.pwaIcon512Path,
    googleAnalyticsIdValue: generalSettings?.[THEME_SITE_GOOGLE_ANALYTICS_KEY]?.value ?? defaultSite.googleAnalyticsId,
    discordLinkValue: generalSettings?.[THEME_SITE_DISCORD_LINK_KEY]?.value ?? defaultSite.discordLink,
    twitterLinkValue: generalSettings?.[THEME_SITE_TWITTER_LINK_KEY]?.value ?? defaultSite.twitterLink,
    facebookLinkValue: generalSettings?.[THEME_SITE_FACEBOOK_LINK_KEY]?.value ?? defaultSite.facebookLink,
    instagramLinkValue: generalSettings?.[THEME_SITE_INSTAGRAM_LINK_KEY]?.value ?? defaultSite.instagramLink,
    tiktokLinkValue: generalSettings?.[THEME_SITE_TIKTOK_LINK_KEY]?.value ?? defaultSite.tiktokLink,
    linkedinLinkValue: generalSettings?.[THEME_SITE_LINKEDIN_LINK_KEY]?.value ?? defaultSite.linkedinLink,
    youtubeLinkValue: generalSettings?.[THEME_SITE_YOUTUBE_LINK_KEY]?.value ?? defaultSite.youtubeLink,
    supportUrlValue: generalSettings?.[THEME_SITE_SUPPORT_URL_KEY]?.value ?? defaultSite.supportUrl,
    customJavascriptCodesJsonValue: generalSettings?.[THEME_SITE_CUSTOM_JAVASCRIPT_CODES_KEY]?.value,
    feeRecipientWalletValue:
      generalSettings?.[GENERAL_FEE_RECIPIENT_WALLET_KEY]?.value ?? DEFAULT_FEE_RECEIVER_WALLET_ADDRESS,
    siteNameErrorLabel: 'Site name',
    siteDescriptionErrorLabel: 'Site description',
    logoModeErrorLabel: 'Logo mode',
    logoSvgErrorLabel: 'Logo SVG',
    logoImagePathErrorLabel: 'Logo image path',
    pwaIcon192PathErrorLabel: 'PWA icon (192x192)',
    pwaIcon512PathErrorLabel: 'PWA icon (512x512)',
    googleAnalyticsIdErrorLabel: 'Google Analytics ID',
    discordLinkErrorLabel: 'Discord link',
    twitterLinkErrorLabel: 'Twitter link',
    facebookLinkErrorLabel: 'Facebook link',
    instagramLinkErrorLabel: 'Instagram link',
    tiktokLinkErrorLabel: 'TikTok link',
    linkedinLinkErrorLabel: 'LinkedIn link',
    youtubeLinkErrorLabel: 'YouTube link',
    supportUrlErrorLabel: 'Support URL',
    customJavascriptCodesErrorLabel: 'Custom javascript code',
    feeRecipientWalletErrorLabel: 'Fee recipient wallet',
  })

  if (normalized.data) {
    return {
      siteName: normalized.data.siteNameValue,
      siteDescription: normalized.data.siteDescriptionValue,
      logoMode: normalized.data.logoModeValue,
      logoSvg: normalized.data.logoSvgValue,
      logoImagePath: normalized.data.logoImagePathValue,
      pwaIcon192Path: normalized.data.pwaIcon192PathValue,
      pwaIcon512Path: normalized.data.pwaIcon512PathValue,
      googleAnalyticsId: normalized.data.googleAnalyticsIdValue,
      discordLink: normalized.data.discordLinkValue,
      twitterLink: normalized.data.twitterLinkValue,
      facebookLink: normalized.data.facebookLinkValue,
      instagramLink: normalized.data.instagramLinkValue,
      tiktokLink: normalized.data.tiktokLinkValue,
      linkedinLink: normalized.data.linkedinLinkValue,
      youtubeLink: normalized.data.youtubeLinkValue,
      supportUrl: normalized.data.supportUrlValue,
      customJavascriptCodes: normalized.data.customJavascriptCodes,
      feeRecipientWallet: getFeeRecipientWalletFormValue(allSettings),
      lifiIntegrator,
      lifiApiKey: '',
      lifiApiKeyConfigured,
    }
  }

  return {
    siteName: defaultSite.name,
    siteDescription: defaultSite.description,
    logoMode: defaultSite.logoMode,
    logoSvg: defaultSite.logoSvg,
    logoImagePath: defaultSite.logoImagePath ?? '',
    pwaIcon192Path: defaultSite.pwaIcon192Path ?? '',
    pwaIcon512Path: defaultSite.pwaIcon512Path ?? '',
    googleAnalyticsId: defaultSite.googleAnalyticsId ?? '',
    discordLink: defaultSite.discordLink ?? '',
    twitterLink: defaultSite.twitterLink ?? '',
    facebookLink: defaultSite.facebookLink ?? '',
    instagramLink: defaultSite.instagramLink ?? '',
    tiktokLink: defaultSite.tiktokLink ?? '',
    linkedinLink: defaultSite.linkedinLink ?? '',
    youtubeLink: defaultSite.youtubeLink ?? '',
    supportUrl: defaultSite.supportUrl ?? '',
    customJavascriptCodes: defaultSite.customJavascriptCodes,
    feeRecipientWallet: '',
    lifiIntegrator,
    lifiApiKey: '',
    lifiApiKeyConfigured,
  }
}

export function validateThemeSettingsInput(params: {
  preset: string | null | undefined
  radius: string | null | undefined
  lightJson: string | null | undefined
  darkJson: string | null | undefined
}): ThemeSettingsValidationResult {
  return normalizeThemeConfig({
    presetValue: params.preset,
    radiusValue: params.radius,
    lightJsonValue: params.lightJson,
    darkJsonValue: params.darkJson,
    presetErrorLabel: 'Theme preset',
    radiusErrorLabel: 'Theme radius',
    lightErrorLabel: 'Light theme overrides',
    darkErrorLabel: 'Dark theme overrides',
  })
}

export function validateThemeSiteSettingsInput(params: {
  siteName: string | null | undefined
  siteDescription: string | null | undefined
  logoMode: string | null | undefined
  logoSvg: string | null | undefined
  logoImagePath: string | null | undefined
  pwaIcon192Path: string | null | undefined
  pwaIcon512Path: string | null | undefined
  googleAnalyticsId: string | null | undefined
  discordLink: string | null | undefined
  twitterLink: string | null | undefined
  facebookLink: string | null | undefined
  instagramLink: string | null | undefined
  tiktokLink: string | null | undefined
  linkedinLink: string | null | undefined
  youtubeLink: string | null | undefined
  supportUrl: string | null | undefined
  customJavascriptCodesJson: string | null | undefined
  feeRecipientWallet: string | null | undefined
  lifiIntegrator: string | null | undefined
  lifiApiKey: string | null | undefined
}): ThemeSiteSettingsValidationResult {
  return normalizeThemeSiteConfig({
    siteNameValue: params.siteName,
    siteDescriptionValue: params.siteDescription,
    logoModeValue: params.logoMode,
    logoSvgValue: params.logoSvg,
    logoImagePathValue: params.logoImagePath,
    pwaIcon192PathValue: params.pwaIcon192Path,
    pwaIcon512PathValue: params.pwaIcon512Path,
    googleAnalyticsIdValue: params.googleAnalyticsId,
    discordLinkValue: params.discordLink,
    twitterLinkValue: params.twitterLink,
    facebookLinkValue: params.facebookLink,
    instagramLinkValue: params.instagramLink,
    tiktokLinkValue: params.tiktokLink,
    linkedinLinkValue: params.linkedinLink,
    youtubeLinkValue: params.youtubeLink,
    supportUrlValue: params.supportUrl,
    customJavascriptCodesJsonValue: params.customJavascriptCodesJson,
    feeRecipientWalletValue: params.feeRecipientWallet,
    lifiIntegratorValue: params.lifiIntegrator,
    lifiApiKeyValue: params.lifiApiKey,
    siteNameErrorLabel: 'Site name',
    siteDescriptionErrorLabel: 'Site description',
    logoModeErrorLabel: 'Logo type',
    logoSvgErrorLabel: 'Logo SVG',
    logoImagePathErrorLabel: 'Logo image',
    pwaIcon192PathErrorLabel: 'PWA icon (192x192)',
    pwaIcon512PathErrorLabel: 'PWA icon (512x512)',
    googleAnalyticsIdErrorLabel: 'Google Analytics ID',
    discordLinkErrorLabel: 'Discord link',
    twitterLinkErrorLabel: 'Twitter link',
    facebookLinkErrorLabel: 'Facebook link',
    instagramLinkErrorLabel: 'Instagram link',
    tiktokLinkErrorLabel: 'TikTok link',
    linkedinLinkErrorLabel: 'LinkedIn link',
    youtubeLinkErrorLabel: 'YouTube link',
    supportUrlErrorLabel: 'Support URL',
    customJavascriptCodesErrorLabel: 'Custom javascript code',
    feeRecipientWalletErrorLabel: 'Fee recipient wallet',
    lifiIntegratorErrorLabel: 'LI.FI integrator',
    lifiApiKeyErrorLabel: 'LI.FI API key',
  })
}

async function loadCachedRuntimeThemeState(): Promise<RuntimeThemeState> {
  'use cache'
  cacheTag(cacheTags.settings)

  const defaults = buildDefaultThemeState()
  const { data: allSettings, error } = await SettingsRepository.getSettings()

  if (error) {
    cacheLife('default')
    return defaults
  }

  const themeSettings = getThemeSettingsGroup(allSettings ?? undefined)
  const generalSettings = getGeneralSettingsGroup(allSettings ?? undefined)
  const hasTheme = hasStoredThemeSettings(themeSettings)
  const hasSite = hasStoredThemeSiteSettings(generalSettings)

  const normalizedTheme = hasTheme
    ? normalizeThemeConfig({
        presetValue: themeSettings?.[THEME_PRESET_KEY]?.value,
        radiusValue: themeSettings?.[THEME_RADIUS_KEY]?.value,
        lightJsonValue: themeSettings?.[THEME_LIGHT_JSON_KEY]?.value,
        darkJsonValue: themeSettings?.[THEME_DARK_JSON_KEY]?.value,
        presetErrorLabel: 'Theme preset in settings',
        radiusErrorLabel: 'Theme radius in settings',
        lightErrorLabel: 'Theme light_json in settings',
        darkErrorLabel: 'Theme dark_json in settings',
      })
    : null

  const normalizedSite = hasSite
    ? normalizeThemeSiteConfig({
        siteNameValue: generalSettings?.[THEME_SITE_NAME_KEY]?.value,
        siteDescriptionValue: generalSettings?.[THEME_SITE_DESCRIPTION_KEY]?.value,
        logoModeValue: generalSettings?.[THEME_SITE_LOGO_MODE_KEY]?.value,
        logoSvgValue: generalSettings?.[THEME_SITE_LOGO_SVG_KEY]?.value,
        logoImagePathValue: generalSettings?.[THEME_SITE_LOGO_IMAGE_PATH_KEY]?.value,
        pwaIcon192PathValue: generalSettings?.[GENERAL_PWA_ICON_192_PATH_KEY]?.value,
        pwaIcon512PathValue: generalSettings?.[GENERAL_PWA_ICON_512_PATH_KEY]?.value,
        googleAnalyticsIdValue: generalSettings?.[THEME_SITE_GOOGLE_ANALYTICS_KEY]?.value,
        discordLinkValue: generalSettings?.[THEME_SITE_DISCORD_LINK_KEY]?.value,
        twitterLinkValue: generalSettings?.[THEME_SITE_TWITTER_LINK_KEY]?.value,
        facebookLinkValue: generalSettings?.[THEME_SITE_FACEBOOK_LINK_KEY]?.value,
        instagramLinkValue: generalSettings?.[THEME_SITE_INSTAGRAM_LINK_KEY]?.value,
        tiktokLinkValue: generalSettings?.[THEME_SITE_TIKTOK_LINK_KEY]?.value,
        linkedinLinkValue: generalSettings?.[THEME_SITE_LINKEDIN_LINK_KEY]?.value,
        youtubeLinkValue: generalSettings?.[THEME_SITE_YOUTUBE_LINK_KEY]?.value,
        supportUrlValue: generalSettings?.[THEME_SITE_SUPPORT_URL_KEY]?.value,
        customJavascriptCodesJsonValue: generalSettings?.[THEME_SITE_CUSTOM_JAVASCRIPT_CODES_KEY]?.value,
        feeRecipientWalletValue:
          generalSettings?.[GENERAL_FEE_RECIPIENT_WALLET_KEY]?.value ?? DEFAULT_FEE_RECEIVER_WALLET_ADDRESS,
        siteNameErrorLabel: 'Site name in settings',
        siteDescriptionErrorLabel: 'Site description in settings',
        logoModeErrorLabel: 'Logo mode in settings',
        logoSvgErrorLabel: 'Logo SVG in settings',
        logoImagePathErrorLabel: 'Logo image path in settings',
        pwaIcon192PathErrorLabel: 'PWA icon (192x192) in settings',
        pwaIcon512PathErrorLabel: 'PWA icon (512x512) in settings',
        googleAnalyticsIdErrorLabel: 'Google Analytics ID in settings',
        discordLinkErrorLabel: 'Discord link in settings',
        twitterLinkErrorLabel: 'Twitter link in settings',
        facebookLinkErrorLabel: 'Facebook link in settings',
        instagramLinkErrorLabel: 'Instagram link in settings',
        tiktokLinkErrorLabel: 'TikTok link in settings',
        linkedinLinkErrorLabel: 'LinkedIn link in settings',
        youtubeLinkErrorLabel: 'YouTube link in settings',
        supportUrlErrorLabel: 'Support URL in settings',
        customJavascriptCodesErrorLabel: 'Custom javascript code in settings',
        feeRecipientWalletErrorLabel: 'Fee recipient wallet in settings',
      })
    : null

  const theme = normalizedTheme?.data
    ? buildResolvedThemeConfig(
        normalizedTheme.data.presetId,
        normalizedTheme.data.lightOverrides,
        normalizedTheme.data.darkOverrides,
        normalizedTheme.data.radius,
      )
    : defaults.theme

  const site = normalizedSite?.data ? buildThemeSiteIdentity(normalizedSite.data) : defaults.site
  const cacheable = !normalizedTheme?.error && !normalizedSite?.error

  if (cacheable) {
    cacheLife('max')
  } else {
    cacheLife('default')
  }

  return {
    theme,
    site,
    source: normalizedTheme?.data || normalizedSite?.data ? 'settings' : 'default',
    cacheable,
  }
}

export async function loadRuntimeThemeState(): Promise<RuntimeThemeState> {
  if (!hasDatabaseEnv()) {
    return buildDefaultThemeState()
  }

  return loadCachedRuntimeThemeState()
}

export async function loadRuntimeThemeSiteName() {
  const runtimeTheme = await loadRuntimeThemeState()
  return runtimeTheme.site.name
}
