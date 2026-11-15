import { describe, expect, it, mock } from 'bun:test'

import { SUPPORTED_LOCALES } from '@/i18n/locales'
import { cacheTags } from '@/lib/cache-tags'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  getCurrentUser: mock(),
  revalidatePath: mock(),
  setEventHiddenState: mock(),
  updateTag: mock(),
}))

void mock.module('next/cache', () => ({
  revalidatePath: (...args: any[]) => mocks.revalidatePath(...args),
  updateTag: (...args: any[]) => mocks.updateTag(...args),
}))

void mock.module('@/lib/db/queries/event', () => ({
  EventRepository: {
    setEventHiddenState: (...args: any[]) => mocks.setEventHiddenState(...args),
  },
}))

void mock.module('@/lib/db/queries/user', () => ({
  UserRepository: {
    getCurrentUser: (...args: any[]) => mocks.getCurrentUser(...args),
  },
}))

const { updateEventVisibilityAction } = await import('@/app/[locale]/admin/events/_actions/update-event-visibility')

describe('updateEventVisibilityAction', () => {
  it('invalidates public event and navigation caches after a visibility change', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce({ id: 'admin-1', is_admin: true })
    mocks.setEventHiddenState.mockResolvedValueOnce({
      data: {
        id: 'event-1',
        slug: 'finance-event',
        is_hidden: true,
      },
      error: null,
    })

    const result = await updateEventVisibilityAction('event-1', true)

    expect(result).toEqual({
      success: true,
      data: {
        id: 'event-1',
        slug: 'finance-event',
        is_hidden: true,
      },
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/[locale]/admin/events', 'page')
    expect(mocks.updateTag).toHaveBeenCalledWith(cacheTags.eventsList)
    expect(mocks.updateTag).toHaveBeenCalledWith(cacheTags.seriesEventsVisibility)
    expect(mocks.updateTag).toHaveBeenCalledWith(cacheTags.event('finance-event'))

    for (const locale of SUPPORTED_LOCALES) {
      expect(mocks.updateTag).toHaveBeenCalledWith(cacheTags.mainTags(locale))
    }
  })
})
