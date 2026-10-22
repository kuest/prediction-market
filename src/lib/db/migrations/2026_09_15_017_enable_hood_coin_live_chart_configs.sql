-- Migration 016 initially staged HOOD and COIN disabled. Enable only those
-- exact Polymarket equity subscriptions after price-reference is deployed.
UPDATE public.event_live_chart_configs
SET enabled = TRUE
WHERE (series_slug = 'hood-daily-up-or-down' AND symbol = 'HOOD'
       OR series_slug = 'coin-daily-up-or-down' AND symbol = 'COIN')
  AND topic = 'equity_prices'
  AND event_type = 'update'
  AND enabled IS DISTINCT FROM TRUE;
