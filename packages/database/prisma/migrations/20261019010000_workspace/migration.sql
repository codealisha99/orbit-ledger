-- Additive workspace data. Financial balances and positions are untouched.
CREATE TABLE user_watchlist (
  "userId" TEXT NOT NULL REFERENCES users("userId") ON DELETE CASCADE,
  asset TEXT NOT NULL CHECK (asset IN ('BTC','ETH','SOL')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", asset)
);
CREATE TABLE price_alerts (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES users("userId") ON DELETE CASCADE,
  asset TEXT NOT NULL CHECK (asset IN ('BTC','ETH','SOL')),
  "targetPrice" DOUBLE PRECISION NOT NULL CHECK ("targetPrice" > 0 AND "targetPrice" <= 10000000000000 AND "targetPrice" = trunc("targetPrice")),
  direction TEXT NOT NULL CHECK (direction IN ('above','below')),
  "triggeredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "price_alerts_userId_createdAt_idx" ON price_alerts("userId", "createdAt");
