DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.event_live_chart_configs
    WHERE starts_with(topic, 'crypto_prices')
      AND topic NOT IN ('crypto_prices', 'crypto_prices_binance', 'crypto_prices_chainlink', 'crypto_prices_twap_thirty', 'crypto_prices_twap_sixty')
  ) THEN
    RAISE EXCEPTION 'Unsupported custom crypto price topic: choose a supported source before migrating live price feeds';
  END IF;
END $$;
ALTER TABLE public.event_live_chart_configs ADD COLUMN provider text;
ALTER TABLE public.event_live_chart_configs ADD COLUMN window_seconds integer;
UPDATE public.event_live_chart_configs SET
  provider = CASE WHEN topic = 'equity_prices' THEN 'pyth' WHEN topic IN ('crypto_prices', 'crypto_prices_binance') THEN 'binance' WHEN starts_with(topic, 'crypto_prices') THEN 'chainlink' ELSE NULL END,
  window_seconds = CASE WHEN topic = 'crypto_prices_twap_thirty' THEN 30 WHEN topic = 'crypto_prices_twap_sixty' THEN 60 ELSE NULL END,
  symbol = CASE WHEN starts_with(topic, 'crypto_prices') THEN regexp_replace(regexp_replace(lower(symbol), '[^a-z0-9]', '', 'g'), 'usdt$', 'usd') ELSE symbol END,
  topic = CASE WHEN topic = 'equity_prices' THEN 'price.equity' WHEN topic IN ('crypto_prices_twap_thirty', 'crypto_prices_twap_sixty') THEN 'price.crypto.twap' WHEN starts_with(topic, 'crypto_prices') THEN 'price.crypto' ELSE topic END;
UPDATE public.event_live_chart_configs SET topic = 'price.crypto.twap', provider = 'chainlink', window_seconds = 60
WHERE topic = 'price.crypto' AND provider = 'chainlink' AND window_seconds IS NULL
  AND (series_slug, symbol, active_window_minutes) IN (
  ('bnb-up-or-down-daily', 'bnbusd', 1440),
  ('bnb-up-or-down-5m', 'bnbusd', 5),
  ('bnb-up-or-down-15m', 'bnbusd', 15),
  ('bnb-up-or-down-hourly', 'bnbusd', 60),
  ('bnb-up-or-down-4h', 'bnbusd', 240),
  ('btc-up-or-down-4h', 'btcusd', 240),
  ('bitcoin-up-or-down-4h', 'btcusd', 240),
  ('btc-up-or-down-5m', 'btcusd', 5),
  ('btc-up-or-down-15m', 'btcusd', 15),
  ('btc-up-or-down-hourly', 'btcusd', 60),
  ('btc-up-or-down-daily', 'btcusd', 1440),
  ('doge-up-or-down-5m', 'dogeusd', 5),
  ('doge-up-or-down-15m', 'dogeusd', 15),
  ('doge-up-or-down-hourly', 'dogeusd', 60),
  ('doge-up-or-down-4h', 'dogeusd', 240),
  ('dogecoin-up-or-down-daily', 'dogeusd', 1440),
  ('eth-up-or-down-5m', 'ethusd', 5),
  ('eth-up-or-down-15m', 'ethusd', 15),
  ('eth-up-or-down-4h', 'ethusd', 240),
  ('eth-up-or-down-hourly', 'ethusd', 60),
  ('eth-up-or-down-daily', 'ethusd', 1440),
  ('ethereum-up-or-down-4h', 'ethusd', 240),
  ('hype-up-or-down-5m', 'hypeusd', 5),
  ('hype-up-or-down-15m', 'hypeusd', 15),
  ('hype-up-or-down-hourly', 'hypeusd', 60),
  ('hype-up-or-down-4h', 'hypeusd', 240),
  ('hype-up-or-down-daily', 'hypeusd', 1440),
  ('sol-up-or-down-5m', 'solusd', 5),
  ('sol-up-or-down-15m', 'solusd', 15),
  ('sol-up-or-down-4h', 'solusd', 240),
  ('solana-up-or-down-hourly', 'solusd', 60),
  ('solana-up-or-down-4h', 'solusd', 240),
  ('solana-up-or-down-daily', 'solusd', 1440),
  ('xrp-up-or-down-5m', 'xrpusd', 5),
  ('xrp-up-or-down-15m', 'xrpusd', 15),
  ('xrp-up-or-down-hourly', 'xrpusd', 60),
  ('xrp-up-or-down-4h', 'xrpusd', 240),
  ('xrp-up-or-down-daily', 'xrpusd', 1440));
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.event_live_chart_configs WHERE topic IN ('price.crypto.twap', 'price.equity.twap') AND window_seconds IS DISTINCT FROM 60) THEN
    RAISE EXCEPTION 'Unsupported custom TWAP window: choose a supported window before migrating live price feeds';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_live_chart_configs WHERE provider = 'binance') THEN
    RAISE EXCEPTION 'Unsupported custom Binance price configuration: choose a supported source before migrating live price feeds';
  END IF;
END $$;
ALTER TABLE public.event_live_chart_configs ALTER COLUMN topic SET DEFAULT 'price.crypto.twap';
ALTER TABLE public.event_live_chart_configs DROP COLUMN event_type;
