-- Enable only the canonical daily HOOD and COIN live chart subscriptions.
UPDATE public.event_live_chart_configs
SET enabled = TRUE
WHERE (
    (series_slug = 'hood-daily-up-or-down' AND symbol = 'HOOD')
    OR (series_slug = 'coin-daily-up-or-down' AND symbol = 'COIN')
  )
  AND topic = 'equity_prices'
  AND event_type = 'update'
  AND active_window_minutes = 390
  AND enabled IS DISTINCT FROM TRUE;
