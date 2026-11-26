import { OUTCOME_INDEX } from '@/lib/constants'

export type BinaryOutcomeIndex = typeof OUTCOME_INDEX.YES | typeof OUTCOME_INDEX.NO
export type OutcomeNumerator = number | string | null | undefined

function toFiniteNumber(value: unknown) {
  if (value == null) {
    return null
  }

  if (typeof value === 'string' && value.trim().length === 0) {
    return null
  }

  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : null
}

function resolveBinaryPayoutNumerators(payoutNumerators: Array<OutcomeNumerator> | null | undefined) {
  if (!Array.isArray(payoutNumerators) || payoutNumerators.length !== 2) {
    return null
  }

  const yesPayout = toFiniteNumber(payoutNumerators[OUTCOME_INDEX.YES])
  const noPayout = toFiniteNumber(payoutNumerators[OUTCOME_INDEX.NO])
  if (yesPayout == null || noPayout == null) {
    return null
  }

  return [yesPayout, noPayout] as const
}

export function hasEqualPositiveBinaryPayout(payoutNumerators: Array<OutcomeNumerator> | null | undefined) {
  const numerators = resolveBinaryPayoutNumerators(payoutNumerators)
  return numerators !== null && numerators[0] > 0 && numerators[0] === numerators[1]
}

export function resolveUniqueBinaryWinningOutcomeIndexFromPayoutNumerators(
  payoutNumerators: Array<OutcomeNumerator> | null | undefined,
): BinaryOutcomeIndex | null {
  const numericNumerators = resolveBinaryPayoutNumerators(payoutNumerators)
  if (!numericNumerators) {
    return null
  }

  const maxValue = Math.max(...numericNumerators)
  if (!(maxValue > 0)) {
    return null
  }

  const winningIndices = numericNumerators.reduce<number[]>((indices, value, index) => {
    if (value === maxValue) {
      indices.push(index)
    }
    return indices
  }, [])

  if (winningIndices.length !== 1) {
    return null
  }

  const winnerIndex = winningIndices[0]
  if (winnerIndex === OUTCOME_INDEX.YES) {
    return OUTCOME_INDEX.YES
  }
  if (winnerIndex === OUTCOME_INDEX.NO) {
    return OUTCOME_INDEX.NO
  }

  return null
}
