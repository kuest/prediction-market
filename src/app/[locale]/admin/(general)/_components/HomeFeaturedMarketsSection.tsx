'use client'

import type { Dispatch, ReactNode, SetStateAction } from 'react'

import {
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  StarIcon,
  VideoIcon,
  XIcon,
} from 'lucide-react'
import { useExtracted } from 'next-intl'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'

import type {
  HomeFeaturedContextItem,
  HomeFeaturedContextMode,
  HomeFeaturedEventAdminItem,
  HomeFeaturedSideCardSettings,
} from '@/types'

import HomeFeaturedSideCardIcon from '@/components/HomeFeaturedSideCardIcon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { useIsMobile } from '@/hooks/useIsMobile'
import { formatDollarValueLabel } from '@/lib/formatters'
import { localizeHomeEventCardTitle } from '@/lib/home-featured-localization'
import { serializeHomeFeaturedEventsForSave } from '@/lib/home-featured-payload'
import { HOME_FEATURED_NEWS_LIMIT } from '@/lib/home-featured-settings'
import { cn } from '@/lib/utils'

import HomeFeaturedAdminPreviewImage from './HomeFeaturedAdminPreviewImage'
import HomeFeaturedEventRow from './HomeFeaturedEventRow'
import HomeFeaturedSideCardCarouselDialog from './HomeFeaturedSideCardCarouselDialog'
import SettingsAccordionSection from './SettingsAccordionSection'

interface AdminEventCandidate {
  id: string
  slug: string
  title: string
  icon_url: string | null
  series_slug: string | null
  series_recurrence: string | null
  volume: number
  volume_24h: number
  status: string
  start_date: string | null
  end_date: string | null
  sports_score: string | null
  sports_live: boolean | null
  sports_ended: boolean | null
}

interface HomeFeaturedMarketsSectionProps {
  locale: string
  isPending: boolean
  openSections: string[]
  onToggleSection: (value: string) => void
  enabled: boolean
  onEnabledChange: (value: boolean) => void
  useAi: boolean
  onUseAiChange: (value: boolean) => void
  maxCards: number
  onMaxCardsChange: (value: number) => void
  defaultContextMode: HomeFeaturedContextMode
  onDefaultContextModeChange: (value: HomeFeaturedContextMode) => void
  newsSources: string
  onNewsSourcesChange: (value: string) => void
  commentBlacklist: string
  onCommentBlacklistChange: (value: string) => void
  minVolume24h: number
  onMinVolume24hChange: (value: number) => void
  includeSportsToday: boolean
  onIncludeSportsTodayChange: (value: boolean) => void
  includeNewEvents: boolean
  onIncludeNewEventsChange: (value: boolean) => void
  sideCard: HomeFeaturedSideCardSettings
  onSideCardChange: Dispatch<SetStateAction<HomeFeaturedSideCardSettings>>
  sideCardImagePreviewUrls: Record<string, string>
  processingSideCardImageIds: string[]
  onSideCardImageChange: (slideId: string, file: File | null) => Promise<void>
  featuredEvents: HomeFeaturedEventAdminItem[]
  onFeaturedEventsChange: Dispatch<SetStateAction<HomeFeaturedEventAdminItem[]>>
}

function fetchAdminEventsApi(pathname: string, init?: RequestInit) {
  return fetch(`/admin/api/events${pathname}`, init)
}

function readApiError(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const maybeError = (payload as { error?: unknown }).error
  return typeof maybeError === 'string' && maybeError.trim() ? maybeError.trim() : null
}

function buildFeaturedKey(item: Pick<HomeFeaturedEventAdminItem, 'eventId' | 'seriesSlug' | 'targetType'>) {
  return item.targetType === 'series' ? `series:${item.seriesSlug ?? ''}` : `event:${item.eventId ?? ''}`
}

function toFeaturedItem(candidate: AdminEventCandidate, rank: number): HomeFeaturedEventAdminItem {
  const hasSeries = Boolean(candidate.series_slug?.trim())

  return {
    targetType: hasSeries ? 'series' : 'event',
    eventId: candidate.id,
    seriesSlug: hasSeries ? candidate.series_slug : null,
    title: candidate.title,
    slug: candidate.slug,
    iconUrl: candidate.icon_url,
    enabled: true,
    rank,
    source: 'manual',
    startsAt: null,
    endsAt: null,
    contextMode: 'auto',
    autoRolloverEnabled: hasSeries,
    contextItems: [],
  }
}

const FEATURED_MARKET_TIME_ZONE = 'America/New_York'

function formatCandidateDateTime(value: string | null, locale: string) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZone: FEATURED_MARKET_TIME_ZONE,
    timeZoneName: 'short',
    year: 'numeric',
  }).format(date)
}

function resolveCandidatePeriodLabel(candidate: AdminEventCandidate, locale: string) {
  const start = formatCandidateDateTime(candidate.start_date, locale)
  const end = formatCandidateDateTime(candidate.end_date, locale)
  if (start && end) {
    return `${start} – ${end}`
  }

  return start ?? end
}

function resolveCandidateStatus(candidate: AdminEventCandidate, now: number) {
  const start = candidate.start_date ? Date.parse(candidate.start_date) : Number.NaN
  const end = candidate.end_date ? Date.parse(candidate.end_date) : Number.NaN
  if (Number.isFinite(end) && end <= now) {
    return { label: 'Expired', tone: 'muted' as const }
  }
  if (Number.isFinite(start) && start > now) {
    return { label: 'Next', tone: 'warning' as const }
  }

  return { label: 'Active', tone: 'active' as const }
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= items.length) {
    return items
  }

  const next = [...items]
  const current = next[index]
  const target = next[nextIndex]
  if (current === undefined || target === undefined) {
    return items
  }

  next[index] = target
  next[nextIndex] = current
  return next
}

function buildManualNewsContextItem(item: {
  title: string
  source: string
  url: string
  faviconUrl: string | null
  publishedAt: string | null
}): HomeFeaturedContextItem {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

  return {
    id: `manual-news:${item.url}`,
    type: 'news',
    source: item.source,
    title: item.title,
    avatarUrl: null,
    faviconUrl: item.faviconUrl,
    url: item.url,
    publishedAt: item.publishedAt,
    selectedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    relevanceScore: 1,
    isManual: true,
  }
}

function HomeFeaturedResponsiveOverlay({
  isMobile,
  open,
  title,
  description,
  children,
  footer,
  dialogClassName,
  onOpenChange,
}: {
  isMobile: boolean
  open: boolean
  title: ReactNode
  description: ReactNode
  children: ReactNode
  footer: ReactNode
  dialogClassName: string
  onOpenChange: (open: boolean) => void
}) {
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[90vh] w-full overflow-hidden bg-background px-4 pt-4 pb-6">
          <DrawerHeader className="shrink-0 space-y-2 p-0 text-left">
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto py-4 pr-1">{children}</div>
          <DrawerFooter className="shrink-0 border-t p-0 pt-4">{footer}</DrawerFooter>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn('max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden', dialogClassName)}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto pr-1">{children}</div>
        <DialogFooter className="border-t pt-4">{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function HomeFeaturedSelectionDialog({
  isMobile,
  locale,
  open,
  disabled,
  selectedItems,
  onOpenChange,
  onAddCandidate,
}: {
  isMobile: boolean
  locale: string
  open: boolean
  disabled: boolean
  selectedItems: HomeFeaturedEventAdminItem[]
  onOpenChange: (open: boolean) => void
  onAddCandidate: (candidate: AdminEventCandidate) => void
}) {
  const t = useExtracted()
  const [search, setSearch] = useState('')
  const [loadingRequestId, setLoadingRequestId] = useState<number | null>(null)
  const [candidates, setCandidates] = useState<AdminEventCandidate[]>([])
  const searchRequestIdRef = useRef(0)
  const isLoading = loadingRequestId !== null
  const [now, setNow] = useState(() => Date.now())
  const selectedKeys = useMemo(() => new Set(selectedItems.map(buildFeaturedKey)), [selectedItems])

  useEffect(
    function refreshCandidateStatusClock() {
      if (!open) {
        return
      }

      const refreshTimeoutId = window.setTimeout(() => setNow(Date.now()), 0)
      const intervalId = window.setInterval(() => setNow(Date.now()), 1_000)
      return function cleanupCandidateStatusClock() {
        window.clearTimeout(refreshTimeoutId)
        window.clearInterval(intervalId)
      }
    },
    [open],
  )

  useEffect(
    function loadCandidates() {
      if (!open) {
        searchRequestIdRef.current += 1
        return
      }

      const requestId = searchRequestIdRef.current + 1
      searchRequestIdRef.current = requestId
      const controller = new AbortController()
      const timeoutId = setTimeout(async () => {
        setLoadingRequestId(requestId)

        try {
          const params = new URLSearchParams({
            activeOnly: '1',
            limit: '30',
            sortBy: 'volume_24h',
            sortOrder: 'desc',
          })
          if (search.trim()) {
            params.set('search', search.trim())
          }

          const response = await fetchAdminEventsApi(`?${params.toString()}`, {
            cache: 'no-store',
            signal: controller.signal,
          })
          const payload = (await response.json().catch(() => null)) as unknown
          const apiError = readApiError(payload)

          if (!response.ok || apiError || !payload || typeof payload !== 'object') {
            throw new Error(apiError || t('Could not load events.'))
          }

          const rows = (payload as { data?: unknown }).data
          if (searchRequestIdRef.current === requestId) {
            setCandidates(Array.isArray(rows) ? (rows as AdminEventCandidate[]) : [])
          }
        } catch (error) {
          if ((error as { name?: string })?.name === 'AbortError') {
            return
          }

          console.error('Failed to load featured market candidates', error)
          toast.error(error instanceof Error ? error.message : t('Could not load events.'))
        } finally {
          if (searchRequestIdRef.current === requestId) {
            setLoadingRequestId(null)
          }
        }
      }, 200)

      return function cleanupCandidateLoad() {
        controller.abort()
        clearTimeout(timeoutId)
      }
    },
    [open, search, t],
  )

  function handleOpenChange(nextOpen: boolean) {
    searchRequestIdRef.current += 1
    setLoadingRequestId(null)
    onOpenChange(nextOpen)
  }

  return (
    <HomeFeaturedResponsiveOverlay
      isMobile={isMobile}
      open={open}
      onOpenChange={handleOpenChange}
      title={t('Add featured markets')}
      description={
        <>
          <span>
            {t('Select active markets for the home carousel. Recurring markets are saved as a series automatically.')}
          </span>
          <span className="mt-1 block">
            {t('Adding a recurring market selects its entire series; the period shown is only a preview.')}
          </span>
        </>
      }
      dialogClassName="sm:max-w-3xl"
      footer={
        <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>
          {t('Done')}
        </Button>
      }
    >
      <div className="grid gap-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('Search active markets')}
            className="pl-9"
            disabled={disabled}
          />
        </div>

        <div className="max-h-96 overflow-y-auto rounded-lg border">
          {isLoading && (
            <div className="flex h-28 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              {t('Searching events...')}
            </div>
          )}

          {!isLoading && candidates.length === 0 && (
            <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
              {t('No events found')}
            </div>
          )}

          {!isLoading &&
            candidates.map((candidate) => {
              const candidateKey = buildFeaturedKey(toFeaturedItem(candidate, selectedItems.length))
              const isSelected = selectedKeys.has(candidateKey)
              const isSeries = Boolean(candidate.series_slug?.trim())
              const periodLabel = resolveCandidatePeriodLabel(candidate, locale)
              const periodStatus = resolveCandidateStatus(candidate, now)
              const localizedStatusLabel =
                periodStatus.label === 'Expired'
                  ? t('Expired')
                  : periodStatus.label === 'Next'
                    ? t('Next')
                    : t('Active')

              return (
                <button
                  key={candidate.id}
                  type="button"
                  disabled={disabled || isSelected}
                  onClick={() => onAddCandidate(candidate)}
                  className={cn(
                    `flex w-full items-center gap-3 border-b p-3 text-left last:border-b-0 hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60`,
                  )}
                >
                  <div className="size-10 overflow-hidden rounded-lg bg-muted">
                    <HomeFeaturedAdminPreviewImage src={candidate.icon_url} alt="" className="size-10 object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {localizeHomeEventCardTitle(candidate.title, locale)}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
                      <span className="truncate">
                        {isSeries ? `${t('Series')} · ${candidate.series_slug}` : candidate.slug}
                      </span>
                      {periodLabel && <span className="truncate">{periodLabel}</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5',
                          periodStatus.tone === 'active' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                          periodStatus.tone === 'warning' && 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
                          periodStatus.tone === 'muted' && 'bg-muted text-muted-foreground',
                        )}
                      >
                        {localizedStatusLabel}
                      </span>
                      {isSeries && <span className="text-muted-foreground">{t('Recurring event')}</span>}
                    </div>
                  </div>
                  <div className="hidden text-right text-sm text-muted-foreground sm:block">
                    <p>{formatDollarValueLabel(candidate.volume, { maximumFractionDigits: 0 })}</p>
                    <p>{`${formatDollarValueLabel(candidate.volume_24h, { maximumFractionDigits: 0 })} 24h`}</p>
                  </div>
                  <span className="shrink-0 text-right text-sm text-muted-foreground">
                    {isSelected
                      ? isSeries
                        ? `${t('Added')} ${t('Series')}`
                        : t('Added')
                      : isSeries
                        ? `${t('Add')} ${t('Series')}`
                        : t('Add')}
                  </span>
                </button>
              )
            })}
        </div>
      </div>
    </HomeFeaturedResponsiveOverlay>
  )
}

function HomeFeaturedSettingsDialog({
  isMobile,
  open,
  disabled,
  useAi,
  maxCards,
  defaultContextMode,
  newsSources,
  commentBlacklist,
  minVolume24h,
  includeSportsToday,
  includeNewEvents,
  onOpenChange,
  onMaxCardsChange,
  onDefaultContextModeChange,
  onNewsSourcesChange,
  onCommentBlacklistChange,
  onMinVolume24hChange,
  onIncludeSportsTodayChange,
  onIncludeNewEventsChange,
}: {
  isMobile: boolean
  open: boolean
  disabled: boolean
  useAi: boolean
  maxCards: number
  defaultContextMode: HomeFeaturedContextMode
  newsSources: string
  commentBlacklist: string
  minVolume24h: number
  includeSportsToday: boolean
  includeNewEvents: boolean
  onOpenChange: (open: boolean) => void
  onMaxCardsChange: (value: number) => void
  onDefaultContextModeChange: (value: HomeFeaturedContextMode) => void
  onNewsSourcesChange: (value: string) => void
  onCommentBlacklistChange: (value: string) => void
  onMinVolume24hChange: (value: number) => void
  onIncludeSportsTodayChange: (value: boolean) => void
  onIncludeNewEventsChange: (value: boolean) => void
}) {
  const t = useExtracted()

  return (
    <HomeFeaturedResponsiveOverlay
      isMobile={isMobile}
      open={open}
      onOpenChange={onOpenChange}
      title={t('Selection and context settings')}
      description={t('Manual order is respected first. AI picks can fill empty slots when enabled.')}
      dialogClassName="sm:max-w-3xl"
      footer={
        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
          {t('Done')}
        </Button>
      }
    >
      <div className="grid gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[0.75fr_1fr_1.25fr]">
          <div className="grid gap-2">
            <Label htmlFor="home-featured-max-cards">{t('Max cards')}</Label>
            <Input
              id="home-featured-max-cards"
              type="number"
              min={1}
              max={8}
              value={maxCards}
              onChange={(event) => onMaxCardsChange(Math.min(8, Math.max(1, Number(event.target.value) || 1)))}
              disabled={disabled}
            />
          </div>

          <div className="grid gap-2">
            <Label>{t('Default context')}</Label>
            <Select
              items={{ auto: t('Auto'), news: t('News'), comments: t('Comments'), hidden: t('Hidden') }}
              value={defaultContextMode}
              onValueChange={(value) => value !== null && onDefaultContextModeChange(value as HomeFeaturedContextMode)}
              disabled={disabled}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t('Auto')}</SelectItem>
                <SelectItem value="news">{t('News')}</SelectItem>
                <SelectItem value="comments">{t('Comments')}</SelectItem>
                <SelectItem value="hidden">{t('Hidden')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="home-featured-min-volume">{t('Minimum 24h volume')}</Label>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <Input
                id="home-featured-min-volume"
                type="number"
                min={0}
                value={minVolume24h}
                onChange={(event) => onMinVolume24hChange(Math.max(0, Number(event.target.value) || 0))}
                disabled={disabled}
                className="pl-7"
              />
            </div>
          </div>
        </div>

        <fieldset className="grid gap-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">{t('Automatic filters')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3 rounded-md bg-muted/50 p-3">
              <Label htmlFor="home-featured-include-sports-today" className="cursor-pointer">
                {t('Sports live/today')}
              </Label>
              <Switch
                id="home-featured-include-sports-today"
                checked={includeSportsToday}
                onCheckedChange={onIncludeSportsTodayChange}
                disabled={disabled}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md bg-muted/50 p-3">
              <Label htmlFor="home-featured-include-new-events" className="cursor-pointer">
                {t('New events')}
              </Label>
              <Switch
                id="home-featured-include-new-events"
                checked={includeNewEvents}
                onCheckedChange={onIncludeNewEventsChange}
                disabled={disabled}
              />
            </div>
          </div>
        </fieldset>

        {useAi && (
          <div className="grid gap-2">
            <Label htmlFor="home-featured-news-sources">{t('News sources')}</Label>
            <Textarea
              id="home-featured-news-sources"
              value={newsSources}
              onChange={(event) => onNewsSourcesChange(event.target.value)}
              placeholder={t('One RSS feed, news URL, sitemap, or allowed domain per line')}
              disabled={disabled}
              className="min-h-28"
            />
            <p className="text-xs text-muted-foreground">
              {t('AI uses these as publication hints, then searches for recent news about each featured market.')}
            </p>
          </div>
        )}

        <div className="grid gap-2">
          <Label htmlFor="home-featured-comment-blacklist">{t('Comment blacklist')}</Label>
          <Textarea
            id="home-featured-comment-blacklist"
            value={commentBlacklist}
            onChange={(event) => onCommentBlacklistChange(event.target.value)}
            placeholder="www&#10;.com&#10;scam&#10;damn"
            disabled={disabled}
            className="min-h-28"
          />
          <p className="text-xs text-muted-foreground">
            {t('One word or fragment per line. Comments containing any fragment will not appear on the home card.')}
          </p>
        </div>
      </div>
    </HomeFeaturedResponsiveOverlay>
  )
}

function HomeFeaturedContextDialog({
  locale,
  isMobile,
  open,
  disabled,
  item,
  newsSources,
  onOpenChange,
  onSave,
}: {
  locale: string
  isMobile: boolean
  open: boolean
  disabled: boolean
  item: HomeFeaturedEventAdminItem | null
  newsSources: string
  onOpenChange: (open: boolean) => void
  onSave: (updates: Pick<HomeFeaturedEventAdminItem, 'contextItems'>) => void
}) {
  const t = useExtracted()
  const [newsUrl, setNewsUrl] = useState('')
  const [contextItemsDraft, setContextItemsDraft] = useState<HomeFeaturedContextItem[]>(() => item?.contextItems ?? [])
  const [isFetchingUrl, setIsFetchingUrl] = useState(false)
  const [isFindingNews, setIsFindingNews] = useState(false)
  const canManageNews = item?.contextMode === 'news' || item?.contextMode === 'auto'

  function addContextItems(items: HomeFeaturedContextItem[]) {
    setContextItemsDraft((previous) => {
      const seen = new Set(previous.map((contextItem) => contextItem.url ?? contextItem.title))
      const next = [...previous]
      for (const contextItem of items) {
        const key = contextItem.url ?? contextItem.title
        if (seen.has(key)) {
          continue
        }
        seen.add(key)
        next.push(contextItem)
      }

      return next.slice(0, HOME_FEATURED_NEWS_LIMIT)
    })
  }

  async function addUrl() {
    const trimmedUrl = newsUrl.trim()
    if (!trimmedUrl) {
      return
    }

    try {
      setIsFetchingUrl(true)
      const response = await fetch('/admin/api/home-featured-events/context-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmedUrl }),
      })
      const payload = (await response.json().catch(() => null)) as unknown
      const apiError = readApiError(payload)
      if (!response.ok || apiError || !payload || typeof payload !== 'object') {
        throw new Error(apiError || t('Could not fetch URL metadata.'))
      }

      const metadata = (payload as { item?: unknown }).item
      if (!metadata || typeof metadata !== 'object') {
        throw new Error(t('Could not fetch URL metadata.'))
      }

      addContextItems([buildManualNewsContextItem(metadata as Parameters<typeof buildManualNewsContextItem>[0])])
      setNewsUrl('')
    } catch (error) {
      console.error('Failed to add featured context URL', error)
      toast.error(error instanceof Error ? error.message : t('Could not fetch URL metadata.'))
    } finally {
      setIsFetchingUrl(false)
    }
  }

  async function findNewsWithAi() {
    if (!item) {
      return
    }

    try {
      setIsFindingNews(true)
      const response = await fetch('/admin/api/home-featured-events/context-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.title,
          slug: item.slug,
          locale,
          newsSources,
        }),
      })
      const payload = (await response.json().catch(() => null)) as unknown
      const apiError = readApiError(payload)
      if (!response.ok || apiError || !payload || typeof payload !== 'object') {
        throw new Error(apiError || t('Could not find news for this featured market.'))
      }

      const rows = (payload as { items?: unknown }).items
      const items = Array.isArray(rows)
        ? rows.map((row) => buildManualNewsContextItem(row as Parameters<typeof buildManualNewsContextItem>[0]))
        : []
      if (items.length === 0) {
        toast.message(t('No news suggestions found.'))
        return
      }

      addContextItems(items)
      toast.success(t('News suggestions added.'))
    } catch (error) {
      console.error('Failed to find featured context news', error)
      toast.error(error instanceof Error ? error.message : t('Could not find news for this featured market.'))
    } finally {
      setIsFindingNews(false)
    }
  }

  function saveAndClose() {
    onSave({
      contextItems: contextItemsDraft,
    })
    onOpenChange(false)
  }

  return (
    <HomeFeaturedResponsiveOverlay
      isMobile={isMobile}
      open={open}
      onOpenChange={onOpenChange}
      title={t('Manage context')}
      description={item?.title ?? t('Featured market')}
      dialogClassName="sm:max-w-3xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button type="button" onClick={saveAndClose} disabled={disabled}>
            {t('Done')}
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        {canManageNews && (
          <div className="grid gap-3">
            <div>
              <Label>{t('News shown on home')}</Label>
              <p className="text-sm text-muted-foreground">
                {t('Add article URLs manually or ask AI to find recent news from the configured source hints.')}
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={newsUrl}
                onChange={(event) => setNewsUrl(event.target.value)}
                placeholder="https://news-site.com/article"
                disabled={disabled || isFetchingUrl}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={addUrl}
                disabled={disabled || isFetchingUrl || !newsUrl.trim()}
                className="w-full sm:w-auto"
              >
                {isFetchingUrl ? <Spinner className="size-4" /> : <PlusIcon className="size-4" />}
                {t('Add URL')}
              </Button>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-fit"
              onClick={findNewsWithAi}
              disabled={disabled || isFindingNews}
            >
              {isFindingNews ? <Spinner className="size-4" /> : <SparklesIcon className="size-4" />}
              {t('Find news with AI')}
            </Button>

            <div className="grid gap-2">
              {contextItemsDraft.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  {t('No manual news selected yet.')}
                </div>
              ) : (
                contextItemsDraft.map((contextItem, index) => (
                  <div
                    key={`${contextItem.url ?? contextItem.id}:${index}`}
                    className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
                  >
                    <div className="size-8 overflow-hidden rounded-md bg-muted">
                      <HomeFeaturedAdminPreviewImage
                        src={contextItem.faviconUrl}
                        alt=""
                        className="size-8 object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{contextItem.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[contextItem.source, contextItem.url].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={disabled}
                      onClick={() =>
                        setContextItemsDraft((previous) => previous.filter((_, itemIndex) => itemIndex !== index))
                      }
                      aria-label={t('Remove')}
                    >
                      <XIcon className="size-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </HomeFeaturedResponsiveOverlay>
  )
}

export default function HomeFeaturedMarketsSection({
  locale,
  isPending,
  openSections,
  onToggleSection,
  enabled,
  onEnabledChange,
  useAi,
  onUseAiChange,
  maxCards,
  onMaxCardsChange,
  defaultContextMode,
  onDefaultContextModeChange,
  newsSources,
  onNewsSourcesChange,
  commentBlacklist,
  onCommentBlacklistChange,
  minVolume24h,
  onMinVolume24hChange,
  includeSportsToday,
  onIncludeSportsTodayChange,
  includeNewEvents,
  onIncludeNewEventsChange,
  sideCard,
  onSideCardChange,
  sideCardImagePreviewUrls,
  processingSideCardImageIds,
  onSideCardImageChange,
  featuredEvents,
  onFeaturedEventsChange,
}: HomeFeaturedMarketsSectionProps) {
  const t = useExtracted()
  const isMobile = useIsMobile()
  const [selectionDialogOpen, setSelectionDialogOpen] = useState(false)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [sideCardDialogOpen, setSideCardDialogOpen] = useState(false)
  const [manageContextIndex, setManageContextIndex] = useState<number | null>(null)
  const [isRegenerating, startRegenerating] = useTransition()
  const disabled = isPending || isRegenerating
  const manageContextItem = manageContextIndex == null ? null : (featuredEvents[manageContextIndex] ?? null)
  const activeSideCardSlides = sideCard.slides.filter((slide) => slide.enabled)
  const firstSideCardSlide = activeSideCardSlides[0] ?? sideCard.slides[0]
  const firstSideCardImagePreviewUrl = firstSideCardSlide
    ? sideCardImagePreviewUrls[firstSideCardSlide.id] || firstSideCardSlide.imageUrl
    : ''

  function addCandidate(candidate: AdminEventCandidate) {
    onFeaturedEventsChange((previous) => {
      const item = toFeaturedItem(candidate, previous.length)
      const key = buildFeaturedKey(item)
      if (previous.some((current) => buildFeaturedKey(current) === key)) {
        return previous
      }

      return [...previous, item].slice(0, 8)
    })
  }

  function updateItem(index: number, updater: (item: HomeFeaturedEventAdminItem) => HomeFeaturedEventAdminItem) {
    onFeaturedEventsChange((previous) =>
      previous.map((item, currentIndex) => (currentIndex === index ? updater(item) : item)),
    )
  }

  function regenerateFeaturedMarkets() {
    startRegenerating(async () => {
      try {
        const response = await fetch('/admin/api/home-featured-events/regenerate', {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            settings: {
              enabled,
              useAi,
              maxCards,
              defaultContextMode,
              newsSources,
              commentBlacklist,
              minVolume24h,
              includeSportsToday,
              includeNewEvents,
              sideCard,
            },
            featuredEvents: serializeHomeFeaturedEventsForSave(featuredEvents, locale),
          }),
        })
        const payload = (await response.json().catch(() => null)) as unknown
        const apiError = readApiError(payload)

        if (!response.ok || apiError || !payload || typeof payload !== 'object') {
          throw new Error(apiError || t('Could not regenerate featured markets.'))
        }

        const items = (payload as { items?: unknown }).items
        if (Array.isArray(items)) {
          onFeaturedEventsChange(items as HomeFeaturedEventAdminItem[])
        }

        toast.success(t('Featured markets regenerated.'))
      } catch (error) {
        console.error('Failed to regenerate featured markets', error)
        toast.error(error instanceof Error ? error.message : t('Could not regenerate featured markets.'))
      }
    })
  }

  return (
    <SettingsAccordionSection
      value="home-featured-markets"
      isOpen={openSections.includes('home-featured-markets')}
      onToggle={onToggleSection}
      header={
        <h3 className="flex items-center gap-2 text-base font-medium">
          <StarIcon className="size-4 text-muted-foreground" />
          {t('Featured markets')}
        </h3>
      }
    >
      <div className="grid gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <span className="grid gap-1">
              <span className="text-sm font-medium">{t('Enable featured markets on home')}</span>
              <span className="text-sm text-muted-foreground">{t('Show the carousel below the main navigation.')}</span>
            </span>
            <Switch checked={enabled} onCheckedChange={onEnabledChange} disabled={disabled} />
          </label>

          <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <span className="grid gap-1">
              <span className="text-sm font-medium">{t('Use AI to highlight markets')}</span>
              <span className="text-sm text-muted-foreground">
                {t('Keep manual picks and let AI complete the remaining slots.')}
              </span>
            </span>
            <Switch checked={useAi} onCheckedChange={onUseAiChange} disabled={disabled} />
          </label>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                <SlidersHorizontalIcon className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{t('Selection and context settings')}</p>
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {`${t('Max cards')}: ${maxCards} · ${t('Default context')}: ${defaultContextMode} · ${t('Minimum 24h volume')}: ${formatDollarValueLabel(minVolume24h, { maximumFractionDigits: 0 })}`}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setSettingsDialogOpen(true)}
              disabled={disabled}
              aria-label={t('Selection and context settings')}
            >
              <SettingsIcon className="size-4" />
            </Button>
          </div>

          <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                {firstSideCardSlide?.type === 'image' && firstSideCardImagePreviewUrl ? (
                  <HomeFeaturedAdminPreviewImage
                    src={firstSideCardImagePreviewUrl}
                    alt=""
                    className="size-10 rounded-lg object-cover"
                  />
                ) : firstSideCardSlide?.type === 'video' ? (
                  <VideoIcon className="size-5" />
                ) : (
                  <HomeFeaturedSideCardIcon name={firstSideCardSlide?.icon ?? sideCard.icon} className="size-5" />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{t('Side card')}</p>
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {firstSideCardSlide
                    ? firstSideCardSlide.type === 'video'
                      ? firstSideCardSlide.videoUrl || t('Video slide')
                      : firstSideCardSlide.type === 'image'
                        ? firstSideCardSlide.ctaLabel || t('Image side card')
                        : firstSideCardSlide.title || firstSideCardSlide.text
                    : t('Side card')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('{count} active slides', { count: String(activeSideCardSlides.length) })}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setSideCardDialogOpen(true)}
              disabled={disabled}
              aria-label={t('Side card')}
            >
              <SettingsIcon className="size-4" />
            </Button>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Label>{t('Featured markets')}</Label>
              <p className="text-sm text-muted-foreground">
                {t('Manual order is respected first. AI picks can fill empty slots when enabled.')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSelectionDialogOpen(true)}
                disabled={disabled || featuredEvents.length >= 8}
              >
                <PlusIcon className="size-4" />
                {t('Add market')}
              </Button>
              <Button type="button" variant="outline" onClick={regenerateFeaturedMarkets} disabled={disabled || !useAi}>
                {isRegenerating ? <Spinner className="size-4" /> : <SparklesIcon className="size-4" />}
                {t('Regenerate')}
              </Button>
            </div>
          </div>

          {featuredEvents.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t('No featured markets selected yet.')}
            </div>
          ) : (
            <div className="grid gap-2">
              {featuredEvents.map((item, index) => (
                <HomeFeaturedEventRow
                  key={`${buildFeaturedKey(item)}:${index}`}
                  item={item}
                  index={index}
                  disabled={disabled}
                  isFirst={index === 0}
                  isLast={index === featuredEvents.length - 1}
                  onMove={(targetIndex, direction) =>
                    onFeaturedEventsChange((previous) => moveItem(previous, targetIndex, direction))
                  }
                  onRemove={(targetIndex) =>
                    onFeaturedEventsChange((previous) =>
                      previous.filter((_, currentIndex) => currentIndex !== targetIndex),
                    )
                  }
                  onManageContext={setManageContextIndex}
                  onContextModeChange={(targetIndex, mode) =>
                    updateItem(targetIndex, (current) => ({ ...current, contextMode: mode }))
                  }
                  onEnabledChange={(targetIndex, nextEnabled) =>
                    updateItem(targetIndex, (current) => ({ ...current, enabled: nextEnabled }))
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <HomeFeaturedSelectionDialog
        isMobile={isMobile}
        locale={locale}
        open={selectionDialogOpen}
        disabled={disabled}
        selectedItems={featuredEvents}
        onOpenChange={setSelectionDialogOpen}
        onAddCandidate={addCandidate}
      />

      <HomeFeaturedSettingsDialog
        isMobile={isMobile}
        open={settingsDialogOpen}
        disabled={disabled}
        useAi={useAi}
        maxCards={maxCards}
        defaultContextMode={defaultContextMode}
        newsSources={newsSources}
        commentBlacklist={commentBlacklist}
        minVolume24h={minVolume24h}
        includeSportsToday={includeSportsToday}
        includeNewEvents={includeNewEvents}
        onOpenChange={setSettingsDialogOpen}
        onMaxCardsChange={onMaxCardsChange}
        onDefaultContextModeChange={onDefaultContextModeChange}
        onNewsSourcesChange={onNewsSourcesChange}
        onCommentBlacklistChange={onCommentBlacklistChange}
        onMinVolume24hChange={onMinVolume24hChange}
        onIncludeSportsTodayChange={onIncludeSportsTodayChange}
        onIncludeNewEventsChange={onIncludeNewEventsChange}
      />

      <HomeFeaturedSideCardCarouselDialog
        isMobile={isMobile}
        open={sideCardDialogOpen}
        disabled={disabled}
        sideCard={sideCard}
        imagePreviewUrls={sideCardImagePreviewUrls}
        processingImageIds={processingSideCardImageIds}
        onOpenChange={setSideCardDialogOpen}
        onSideCardChange={onSideCardChange}
        onImageChange={onSideCardImageChange}
      />

      <HomeFeaturedContextDialog
        locale={locale}
        isMobile={isMobile}
        key={
          manageContextItem
            ? `${buildFeaturedKey(manageContextItem)}:${manageContextItem.slug ?? ''}`
            : 'home-featured-context-dialog'
        }
        open={manageContextIndex != null}
        disabled={disabled}
        item={manageContextItem}
        newsSources={newsSources}
        onOpenChange={(open) => setManageContextIndex(open ? manageContextIndex : null)}
        onSave={(updates) =>
          manageContextIndex != null &&
          updateItem(manageContextIndex, (current) => ({
            ...current,
            contextItems: updates.contextItems,
          }))
        }
      />
    </SettingsAccordionSection>
  )
}
