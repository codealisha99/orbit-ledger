CREATE TABLE "market_candles" (
    "symbol" VARCHAR(12) NOT NULL,
    "interval" VARCHAR(2) NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL,
    "open" BIGINT NOT NULL,
    "high" BIGINT NOT NULL,
    "low" BIGINT NOT NULL,
    "close" BIGINT NOT NULL,
    "baseVolume" DECIMAL(38,12) NOT NULL,
    "quoteVolume" DECIMAL(38,12) NOT NULL,
    "tradeCount" INTEGER NOT NULL,

    CONSTRAINT "market_candles_pkey" PRIMARY KEY ("symbol", "interval", "timestamp"),
    CONSTRAINT "market_candles_interval_check" CHECK ("interval" IN ('1d', '1w')),
    CONSTRAINT "market_candles_symbol_check" CHECK ("symbol" IN ('BTC', 'ETH', 'SOL'))
);
