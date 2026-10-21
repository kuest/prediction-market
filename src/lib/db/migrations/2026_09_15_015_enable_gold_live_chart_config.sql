UPDATE public.event_live_chart_configs
SET enabled = true
WHERE series_slug = 'gold-daily-up-or-down'
  AND topic = 'equity_prices'
  AND symbol = 'XAUUSD';
