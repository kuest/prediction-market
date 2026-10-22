-- Keep HOOD and COIN disabled during the build and rollout. Migration 016
-- stages their configs; activation must happen only after the matching
-- frontend release is live. This version was already recorded on mainnet,
-- so retain its number without changing existing enabled values.
SELECT 1;
