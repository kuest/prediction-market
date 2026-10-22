import { NextResponse } from 'next/server'

import { resolvePublicRuntimeEnv } from '@/lib/public-runtime-config.shared'

type Interval = '5m' | '15m' | '1h' | '4h' | '1d'
type Source = 'binance' | 'chainlink' | 'pyth'

interface SeriesMapItem {
  series_slug: string
  instrument: string
  interval: Interval
  source: Source
  display_name: string
  display_symbol: string
}

interface PriceReferenceSeriesMapResponse {
  series?: SeriesMapItem[]
}

interface PriceReferenceLastFinal {
  window_start_ms: number
  window_end_ms: number
  price: number
  source: Source
  source_timestamp_ms: number
  source_ref: string | null
  status: string
}

interface PriceReferenceNextWindow {
  window_start_ms: number
  window_end_ms: number
  opening_reference_price: number
}

interface PriceReferenceLatestMarket {
  instrument: string
  interval: Interval
  source: Source
  display_name: string
  display_symbol: string
  last_final: PriceReferenceLastFinal | null
  next_window: PriceReferenceNextWindow | null
}

interface PriceReferenceLatestResponse {
  markets?: PriceReferenceLatestMarket[]
}

interface PriceReferenceHistoryRow {
  instrument: string
  interval: Interval
  window_start_ms: number
  window_end_ms: number
  settlement_price: number
  source: Source
  source_timestamp_ms: number
  source_ref: string | null
  status: string
}

interface PriceReferenceHistoryResponse {
  rows?: PriceReferenceHistoryRow[]
}

const SERIES_MAP_TTL_MS = 5 * 60 * 1000

let seriesMapBySlugCache = new Map<string, SeriesMapItem>()
let seriesMapCachedAtMs = 0
let seriesMapCachedBaseUrl = ''

function intervalToMs(interval: Interval) {
  switch (interval) {
    case '5m':
      return 5 * 60 * 1000
    case '15m':
      return 15 * 60 * 1000
    case '1h':
      return 60 * 60 * 1000
    case '4h':
      return 4 * 60 * 60 * 1000
    case '1d':
      return 24 * 60 * 60 * 1000
  }
}

function alignWindowEnd(timestampMs: number, intervalMs: number) {
  return Math.floor(timestampMs / intervalMs) * intervalMs
}

function toFiniteNumber(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function toPositiveInteger(value: string) {
  const numeric = Number.parseInt(value, 10)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null
  }
  return numeric
}

function selectMostRecentRowAtOrBefore(rows: PriceReferenceHistoryRow[], targetMs: number) {
  return rows.find((row) => row.window_end_ms <= targetMs) ?? null
}

function selectClosingRow(
  rows: PriceReferenceHistoryRow[],
  targetMs: number,
  source: Source,
  interval: Interval,
  seriesSlug: string,
) {
  if (interval === '1d' && (source === 'binance' || seriesSlug === 'gold-daily-up-or-down')) {
    return rows.find((row) => row.window_end_ms === targetMs) ?? null
  }

  return selectMostRecentRowAtOrBefore(rows, targetMs)
}

function sortAndFilterHistoryRows(
  rows: PriceReferenceHistoryRow[] | undefined,
  instrument: string,
  interval: Interval,
  source: Source,
) {
  return (rows ?? [])
    .filter((row) => row.instrument === instrument && row.interval === interval && row.source === source)
    .slice()
    .sort((a, b) => b.window_end_ms - a.window_end_ms)
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`price-reference request failed: ${response.status} ${url}`)
  }

  return response.json() as Promise<T>
}

async function getSeriesMapBySlug() {
  const { priceReferenceUrl } = resolvePublicRuntimeEnv(process.env)
  const nowMs = Date.now()
  if (
    seriesMapCachedBaseUrl === priceReferenceUrl &&
    nowMs - seriesMapCachedAtMs < SERIES_MAP_TTL_MS &&
    seriesMapBySlugCache.size > 0
  ) {
    return seriesMapBySlugCache
  }

  const payload = await fetchJson<PriceReferenceSeriesMapResponse>(`${priceReferenceUrl}/series-map`)
  const nextCache = new Map<string, SeriesMapItem>()

  for (const item of payload.series ?? []) {
    const slug = item.series_slug?.trim().toLowerCase()
    if (!slug) {
      continue
    }
    nextCache.set(slug, item)
  }

  seriesMapBySlugCache = nextCache
  seriesMapCachedAtMs = nowMs
  seriesMapCachedBaseUrl = priceReferenceUrl

  return seriesMapBySlugCache
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const seriesSlugParam = searchParams.get('seriesSlug')?.trim() ?? ''
  const eventSlugParam = searchParams.get('eventSlug')?.trim().toLowerCase() ?? ''
  const eventStartMsParam = searchParams.get('eventStartMs')?.trim() ?? ''
  const eventEndMsParam = searchParams.get('eventEndMs')?.trim() ?? ''
  const activeWindowMinutesParam = searchParams.get('activeWindowMinutes')?.trim() ?? ''

  if (!seriesSlugParam) {
    return NextResponse.json({ error: 'seriesSlug is required' }, { status: 400 })
  }

  const eventEndMs = Number.parseInt(eventEndMsParam, 10)
  if (!Number.isFinite(eventEndMs) || eventEndMs <= 0) {
    return NextResponse.json(
      { error: 'eventEndMs is required and must be a positive unix millisecond timestamp' },
      { status: 400 },
    )
  }

  try {
    const normalizedSeriesSlug = seriesSlugParam.toLowerCase()
    const seriesMapBySlug = await getSeriesMapBySlug()
    const seriesEntry = seriesMapBySlug.get(normalizedSeriesSlug)

    if (!seriesEntry) {
      return NextResponse.json(
        { error: `series_slug not configured in price-reference: ${normalizedSeriesSlug}` },
        { status: 404 },
      )
    }

    const intervalMs = intervalToMs(seriesEntry.interval)
    const defaultActiveWindowMinutes = Math.round(intervalMs / (60 * 1000))
    const activeWindowMinutes = toPositiveInteger(activeWindowMinutesParam) ?? defaultActiveWindowMinutes
    const activeWindowMs = activeWindowMinutes * 60 * 1000

    const explicitEventStartMs = Number.parseInt(eventStartMsParam, 10)
    const hasValidExplicitStart =
      Number.isFinite(explicitEventStartMs) && explicitEventStartMs > 0 && explicitEventStartMs < eventEndMs
    // Prefer explicit event start when provided, fallback to countdown-derived window.
    const eventWindowStartMs = hasValidExplicitStart ? explicitEventStartMs : Math.max(0, eventEndMs - activeWindowMs)
    const eventWindowEndMs = eventEndMs
    const isEventClosed = Date.now() >= eventEndMs
    // Daily markets should use a finer candle for "start of window" so baseline matches real market time.
    const openingPreferredInterval: Interval = seriesEntry.interval === '1d' ? '5m' : seriesEntry.interval
    const openingPreferredIntervalMs = intervalToMs(openingPreferredInterval)
    const openingHistoryTargetMs = alignWindowEnd(eventWindowStartMs, openingPreferredIntervalMs)
    const closingHistoryTargetMs = alignWindowEnd(eventWindowEndMs, intervalMs)
    const shouldFetchOpeningFallback = openingPreferredInterval !== seriesEntry.interval
    const openingFallbackTargetMs = shouldFetchOpeningFallback
      ? alignWindowEnd(eventWindowStartMs, intervalMs)
      : openingHistoryTargetMs

    const openingHistoryParams = new URLSearchParams({
      instrument: seriesEntry.instrument,
      interval: openingPreferredInterval,
      from: String(Math.max(0, openingHistoryTargetMs - openingPreferredIntervalMs * 24)),
      to: String(openingHistoryTargetMs),
      limit: '96',
    })

    const openingFallbackParams = new URLSearchParams({
      instrument: seriesEntry.instrument,
      interval: seriesEntry.interval,
      from: String(Math.max(0, openingFallbackTargetMs - intervalMs * 6)),
      to: String(openingFallbackTargetMs),
      limit: '24',
    })

    const closingHistoryParams = new URLSearchParams({
      instrument: seriesEntry.instrument,
      interval: seriesEntry.interval,
      from: String(Math.max(0, closingHistoryTargetMs - intervalMs * 4)),
      to: String(closingHistoryTargetMs),
      limit: '16',
    })
    const chartHistoryInterval: Interval = '5m'
    const chartHistoryIntervalMs = intervalToMs(chartHistoryInterval)
    const chartHistoryParams = new URLSearchParams({
      instrument: seriesEntry.instrument,
      interval: chartHistoryInterval,
      from: String(eventWindowStartMs),
      to: String(eventWindowEndMs),
      limit: String(Math.min(1000, Math.max(2, Math.ceil(activeWindowMs / chartHistoryIntervalMs) + 2))),
    })
    const { priceReferenceUrl } = resolvePublicRuntimeEnv(process.env)

    const [latestPayload, openingHistoryPayload, closingHistoryPayload, openingFallbackPayload, chartHistoryPayload] =
      await Promise.all([
        fetchJson<PriceReferenceLatestResponse>(`${priceReferenceUrl}/marks/latest`),
        fetchJson<PriceReferenceHistoryResponse>(
          `${priceReferenceUrl}/marks/history?${openingHistoryParams.toString()}`,
        ),
        fetchJson<PriceReferenceHistoryResponse>(
          `${priceReferenceUrl}/marks/history?${closingHistoryParams.toString()}`,
        ),
        shouldFetchOpeningFallback
          ? fetchJson<PriceReferenceHistoryResponse>(
              `${priceReferenceUrl}/marks/history?${openingFallbackParams.toString()}`,
            )
          : Promise.resolve<PriceReferenceHistoryResponse>({ rows: [] }),
        isEventClosed
          ? fetchJson<PriceReferenceHistoryResponse>(
              `${priceReferenceUrl}/marks/history?${chartHistoryParams.toString()}`,
            )
          : Promise.resolve<PriceReferenceHistoryResponse>({ rows: [] }),
      ])

    const latestMarket = (latestPayload.markets ?? []).find(
      (market) =>
        market.instrument === seriesEntry.instrument &&
        market.interval === seriesEntry.interval &&
        market.source === seriesEntry.source,
    )
    const latestOpeningMarket = (latestPayload.markets ?? []).find(
      (market) =>
        market.instrument === seriesEntry.instrument &&
        market.interval === openingPreferredInterval &&
        market.source === seriesEntry.source,
    )

    const openingHistoryRows = sortAndFilterHistoryRows(
      openingHistoryPayload.rows,
      seriesEntry.instrument,
      openingPreferredInterval,
      seriesEntry.source,
    )
    const openingFallbackRows = sortAndFilterHistoryRows(
      openingFallbackPayload.rows,
      seriesEntry.instrument,
      seriesEntry.interval,
      seriesEntry.source,
    )
    const closingHistoryRows = sortAndFilterHistoryRows(
      closingHistoryPayload.rows,
      seriesEntry.instrument,
      seriesEntry.interval,
      seriesEntry.source,
    )
    const chartHistoryRows = sortAndFilterHistoryRows(
      chartHistoryPayload.rows,
      seriesEntry.instrument,
      chartHistoryInterval,
      seriesEntry.source,
    )

    const isGoldDailySeries = normalizedSeriesSlug === 'gold-daily-up-or-down'
    const isEventBoundEquity =
      normalizedSeriesSlug === 'hood-daily-up-or-down' || normalizedSeriesSlug === 'coin-daily-up-or-down'
    const openingRow = isEventBoundEquity
      ? (openingFallbackRows.find((row) => row.source_ref === `polymarket-price-to-beat:${eventSlugParam}`) ?? null)
      : isGoldDailySeries
        ? (openingFallbackRows.find((row) => row.source_timestamp_ms < eventWindowStartMs) ?? null)
        : (openingHistoryRows.find((row) => row.window_end_ms === openingHistoryTargetMs) ??
          openingFallbackRows.find((row) => row.window_end_ms === openingFallbackTargetMs) ??
          null)
    const windowRow = isEventBoundEquity
      ? (closingHistoryRows.find(
          (row) =>
            row.source_ref?.startsWith('polymarket-price-to-beat:') &&
            Math.abs(row.source_timestamp_ms - eventWindowEndMs) <= 5 * 60 * 1000,
        ) ?? null)
      : selectClosingRow(
          closingHistoryRows,
          closingHistoryTargetMs,
          seriesEntry.source,
          seriesEntry.interval,
          normalizedSeriesSlug,
        )

    const openingFromHistory = toFiniteNumber(openingRow?.settlement_price)
    const openingFromLatestPreferred = (() => {
      if (!latestOpeningMarket?.next_window) {
        return null
      }
      if (
        eventWindowStartMs >= latestOpeningMarket.next_window.window_start_ms &&
        eventWindowStartMs < latestOpeningMarket.next_window.window_end_ms
      ) {
        return toFiniteNumber(latestOpeningMarket.next_window.opening_reference_price)
      }
      return null
    })()
    const openingFromLatestFallback = (() => {
      if (!latestMarket?.next_window) {
        return null
      }
      if (
        eventWindowStartMs >= latestMarket.next_window.window_start_ms &&
        eventWindowStartMs < latestMarket.next_window.window_end_ms
      ) {
        return toFiniteNumber(latestMarket.next_window.opening_reference_price)
      }
      return null
    })()

    const openingPrice =
      isGoldDailySeries || isEventBoundEquity
        ? openingFromHistory
        : (openingFromHistory ?? openingFromLatestPreferred ?? openingFromLatestFallback)
    const closingPrice = toFiniteNumber(windowRow?.settlement_price)
    const latestRow =
      isEventBoundEquity && (isEventClosed || latestMarket?.last_final?.source_ref !== openingRow?.source_ref)
        ? null
        : latestMarket?.last_final
    const latestPrice = toFiniteNumber(latestRow?.price)
    const latestWindowEndMs = toFiniteNumber(latestRow?.window_end_ms)
    const latestSourceTimestampMs = toFiniteNumber(latestRow?.source_timestamp_ms)
    const priceHistory = chartHistoryRows
      .filter((row) => row.window_end_ms > eventWindowStartMs && row.window_end_ms < eventWindowEndMs)
      .map((row) => ({
        timestamp_ms: row.window_end_ms,
        price: row.settlement_price,
      }))
      .reverse()

    return NextResponse.json({
      series_slug: seriesEntry.series_slug,
      instrument: seriesEntry.instrument,
      interval: seriesEntry.interval,
      source: seriesEntry.source,
      interval_ms: intervalMs,
      active_window_minutes: activeWindowMinutes,
      event_window_start_ms: eventWindowStartMs,
      event_window_end_ms: eventWindowEndMs,
      opening_price: openingPrice,
      closing_price: closingPrice,
      latest_price: latestPrice,
      latest_window_end_ms: latestWindowEndMs,
      latest_source_timestamp_ms: latestSourceTimestampMs,
      price_history: priceHistory,
      is_event_closed: isEventClosed,
    })
  } catch (error) {
    console.error('Failed to build live-series price snapshot', error)
    return NextResponse.json({ error: 'Failed to load price reference snapshot' }, { status: 500 })
  }
}
