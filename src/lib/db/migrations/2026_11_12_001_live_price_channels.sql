ALTER TABLE public.event_live_chart_configs ADD COLUMN provider text;
ALTER TABLE public.event_live_chart_configs ADD COLUMN window_seconds integer;
UPDATE public.event_live_chart_configs SET
  provider = CASE WHEN topic = 'equity_prices' THEN 'pyth' WHEN topic LIKE 'crypto_prices%' THEN 'chainlink' ELSE NULL END,
  window_seconds = CASE WHEN topic LIKE 'crypto_prices%' THEN 60 ELSE NULL END,
  symbol = CASE WHEN topic LIKE 'crypto_prices%' THEN regexp_replace(regexp_replace(lower(symbol), '[^a-z0-9]', '', 'g'), 'usdt$', 'usd') ELSE symbol END,
  topic = CASE WHEN topic = 'equity_prices' THEN 'price.equity' WHEN topic LIKE 'crypto_prices%' THEN 'price.crypto.twap' ELSE topic END;
ALTER TABLE public.event_live_chart_configs ALTER COLUMN topic SET DEFAULT 'price.crypto.twap';
ALTER TABLE public.event_live_chart_configs ALTER COLUMN provider SET DEFAULT 'chainlink';
ALTER TABLE public.event_live_chart_configs ALTER COLUMN window_seconds SET DEFAULT 60;
ALTER TABLE public.event_live_chart_configs DROP COLUMN event_type;
