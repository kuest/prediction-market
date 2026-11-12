ALTER TABLE public.event_live_chart_configs ADD COLUMN provider text;
ALTER TABLE public.event_live_chart_configs ADD COLUMN window_seconds integer;
UPDATE public.event_live_chart_configs SET
  provider = CASE WHEN topic = 'equity_prices' THEN 'pyth' WHEN topic IN ('crypto_prices', 'crypto_prices_binance') THEN 'binance' WHEN topic LIKE 'crypto_prices_%' THEN 'chainlink' ELSE NULL END,
  window_seconds = CASE WHEN topic = 'crypto_prices_twap_thirty' THEN 30 WHEN topic = 'crypto_prices_twap_sixty' THEN 60 ELSE NULL END,
  topic = CASE WHEN topic = 'equity_prices' THEN 'price.equity' WHEN topic IN ('crypto_prices_twap_thirty', 'crypto_prices_twap_sixty') THEN 'price.crypto.twap' WHEN topic LIKE 'crypto_prices%' THEN 'price.crypto' ELSE topic END;
ALTER TABLE public.event_live_chart_configs ALTER COLUMN topic SET DEFAULT 'price.crypto';
ALTER TABLE public.event_live_chart_configs ALTER COLUMN provider SET DEFAULT 'chainlink';
ALTER TABLE public.event_live_chart_configs DROP COLUMN event_type;
