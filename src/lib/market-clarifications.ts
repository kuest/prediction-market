export interface VisibleMarketClarification {
  id: number | string
  source?: 'kuest' | 'polymarket'
  content: string
  state: 'success'
  showInFrontend: true
  txTimestamp: string | null
  createdAt: string | null
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function parseObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function normalizeVisibleMarketClarifications(value: unknown): VisibleMarketClarification[] {
  if (!Array.isArray(value)) {
    return []
  }

  const unique = new Map<string, VisibleMarketClarification>()
  for (const item of value) {
    const note = parseObject(item)
    if (!note || note.state !== 'success' || note.showInFrontend !== true || typeof note.content !== 'string') {
      continue
    }
    const { id } = note
    if (!((typeof id === 'number' && Number.isSafeInteger(id)) || (typeof id === 'string' && id.trim()))) {
      continue
    }
    const content = note.content.trim()
    if (!content) {
      continue
    }
    const source = note.source === 'kuest' || note.source === 'polymarket' ? note.source : undefined
    const key = `${source ?? 'polymarket'}:${id}`
    if (!unique.has(key)) {
      unique.set(key, {
        id,
        ...(source && { source }),
        content,
        state: 'success',
        showInFrontend: true,
        txTimestamp: isoTimestamp(note.txTimestamp),
        createdAt: isoTimestamp(note.createdAt),
      })
    }
  }
  return Array.from(unique.values())
}

export function readVisibleMarketClarifications(metadata: unknown): VisibleMarketClarification[] {
  if (typeof metadata === 'string') {
    try {
      return normalizeVisibleMarketClarifications(parseObject(JSON.parse(metadata))?.market_clarifications)
    } catch {
      return []
    }
  }
  return normalizeVisibleMarketClarifications(parseObject(metadata)?.market_clarifications)
}
