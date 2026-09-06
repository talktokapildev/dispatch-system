-- Backfill remainingAmount for CREDIT_PROMO rows created before this
-- column existed. These were previously tracked only via the aggregate
-- promoBalance; this makes their FIFO lot tracking consistent with new
-- rows going forward. Only touches rows where remainingAmount IS NULL,
-- so it's safe to run even if some rows are already backfilled.
UPDATE "WalletTransaction"
SET "remainingAmount" = "amount"
WHERE "type" = 'CREDIT_PROMO'
  AND "remainingAmount" IS NULL;