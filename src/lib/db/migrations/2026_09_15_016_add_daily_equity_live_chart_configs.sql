-- Daily single-market Up/Down series. HOOD and COIN are staged disabled until
-- their price-reference mappings exist. Existing operator-managed rows are left unchanged.
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
VALUES
  ('aapl-daily-up-down', 'equity_prices', 'update', 'AAPL', 'Apple', 'AAPL', '#555555', '/images/live-assets/aapl.svg', true, true, 390),
  ('amzn-daily-up-down', 'equity_prices', 'update', 'AMZN', 'Amazon', 'AMZN', '#FF9900', '/images/live-assets/amzn.svg', true, true, 390),
  ('coin-daily-up-or-down', 'equity_prices', 'update', 'COIN', 'Coinbase', 'COIN', '#0052FF', '/images/live-assets/coin.svg', false, true, 390),
  ('googl-daily-up-down', 'equity_prices', 'update', 'GOOGL', 'Google', 'GOOGL', '#4285F4', '/images/live-assets/googl.svg', true, true, 390),
  ('hood-daily-up-or-down', 'equity_prices', 'update', 'HOOD', 'Robinhood', 'HOOD', '#00C805', '/images/live-assets/hood.svg', false, true, 390),
  ('meta-daily-up-down', 'equity_prices', 'update', 'META', 'Meta', 'META', '#0866FF', '/images/live-assets/meta.svg', true, true, 390),
  ('msft-daily-up-down', 'equity_prices', 'update', 'MSFT', 'Microsoft', 'MSFT', '#0078D4', '/images/live-assets/msft.svg', true, true, 390),
  ('nvda-daily-up-down', 'equity_prices', 'update', 'NVDA', 'NVIDIA', 'NVDA', '#76B900', '/images/live-assets/nvda.svg', true, true, 390),
  ('nflx-daily-up-or-down', 'equity_prices', 'update', 'NFLX', 'Netflix', 'NFLX', '#E50914', '/images/live-assets/nflx.svg', true, true, 390),
  ('pltr-daily-up-or-down', 'equity_prices', 'update', 'PLTR', 'Palantir', 'PLTR', '#000000', '/images/live-assets/pltr.svg', true, true, 390),
  ('open-daily-up-or-down', 'equity_prices', 'update', 'OPEN', 'Opendoor', 'OPEN', '#006AFF', '/images/live-assets/open.svg', true, true, 390),
  ('rklb-daily-up-or-down', 'equity_prices', 'update', 'RKLB', 'Rocket Lab', 'RKLB', '#000000', '/images/live-assets/rklb.svg', true, true, 390),
  ('tsla-daily-up-down', 'equity_prices', 'update', 'TSLA', 'Tesla', 'TSLA', '#CC0000', '/images/live-assets/tsla.svg', true, true, 390),
  ('abnb-daily-up-or-down', 'equity_prices', 'update', 'ABNB', 'Airbnb', 'ABNB', '#FF5A5F', '/images/live-assets/abnb.svg', true, true, 390),
  ('gold-daily-up-or-down', 'equity_prices', 'update', 'XAUUSD', 'Gold', 'XAUUSD', '#FFD700', '/images/live-assets/gold-radio.svg', true, true, 450)
ON CONFLICT (series_slug) DO NOTHING;
