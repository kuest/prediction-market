CREATE INDEX IF NOT EXISTS idx_events_series_navigation
  ON public.events (series_slug, end_date DESC, created_at DESC);
