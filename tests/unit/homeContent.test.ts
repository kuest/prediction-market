import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import * as actualNextCache from 'next/cache'

import { hoisted, useRealTimers } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  listHomeEventsPage: mock(),
}))

void mock.module('@/lib/home-events-page', () => ({
  listHomeEventsPage: (...args: any[]) => mocks.listHomeEventsPage(...args),
}))

void mock.module('@/lib/home-featured-events', () => ({
  getHomeFeaturedSideCard: mock().mockResolvedValue({ slides: [] }),
  listHomeFeaturedEvents: mock().mockResolvedValue([]),
  listHomeFeaturedHotTopics: mock().mockResolvedValue([]),
}))

void mock.module('next/cache', () => {
  return {
    ...actualNextCache,
    cacheLife: mock(),
    cacheTag: mock(),
  }
})

void mock.module('@/app/[locale]/(platform)/(home)/_components/HomeClient', () => ({
  default: () => null,
}))

describe('homeContent', () => {
  beforeEach(() => {
    mocks.listHomeEventsPage.mockReset()
  })

  afterEach(() => {
    useRealTimers()
  })

  it('uses the route main tag when fetching initial subcategory events without loading footer events', async () => {
    const currentTimestamp = Date.parse('2026-05-11T12:30:00.000Z')
    mocks.listHomeEventsPage.mockResolvedValue({ data: [], error: null })

    const HomeContent = (await import('@/app/[locale]/(platform)/(home)/_components/HomeContent')).default
    await HomeContent({
      initialTag: 'ai',
      initialMainTag: 'tech',
      currentTimestamp,
    })

    expect(mocks.listHomeEventsPage).toHaveBeenCalledTimes(1)
    expect(mocks.listHomeEventsPage).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: 'ai',
        mainTag: 'tech',
        locale: 'en',
        currentTimestamp,
        cardPayload: true,
      }),
    )
  })

  it('uses the provided current timestamp for initial home events', async () => {
    const currentTimestamp = Date.parse('2026-05-11T12:34:00.000Z')
    mocks.listHomeEventsPage.mockResolvedValueOnce({ data: [], error: null, currentTimestamp })

    const HomeContent = (await import('@/app/[locale]/(platform)/(home)/_components/HomeContent')).default
    await HomeContent({
      currentTimestamp,
    })

    expect(mocks.listHomeEventsPage).toHaveBeenCalledWith(
      expect.objectContaining({
        currentTimestamp,
      }),
    )
  })

  it('omits sortBy for the new route so repository keeps newest-first default', async () => {
    mocks.listHomeEventsPage.mockResolvedValueOnce({ data: [], error: null })

    const HomeContent = (await import('@/app/[locale]/(platform)/(home)/_components/HomeContent')).default
    await HomeContent({
      initialTag: 'new',
      currentTimestamp: Date.parse('2026-05-11T12:30:00.000Z'),
    })

    expect(mocks.listHomeEventsPage).toHaveBeenCalledWith(
      expect.not.objectContaining({
        sortBy: expect.anything(),
      }),
    )
  })
})
