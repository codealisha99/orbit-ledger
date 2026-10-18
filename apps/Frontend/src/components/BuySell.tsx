"use client";

import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import type { SYMBOL } from "../utils/constants";
import { createTrade, findUserAmount } from "../api/trade";
import { getAssetDetails } from "../api/trade";
import type { Asset } from "../types/asset";
import {
  calculatePnlCents,
  toDisplayPriceUSD,
  toInternalPrice,
} from "../utils/utils";

export default function BuySell({
  askPrice,
  bidPrice,
  symbol,
  onOrderPlaced,
}: {
  askPrice: number;
  bidPrice: number;
  symbol: SYMBOL;
  onOrderPlaced?: () => void;
}) {
  const [margin, setMargin] = useState<number | string>(100);
  const [leverage, setLeverage] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [tpEnabled, setTpEnabled] = useState<boolean>(false);
  const [slEnabled, setSlEnabled] = useState<boolean>(false);
  const [tpPrice, setTpPrice] = useState<string>("");
  const [slPrice, setSlPrice] = useState<string>("");
  const [tpPercentage, setTpPercentage] = useState<number>(5); // Default 5% profit
  const [slPercentage, setSlPercentage] = useState<number>(5); // Default 5% loss
  const [tpManualEdit, setTpManualEdit] = useState<boolean>(false); // Track manual editing
  const [slManualEdit, setSlManualEdit] = useState<boolean>(false); // Track manual editing
  const [tslEnabled, setTslEnabled] = useState<boolean>(false); // Trailing Stop Loss
  const [tslDistance, setTslDistance] = useState<string>("500"); // Default $500 trailing distance
  const [activeTab, setActiveTab] = useState<"buy" | "sell">("buy");
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [userBalance, setUserBalance] = useState<number>(0);
  const [currentAsset, setCurrentAsset] = useState<Asset | null>(null);

  useEffect(() => {
    setTpManualEdit(false);
    setSlManualEdit(false);
  }, [activeTab]);

  useEffect(() => {
    const currentPrice = activeTab === "buy" ? askPrice : bidPrice;

    if (tpEnabled && currentPrice > 0 && !tpManualEdit) {
      const tpCalculated =
        activeTab === "buy"
          ? currentPrice * (1 + tpPercentage / 100)
          : currentPrice * (1 - tpPercentage / 100);
      setTpPrice(tpCalculated.toFixed(2));
    }

    if (slEnabled && currentPrice > 0 && !slManualEdit) {
      const slCalculated =
        activeTab === "buy"
          ? currentPrice * (1 - slPercentage / 100)
          : currentPrice * (1 + slPercentage / 100);
      setSlPrice(slCalculated.toFixed(2));
    }
  }, [tpEnabled, slEnabled, tpPercentage, slPercentage, activeTab, askPrice, bidPrice, tpManualEdit, slManualEdit]);

  useEffect(() => {
    const getUserBalance = async () => {
      try {
        const response = await findUserAmount();
        if (response && response.balance && response.balance.usd) {
          setUserBalance(response.balance.usd);
        }
      } catch (err) {
        console.error("Error fetching user balance", err);
      }
    };

    const getAssets = async () => {
      try {
        const assetData = await getAssetDetails();
        if (assetData.length > 0) {
          const asset = assetData.find((a) => a.symbol === symbol);
          if (asset) {
            setCurrentAsset(asset);
          }
        }
      } catch (error) {
        console.error("Error loading assets:", error);
      }
    };

    getUserBalance();
    getAssets();

    const balanceIntervalId = setInterval(getUserBalance, 10000);
    const assetsIntervalId = setInterval(getAssets, 30000);

    return () => {
      clearInterval(balanceIntervalId);
      clearInterval(assetsIntervalId);
    };
  }, [symbol]);

  const estimatedTpPnlInCents = useMemo(() => {
    if (!tpEnabled || !tpPrice || Number(tpPrice) <= 0) return 0;

    const openPriceForCalc =
      activeTab === "buy"
        ? toInternalPrice(askPrice)
        : toInternalPrice(bidPrice);
    const closePriceForCalc = toInternalPrice(Number(tpPrice));
    const marginForCalc = Number(margin) * 100; // Convert dollar margin to cents

    return calculatePnlCents({
      side: activeTab,
      openPrice: openPriceForCalc,
      closePrice: closePriceForCalc,
      marginCents: marginForCalc,
      leverage: leverage,
    });
  }, [tpEnabled, tpPrice, activeTab, askPrice, bidPrice, margin, leverage]);

  const estimatedSlPnlInCents = useMemo(() => {
    if (!slEnabled || !slPrice || Number(slPrice) <= 0) return 0;

    const openPriceForCalc =
      activeTab === "buy"
        ? toInternalPrice(askPrice)
        : toInternalPrice(bidPrice);
    const closePriceForCalc = toInternalPrice(Number(slPrice));
    const marginForCalc = Number(margin) * 100; // Convert dollar margin to cents

    return calculatePnlCents({
      side: activeTab,
      openPrice: openPriceForCalc,
      closePrice: closePriceForCalc,
      marginCents: marginForCalc,
      leverage: leverage,
    });
  }, [slEnabled, slPrice, activeTab, askPrice, bidPrice, margin, leverage]);

  const handleSubmitTrade = async () => {
    const marginValue = Number(margin);
    if (marginValue <= 0) {
      setError("Margin must be greater than 0");
      setTimeout(() => setError(""), 3000);
      return;
    }

    const openFee = marginValue * 0.005; // 0.5% fee on margin entry
    const totalCost = marginValue + openFee;

    if (totalCost > userBalance) {
      setError(`Insufficient balance. Need $${totalCost.toFixed(2)} (margin: $${marginValue.toFixed(2)} + 0.5% fee: $${openFee.toFixed(2)})`);
      setTimeout(() => setError(""), 4000);
      return;
    }

    const entryPrice = activeTab === "buy" ? askPrice : bidPrice;

    if (tpEnabled && tpPrice) {
      const takeProfitValue = Number(tpPrice);
      if (activeTab === "buy" && takeProfitValue <= entryPrice) {
        setError(`Invalid Take Profit. For BUY orders, TP must be higher than entry price ($${entryPrice.toFixed(2)})`);
        setTimeout(() => setError(""), 4000);
        return;
      }
      if (activeTab === "sell" && takeProfitValue >= entryPrice) {
        setError(`Invalid Take Profit. For SELL orders, TP must be lower than entry price ($${entryPrice.toFixed(2)})`);
        setTimeout(() => setError(""), 4000);
        return;
      }
    }

    if (slEnabled && slPrice) {
      const stopLossValue = Number(slPrice);
      if (activeTab === "buy" && stopLossValue >= entryPrice) {
        setError(`Invalid Stop Loss. For BUY orders, SL must be lower than entry price ($${entryPrice.toFixed(2)})`);
        setTimeout(() => setError(""), 4000);
        return;
      }
      if (activeTab === "sell" && stopLossValue <= entryPrice) {
        setError(`Invalid Stop Loss. For SELL orders, SL must be higher than entry price ($${entryPrice.toFixed(2)})`);
        setTimeout(() => setError(""), 4000);
        return;
      }
    }

    if (tslEnabled) {
      const tslDistanceValue = Number(tslDistance);

      if (!tslDistance || isNaN(tslDistanceValue) || tslDistanceValue <= 0) {
        setError(`Invalid Trailing Stop Loss. Please enter a valid distance (minimum $10)`);
        setTimeout(() => setError(""), 4000);
        return;
      }

      if (tslDistanceValue < 10) {
        setError(`Invalid Trailing Stop Loss. Minimum distance is $10 to prevent instant closure (you entered $${tslDistance})`);
        setTimeout(() => setError(""), 4000);
        return;
      }
      if (tslDistanceValue > 10000) {
        setError(`Invalid Trailing Stop Loss. Maximum distance is $10,000 (you entered $${tslDistance})`);
        setTimeout(() => setError(""), 4000);
        return;
      }

      const entryPrice = activeTab === "buy" ? askPrice : bidPrice;

      let liquidationPrice: number;
      if (activeTab === "buy") {
        liquidationPrice = entryPrice * (1 - 1 / leverage);
      } else {
        liquidationPrice = entryPrice * (1 + 1 / leverage);
      }

      const distanceToLiquidation = Math.abs(entryPrice - liquidationPrice);

      if (tslDistanceValue >= distanceToLiquidation) {
        const maxAllowed = Math.floor(distanceToLiquidation * 0.95); // 95% of distance for safety
        setError(
          `Trailing Stop Loss too large for ${leverage}x leverage. ` +
          `With ${symbol} at $${entryPrice.toFixed(2)}, liquidation is at $${liquidationPrice.toFixed(2)}. ` +
          `Max TSL distance: $${maxAllowed}. You entered: $${tslDistanceValue}. ` +
          `Reduce leverage or TSL distance.`
        );
        setTimeout(() => setError(""), 10000);
        return;
      }
    }

    try {
      setIsSubmitting(true);
      setError("");

      const token = localStorage.getItem("token") || "";

      const response = await createTrade({
        symbol,
        activeTab,
        margin: marginValue,
        leverage,
        tpEnabled,
        tpPrice,
        slEnabled,
        slPrice,
        tslEnabled,
        tslDistance,
        token,
      });

      if (response && response.order && response.order.orderId) {
        setSuccess(`Order placed successfully!`);
        setTimeout(() => setSuccess(""), 3000);

        const balanceResponse = await findUserAmount();
        if (balanceResponse && balanceResponse.balance && balanceResponse.balance.usd) {
          setUserBalance(balanceResponse.balance.usd);
        }
        
        if (onOrderPlaced) {
          onOrderPlaced();
        }
      }
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const errorData = err.response?.data;
        let errorMessage = "Failed to place order";

        if (errorData?.error) {
          errorMessage = errorData.error;

          if (errorData?.details && Array.isArray(errorData.details) && errorData.details.length > 0) {
            errorMessage = `${errorData.error}: ${errorData.details[0].message}`;
          }
        } else if (errorData?.message) {
          errorMessage = errorData.message;
        }

        console.error("Trade error:", errorData);

        setError(errorMessage);
        setTimeout(() => setError(""), 8000); // Show for 8 seconds for longer error messages
      } else {
        setError("An unexpected error occurred");
        setTimeout(() => setError(""), 3000);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <aside
      className="w-full rounded-lg border border-[var(--nt-border)] bg-[color:color-mix(in_srgb,var(--nt-surface)_80%,transparent)] backdrop-blur-xl text-[var(--nt-text)] shadow-sm h-full flex flex-col"
      aria-label="Trade ticket"
    >
      <div className="flex border-b border-[color:color-mix(in_srgb,var(--nt-border)_40%,transparent)]">
        <button
          onClick={() => setActiveTab("buy")}
          className={`flex-1 py-3 text-center font-medium text-sm transition ${
            activeTab === "buy"
              ? "text-[var(--nt-accent)] border-b-2 border-[var(--nt-accent)]"
              : "text-[var(--nt-text)] hover:text-[var(--nt-text)]"
          }`}
        >
          Buy {symbol}
        </button>
        <button
          onClick={() => setActiveTab("sell")}
          className={`flex-1 py-3 text-center font-medium text-sm transition ${
            activeTab === "sell"
              ? "text-[#EB483F] border-b-2 border-[#EB483F]"
              : "text-[var(--nt-text)] hover:text-[var(--nt-text)]"
          }`}
        >
          Sell {symbol}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <header className="mb-4">
          <div className="flex items-center justify-between gap-3">
            {currentAsset ? (
              <div className="flex min-w-0 items-center gap-2">
                <img
                  src={currentAsset.imageUrl}
                  alt={currentAsset.name}
                  className="h-8 w-8 rounded-full"
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[var(--nt-text)]">{symbol}/USDT</div>
                  <div className="text-xs text-[var(--nt-muted)]">Market order</div>
                </div>
              </div>
            ) : (
              <div className="text-sm font-semibold text-[var(--nt-text)]">
                {symbol}/USDT
              </div>
            )}
            <div className="shrink-0 text-right">
              <div className="text-[10px] uppercase tracking-wide text-[var(--nt-muted)]">Available</div>
              <div className="font-mono text-sm font-medium text-[var(--nt-text)]">
                ${userBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 divide-x divide-[var(--nt-border)] border-y border-[var(--nt-border)] py-2.5" aria-label="Market prices">
          <div className="pr-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--nt-muted)]">Sell price</div>
            <div className="mt-1 truncate font-mono text-sm font-semibold text-red-400">${bidPrice}</div>
          </div>
          <div className="pl-3 text-right">
            <div className="text-[10px] uppercase tracking-wide text-[var(--nt-muted)]">Buy price</div>
            <div className="mt-1 truncate font-mono text-sm font-semibold text-[var(--nt-accent)]">${askPrice}</div>
          </div>
        </section>

        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-[color:color-mix(in_srgb,var(--nt-text)_60%,transparent)]"
              >
                <line x1="12" y1="1" x2="12" y2="23"></line>
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
              </svg>
              <label htmlFor="margin" className="text-xs text-[color:color-mix(in_srgb,var(--nt-text)_60%,transparent)]">
                Trading Margin
              </label>
            </div>
            <span className="text-[10px] text-[color:color-mix(in_srgb,var(--nt-text)_50%,transparent)] bg-[var(--nt-surface2)] px-1.5 py-0.5 rounded">
              ${margin} USD
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Decrease margin"
              className="rounded-md border border-[var(--nt-border)] px-2 py-1 text-xs text-[color:color-mix(in_srgb,var(--nt-text)_80%,transparent)] hover:bg-[var(--nt-surface2)] transition-colors"
              onClick={() => setMargin((prev) => Math.max(10, Number(prev) - 10))}
              disabled={isSubmitting}
            >
              −
            </button>
            <div className="w-full relative">
              <div className="absolute left-0 top-0 h-full px-2 flex items-center">
                <span className="text-xs text-[color:color-mix(in_srgb,var(--nt-text)_50%,transparent)]">$</span>
              </div>
              <input
                id="margin"
                name="margin"
                type="number"
                min={10}
                step={10}
                value={margin}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "") {
                    setMargin("");
                  } else {
                    setMargin(Number(val));
                  }
                }}
                disabled={isSubmitting}
                className="w-full rounded-md border border-[var(--nt-border)] bg-[var(--nt-surface2)] pl-6 pr-2 py-1.5 text-xs outline-none focus:border-[var(--nt-accent)] transition-colors"
              />
            </div>
            <button
              type="button"
              aria-label="Increase margin"
              className="rounded-md border border-[var(--nt-border)] px-2 py-1 text-xs text-[color:color-mix(in_srgb,var(--nt-text)_80%,transparent)] hover:bg-[var(--nt-surface2)] transition-colors"
              onClick={() => setMargin((prev) => Number(prev) + 10)}
              disabled={isSubmitting}
            >
              +
            </button>
          </div>

        </section>

        <section className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-[color:color-mix(in_srgb,var(--nt-text)_60%,transparent)]"
              >
                <path d="M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1"></path>
                <polygon points="12 15 17 21 7 21 12 15"></polygon>
              </svg>
              <label className="text-xs text-[color:color-mix(in_srgb,var(--nt-text)_60%,transparent)]">Leverage</label>
            </div>
            <div className="flex items-center">
              <div className="text-xs text-[color:color-mix(in_srgb,var(--nt-text)_50%,transparent)] bg-[var(--nt-surface2)] px-1.5 py-0.5 rounded mr-1">
                <span className="text-[color:color-mix(in_srgb,var(--nt-text)_70%,transparent)] font-medium">{leverage}x</span>
              </div>
              <div className="text-[10px] text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">
                ${(Number(margin) * leverage).toLocaleString("en-US")}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-1.5">
            {[1, 5, 10, 20, 100].map((lev) => (
              <button
                key={lev}
                type="button"
                className={`rounded-md border relative overflow-hidden ${
                  leverage === lev
                    ? lev >= 100
                      ? "border-red-500 bg-red-500/10 text-red-400"
                      : lev >= 20
                      ? "border-orange-500 bg-orange-500/10 text-orange-400"
                      : "border-[var(--nt-accent)] bg-[color:color-mix(in_srgb,var(--nt-accent)_10%,transparent)] text-[var(--nt-accent)]"
                    : "border-[var(--nt-border)] text-[color:color-mix(in_srgb,var(--nt-text)_70%,transparent)] hover:bg-[var(--nt-surface2)]"
                } px-1 py-1.5 text-xs transition-all`}
                onClick={() => setLeverage(lev)}
                disabled={isSubmitting}
              >
                {leverage === lev && (
                  <div className={`absolute top-0 left-0 w-1 h-full ${
                    lev >= 100 ? "bg-red-500" : lev >= 20 ? "bg-orange-500" : "bg-[var(--nt-accent)]"
                  }`}></div>
                )}
                {lev}x
              </button>
            ))}
          </div>

          {leverage >= 100 && (
            <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/5 p-2">
              <div className="flex items-start gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400 flex-shrink-0 mt-0.5">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-red-400">EXTREME RISK - 100x Leverage</div>
                  <div className="text-[10px] text-red-300/80">
                    A 1% price move against you = 100% loss (instant liquidation). Only use if you understand the extreme risk.
                  </div>
                </div>
              </div>
            </div>
          )}

          {leverage >= 20 && leverage < 100 && (
            <div className="mt-2 rounded-md border border-orange-500/30 bg-orange-500/5 p-2">
              <div className="flex items-start gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange-400 flex-shrink-0 mt-0.5">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <div className="text-[10px] text-orange-300/80">
                  High leverage ({leverage}x) = High risk. A {(100 / leverage).toFixed(1)}% move against you will liquidate your position.
                </div>
              </div>
            </div>
          )}
        </section>

        <details className="mt-4 rounded-lg border border-[var(--nt-border)] bg-[var(--nt-surface)]">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium text-[var(--nt-text)] focus-visible:ring-2 focus-visible:ring-[var(--nt-accent)] [&::-webkit-details-marker]:hidden">
            <span>Risk controls</span>
            <span className="text-xs font-normal text-[var(--nt-muted)]">Take profit · Stop loss · Trailing</span>
          </summary>
          <div className="space-y-2 border-t border-[var(--nt-border)] p-3">
          <div className="rounded-md border border-[var(--nt-border)] bg-[var(--nt-bg)] p-2">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-[color:color-mix(in_srgb,var(--nt-text)_60%,transparent)]"
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
                <label htmlFor="tp-toggle" className="text-xs text-[color:color-mix(in_srgb,var(--nt-text)_60%,transparent)]">
                  Take Profit
                </label>
                <span className="bg-green-500/10 text-green-400 text-[10px] px-1.5 py-0.5 rounded">
                  Recommended
                </span>
              </div>
              <div className="flex items-center">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    id="tp-toggle"
                    type="checkbox"
                    className="sr-only peer"
                    checked={tpEnabled}
                    onChange={(e) => setTpEnabled(e.target.checked)}
                  />
                  <div className="w-9 h-5 bg-[var(--nt-surface2)] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-[var(--nt-border)] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[color:color-mix(in_srgb,var(--nt-surface2)_30%,transparent)] after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[color:color-mix(in_srgb,var(--nt-accent)_30%,transparent)]"></div>
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <div className="relative">
                <div className="absolute left-0 top-0 h-full px-2 flex items-center">
                  <span className="text-xs text-[color:color-mix(in_srgb,var(--nt-text)_50%,transparent)]">$</span>
                </div>
                <input
                  id="tp-price"
                  name="tp"
                  type="number"
                  step="0.01"
                  placeholder="Target Price"
                  disabled={!tpEnabled}
                  value={tpPrice}
                  onChange={(e) => {
                    setTpPrice(e.target.value);
                    setTpManualEdit(true); // User is manually editing
                  }}
                  className={`
                    w-full rounded-md border border-[var(--nt-border)] bg-[var(--nt-surface2)] pl-6 pr-2 py-1.5 text-xs outline-none
                    ${
                      tpEnabled
                        ? "focus:border-[var(--nt-accent)] transition-colors"
                        : "opacity-50"
                    }
                  `}
                />
              </div>

              {tpEnabled && (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-[color:color-mix(in_srgb,var(--nt-text)_50%,transparent)]">Quick:</span>
                  {[2, 5, 10, 15].map((percent) => (
                    <button
                      key={percent}
                      type="button"
                      onClick={() => {
                        setTpPercentage(percent);
                        setTpManualEdit(false); // Re-enable auto-calculation
                      }}
                      className={`flex-1 text-[10px] px-2 py-1 rounded border transition-colors ${
                        tpPercentage === percent && !tpManualEdit
                          ? "border-green-500 bg-green-500/20 text-green-400"
                          : "border-[var(--nt-border)] bg-[var(--nt-surface2)] text-[color:color-mix(in_srgb,var(--nt-text)_60%,transparent)] hover:border-green-500/50"
                      }`}
                    >
                      +{percent}%
                    </button>
                  ))}
                </div>
              )}
            </div>

            {tpEnabled && (
              <div className="mt-1.5 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <div className="text-[10px] text-[color:color-mix(in_srgb,var(--nt-text)_50%,transparent)]">
                      Est. Profit:
                    </div>
                  </div>
                  <div
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      estimatedTpPnlInCents > 0
                        ? "text-green-400 bg-green-500/10"
                        : "text-red-400 bg-red-500/10"
                    }`}
                  >
                    {estimatedTpPnlInCents >= 0 ? "+$" : "-$"}
                    {toDisplayPriceUSD(Math.abs(estimatedTpPnlInCents)).toFixed(
                      2
                    )}
                  </div>
                </div>
                <div className="text-[10px] text-[color:color-mix(in_srgb,var(--nt-text)_40%,transparent)]">
                  Target: ${tpPrice} | Current: $
                  {activeTab === "buy" ? askPrice : bidPrice}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-md border border-[var(--nt-border)] bg-[var(--nt-bg)] p-2">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-[color:color-mix(in_srgb,var(--nt-text)_60%,transparent)]"
                >
                  <path d="M10 16l-6-6 6-6"></path>
                  <path d="M20 21v-7a4 4 0 0 0-4-4H5"></path>
                </svg>
                <label htmlFor="sl-toggle" className="text-xs text-[color:color-mix(in_srgb,var(--nt-text)_60%,transparent)]">
                  Stop Loss
                </label>
                <span className="bg-red-500/10 text-red-400 text-[10px] px-1.5 py-0.5 rounded">
                  Risk Protection
                </span>
              </div>
              <div className="flex items-center">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    id="sl-toggle"
                    type="checkbox"
                    className="sr-only peer"
                    checked={slEnabled}
                    onChange={(e) => setSlEnabled(e.target.checked)}
                  />
                  <div className="w-9 h-5 bg-[var(--nt-surface2)] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-[var(--nt-border)] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[color:color-mix(in_srgb,var(--nt-surface2)_30%,transparent)] after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#EB483F]/30"></div>
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <div className="relative">
                <div className="absolute left-0 top-0 h-full px-2 flex items-center">
                  <span className="text-xs text-[color:color-mix(in_srgb,var(--nt-text)_50%,transparent)]">$</span>
                </div>
                <input
                  id="sl-price"
                  name="sl"
                  type="number"
                  step="0.01"
                  placeholder="Stop Price"
                  disabled={!slEnabled}
                  value={slPrice}
                  onChange={(e) => {
                    setSlPrice(e.target.value);
                    setSlManualEdit(true); // User is manually editing
                  }}
                  className={`
                    w-full rounded-md border border-[var(--nt-border)] bg-[var(--nt-surface2)] pl-6 pr-2 py-1.5 text-xs outline-none
                    ${
                      slEnabled
                        ? "focus:border-[#EB483F] transition-colors"
                        : "opacity-50"
                    }
                  `}
                />
              </div>

              {slEnabled && (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-[color:color-mix(in_srgb,var(--nt-text)_50%,transparent)]">Quick:</span>
                  {[2, 5, 10, 15].map((percent) => (
                    <button
                      key={percent}
                      type="button"
                      onClick={() => {
                        setSlPercentage(percent);
                        setSlManualEdit(false); // Re-enable auto-calculation
                      }}
                      className={`flex-1 text-[10px] px-2 py-1 rounded border transition-colors ${
                        slPercentage === percent && !slManualEdit
                          ? "border-red-500 bg-red-500/20 text-red-400"
                          : "border-[var(--nt-border)] bg-[var(--nt-surface2)] text-[color:color-mix(in_srgb,var(--nt-text)_60%,transparent)] hover:border-red-500/50"
                      }`}
                    >
                      -{percent}%
                    </button>
                  ))}
                </div>
              )}
            </div>

            {slEnabled && (
              <div className="mt-1.5 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <div className="text-[10px] text-[color:color-mix(in_srgb,var(--nt-text)_50%,transparent)]">Est. Loss:</div>
                  </div>
                  <div
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      estimatedSlPnlInCents < 0
                        ? "text-red-400 bg-red-500/10"
                        : "text-green-400 bg-green-500/10"
                    }`}
                  >
                    {estimatedSlPnlInCents > 0 ? "+$" : "-$"}
                    {toDisplayPriceUSD(Math.abs(estimatedSlPnlInCents)).toFixed(
                      2
                    )}
                  </div>
                </div>
                <div className="text-[10px] text-[color:color-mix(in_srgb,var(--nt-text)_40%,transparent)]">
                  Stop: ${slPrice} | Current: $
                  {activeTab === "buy" ? askPrice : bidPrice}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-md border border-[var(--nt-border)] bg-[var(--nt-bg)] p-2">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-[color:color-mix(in_srgb,var(--nt-text)_60%,transparent)]"
                >
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                </svg>
                <label htmlFor="tsl-toggle" className="text-xs text-[color:color-mix(in_srgb,var(--nt-text)_60%,transparent)]">
                  Trailing Stop Loss
                </label>
                <span className="bg-yellow-500/10 text-yellow-400 text-[10px] px-1.5 py-0.5 rounded">
                  Advanced
                </span>
              </div>
              <div className="flex items-center">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    id="tsl-toggle"
                    type="checkbox"
                    className="sr-only peer"
                    checked={tslEnabled}
                    onChange={(e) => setTslEnabled(e.target.checked)}
                  />
                  <div className="w-9 h-5 bg-[var(--nt-surface2)] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-[var(--nt-border)] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[color:color-mix(in_srgb,var(--nt-surface2)_30%,transparent)] after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-yellow-500/30"></div>
                </label>
              </div>
            </div>

            <div className="relative">
              <div className="absolute left-0 top-0 h-full px-2 flex items-center">
                <span className="text-xs text-[color:color-mix(in_srgb,var(--nt-text)_50%,transparent)]">$</span>
              </div>
              <input
                id="tsl-distance"
                name="tsl"
                type="number"
                step="10"
                placeholder="Trailing Distance (e.g. 500)"
                disabled={!tslEnabled}
                value={tslDistance}
                onChange={(e) => setTslDistance(e.target.value)}
                className={`
                  w-full rounded-md border border-[var(--nt-border)] bg-[var(--nt-surface2)] pl-6 pr-2 py-1.5 text-xs outline-none
                  ${
                    tslEnabled
                      ? "focus:border-yellow-500 transition-colors"
                      : "opacity-50"
                  }
                `}
              />
            </div>

            {tslEnabled && (
              <div className="mt-1.5 space-y-1">
                <div className="text-[10px] text-[color:color-mix(in_srgb,var(--nt-text)_40%,transparent)]">
                  Locks in profit as price moves in your favor. Stop loss moves with price but never reverses.
                </div>
                {(() => {
                  const entryPrice = activeTab === "buy" ? askPrice : bidPrice;
                  const liquidationPrice = activeTab === "buy"
                    ? entryPrice * (1 - 1 / leverage)
                    : entryPrice * (1 + 1 / leverage);
                  const distanceToLiquidation = Math.abs(entryPrice - liquidationPrice);
                  const maxTsl = Math.floor(distanceToLiquidation * 0.95);

                  return (
                    <div className="text-[10px] text-yellow-500/60">
                      Minimum: $10 | Maximum for {leverage}x leverage: ${maxTsl.toFixed(0)}
                    </div>
                  );
                })()}
                <div className="flex items-center justify-between">
                  <div className="text-[10px] text-[color:color-mix(in_srgb,var(--nt-text)_50%,transparent)]">
                    Distance from peak:
                  </div>
                  {(() => {
                    const entryPrice = activeTab === "buy" ? askPrice : bidPrice;
                    const liquidationPrice = activeTab === "buy"
                      ? entryPrice * (1 - 1 / leverage)
                      : entryPrice * (1 + 1 / leverage);
                    const distanceToLiquidation = Math.abs(entryPrice - liquidationPrice);
                    const maxTsl = distanceToLiquidation * 0.95;
                    const currentValue = Number(tslDistance) || 0;
                    const percentage = (currentValue / maxTsl) * 100;

                    let colorClass = "text-yellow-400 bg-yellow-500/10";
                    if (percentage >= 95) {
                      colorClass = "text-red-400 bg-red-500/10";
                    } else if (percentage >= 80) {
                      colorClass = "text-orange-400 bg-orange-500/10";
                    } else if (percentage >= 60) {
                      colorClass = "text-yellow-400 bg-yellow-500/10";
                    } else {
                      colorClass = "text-green-400 bg-green-500/10";
                    }

                    return (
                      <div className={`text-[10px] px-1.5 py-0.5 rounded ${colorClass}`}>
                        ${tslDistance} {percentage >= 80 && `(${percentage.toFixed(0)}% of max)`}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
          </div>
        </details>

        {error && (
          <div className="mt-2 p-1 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-[10px]">
            {error}
          </div>
        )}

        {success && (
          <div className="mt-2 p-1 bg-green-500/10 border border-green-500/30 rounded text-green-400 text-[10px]">
            {success}
          </div>
        )}

      </div>

      <footer className="shrink-0 border-t border-[var(--nt-border)] bg-[var(--nt-surface)] px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="text-[var(--nt-muted)]">Estimated total · includes 0.5% fee</span>
          <span className="font-mono font-medium text-[var(--nt-text)]">${(Number(margin) + Number(margin) * 0.005).toFixed(2)}</span>
        </div>
        <button
          className={`min-h-11 w-full rounded-lg px-3 py-3 text-sm font-semibold transition-colors flex items-center justify-center gap-2 relative overflow-hidden ${
            activeTab === "buy"
              ? "bg-gradient-to-r from-[color:color-mix(in_srgb,var(--nt-accent)_90%,transparent)] to-[var(--nt-accent)] hover:from-[var(--nt-accent)] hover:to-[color:color-mix(in_srgb,var(--nt-accent)_90%,transparent)] text-[var(--nt-text)]"
              : "bg-red-600 hover:bg-red-500 text-white"
          } ${isSubmitting ? "opacity-80 cursor-not-allowed" : ""}`}
          aria-label={
            activeTab === "buy" ? "Place buy order" : "Place sell order"
          }
          onClick={handleSubmitTrade}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <svg
                className="animate-spin h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <span>Processing...</span>
            </>
          ) : (
            <>
              {activeTab === "buy" ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 5v14"></path>
                  <path d="M19 12l-7-7-7 7"></path>
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 19V5"></path>
                  <path d="M5 12l7 7 7-7"></path>
                </svg>
              )}
              <span>
                {activeTab === "buy" ? "Buy" : "Sell"} {symbol}
              </span>
            </>
          )}
        </button>

      </footer>
    </aside>
  );
}
