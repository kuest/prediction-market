export const HOME_INITIAL_EVENTS_CACHE_LIFE = {
  stale: 900,
  revalidate: 900,
  expire: 31_536_000,
} as const

const HOME_INITIAL_EVENTS_TIMESTAMP_BUCKET_MS = 900_000

export function getHomeInitialCurrentTimestamp() {
  return Math.floor(Date.now() / HOME_INITIAL_EVENTS_TIMESTAMP_BUCKET_MS) * HOME_INITIAL_EVENTS_TIMESTAMP_BUCKET_MS
}
