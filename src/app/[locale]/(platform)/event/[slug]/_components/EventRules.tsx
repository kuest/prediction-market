'use client'

import type { ReactNode } from 'react'

import { BadgeInfoIcon, GiftIcon, LinkIcon } from 'lucide-react'
import { useExtracted, useLocale } from 'next-intl'
import Image from 'next/image'
import { useCallback, useEffect, useState } from 'react'

import type { Event } from '@/types'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useSiteIdentity } from '@/hooks/useSiteIdentity'
import {
  DRO_CTF_ADAPTER_V4_ADDRESS,
  NEGRISK_DRO_CTF_ADAPTER_V4_ADDRESS,
  NEGRISK_UMA_CTF_ADAPTER_V4_ADDRESS,
  UMA_CTF_ADAPTER_ADDRESS,
  UMA_CTF_ADAPTER_POLYMARKET_ADDRESS,
  UMA_CTF_ADAPTER_V4_ADDRESS,
  UMA_NEG_RISK_ADAPTER_ADDRESS,
  UMA_NEG_RISK_ADAPTER_POLYMARKET_ADDRESS,
} from '@/lib/contracts'
import { isDirectResolutionMarket } from '@/lib/direct-resolution'
import { readVisibleMarketClarifications } from '@/lib/market-clarifications'
import { getMirrorResolutionType } from '@/lib/mirror-resolution'
import { resolveUmaProposeTarget } from '@/lib/uma'
import { cn } from '@/lib/utils'
import { normalizeAddress } from '@/lib/wallet'
import { useOrder } from '@/stores/useOrder'

import DirectResolutionButton from './DirectResolutionButton'

interface EventRulesProps {
  event: Event
  mode?: 'accordion' | 'inline'
  showEndDate?: boolean
  marketConditionId?: string
  initialMarketConditionId?: string
}

const RESOLVER_GRADIENTS = [
  'from-primary/80 to-primary',
  'from-blue-500/70 to-indigo-500',
  'from-emerald-500/70 to-teal-500',
  'from-orange-500/70 to-rose-500',
  'from-purple-500/70 to-fuchsia-500',
  'from-sky-500/70 to-cyan-500',
]

const UMA_RESOLVER_ADDRESS_SET = new Set(
  [
    UMA_CTF_ADAPTER_POLYMARKET_ADDRESS,
    UMA_NEG_RISK_ADAPTER_POLYMARKET_ADDRESS,
    UMA_CTF_ADAPTER_ADDRESS,
    UMA_NEG_RISK_ADAPTER_ADDRESS,
    UMA_CTF_ADAPTER_V4_ADDRESS,
    NEGRISK_UMA_CTF_ADAPTER_V4_ADDRESS,
    DRO_CTF_ADAPTER_V4_ADDRESS,
    NEGRISK_DRO_CTF_ADAPTER_V4_ADDRESS,
  ].map((address) => address.toLowerCase()),
)
const RULES_URL_REGEX = /((?:https?:\/\/|www\.)[^\s<>"']+)/g
const RULES_URL_TRAILING_PUNCTUATION_REGEX = /([)\].,!?;:]+)$/
const RULES_LABEL_WHITESPACE_REGEX = /\s+/gu
const EVENT_RULES_TIMESTAMP_LOCALE = 'en-US'

function getResolverGradient(address?: string) {
  if (!address) {
    return RESOLVER_GRADIENTS[0]
  }

  let checksum = 0
  for (const character of address.toLowerCase()) {
    checksum += character.charCodeAt(0)
  }
  return RESOLVER_GRADIENTS[checksum % RESOLVER_GRADIENTS.length]
}

function normalizeRulesLabelWhitespace(value: string) {
  return value.replace(RULES_LABEL_WHITESPACE_REGEX, ' ').trim()
}

function useExpandedState(initialExpanded: boolean) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded)
  return { isExpanded, setIsExpanded }
}

function AccordionRulesPanel({
  children,
  initialExpanded,
  title,
  titleAdornment,
}: {
  children: ReactNode
  initialExpanded: boolean
  title: string
  titleAdornment?: ReactNode
}) {
  const { isExpanded, setIsExpanded } = useExpandedState(initialExpanded)

  useEffect(() => {
    function openResolutionProposal(event: globalThis.Event) {
      const targetId = (event as CustomEvent<{ targetId?: string }>).detail?.targetId
      setIsExpanded(true)
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          document.getElementById(targetId ?? '')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        })
      })
    }

    window.addEventListener('open-resolution-proposal', openResolutionProposal)
    return () => window.removeEventListener('open-resolution-proposal', openResolutionProposal)
  }, [setIsExpanded])

  return (
    <section className="overflow-hidden rounded-xl border bg-card transition-all duration-500 ease-in-out">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          `flex h-18 w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none`,
        )}
        aria-expanded={isExpanded}
      >
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-base font-medium">{title}</h3>
          {titleAdornment}
        </div>
        <div className="flex shrink-0 items-center">
          <span aria-hidden="true" className="pointer-events-none flex size-8 items-center justify-center">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className={cn('size-6 text-muted-foreground transition-transform', { 'rotate-180': isExpanded })}
            >
              <path
                d="M4 6L8 10L12 6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
      </button>

      <div
        className={cn(
          `grid overflow-hidden transition-all duration-500 ease-in-out ${
            isExpanded
              ? 'pointer-events-auto grid-rows-[1fr] opacity-100'
              : 'pointer-events-none grid-rows-[0fr] opacity-0'
          }`,
        )}
        aria-hidden={!isExpanded}
      >
        <div className={cn('min-h-0 overflow-hidden', { 'border-t border-border/30': isExpanded })}>{children}</div>
      </div>
    </section>
  )
}

function ResolutionRewardsIcon({ amount, label }: { amount: string; label: string }) {
  return (
    <span
      aria-label={`${label}: ${amount}`}
      className="group inline-flex min-h-7 shrink-0 items-center justify-center gap-1 rounded-md border border-violet-500/20 bg-violet-500/5 px-1.5 text-xs font-semibold text-violet-500"
    >
      <GiftIcon className="size-3.5" aria-hidden="true" />
      <span className="inline-flex min-w-0 items-center">
        <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity,margin] duration-200 group-hover:mr-1 group-hover:max-w-40 group-hover:opacity-100 [@media(hover:none)]:mr-1 [@media(hover:none)]:max-w-40 [@media(hover:none)]:opacity-100">
          {label}:
        </span>
        <span className="tabular-nums">{amount}</span>
      </span>
    </span>
  )
}

export default function EventRules({
  event,
  mode = 'accordion',
  showEndDate = false,
  marketConditionId,
  initialMarketConditionId,
}: EventRulesProps) {
  const t = useExtracted()
  const locale = useLocale()
  const siteIdentity = useSiteIdentity()
  const isInline = mode === 'inline'
  const selectedMarketConditionId = useOrder((state) => state.market?.condition_id)
  const isNegRiskEvent = Boolean(
    event.enable_neg_risk || event.neg_risk || event.neg_risk_augmented || event.neg_risk_market_id,
  )
  const selectedMarket = event.markets.find((market) => market.condition_id === selectedMarketConditionId)
  const primaryMarket = (isNegRiskEvent ? selectedMarket : null) ?? event.markets[0]
  const clarificationMarket =
    event.markets.find((market) => market.condition_id === marketConditionId) ??
    selectedMarket ??
    event.markets.find((market) => market.condition_id === initialMarketConditionId) ??
    event.markets[0]
  const clarifications = readVisibleMarketClarifications(clarificationMarket?.metadata)
  const resolutionRewardMarketKey = [
    event.id,
    primaryMarket?.condition_id,
    primaryMarket?.question_id,
    primaryMarket?.neg_risk_request_id,
  ].join(':')
  const [resolutionReward, setResolutionReward] = useState<{ marketKey: string; amount: string | null }>(() => ({
    marketKey: resolutionRewardMarketKey,
    amount: null,
  }))
  const resolutionRewardAmount =
    resolutionReward.marketKey === resolutionRewardMarketKey ? resolutionReward.amount : null
  const handleResolutionRewardAmountChange = useCallback(
    (amount: string | null) => setResolutionReward({ marketKey: resolutionRewardMarketKey, amount }),
    [resolutionRewardMarketKey],
  )

  function formatRules(rules: string): string {
    if (!rules) {
      return ''
    }

    return rules.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/^"/, '').replace(/"$/, '')
  }

  function formatOracleAddress(address: string): string {
    if (!address || !address.startsWith('0x')) {
      return t('0x0000...0000')
    }

    const prefix = address.substring(0, 6)
    const suffix = address.substring(address.length - 4)
    return `${prefix}...${suffix}`
  }

  function formatCreatedAt(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      return t('—')
    }

    const parts = new Intl.DateTimeFormat(EVENT_RULES_TIMESTAMP_LOCALE, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/New_York',
    }).formatToParts(date)

    const month = parts.find((part) => part.type === 'month')?.value ?? ''
    const day = parts.find((part) => part.type === 'day')?.value ?? ''
    const year = parts.find((part) => part.type === 'year')?.value ?? ''
    const hour = parts.find((part) => part.type === 'hour')?.value ?? ''
    const minute = parts.find((part) => part.type === 'minute')?.value ?? ''
    const dayPeriod = parts.find((part) => part.type === 'dayPeriod')?.value ?? ''

    return normalizeRulesLabelWhitespace(`${month} ${day}, ${year}, ${hour}:${minute} ${dayPeriod}`)
  }

  function formatEndDate(value: string | null | undefined): string {
    if (!value) {
      return t('—')
    }

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      return t('—')
    }

    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date)
  }

  function formatAdditionalContextUpdatedAt(value: string | null | undefined): string | null {
    if (!value) {
      return null
    }

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      return null
    }

    return new Intl.DateTimeFormat(EVENT_RULES_TIMESTAMP_LOCALE, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(date)
  }

  function renderRulesTextWithLinks(text: string) {
    if (!text) {
      return null
    }

    return text.split(RULES_URL_REGEX).map((part, index) => {
      if (index % 2 === 1) {
        const trailingPunctuationMatch = part.match(RULES_URL_TRAILING_PUNCTUATION_REGEX)
        const trailingPunctuationCandidate = trailingPunctuationMatch?.[1] ?? ''
        const urlCandidate = trailingPunctuationCandidate ? part.slice(0, -trailingPunctuationCandidate.length) : part
        const hrefCandidate = urlCandidate.startsWith('http') ? urlCandidate : `https://${urlCandidate}`
        let trailingPunctuation = ''
        let urlPart = part
        try {
          const parsedUrl = new URL(hrefCandidate)
          if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            throw new Error('Invalid protocol')
          }
          urlPart = urlCandidate
          trailingPunctuation = trailingPunctuationCandidate
        } catch {
          //
        }
        const href = urlPart.startsWith('http') ? urlPart : `https://${urlPart}`

        return (
          <span key={`rules-link-${index}`}>
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:opacity-80">
              {trailingPunctuation ? urlPart : part}
            </a>
            {trailingPunctuation || null}
          </span>
        )
      }
      return part
    })
  }

  const mirrorResolutionType = primaryMarket ? getMirrorResolutionType(primaryMarket) : null
  const mirrorResolutionLabel =
    mirrorResolutionType === 'chainlink' ? 'Chainlink' : mirrorResolutionType === 'uma' ? 'UMA' : null
  const isDirectResolver = primaryMarket ? isDirectResolutionMarket(primaryMarket) : false
  const isPrimaryMarketResolved = Boolean(primaryMarket?.is_resolved || primaryMarket?.condition?.resolved)
  const proposeTarget = isDirectResolver ? null : resolveUmaProposeTarget(primaryMarket?.condition, siteIdentity.name)
  const resolverAddress = proposeTarget?.isMirror
    ? primaryMarket?.resolver
    : isDirectResolver
      ? (primaryMarket?.resolver ?? primaryMarket?.condition?.oracle)
      : primaryMarket?.condition?.oracle
  const resolverGradient = getResolverGradient(resolverAddress)
  const proposeUrl = proposeTarget?.url ?? null
  const resolutionSourceUrl = (() => {
    const value = primaryMarket?.resolution_source_url?.trim() ?? ''
    if (!value || value.toLowerCase() === 'n/a') {
      return ''
    }
    const href = value.startsWith('http') ? value : `https://${value}`
    try {
      const url = new URL(href)
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : ''
    } catch {
      return ''
    }
  })()
  const formattedRules = formatRules(primaryMarket?.market_rules?.trim() || event.rules || '')
  const createdAtLabel = formatCreatedAt(event.created_at)
  const endDateLabel = formatEndDate(event.end_date)
  const normalizedResolverAddress = normalizeAddress(resolverAddress)?.toLowerCase()
  const isUmaResolver = normalizedResolverAddress ? UMA_RESOLVER_ADDRESS_SET.has(normalizedResolverAddress) : false
  const hasResolutionSourceUrl = Boolean(resolutionSourceUrl)
  const resolverBadgeClassName = isUmaResolver ? 'bg-transparent' : `bg-linear-to-r ${resolverGradient}`
  const additionalContext = typeof event.additional_context === 'string' ? event.additional_context.trim() : ''
  const contextEntries = [
    ...(additionalContext ? [{ key: 'event', content: additionalContext }] : []),
    ...clarifications.map((note) => ({ key: `${note.source ?? 'polymarket'}:${note.id}`, content: note.content })),
  ]
  const hasAdditionalContext = contextEntries.length > 0
  const clarificationUpdatedAt = clarifications.reduce<string | null>((latest, note) => {
    const timestamp = note.txTimestamp ?? note.createdAt
    return timestamp && (!latest || timestamp > latest) ? timestamp : latest
  }, null)
  const manualUpdatedAt = additionalContext ? (event.additional_context_updated_at ?? event.updated_at) : null
  const latestUpdatedAt =
    clarificationUpdatedAt && (!manualUpdatedAt || !(Date.parse(manualUpdatedAt) >= Date.parse(clarificationUpdatedAt)))
      ? clarificationUpdatedAt
      : manualUpdatedAt
  const additionalContextUpdatedAtLabel = formatAdditionalContextUpdatedAt(latestUpdatedAt)

  const resolverDetails = (
    <div className="flex min-w-0 items-start gap-3">
      <div className={cn(`size-10 ${resolverBadgeClassName} flex shrink-0 items-center justify-center rounded-sm`)}>
        {isUmaResolver && (
          <Image
            src="/images/resolver/uma.svg"
            alt="UMA"
            width={40}
            height={40}
            loading="eager"
            unoptimized
            className="h-auto w-full max-w-10"
          />
        )}
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{t('Resolver')}</div>
        <a
          href={resolverAddress ? `https://polygonscan.com/address/${resolverAddress}` : '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:opacity-80"
        >
          {formatOracleAddress(resolverAddress || '')}
        </a>
      </div>
    </div>
  )

  const resolverAction = (() => {
    if (isDirectResolver) {
      return null
    }

    if (hasResolutionSourceUrl) {
      return null
    }

    if (proposeUrl) {
      return (
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={
            <a href={proposeUrl} target="_blank" rel="noopener noreferrer">
              {t('Propose resolution')}
            </a>
          }
        />
      )
    }

    return (
      <Button variant="outline" size="sm" disabled>
        {t('Propose resolution')}
      </Button>
    )
  })()
  const resolutionRewardAdornment =
    isDirectResolver && !isPrimaryMarketResolved && resolutionRewardAmount ? (
      <ResolutionRewardsIcon amount={resolutionRewardAmount} label={t('Resolution reward')} />
    ) : null
  const resolutionProposalTargetId = primaryMarket
    ? `propose-resolution-${primaryMarket.condition_id}`
    : 'propose-resolution'

  const resolverBlock = (
    <div id={!isDirectResolver ? resolutionProposalTargetId : undefined} className="rounded-lg border p-3">
      <div className={cn('flex items-center', resolverAction && 'justify-between gap-3')}>
        {resolverDetails}
        {resolverAction}
      </div>
    </div>
  )

  const resolutionSourceBlock = hasResolutionSourceUrl ? (
    <div className="rounded-lg border p-3">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
          <LinkIcon className="size-4 -scale-x-100 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">
            {t('Resolution Source')}
            {mirrorResolutionLabel ? ` · ${mirrorResolutionLabel}` : ''}
          </div>
          <a
            href={resolutionSourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'text-xs text-primary hover:opacity-80',
              isInline ? 'block max-w-full truncate' : 'break-all',
            )}
            title={resolutionSourceUrl}
          >
            {resolutionSourceUrl}
          </a>
        </div>
      </div>
    </div>
  ) : null

  const content = (
    <div className={cn('space-y-2', { 'p-3': !isInline })}>
      {hasAdditionalContext && (
        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <BadgeInfoIcon aria-hidden="true" className="size-5 shrink-0 fill-primary/12 text-primary" />
              <p className="text-base font-medium text-foreground">{t('Additional context')}</p>
            </div>
            {additionalContextUpdatedAtLabel && (
              <p className="text-sm text-muted-foreground sm:ml-auto">
                {t('Updated')} {additionalContextUpdatedAtLabel}
              </p>
            )}
          </div>
          <Separator />
          <div className="space-y-3 p-4">
            {contextEntries.map((entry, index) => (
              <div key={entry.key} className="space-y-3">
                {index > 0 && <Separator />}
                <p className="text-sm/relaxed wrap-anywhere whitespace-pre-line text-muted-foreground">
                  {entry.content}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
      {formattedRules && (
        <div className="text-sm/relaxed whitespace-pre-line text-foreground">
          {renderRulesTextWithLinks(formattedRules)}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm text-foreground">
        <p>
          <span className="font-semibold">{t('Created At')}:</span> {createdAtLabel} {t('ET')}
        </p>
        {event.is_polymarket_mirror && (
          <div className="ml-auto flex items-center gap-2">
            <span className="font-semibold">{t('Original market')}:</span>
            <Image
              src="/images/logos/polymarket-logo-black.svg"
              alt="Polymarket"
              width={105}
              height={17}
              className="h-4 w-auto dark:brightness-0 dark:invert"
            />
          </div>
        )}
      </div>

      {showEndDate && (
        <p className="text-sm text-foreground">
          <span className="font-semibold">{t('End Date')}:</span> {endDateLabel}
        </p>
      )}

      {hasResolutionSourceUrl ? (
        <div className={cn('mt-3 grid gap-3 sm:grid-cols-2', { 'mb-3': isInline })}>
          {resolutionSourceBlock}
          {resolverBlock}
        </div>
      ) : (
        <div className={cn('mt-3', { 'mb-3': isInline })}>{resolverBlock}</div>
      )}

      {isDirectResolver && primaryMarket && (
        <div id={resolutionProposalTargetId}>
          <DirectResolutionButton
            market={primaryMarket}
            event={event}
            resolutionSourceLabel={mirrorResolutionLabel}
            onResolutionRewardAmountChange={handleResolutionRewardAmountChange}
          />
        </div>
      )}
    </div>
  )

  if (isInline) {
    return (
      <section className="grid gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-base font-medium text-foreground">{t('Rules & Resolution')}</h4>
          {resolutionRewardAdornment}
        </div>
        {content}
      </section>
    )
  }

  return (
    <AccordionRulesPanel
      key={`${event.id}:${hasAdditionalContext ? 'with-context' : 'without-context'}`}
      initialExpanded={hasAdditionalContext}
      title={t('Rules & Resolution')}
      titleAdornment={resolutionRewardAdornment}
    >
      {content}
    </AccordionRulesPanel>
  )
}
