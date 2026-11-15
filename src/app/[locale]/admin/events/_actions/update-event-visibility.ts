'use server'

import { revalidatePath, updateTag } from 'next/cache'

import { SUPPORTED_LOCALES } from '@/i18n/locales'
import { cacheTags } from '@/lib/cache-tags'
import { EventRepository } from '@/lib/db/queries/event'
import { UserRepository } from '@/lib/db/queries/user'

export interface UpdateEventVisibilityResult {
  success: boolean
  data?: {
    id: string
    slug: string
    is_hidden: boolean
  }
  error?: string
}

export async function updateEventVisibilityAction(
  eventId: string,
  isHidden: boolean,
): Promise<UpdateEventVisibilityResult> {
  try {
    const currentUser = await UserRepository.getCurrentUser({ minimal: true })
    if (!currentUser || !currentUser.is_admin) {
      return {
        success: false,
        error: 'Unauthorized. Admin access required.',
      }
    }

    const { data, error } = await EventRepository.setEventHiddenState(eventId, isHidden)
    if (error || !data) {
      return {
        success: false,
        error: error ?? 'Failed to update event visibility.',
      }
    }

    revalidatePath('/[locale]/admin/events', 'page')
    updateTag(cacheTags.eventsList)
    updateTag(cacheTags.seriesEventsVisibility)
    updateTag(cacheTags.event(data.slug))
    updateTag(cacheTags.sportsMenu)
    updateTag(cacheTags.sitemap)
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
