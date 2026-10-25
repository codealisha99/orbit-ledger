ALTER TABLE "active_orders"
  ADD COLUMN "fundingAccruedCents" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "lastFundingAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "closed_orders"
  ADD COLUMN "fundingAccruedCents" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE TABLE "perp_funding_payments" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "positionId" TEXT NOT NULL,
  "asset" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "notionalCents" DOUBLE PRECISION NOT NULL,
  "rateBps" INTEGER NOT NULL,
  "amountCents" DOUBLE PRECISION NOT NULL,
  "markPrice" DOUBLE PRECISION NOT NULL,
  "appliedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "perp_funding_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "perp_funding_payments_userId_appliedAt_idx" ON "perp_funding_payments"("userId", "appliedAt");
CREATE INDEX "perp_funding_payments_positionId_appliedAt_idx" ON "perp_funding_payments"("positionId", "appliedAt");
