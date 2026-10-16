import { describe, expect, it } from 'bun:test'

import { parseHomeFeaturedEventsPayload } from '@/lib/home-featured-admin'
import {
  getHomeFeaturedSettingsFromSettings,
  serializeHomeFeaturedSideCardSlides,
  validateHomeFeaturedSettingsInput,
} from '@/lib/home-featured-settings'

describe('home featured settings', () => {
  it('preserves five selected news articles when saving a featured market', () => {
    const contextItems = Array.from({ length: 6 }, (_, index) => ({
      type: 'news',
      source: 'Publisher',
      title: `Story ${index + 1}`,
      url: `https://example.com/story-${index + 1}`,
      locale: 'pt',
    }))
    const result = parseHomeFeaturedEventsPayload([
      {
        targetType: 'series',
        seriesSlug: 'daily-market',
        eventId: 'current-event',
        contextItems,
      },
    ])

    expect(result.error).toBeNull()
    expect(result.data?.[0]?.contextItems).toHaveLength(5)
    expect(result.data?.[0]?.contextItems?.[4]?.url).toBe(contextItems[4]!.url)
  })

  it('loads the side card image mode from key-value settings', () => {
    const settings = getHomeFeaturedSettingsFromSettings({
      home_featured: {
        side_card_use_image: { value: 'true', updated_at: '' },
        side_card_image_path: {
          value: 'home-featured/side-card-123-abc123.webp',
          updated_at: '',
        },
      },
    })

    expect(settings.sideCard).toMatchObject({
      useImage: true,
      imagePath: 'home-featured/side-card-123-abc123.webp',
      imageUrl: '',
    })
  })

  it('rejects arbitrary side card image paths', () => {
    const result = validateHomeFeaturedSettingsInput({
      enabled: 'true',
      useAi: 'false',
      maxCards: '6',
      defaultContextMode: 'auto',
      newsSources: '',
      commentBlacklist: '',
      minVolume24h: '0',
      includeSportsToday: 'true',
      includeNewEvents: 'true',
      sideCardUseImage: 'true',
      sideCardImagePath: 'https://example.com/untrusted.svg',
    })

    expect(result.data?.sideCard.imagePath).toBe('')
  })

  it.each(['jpg', 'png', 'webp'])('accepts a stored .%s side card path', (extension) => {
    const result = validateHomeFeaturedSettingsInput({
      enabled: 'true',
      useAi: 'false',
      maxCards: '6',
      defaultContextMode: 'auto',
      newsSources: '',
      commentBlacklist: '',
      minVolume24h: '0',
      includeSportsToday: 'true',
      includeNewEvents: 'true',
      sideCardUseImage: 'true',
      sideCardImagePath: `home-featured/side-card-123-abc123.${extension}`,
    })

    expect(result.data?.sideCard.imagePath).toBe(`home-featured/side-card-123-abc123.${extension}`)
  })

  it('loads ordered text, image, and video slides from the versioned setting', () => {
    const settings = getHomeFeaturedSettingsFromSettings({
      home_featured: {
        side_card_slides_v1: {
          value: JSON.stringify([
            { id: 'text-1', type: 'text', enabled: true, title: 'First', text: 'Text' },
            { id: 'image-1', type: 'image', enabled: false, imagePath: 'home-featured/side-card-123-abc123.webp' },
            { id: 'video-1', type: 'video', enabled: true, videoUrl: 'https://youtu.be/dQw4w9WgXcQ' },
          ]),
          updated_at: '',
        },
      },
    })

    expect(settings.sideCard.slides).toMatchObject([
      { id: 'text-1', type: 'text', enabled: true },
      { id: 'image-1', type: 'image', enabled: false, imagePath: 'home-featured/side-card-123-abc123.webp' },
      {
        id: 'video-1',
        type: 'video',
        enabled: true,
        videoEmbedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      },
    ])
  })

  it('uses the first enabled slide as the primary side card without re-enabling disabled slides', () => {
    const settings = getHomeFeaturedSettingsFromSettings({
      home_featured: {
        side_card_slides_v1: {
          value: JSON.stringify([
            {
              id: 'disabled-image',
              type: 'image',
              enabled: false,
              imagePath: 'home-featured/side-card-123-abc123.webp',
            },
            { id: 'active-text', type: 'text', enabled: true, title: 'Visible', text: 'Active slide' },
          ]),
          updated_at: '',
        },
      },
    })

    expect(settings.sideCard.id).toBe('active-text')
    expect(settings.sideCard.slides).toMatchObject([
      { id: 'disabled-image', enabled: false },
      { id: 'active-text', enabled: true },
    ])
  })

  it('keeps every slide disabled when the stored carousel has no active slides', () => {
    const settings = getHomeFeaturedSettingsFromSettings({
      home_featured: {
        side_card_slides_v1: {
          value: JSON.stringify([
            { id: 'disabled-text', type: 'text', enabled: false, title: 'Hidden', text: 'Hidden slide' },
            {
              id: 'disabled-image',
              type: 'image',
              enabled: false,
              imagePath: 'home-featured/side-card-123-abc123.webp',
            },
          ]),
          updated_at: '',
        },
      },
    })

    expect(settings.sideCard.enabled).toBe(false)
    expect(settings.sideCard.slides.every((slide) => !slide.enabled)).toBe(true)
  })

  it('rejects arbitrary iframe URLs and does not persist derived URLs', () => {
    const result = validateHomeFeaturedSettingsInput({
      enabled: 'true',
      useAi: 'false',
      maxCards: '6',
      defaultContextMode: 'auto',
      newsSources: '',
      commentBlacklist: '',
      minVolume24h: '0',
      includeSportsToday: 'true',
      includeNewEvents: 'true',
      sideCardSlidesJson: JSON.stringify([
        { id: 'video-1', type: 'video', enabled: true, videoUrl: 'https://example.com/embed/unsafe' },
      ]),
    })

    expect(result.data?.sideCard.slides[0]).toMatchObject({ videoUrl: '', videoEmbedUrl: '' })
    expect(serializeHomeFeaturedSideCardSlides(result.data?.sideCard.slides ?? [])).not.toContain('videoEmbedUrl')
  })
})
