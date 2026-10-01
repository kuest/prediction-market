/**
 * Central registry of cache tags used with `cacheTag()` and `revalidateTag()`.
 *
 * Each tag must represent a single logical concern. Sharing one tag across
 * unrelated cache surfaces causes invalidation fan-out: invalidating the tag
 * for one concern wipes every other surface that happens to be tagged the
 * same. Keep tags scoped to the data they describe.
 */
export const cacheTags = {
  /** Per-user notifications inbox. */
  notifications: (key: string) => `notifications:${key}`,
  /** Per-event public activity feed. */
  activity: (key: string) => `activity:${key}`,
  /** Per-condition holders list. */
  holders: (key: string) => `holders:${key}`,
  /** Per-user event lists (favorites, etc). */
  events: (key: string) => `events:${key}`,
  /** Public event listing surfaces (homepage grid, market-slug routing list). */
  eventsList: 'events:list',
  /** Public home featured markets carousel and admin featured settings. */
  homeFeaturedEvents: 'home:featured-events',
  /** Per-event content surfaces (page data, title, route resolution). */
  event: (key: string) => `event:${key}`,
  /** Series event navigation and live-series pill data. */
  seriesEvents: (key: string) => `series-events:${key.trim()}`,
  /** Admin categories table. */
  adminCategories: 'admin:categories',
  /** Per-locale main navigation tags. */
  mainTags: (locale: string) => `main-tags:${locale}`,
  /** Site settings (admin-edited identity, branding, integrations). */
  settings: 'settings',
  /** Localized Terms of Use content. */
  termsOfService: 'terms-of-service',
  /** Sports pages whose output includes menu and event-derived data. */
  sportsMenu: 'sports:menu',
  /** Stable sports menu structure: labels, aliases, titles and routing. */
  sportsMenuStructure: 'sports:menu:structure',
  /** Public sitemap entries (event/market URL lists). */
  sitemap: 'sitemap',
}
