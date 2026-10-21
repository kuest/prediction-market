INSERT INTO public.event_live_chart_configs (
  series_slug,
  topic,
  event_type,
  symbol,
  display_name,
  display_symbol,
  line_color,
  icon_path,
  enabled,
  show_price_decimals,
  active_window_minutes
)
VALUES (
  'gold-daily-up-or-down',
  'equity_prices',
  'update',
  'XAUUSD',
  'Gold',
  'XAUUSD',
  '#FFD700',
  '/images/live-assets/gold-radio.svg',
  false,
  true,
  450
)
ON CONFLICT (series_slug) DO NOTHING;
