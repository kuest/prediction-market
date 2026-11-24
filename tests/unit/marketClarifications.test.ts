import { describe, expect, it } from 'bun:test'

import { normalizeVisibleMarketClarifications, readVisibleMarketClarifications } from '@/lib/market-clarifications'

describe('market clarifications metadata', () => {
  const publicNote = {
    id: 10,
    state: 'success',
    showInFrontend: true,
    content: ' The source report must include the full month. ',
    txTimestamp: '2026-11-25T00:12:00Z',
    clearBook: true,
  }

  it('accepts only successful, explicitly visible notes and omits unrelated metadata', () => {
    const metadata = {
      market_clarifications: [
        { ...publicNote, id: 11, state: 'pending' },
        { ...publicNote, id: 12, showInFrontend: false },
        { ...publicNote, id: 13, showInFrontend: null },
        { ...publicNote, id: 14, content: '  ' },
        publicNote,
        { ...publicNote, content: 'duplicate' },
      ],
    }
    expect(readVisibleMarketClarifications(JSON.stringify(metadata))).toEqual([
      {
        id: 10,
        state: 'success',
        showInFrontend: true,
        content: 'The source report must include the full month.',
        txTimestamp: '2026-11-25T00:12:00.000Z',
        createdAt: null,
      },
    ])
  })

  it('keeps independent native and imported notes with the same identifier in their original order', () => {
    const notes = normalizeVisibleMarketClarifications([
      { ...publicNote, source: 'polymarket' },
      { ...publicNote, source: 'kuest', content: 'Clarification from Kuest.', txTimestamp: 'invalid' },
    ])
    expect(notes.map((note) => [note.source, note.content, note.txTimestamp])).toEqual([
      ['polymarket', 'The source report must include the full month.', '2026-11-25T00:12:00.000Z'],
      ['kuest', 'Clarification from Kuest.', null],
    ])
  })

  it('treats missing and malformed data as having no visible notes', () => {
    expect(readVisibleMarketClarifications('not json')).toEqual([])
    expect(readVisibleMarketClarifications(null)).toEqual([])
    expect(readVisibleMarketClarifications({ market_clarifications: {} })).toEqual([])
  })
})
