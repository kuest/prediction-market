import type { Event, Market, Outcome, SportsTeam } from '@/types'

import {
  hasEqualPositiveBinaryPayout,
  resolveUniqueBinaryWinningOutcomeIndexFromPayoutNumerators,
} from '@/lib/binary-outcome-resolution'
import { OUTCOME_INDEX } from '@/lib/constants'
import { doesTextMatchTeam, normalizeComparableText, parseSportsScore } from '@/lib/sports-resolution'

const normalizeText = normalizeComparableText

function normalizeHexColor(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(withHash) ? withHash : null
}

function hasSportsContext(event: Event) {
  return Boolean(event.sports_sport_slug?.trim())
}

function getNormalizedEventTagTokens(event: Event) {
  const tagTokens = new Set<string>()

  for (const tag of event.tags ?? []) {
    const normalizedSlug = normalizeText(tag.slug)
    const normalizedName = normalizeText(tag.name)
    if (normalizedSlug) {
      tagTokens.add(normalizedSlug)
    }
    if (normalizedName) {
      tagTokens.add(normalizedName)
    }
  }

  const normalizedMainTag = normalizeText(event.main_tag)
  if (normalizedMainTag) {
    tagTokens.add(normalizedMainTag)
  }

  for (const tag of event.sports_tags ?? []) {
    const normalizedTag = normalizeText(tag)
    if (normalizedTag) {
      tagTokens.add(normalizedTag)
    }
  }

  return tagTokens
}

function hasPropsTag(event: Event) {
  const tagTokens = getNormalizedEventTagTokens(event)
  return Array.from(tagTokens).some((token) => token === 'props' || token === 'prop')
}

function hasGamesTag(event: Event) {
  const tagTokens = getNormalizedEventTagTokens(event)
  return Array.from(tagTokens).some((token) => token === 'games' || token === 'game')
}

function isNegRiskEvent(event: Event) {
  return Boolean(event.neg_risk || event.enable_neg_risk || event.neg_risk_augmented || event.neg_risk_market_id)
}

function marketDisplayText(market: Market) {
  return [market.sports_group_item_title, market.short_title, market.title].join(' ')
}

function isDrawMarket(market: Market) {
  return normalizeText(marketDisplayText(market)).includes('draw')
}

function isExplicitNonMoneylineMarket(market: Market) {
  const normalizedType = normalizeText(market.sports_market_type)
  const normalizedDisplayText = normalizeText(marketDisplayText(market))
  const combinedText = `${normalizedType} ${normalizedDisplayText}`

  return (
    /\b(?:first|last|anytime|both)\s+teams?\s+to\s+score\b/.test(combinedText) ||
    /\b(?:team|player)\s+to\s+score\b/.test(combinedText) ||
    /\b(?:exact|correct)\s+score\b/.test(combinedText) ||
    /\b(?:total|totals|spread|spreads|handicap|over\s+under|btts)\b/.test(combinedText)
  )
}

function doesMarketMatchTeam(market: Market, team: HomeSportsTeam | null) {
  if (!team || isDrawMarket(market)) {
    return false
  }

  return doesTextMatchTeam(marketDisplayText(market), team)
}

function resolveYesOutcome(market: Market) {
  return (
    market.outcomes.find((outcome) => normalizeText(outcome.outcome_text) === 'yes') ??
    market.outcomes.find((outcome) => outcome.outcome_index === 0) ??
    market.outcomes[0] ??
    null
  )
}

function toMarketType(market: Market) {
  const normalizedType = normalizeText(market.sports_market_type)
  const normalizedDisplayText = normalizeText(marketDisplayText(market))
  if (isExplicitNonMoneylineMarket(market)) {
    return null
  }

  if (
    normalizedType.includes('moneyline') ||
    normalizedType.includes('match winner') ||
    normalizedType === '1x2' ||
    normalizedDisplayText.includes('moneyline') ||
    normalizedDisplayText.includes('match winner') ||
    normalizedDisplayText === '1x2'
  ) {
    return 'moneyline' as const
  }

  return null
}

function buildFallbackAbbreviation(teamName: string) {
  return teamName
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 3)
    .toUpperCase()
}

function toHomeSportsTeams(event: Event): HomeSportsTeam[] {
  const logoUrls = event.sports_team_logo_urls ?? []
  const rawTeams = (event.sports_teams ?? []) as SportsTeam[]
  const canUseIndexedLogoFallback =
    rawTeams.length > 0 && logoUrls.length >= rawTeams.length && rawTeams.every((team) => Boolean(team.name?.trim()))
  const teams = rawTeams
    .map((team, index): HomeSportsTeam | null => {
      const name = team.name?.trim() ?? ''
      if (!name) {
        return null
      }

      const abbreviation = team.abbreviation?.trim() || buildFallbackAbbreviation(name)
      const logoUrl = team.logo_url?.trim() || (canUseIndexedLogoFallback ? logoUrls[index] : null) || null

      return {
        name,
        abbreviation,
        color: normalizeHexColor(team.color),
        logoUrl,
        hostStatus: team.host_status?.trim() ?? null,
      }
    })
    .filter((team): team is HomeSportsTeam => Boolean(team))

  return teams.sort((a, b) => {
    if (a.hostStatus === 'home' && b.hostStatus !== 'home') {
      return -1
    }
    if (b.hostStatus === 'home' && a.hostStatus !== 'home') {
      return 1
    }
    if (a.hostStatus === 'away' && b.hostStatus !== 'away') {
      return 1
    }
    if (b.hostStatus === 'away' && a.hostStatus !== 'away') {
      return -1
    }
    return 0
  })
}

function resolvePrimaryTeams(teams: HomeSportsTeam[]) {
  const homeTeam = teams.find((team) => team.hostStatus === 'home') ?? null
  const awayTeam = teams.find((team) => team.hostStatus === 'away') ?? null
  const team1 = homeTeam ?? teams[0] ?? null
  const team2 = awayTeam ?? teams.find((team) => team !== team1) ?? null
  return { team1, team2 }
}

function toHomeButton(payload: {
  market: Market
  outcome: Outcome
  label: string
  tone: 'team1' | 'team2' | 'draw'
  color: string | null
}) {
  return {
    conditionId: payload.market.condition_id,
    outcomeIndex: payload.outcome.outcome_index,
    label: payload.label,
    tone: payload.tone,
    color: payload.color,
  }
}

function findMoneylineMarkets(event: Event) {
  return (event.markets ?? []).filter((market) => {
    if (!market?.condition_id) {
      return false
    }

    if (toMarketType(market) === 'moneyline') {
      return true
    }

    return isDrawMarket(market) && !isExplicitNonMoneylineMarket(market)
  })
}

function resolveExplicitOutcomeForTeam(
  market: Market,
  team: HomeSportsTeam | null,
  excludedOutcomeIndex?: number | null,
) {
  const matchingOutcome = market.outcomes.find((outcome) => {
    if (excludedOutcomeIndex != null && outcome.outcome_index === excludedOutcomeIndex) {
      return false
    }

    return doesTextMatchTeam(outcome.outcome_text, team)
  })

  if (matchingOutcome) {
    return matchingOutcome
  }
  return null
}

interface HomeSportsTeam {
  name: string
  abbreviation: string
  color: string | null
  logoUrl: string | null
  hostStatus: string | null
}

export interface HomeSportsMoneylineButton {
  conditionId: string
  outcomeIndex: number
  label: string
  tone: 'team1' | 'team2' | 'draw'
  color: string | null
}

export interface HomeSportsMoneylineModel {
  team1: HomeSportsTeam
  team2: HomeSportsTeam
  team1Button: HomeSportsMoneylineButton
  team2Button: HomeSportsMoneylineButton
  drawButton?: HomeSportsMoneylineButton
}

export interface ResolvedHomeSportsMoneylineWinner {
  conditionId: string
  label: string
  outcomeIndex: number
  tone: HomeSportsMoneylineButton['tone']
}

export function resolveHomeSportsButtonChance(baseChance: number | null | undefined, outcomeIndex: number) {
  const normalizedBaseChance =
    typeof baseChance === 'number' && Number.isFinite(baseChance) ? Math.max(0, Math.min(100, baseChance)) : 0

  if (outcomeIndex === 1) {
    return Math.max(0, Math.min(100, 100 - normalizedBaseChance))
  }

  return normalizedBaseChance
}

function resolveBinaryWinningOutcomeIndex(market: Pick<Market, 'outcomes' | 'condition'>) {
  const explicitWinner = market.outcomes.find((outcome) => outcome.is_winning_outcome)
  if (explicitWinner && Number.isFinite(explicitWinner.outcome_index)) {
    return explicitWinner.outcome_index
  }

  return resolveUniqueBinaryWinningOutcomeIndexFromPayoutNumerators(market.condition?.payout_numerators)
}

function hasExplicitSplitPayout(market: Pick<Market, 'outcomes' | 'condition'>) {
  if (hasEqualPositiveBinaryPayout(market.condition?.payout_numerators)) {
    return true
  }

  const yesPayout = market.outcomes.find((outcome) => outcome.outcome_index === OUTCOME_INDEX.YES)?.payout_value
  const noPayout = market.outcomes.find((outcome) => outcome.outcome_index === OUTCOME_INDEX.NO)?.payout_value
  if (yesPayout != null && noPayout != null) {
    return hasEqualPositiveBinaryPayout([yesPayout, noPayout])
  }

  // A reported price alone is not final while the condition is still unresolved.
  return market.condition?.resolved === true && market.condition.resolution_price === 0.5
}

function resolveResolvedWinnerLabel(model: HomeSportsMoneylineModel, tone: HomeSportsMoneylineButton['tone']) {
  if (tone === 'team1') {
    return model.team1.name
  }
  if (tone === 'team2') {
    return model.team2.name
  }
  return 'Draw'
}

export function resolveResolvedHomeSportsMoneylineWinner(
  event: Pick<Event, 'markets' | 'sports_score'>,
  model: HomeSportsMoneylineModel,
): ResolvedHomeSportsMoneylineWinner | null {
  const buttons = [model.team1Button, model.drawButton, model.team2Button].filter(
    (button): button is HomeSportsMoneylineButton => Boolean(button),
  )

  let resolvedWinner: ResolvedHomeSportsMoneylineWinner | null = null
  for (const button of buttons) {
    const market = event.markets.find((candidate) => candidate.condition_id === button.conditionId)
    if (!market) {
      continue
    }

    if (hasExplicitSplitPayout(market)) {
      // The card combines these markets, so a split cannot produce a single winner.
      return null
    }

    const winnerIndex = resolveBinaryWinningOutcomeIndex(market)
    if (resolvedWinner || winnerIndex !== button.outcomeIndex) {
      continue
    }

    resolvedWinner = {
      conditionId: button.conditionId,
      label: resolveResolvedWinnerLabel(model, button.tone),
      outcomeIndex: button.outcomeIndex,
      tone: button.tone,
    }
  }

  if (resolvedWinner) {
    return resolvedWinner
  }

  const finalScore = parseSportsScore(event.sports_score)
  if (!finalScore) {
    return null
  }

  if (finalScore.team1 === finalScore.team2) {
    if (!model.drawButton) {
      return null
    }

    return {
      conditionId: model.drawButton.conditionId,
      label: resolveResolvedWinnerLabel(model, model.drawButton.tone),
      outcomeIndex: model.drawButton.outcomeIndex,
      tone: model.drawButton.tone,
    }
  }

  const winningButton = finalScore.team1 > finalScore.team2 ? model.team1Button : model.team2Button

  return {
    conditionId: winningButton.conditionId,
    label: resolveResolvedWinnerLabel(model, winningButton.tone),
    outcomeIndex: winningButton.outcomeIndex,
    tone: winningButton.tone,
  }
}

function buildSeparatedMoneylineModel(
  moneylineMarkets: Market[],
  team1: HomeSportsTeam,
  team2: HomeSportsTeam,
): HomeSportsMoneylineModel | null {
  const drawMarket = moneylineMarkets.find((market) => isDrawMarket(market))
  const nonDrawMarkets = moneylineMarkets.filter((market) => !isDrawMarket(market))

  const team1Market = nonDrawMarkets.find((market) => doesMarketMatchTeam(market, team1)) ?? nonDrawMarkets[0]
  const team2Market =
    nonDrawMarkets.find((market) => market !== team1Market && doesMarketMatchTeam(market, team2)) ??
    nonDrawMarkets.find((market) => market !== team1Market)

  const team1Outcome = team1Market ? resolveYesOutcome(team1Market) : null
  const team2Outcome = team2Market ? resolveYesOutcome(team2Market) : null
  const drawOutcome = drawMarket ? resolveYesOutcome(drawMarket) : null

  if (!team1Market || !team2Market || !team1Outcome || !team2Outcome) {
    return null
  }

  return {
    team1,
    team2,
    team1Button: toHomeButton({
      market: team1Market,
      outcome: team1Outcome,
      label: team1.abbreviation,
      tone: 'team1',
      color: team1.color,
    }),
    team2Button: toHomeButton({
      market: team2Market,
      outcome: team2Outcome,
      label: team2.abbreviation,
      tone: 'team2',
      color: team2.color,
    }),
    drawButton:
      drawMarket && drawOutcome
        ? toHomeButton({
            market: drawMarket,
            outcome: drawOutcome,
            label: 'DRAW',
            tone: 'draw',
            color: null,
          })
        : undefined,
  }
}

function buildBinaryMoneylineModel(
  moneylineMarkets: Market[],
  team1: HomeSportsTeam,
  team2: HomeSportsTeam,
): HomeSportsMoneylineModel | null {
  for (const market of moneylineMarkets) {
    if (isDrawMarket(market) || (market.outcomes?.length ?? 0) < 2) {
      continue
    }

    const team1Outcome = resolveExplicitOutcomeForTeam(market, team1)
    if (!team1Outcome) {
      continue
    }

    const team2Outcome = resolveExplicitOutcomeForTeam(market, team2, team1Outcome.outcome_index)
    if (!team2Outcome) {
      continue
    }

    return {
      team1,
      team2,
      team1Button: toHomeButton({
        market,
        outcome: team1Outcome,
        label: team1.abbreviation,
        tone: 'team1',
        color: team1.color,
      }),
      team2Button: toHomeButton({
        market,
        outcome: team2Outcome,
        label: team2.abbreviation,
        tone: 'team2',
        color: team2.color,
      }),
    }
  }

  return null
}

export function buildHomeSportsMoneylineModel(event: Event): HomeSportsMoneylineModel | null {
  if (!hasSportsContext(event) || hasPropsTag(event) || !hasGamesTag(event)) {
    return null
  }

  const teams = toHomeSportsTeams(event)
  const { team1, team2 } = resolvePrimaryTeams(teams)

  if (!team1 || !team2) {
    return null
  }

  const moneylineMarkets = findMoneylineMarkets(event)
  if (moneylineMarkets.length === 0) {
    return null
  }

  return isNegRiskEvent(event)
    ? (buildSeparatedMoneylineModel(moneylineMarkets, team1, team2) ??
        buildBinaryMoneylineModel(moneylineMarkets, team1, team2))
    : (buildBinaryMoneylineModel(moneylineMarkets, team1, team2) ??
        buildSeparatedMoneylineModel(moneylineMarkets, team1, team2))
}
