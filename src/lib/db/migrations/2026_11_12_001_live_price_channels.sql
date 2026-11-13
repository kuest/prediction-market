ALTER TABLE public.event_live_chart_configs ADD COLUMN provider text;
ALTER TABLE public.event_live_chart_configs ADD COLUMN window_seconds integer;
UPDATE public.event_live_chart_configs SET
  provider = CASE WHEN topic = 'equity_prices' THEN 'pyth' WHEN topic IN ('crypto_prices', 'crypto_prices_binance') THEN 'binance' WHEN topic LIKE 'crypto_prices%' THEN 'chainlink' ELSE NULL END,
  window_seconds = CASE WHEN topic = 'crypto_prices_twap_thirty' THEN 30 WHEN topic = 'crypto_prices_twap_sixty' THEN 60 ELSE NULL END,
  symbol = CASE WHEN topic LIKE 'crypto_prices%' THEN regexp_replace(regexp_replace(lower(symbol), '[^a-z0-9]', '', 'g'), 'usdt$', 'usd') ELSE symbol END,
  topic = CASE WHEN topic = 'equity_prices' THEN 'price.equity' WHEN topic IN ('crypto_prices_twap_thirty', 'crypto_prices_twap_sixty') THEN 'price.crypto.twap' WHEN topic LIKE 'crypto_prices%' THEN 'price.crypto' ELSE topic END;
UPDATE public.event_live_chart_configs SET topic = 'price.crypto.twap', provider = 'chainlink', window_seconds = 60
WHERE topic LIKE 'price.crypto%' AND (series_slug, active_window_minutes) IN (
  ('bnb-up-or-down-daily', 1440),
  ('bnb-up-or-down-5m', 5),
  ('bnb-up-or-down-15m', 15),
  ('bnb-up-or-down-hourly', 60),
  ('bnb-up-or-down-4h', 240),
  ('btc-up-or-down-4h', 240),
  ('bitcoin-up-or-down-4h', 240),
  ('btc-up-or-down-5m', 5),
  ('btc-up-or-down-15m', 15),
  ('btc-up-or-down-hourly', 60),
  ('btc-up-or-down-daily', 1440),
  ('doge-up-or-down-5m', 5),
  ('doge-up-or-down-15m', 15),
  ('doge-up-or-down-hourly', 60),
  ('doge-up-or-down-4h', 240),
  ('dogecoin-up-or-down-daily', 1440),
  ('eth-up-or-down-5m', 5),
  ('eth-up-or-down-15m', 15),
  ('eth-up-or-down-4h', 240),
  ('eth-up-or-down-hourly', 60),
  ('eth-up-or-down-daily', 1440),
  ('ethereum-up-or-down-4h', 240),
  ('hype-up-or-down-5m', 5),
  ('hype-up-or-down-15m', 15),
  ('hype-up-or-down-hourly', 60),
  ('hype-up-or-down-4h', 240),
  ('hype-up-or-down-daily', 1440),
  ('sol-up-or-down-5m', 5),
  ('sol-up-or-down-15m', 15),
  ('sol-up-or-down-4h', 240),
  ('solana-up-or-down-hourly', 60),
  ('solana-up-or-down-4h', 240),
  ('solana-up-or-down-daily', 1440),
  ('xrp-up-or-down-5m', 5),
  ('xrp-up-or-down-15m', 15),
  ('xrp-up-or-down-hourly', 60),
  ('xrp-up-or-down-4h', 240),
  ('xrp-up-or-down-daily', 1440));
ALTER TABLE public.event_live_chart_configs ALTER COLUMN topic SET DEFAULT 'price.crypto.twap';
ALTER TABLE public.event_live_chart_configs DROP COLUMN event_type;
