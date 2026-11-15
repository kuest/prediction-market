'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { z } from 'zod'

import type { NonDefaultLocale } from '@/i18n/locales'

import { SUPPORTED_LOCALES } from '@/i18n/locales'
import { cacheTags } from '@/lib/cache-tags'
import { TagRepository } from '@/lib/db/queries/tag'
import { UserRepository } from '@/lib/db/queries/user'

const UpdateCategoryInputSchema = z.object({
  is_main_category: z.boolean().optional(),
  is_hidden: z.boolean().optional(),
  hide_events: z.boolean().optional(),
  event_page_note: z.string().max(10_000).nullable().optional(),
})

export interface UpdateCategoryInput {
  is_main_category?: boolean
  is_hidden?: boolean
  hide_events?: boolean
  event_page_note?: string | null
}

export interface UpdateCategoryResult {
  success: boolean
  data?: {
    id: number
    name: string
    slug: string
    is_main_category: boolean
    is_hidden: boolean
    hide_events: boolean
    event_page_note: string | null
    display_order: number
    active_markets_count: number
    created_at: string
    updated_at: string
    translations: Partial<Record<NonDefaultLocale, string>>
  }
  error?: string
}

function containsHtmlTags(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(value)
}

export async function updateCategoryAction(
  categoryId: number,
  input: UpdateCategoryInput,
): Promise<UpdateCategoryResult> {
  try {
    const parsed = UpdateCategoryInputSchema.safeParse(input)
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? 'Invalid input.',
      }
    }

    const normalizedInput: UpdateCategoryInput = {
      ...parsed.data,
      event_page_note:
        parsed.data.event_page_note === undefined
          ? undefined
          : parsed.data.event_page_note?.trim()
            ? parsed.data.event_page_note.trim()
            : null,
    }

    if (typeof normalizedInput.event_page_note === 'string' && containsHtmlTags(normalizedInput.event_page_note)) {
      return {
        success: false,
        error: 'Event note must be plain text only.',
      }
    }

    const currentUser = await UserRepository.getCurrentUser({ minimal: true })
    if (!currentUser || !currentUser.is_admin) {
      return {
        success: false,
        error: 'Unauthorized. Admin access required.',
      }
    }

    const { data, error } = await TagRepository.updateTagById(categoryId, normalizedInput)

    if (error || !data) {
      console.error('Error updating category:', error)
      return {
        success: false,
        error: 'Failed to update category. Please try again.',
      }
    }

    revalidatePath('/[locale]/admin/categories', 'page')
    revalidatePath('/[locale]/event/[slug]', 'page')
    revalidatePath('/[locale]/event/[slug]/[market]', 'page')
    updateTag(cacheTags.adminCategories)
    updateTag(cacheTags.eventsList)
    if (normalizedInput.hide_events !== undefined) {
      updateTag(cacheTags.seriesEventsVisibility)
    }
    updateTag(cacheTags.events(currentUser.id))

    for (const locale of SUPPORTED_LOCALES) {
      updateTag(cacheTags.mainTags(locale))
    }

    return {
      success: true,
      data,
    }
  } catch (error) {
    console.error('Server action error:', error)
    return {
      success: false,
      error: 'Internal server error. Please try again.',
    }
  }
}
