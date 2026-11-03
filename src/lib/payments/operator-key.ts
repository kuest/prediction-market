import 'server-only'
import { SettingsRepository } from '@/lib/db/queries/settings'
import { decryptSecret } from '@/lib/encryption'

export const PAYMENTS_SETTINGS_GROUP = 'payments'
export const PAYMENTS_OPERATOR_KEY = 'operator_key'
export const PAYMENTS_OPERATOR_DOMAIN_KEY = 'operator_domain'
export const PAYMENTS_OPERATOR_CHALLENGE_KEY = 'operator_domain_challenge:'
export const PAYMENTS_OPERATOR_LEGACY_CHALLENGE_KEY = 'operator_domain_challenge'
export const PAYMENTS_ENABLED_KEY = 'on_off_ramp_enabled'

type RequestHeaders = Pick<Headers, 'get'>

export function getPaymentsCanonicalDomain(requestHeaders: RequestHeaders | null | undefined): string | null {
  if (!requestHeaders) {
    return null
  }

  try {
    // Use the request authority itself; forwarded host values may come from an untrusted proxy.
    // Payments owns domain eligibility and HTTPS ownership proof; this only canonicalizes the request authority.
    const host = requestHeaders.get('host')?.trim()
    const forwardedProtocol = requestHeaders.get('x-forwarded-proto')?.trim().toLowerCase()
    if (
      !host ||
      host.includes(',') ||
      (forwardedProtocol && (forwardedProtocol.includes(',') || forwardedProtocol !== 'https'))
    ) {
      return null
    }

    const url = new URL(`https://${host}`)
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, '')
    if (
      !hostname ||
      hostname.endsWith('.') ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return null
    }
    return hostname
  } catch {
    return null
  }
}

export function getPaymentsOperatorChallengeSettingKey(challengeId: string) {
  if (!/^[A-Za-z0-9_-]{22}$/u.test(challengeId)) {
    throw new Error('invalid_payments_operator_challenge_id')
  }
  return `${PAYMENTS_OPERATOR_CHALLENGE_KEY}${challengeId}`
}

type SettingsMap = Record<string, Record<string, { value: string } | undefined> | undefined>

export function getPaymentsIntegrationFormState(
  settings: SettingsMap | null | undefined,
  canonicalDomain: string | null,
) {
  const group = settings?.[PAYMENTS_SETTINGS_GROUP]
  const encryptedKey = group?.[PAYMENTS_OPERATOR_KEY]?.value ?? ''
  const operatorKey = decryptSecret(encryptedKey)
  const configured = /^[A-Za-z0-9_-]{40,64}$/u.test(operatorKey)
  const enabledValue = group?.[PAYMENTS_ENABLED_KEY]?.value
  const storedDomain = group?.[PAYMENTS_OPERATOR_DOMAIN_KEY]?.value?.trim().toLowerCase() ?? ''
  const operatorDomainChanged =
    (Boolean(storedDomain) && (!canonicalDomain || storedDomain !== canonicalDomain)) ||
    (configured && (!canonicalDomain || !storedDomain))

  return {
    enabled: configured && enabledValue === 'true' && !operatorDomainChanged,
    operatorKeyConfigured: configured,
    operatorDomainChanged,
  }
}

async function getStoredPaymentsOperatorKey(
  requireEnabled: boolean,
  canonicalDomain: string | null,
): Promise<string | null> {
  const { data, error } = await SettingsRepository.getSettings()
  if (error) {
    return null
  }

  const group = data?.[PAYMENTS_SETTINGS_GROUP]
  const storedDomain = group?.[PAYMENTS_OPERATOR_DOMAIN_KEY]?.value?.trim().toLowerCase() ?? ''
  if (!canonicalDomain || !storedDomain) {
    return null
  }
  if (requireEnabled && (group?.[PAYMENTS_ENABLED_KEY]?.value !== 'true' || storedDomain !== canonicalDomain)) {
    return null
  }

  const storedKey = decryptSecret(group?.[PAYMENTS_OPERATOR_KEY]?.value ?? '')
  return /^[A-Za-z0-9_-]{40,64}$/u.test(storedKey) ? storedKey : null
}

export function getPaymentsOperatorKey(canonicalDomain: string | null): Promise<string | null> {
  return getStoredPaymentsOperatorKey(true, canonicalDomain)
}

// Status checks may arrive on the previous domain saved in a checkout's return URL.
// The Worker scopes every status lookup to both operator_id and the authenticated user ID.
export function getPaymentsOperatorKeyForCheckoutStatus(canonicalDomain: string | null): Promise<string | null> {
  return getStoredPaymentsOperatorKey(false, canonicalDomain)
}
