-- Apply before the new API. Existing ambiguous partial exits need the audit in docs/release-runbook.md.
ALTER TABLE users ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE active_orders ADD COLUMN "notionalCents" DOUBLE PRECISION;
UPDATE active_orders SET "notionalCents" = LEAST(margin,"initialMargin")::double precision * leverage;
ALTER TABLE active_orders ALTER COLUMN "notionalCents" SET NOT NULL;
ALTER TABLE active_orders ADD COLUMN "entryFeeCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE closed_orders ADD COLUMN "positionId" TEXT;
ALTER TABLE closed_orders ADD COLUMN "notionalCents" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE closed_orders ADD COLUMN "entryFeeCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE closed_orders ADD COLUMN "exitFeeCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE closed_orders ADD COLUMN "netPnlCents" INTEGER NOT NULL DEFAULT 0;
UPDATE closed_orders SET "positionId" = split_part("orderId", '_partial_', 1), "notionalCents" = margin::double precision * leverage, "netPnlCents" = pnl;
DO $$ DECLARE tab text; col text; BEGIN
  FOREACH tab IN ARRAY ARRAY['active_orders','closed_orders','order_snapshots'] LOOP
    FOREACH col IN ARRAY ARRAY['openPrice','liquidationPrice','takeProfit','stopLoss','trailingStopLossDistance','trailingStopLossHighestPrice','trailingStopLossLowestPrice'] LOOP
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE DOUBLE PRECISION',tab,col);
    END LOOP;
  END LOOP;
END $$;
ALTER TABLE closed_orders ALTER COLUMN "closePrice" TYPE DOUBLE PRECISION;
DROP INDEX IF EXISTS "Trade_tradeId_timestamp_key";
CREATE UNIQUE INDEX "Trade_symbol_tradeId_timestamp_key" ON "Trade" (symbol,"tradeId",timestamp);
CREATE TABLE "AccountEvent" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, version INTEGER NOT NULL, kind TEXT NOT NULL, "positionId" TEXT, payload JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "deliveredAt" TIMESTAMP(3));
CREATE UNIQUE INDEX "AccountEvent_userId_version_key" ON "AccountEvent"("userId", version);
CREATE INDEX "AccountEvent_userId_createdAt_idx" ON "AccountEvent"("userId", "createdAt");
CREATE INDEX "AccountEvent_deliveredAt_createdAt_idx" ON "AccountEvent"("deliveredAt", "createdAt");
CREATE TABLE "MutationReceipt" ("userId" TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, response JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY("userId",key));
CREATE TABLE "EquitySnapshot" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "availableCents" INTEGER NOT NULL, "reservedCents" INTEGER NOT NULL, "pnlCents" INTEGER, "equityCents" INTEGER, stale BOOLEAN NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "EquitySnapshot_userId_createdAt_idx" ON "EquitySnapshot"("userId", "createdAt");
CREATE TABLE "LoginCode" (code TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL);
ALTER TABLE active_orders ADD CONSTRAINT active_exposure_valid CHECK ("notionalCents" > 0 AND "notionalCents" <= 9007199254740991 AND "notionalCents" = trunc("notionalCents") AND margin > 0);

ALTER TABLE active_orders ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false;
-- Historical partial exits after collateral additions cannot be reconstructed safely.
UPDATE active_orders a SET "needsReview" = true WHERE a."addedMargin" > 0 AND EXISTS (SELECT 1 FROM closed_orders c WHERE c."positionId" = a."orderId");
ALTER TABLE closed_orders ADD COLUMN "feesRecorded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE market_candles DROP CONSTRAINT IF EXISTS market_candles_interval_check;
ALTER TABLE market_candles ADD CONSTRAINT market_candles_interval_check CHECK (interval IN ('1m','5m','15m','1h','4h','1d','1w'));

ALTER TABLE market_candles ALTER COLUMN interval TYPE VARCHAR(3);

ALTER TABLE active_orders ADD COLUMN "feesRecorded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE active_orders ALTER COLUMN "feesRecorded" SET DEFAULT true;

-- JS numbers preserve integer cents exactly through 2^53; arithmetic validates safe integers.
DO $$ DECLARE rec record; BEGIN
  FOR rec IN SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name IN ('users','active_orders','closed_orders','order_snapshots','user_snapshots','EquitySnapshot')
    AND column_name IN ('balanceCents','margin','initialMargin','addedMargin','entryFeeCents','exitFeeCents','netPnlCents','pnl','availableCents','reservedCents','pnlCents','equityCents')
  LOOP EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE DOUBLE PRECISION',rec.table_name,rec.column_name); END LOOP;
END $$;
ALTER TABLE users ADD CONSTRAINT balance_safe_cents CHECK ("balanceCents" >= 0 AND "balanceCents" <= 9007199254740991 AND "balanceCents" = trunc("balanceCents"));
