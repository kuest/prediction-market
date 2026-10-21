import type { HomeVisibleEventCandidate } from '@/lib/home-events'

import { OUTCOME_INDEX } from '@/lib/constants'
import {
  isCryptoEvent,
  matchesCryptoCadenceRoute,
  resolveCryptoCadenceRoute,
  resolveCryptoCadenceRouteSlug,
  resolveCryptoEventAsset,
} from '@/lib/crypto-cadence-event'
import { filterHomeEvents } from '@/lib/home-events'

interface SelectRelatedEventCandidatesOptions {
  currentTimestamp: number
  limit: number
}

interface CryptoRelatedSourceEvent {
  title: string
  end_date: string | null
  series_recurrence?: string | null
  series_slug?: string | null
  main_tag?: string | null
  tags?: Array<{
    name?: string | null
    slug?: string | null
  }>
}

interface CryptoRelatedEventCandidate extends HomeVisibleEventCandidate {
  title: string
  start_date?: string | null
  series_recurrence?: string | null
}

export function isCurrentCryptoRelatedRound(
  candidate: Pick<CryptoRelatedEventCandidate, 'start_date' | 'end_date' | 'status'>,
  currentTimestamp: number,
  durationMinutes: number,
) {
  const listedStart = candidate.start_date ? Date.parse(candidate.start_date) : null
  const end = candidate.end_date ? Date.parse(candidate.end_date) : Number.NaN
  const roundStart = end - durationMinutes * 60_000
  return (
    candidate.status === 'active' &&
    Number.isFinite(roundStart) &&
    (listedStart == null || (Number.isFinite(listedStart) && listedStart <= currentTimestamp)) &&
    roundStart <= currentTimestamp &&
    currentTimestamp < end
  )
}

interface RelatedEventOutcomeRow {
  event_id: string
  outcome_index: number
  outcome_text: string
  token_id: string
}

export interface RelatedEventPrimaryOutcome {
  label: string
  tokenId: string
}

export function buildRelatedEventPrimaryOutcomes(rows: RelatedEventOutcomeRow[]) {
  const primaryOutcomeByEventId = new Map<string, RelatedEventPrimaryOutcome>()

  for (const row of rows) {
    const existing = primaryOutcomeByEventId.get(row.event_id)
    const isPrimaryOutcome = Number(row.outcome_index) === OUTCOME_INDEX.YES
    if (existing && !isPrimaryOutcome) {
      continue
    }

    primaryOutcomeByEventId.set(row.event_id, {
      label: row.outcome_text,
      tokenId: row.token_id,
    })
  }

  return primaryOutcomeByEventId
}

export function selectRelatedEventCandidates<T extends HomeVisibleEventCandidate>(
  candidates: T[],
  options: SelectRelatedEventCandidatesOptions,
) {
  const activeCandidates = candidates.filter((candidate) => candidate.status === 'active')

  return filterHomeEvents(activeCandidates, {
    currentTimestamp: options.currentTimestamp,
    status: 'active',
  }).slice(0, options.limit)
}

export function selectCryptoRelatedEventCandidates<T extends CryptoRelatedEventCandidate>(
  currentEvent: CryptoRelatedSourceEvent,
  candidates: T[],
  options: SelectRelatedEventCandidatesOptions & {
    cadenceSlug: string
  },
) {
  const cadenceRoute = resolveCryptoCadenceRoute(options.cadenceSlug)
  const currentCadenceRouteSlug = resolveCryptoCadenceRouteSlug(currentEvent)
  const currentAsset = resolveCryptoEventAsset(currentEvent)
  if (!cadenceRoute || !isCryptoEvent(currentEvent) || !currentCadenceRouteSlug || !currentAsset) {
    return []
  }

  const shouldExcludeCurrentAsset = cadenceRoute.routeSlug === currentCadenceRouteSlug
  const cadenceCandidates = candidates.filter(
    (candidate) =>
      matchesCryptoCadenceRoute(candidate, cadenceRoute.routeSlug) &&
      isCurrentCryptoRelatedRound(candidate, options.currentTimestamp, cadenceRoute.durationMinutes),
  )
  const sameAssetCandidates: T[] = []
  const otherAssetCandidates: T[] = []

  for (const candidate of cadenceCandidates) {
    const candidateAsset = resolveCryptoEventAsset({
      ...candidate,
      end_date: candidate.end_date ?? null,
      main_tag: candidate.main_tag ?? 'crypto',
    })

    if (candidateAsset?.slug === currentAsset.slug && !shouldExcludeCurrentAsset) {
      sameAssetCandidates.push(candidate)
    } else if (candidateAsset?.slug !== currentAsset.slug) {
      otherAssetCandidates.push(candidate)
    }
  }

  return selectRelatedEventCandidates([...sameAssetCandidates, ...otherAssetCandidates], options)
}
