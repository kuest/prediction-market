import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { cacheTags } from '@/lib/cache-tags'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  getCurrentUser: mock(),
  updateTagById: mock(),
  revalidatePath: mock(),
  updateTag: mock(),
}))

void mock.module('next/cache', () => ({ revalidatePath: mocks.revalidatePath, updateTag: mocks.updateTag }))
void mock.module('@/lib/db/queries/tag', () => ({ TagRepository: { updateTagById: mocks.updateTagById } }))
void mock.module('@/lib/db/queries/user', () => ({ UserRepository: { getCurrentUser: mocks.getCurrentUser } }))

const { updateCategoryAction } = await import('@/app/[locale]/admin/categories/_actions/update-category')

describe('category changes and shared series visibility', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => fn.mockReset())
    mocks.getCurrentUser.mockResolvedValue({ id: 'admin-1', is_admin: true })
    mocks.updateTagById.mockResolvedValue({ data: { id: 1, slug: 'crypto' }, error: null })
  })

  it.each([true, false])('invalidates series when hide_events changes to %s', async (hideEvents) => {
    expect((await updateCategoryAction(1, { hide_events: hideEvents })).success).toBe(true)
    expect(mocks.updateTag).toHaveBeenCalledWith(cacheTags.seriesEventsVisibility)
  })

  it('keeps shared series warm when only the category note changes', async () => {
    expect((await updateCategoryAction(1, { event_page_note: 'Market information' })).success).toBe(true)
    expect(mocks.updateTag).toHaveBeenCalledWith(cacheTags.eventsList)
    expect(mocks.updateTag).not.toHaveBeenCalledWith(cacheTags.seriesEventsVisibility)
  })
})
