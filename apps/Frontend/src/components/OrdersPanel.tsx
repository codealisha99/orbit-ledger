"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { closetrade, getclosedtrades, getopentrades, partialCloseTrade, addMarginToTrade } from "../api/trade";
import {
  calculatePnlCents,
  toDisplayPrice,
  toDisplayPriceUSD,
} from "../utils/utils";
import { subscribePrices, type LivePrices } from "../utils/price_store";

interface OpenOrder {
  orderId: string;
  type: "buy" | "sell";
  margin: number;
  leverage: number;
  openPrice: number;
  asset?: string;
  takeProfit?: number;
  stopLoss?: number;
  liquidationPrice?: number;
}

interface ClosedOrder extends OpenOrder {
  closePrice: number;
  pnl: number;
}

type OpenOrderWithPnl = OpenOrder & { pnlUsd: number };
export interface OrderActivity {
  id: string;
  event: "opened" | "closed" | "liquidated";
  asset: string;
  side: "buy" | "sell";
  price: number;
  pnl?: number;
  timestamp: number;
}

export default function OrdersPanel({ onRefreshReady, activity = [] }: { onRefreshReady?: (refresh: () => void) => void; activity?: OrderActivity[] }) {
  const [activeTab, setActiveTab] = useState<"open" | "closed" | "activity">("open");
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [closedOrders, setClosedOrders] = useState<ClosedOrder[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isClosingPosition, setIsClosingPosition] = useState<string | null>(
    null
  );
  const [showPartialCloseModal, setShowPartialCloseModal] = useState<string | null>(null);
  const [showAddMarginModal, setShowAddMarginModal] = useState<string | null>(null);
  const [partialClosePercentage, setPartialClosePercentage] = useState<string>("50");
  const [additionalMargin, setAdditionalMargin] = useState<string>("100");
  const [latestPrices, setLatestPrices] = useState<LivePrices>({
    BTC: { bid: 0, ask: 0 },
    ETH: { bid: 0, ask: 0 },
    SOL: { bid: 0, ask: 0 },
  });

  const fetchOpenOrders = useCallback(async (background = false) => {
    if (!background) setIsLoading(true);
    try {
      const token = localStorage.getItem("token") || "";

      const response = await getopentrades(token);
      if (response?.data?.orders) {
        setOpenOrders(response.data.orders);
      } else {
        setOpenOrders([]);
      }
    } catch (error) {
      console.error("Error fetching open orders:", error);
    } finally {
      if (!background) setIsLoading(false);
    }
  }, []);

  const fetchClosedOrders = useCallback(async (background = false) => {
    if (!background) setIsLoading(true);
    setHistoryError(null);
    try {
      const token = localStorage.getItem("token") || "";

      const response = await getclosedtrades(token);
      setClosedOrders(response.data.orders || []);
    } catch (error) {
      console.error("Error fetching closed orders:", error);
      setHistoryError("Could not load your order history.");
    } finally {
      if (!background) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "open") {
      fetchOpenOrders();
    } else if (activeTab === "closed") {
      fetchClosedOrders();
    }

    if (activeTab === "activity") return;

    const intervalId = setInterval(() => {
      if (activeTab === "open") {
        fetchOpenOrders(true);
      } else if (activeTab === "closed") {
        fetchClosedOrders(true);
      }
    }, 5000);

    return () => clearInterval(intervalId);
  }, [activeTab, fetchOpenOrders, fetchClosedOrders]);

  useEffect(() => {
    if (onRefreshReady) {
      onRefreshReady(fetchOpenOrders);
    }
  }, [onRefreshReady, fetchOpenOrders]);

  useEffect(() => {
    const unsubscribe = subscribePrices((p: LivePrices) => {
      setLatestPrices(p);
    });
    return () => unsubscribe();
  }, []);

  const openWithPnl: OpenOrderWithPnl[] = useMemo(() => {
    return openOrders.map((o): OpenOrderWithPnl => {
      const sym = (o.asset || "BTC").replace("USDT", "");
      const p = latestPrices[sym as keyof LivePrices];
      if (!p || p.bid === 0 || p.ask === 0) {
        return { ...o, pnlUsd: 0 };
      }

      const currentcloseprice = o.type === "buy" ? p.bid : p.ask;
      const pnlInCents = calculatePnlCents({
        side: o.type,
        openPrice: o.openPrice,
        closePrice: currentcloseprice,
        marginCents: o.margin,
        leverage: o.leverage,
      });
      return { ...o, pnlUsd: pnlInCents };
    });
  }, [openOrders, latestPrices]);

  const getTpSlStatus = (order: OpenOrderWithPnl) => {
    const sym = (order.asset || "BTC").replace("USDT", "");
    const p = latestPrices[sym as keyof LivePrices];
    if (!p) return { tpStatus: "none", slStatus: "none" };

    const currentPrice = order.type === "buy" ? p.bid : p.ask;

    let tpStatus = "none";
    let slStatus = "none";

    if (order.takeProfit) {
      if (order.type === "buy" && currentPrice >= order.takeProfit) {
        tpStatus = "hit";
      } else if (order.type === "sell" && currentPrice <= order.takeProfit) {
        tpStatus = "hit";
      } else {
        const distance =
          Math.abs(currentPrice - order.takeProfit) / order.takeProfit;
        tpStatus = distance < 0.02 ? "close" : "active";
      }
    }

    if (order.stopLoss) {
      if (order.type === "buy" && currentPrice <= order.stopLoss) {
        slStatus = "hit";
      } else if (order.type === "sell" && currentPrice >= order.stopLoss) {
        slStatus = "hit";
      } else {
        const distance =
          Math.abs(currentPrice - order.stopLoss) / order.stopLoss;
        slStatus = distance < 0.02 ? "close" : "active";
      }
    }

    return { tpStatus, slStatus };
  };

  const closePosition = async (orderId: string) => {
    try {
      setIsClosingPosition(orderId);
      const token = localStorage.getItem("token") || "";

      await closetrade(token, orderId);

      fetchOpenOrders();
      fetchClosedOrders();
    } catch (error) {
      console.error("Error closing position:", error);
    } finally {
      setIsClosingPosition(null);
    }
  };

  const handlePartialClose = async (orderId: string) => {
    try {
      setIsClosingPosition(orderId);
      const token = localStorage.getItem("token") || "";

      const percentage = parseFloat(partialClosePercentage);
      if (isNaN(percentage) || percentage < 1 || percentage > 99) {
        alert("Please enter a valid percentage between 1 and 99");
        setIsClosingPosition(null);
        return;
      }

      await partialCloseTrade(orderId, percentage, token);

      setShowPartialCloseModal(null);
      setPartialClosePercentage("50"); // Reset to default
      fetchOpenOrders();
      fetchClosedOrders();
    } catch (error) {
      console.error("Error partial closing position:", error);
      alert("Failed to partial close position: " + (error as Error).message);
    } finally {
      setIsClosingPosition(null);
    }
  };

  const handleAddMargin = async (orderId: string) => {
    try {
      setIsClosingPosition(orderId);
      const token = localStorage.getItem("token") || "";

      const margin = parseFloat(additionalMargin);
      if (isNaN(margin) || margin < 10) {
        alert("Please enter a valid amount (minimum $10)");
        setIsClosingPosition(null);
        return;
      }

      await addMarginToTrade(orderId, margin, token);

      setShowAddMarginModal(null);
      setAdditionalMargin("100"); // Reset to default
      fetchOpenOrders();
    } catch (error) {
      console.error("Error adding margin:", error);
      alert("Failed to add margin: " + (error as Error).message);
    } finally {
      setIsClosingPosition(null);
    }
  };

  return (
    <div className="bg-[color:color-mix(in_srgb,var(--nt-surface)_80%,transparent)] backdrop-blur-xl border border-[var(--nt-border)] rounded-lg w-full h-full flex flex-col">
      <div className="flex border-b border-[color:color-mix(in_srgb,var(--nt-border)_40%,transparent)]">
        <button
          type="button"
          aria-pressed={activeTab === "open"}
          className={`min-h-11 flex-1 py-2 text-center text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--nt-accent)] sm:text-sm ${
            activeTab === "open"
              ? "text-[var(--nt-accent)] border-b-2 border-[var(--nt-accent)]"
              : "text-[var(--nt-text)] hover:text-[var(--nt-text)]"
          }`}
          onClick={() => setActiveTab("open")}
        >
          Open Positions
        </button>
        <button
          type="button"
          aria-pressed={activeTab === "closed"}
          className={`min-h-11 flex-1 py-2 text-center text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--nt-accent)] sm:text-sm ${
            activeTab === "closed"
              ? "text-[var(--nt-accent)] border-b-2 border-[var(--nt-accent)]"
              : "text-[var(--nt-text)] hover:text-[var(--nt-text)]"
          }`}
          onClick={() => setActiveTab("closed")}
        >
          Order History
        </button>
        <button
          type="button"
          aria-pressed={activeTab === "activity"}
          className={`min-h-11 flex-1 py-2 text-center text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--nt-accent)] sm:text-sm ${
            activeTab === "activity"
              ? "text-[var(--nt-accent)] border-b-2 border-[var(--nt-accent)]"
              : "text-[var(--nt-text)] hover:text-[var(--nt-text)]"
          }`}
          onClick={() => setActiveTab("activity")}
        >
          Live activity{activity.length > 0 ? ` · ${activity.length}` : ""}
        </button>
      </div>

      <div className="p-4 overflow-auto flex-1">
        {isLoading ? (
          <div className="text-center py-8 text-[var(--nt-muted)]">Loading...</div>
        ) : activeTab === "open" ? (
          <>
            {openWithPnl.length > 0 ? (
              <div className="overflow-x-auto h-full">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[color:color-mix(in_srgb,var(--nt-surface)_80%,transparent)] backdrop-blur-sm z-10">
                    <tr className="text-xs text-[var(--nt-muted)] border-b border-[color:color-mix(in_srgb,var(--nt-border)_40%,transparent)]">
                      <th className="py-3 px-3 text-left font-medium">Position</th>
                      <th className="py-3 px-3 text-right font-medium">Margin</th>
                      <th className="py-3 px-3 text-right font-medium">Entry</th>
                      <th className="py-3 px-3 text-right font-medium">Risk levels</th>
                      <th className="py-3 px-3 text-right font-medium">Unrealized P&amp;L</th>
                      <th className="py-3 px-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openWithPnl.map((order) => {
                      const { tpStatus, slStatus } = getTpSlStatus(order);
                      const sym = (order.asset || "BTC").replace("USDT", "");
                      const p = latestPrices[sym as keyof LivePrices];
                      const currentPrice = p
                        ? order.type === "buy"
                          ? p.bid
                          : p.ask
                        : 0;
                      const liquidationDistance = order.liquidationPrice
                        ? Math.abs(currentPrice - order.liquidationPrice) /
                          order.liquidationPrice
                        : 1;

                      let rowStatus = "normal";
                      if (tpStatus === "hit" || slStatus === "hit") {
                        rowStatus = "executed";
                      } else if (
                        tpStatus === "close" ||
                        slStatus === "close" ||
                        liquidationDistance < 0.05
                      ) {
                        rowStatus = "warning";
                      }

                      return (
                        <tr
                          key={order.orderId}
                          className={`border-b border-[color:color-mix(in_srgb,var(--nt-border)_20%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--nt-surface2)_50%,transparent)] ${
                            rowStatus === "executed"
                              ? "bg-green-500/5"
                              : rowStatus === "warning"
                              ? "bg-yellow-500/5"
                              : ""
                          }`}
                        >
                          <td className="py-3 px-3 font-medium text-[var(--nt-text)]">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{order.asset || "BTC"}<span className="text-[var(--nt-muted)] text-xs">/USDT</span></span>
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              order.type === "buy"
                                ? "bg-[color:color-mix(in_srgb,var(--nt-accent)_12%,transparent)] text-[var(--nt-accent)]"
                                : "bg-red-500/10 text-red-400"
                              }`}>{order.type === "buy" ? "LONG" : "SHORT"}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right text-[var(--nt-text)]">
                            <div>{toDisplayPriceUSD(order.margin)} USD</div>
                            <div className="text-xs text-[var(--nt-muted)]">{order.leverage}x leverage</div>
                          </td>
                          <td className="py-3 px-3 text-right text-[var(--nt-text)]">
                            ${toDisplayPrice(order.openPrice)}
                          </td>
                          <td className="py-3 px-3 text-right">
                            <div className="space-y-1 text-xs">
                              <div><span className="text-[var(--nt-muted)]">TP </span><span className="text-green-400">{order.takeProfit ? `$${toDisplayPrice(order.takeProfit)}` : "—"}</span></div>
                              <div><span className="text-[var(--nt-muted)]">SL </span><span className="text-red-400">{order.stopLoss ? `$${toDisplayPrice(order.stopLoss)}` : "—"}</span></div>
                              <div><span className="text-[var(--nt-muted)]">Liq. </span><span className="text-orange-400">{order.liquidationPrice ? `$${toDisplayPrice(order.liquidationPrice)}` : "—"}</span></div>
                            </div>
                          </td>
                          <td
                            className={`py-3 px-3 text-right font-medium ${
                              order.pnlUsd >= 0
                                ? "text-green-500"
                                : "text-[#EB483F]"
                            }`}
                          >
                            {order.pnlUsd >= 0 ? "+" : ""}
                            {toDisplayPriceUSD(order.pnlUsd)} USD
                          </td>
                          <td className="py-3 px-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => closePosition(order.orderId)}
                                disabled={isClosingPosition === order.orderId}
                                title="Close position"
                                className={`min-h-10 px-3 py-2 text-[var(--nt-text)] rounded text-xs font-medium transition-colors
                                ${
                                  isClosingPosition === order.orderId
                                    ? "bg-[var(--nt-border)] cursor-not-allowed"
                                    : "bg-[#EB483F] hover:bg-[#EB483F]/80"
                                }`}
                              >
                                {isClosingPosition === order.orderId
                                  ? "..."
                                  : "Close"}
                              </button>
                              <button
                                onClick={() => setShowPartialCloseModal(order.orderId)}
                                disabled={isClosingPosition === order.orderId}
                                title="Partially close position"
                                aria-label="Partially close position"
                                className={`min-h-10 px-3 py-2 text-[var(--nt-text)] rounded text-xs font-medium transition-colors
                                ${
                                  isClosingPosition === order.orderId
                                    ? "bg-[var(--nt-border)] cursor-not-allowed"
                                    : "bg-yellow-600 hover:bg-yellow-600/80"
                                }`}
                              >
                                Partial
                              </button>
                              <button
                                onClick={() => setShowAddMarginModal(order.orderId)}
                                disabled={isClosingPosition === order.orderId}
                                title="Add margin"
                                aria-label="Add margin"
                                className={`min-h-10 px-3 py-2 text-[var(--nt-text)] rounded text-xs font-medium transition-colors
                                ${
                                  isClosingPosition === order.orderId
                                    ? "bg-[var(--nt-border)] cursor-not-allowed"
                                    : "bg-blue-600 hover:bg-blue-600/80"
                                }`}
                              >
                                +M
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex h-full min-h-40 flex-col items-center justify-center px-4 text-center">
                <span className="text-sm font-medium text-[var(--nt-text)]">No open positions</span>
                <span className="mt-1 text-xs text-[var(--nt-muted)]">Your active trades will appear here.</span>
              </div>
            )}

            {showPartialCloseModal && (
              <div className="fixed inset-0 bg-[color:color-mix(in_srgb,var(--nt-bg)_50%,transparent)] flex items-center justify-center z-50" onClick={() => {
                setShowPartialCloseModal(null);
                setPartialClosePercentage("50");
              }}>
                <div className="bg-[var(--nt-surface)] border border-[var(--nt-border)] rounded-lg p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-lg font-semibold text-[var(--nt-text)] mb-4">Partial Close Position</h3>
                  <div className="mb-4">
                    <label className="block text-sm text-[var(--nt-muted)] mb-2">Close Percentage (%)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={partialClosePercentage}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === "" || /^\d+$/.test(value)) {
                          setPartialClosePercentage(value);
                        }
                      }}
                      onFocus={(e) => {
                        if (e.target.value === "50") {
                          setPartialClosePercentage("");
                        }
                      }}
                      onBlur={(e) => {
                        if (e.target.value === "") {
                          setPartialClosePercentage("50");
                        }
                      }}
                      className="w-full px-3 py-2 bg-[var(--nt-surface2)] border border-[var(--nt-border)] rounded text-[var(--nt-text)] focus:outline-none focus:border-yellow-500"
                      placeholder="50"
                    />
                    <p className="text-xs text-[var(--nt-text)]0 mt-1">Enter 1-99% (cannot close 100% here)</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowPartialCloseModal(null);
                        setPartialClosePercentage("50");
                      }}
                      className="flex-1 px-4 py-2 bg-[var(--nt-border)] hover:bg-[var(--nt-border)] text-[var(--nt-text)] rounded text-sm font-medium transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePartialClose(showPartialCloseModal);
                      }}
                      disabled={isClosingPosition === showPartialCloseModal}
                      className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-600/80 text-[var(--nt-text)] rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isClosingPosition === showPartialCloseModal ? "Closing..." : `Confirm Close ${partialClosePercentage}%`}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showAddMarginModal && (
              <div className="fixed inset-0 bg-[color:color-mix(in_srgb,var(--nt-bg)_50%,transparent)] flex items-center justify-center z-50" onClick={() => {
                setShowAddMarginModal(null);
                setAdditionalMargin("100");
              }}>
                <div className="bg-[var(--nt-surface)] border border-[var(--nt-border)] rounded-lg p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-lg font-semibold text-[var(--nt-text)] mb-4">Add Margin to Position</h3>
                  <div className="mb-4">
                    <label className="block text-sm text-[var(--nt-muted)] mb-2">Additional Margin ($)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={additionalMargin}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === "" || /^\d*\.?\d*$/.test(value)) {
                          setAdditionalMargin(value);
                        }
                      }}
                      onFocus={(e) => {
                        if (e.target.value === "100") {
                          setAdditionalMargin("");
                        }
                      }}
                      onBlur={(e) => {
                        if (e.target.value === "") {
                          setAdditionalMargin("100");
                        }
                      }}
                      className="w-full px-3 py-2 bg-[var(--nt-surface2)] border border-[var(--nt-border)] rounded text-[var(--nt-text)] focus:outline-none focus:border-blue-500"
                      placeholder="100"
                    />
                    <p className="text-xs text-[var(--nt-text)]0 mt-1">Minimum $10 USD</p>
                    <p className="text-xs text-blue-400 mt-2">Adding margin reduces liquidation risk by lowering effective leverage</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowAddMarginModal(null);
                        setAdditionalMargin("100");
                      }}
                      className="flex-1 px-4 py-2 bg-[var(--nt-border)] hover:bg-[var(--nt-border)] text-[var(--nt-text)] rounded text-sm font-medium transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddMargin(showAddMarginModal);
                      }}
                      disabled={isClosingPosition === showAddMarginModal}
                      className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-600/80 text-[var(--nt-text)] rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isClosingPosition === showAddMarginModal ? "Adding..." : `Add $${additionalMargin}`}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : activeTab === "activity" ? (
          activity.length > 0 ? (
            <ol className="divide-y divide-[var(--nt-border)]" aria-live="polite" aria-label="Live order activity">
              {activity.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${item.event === "opened" ? "bg-[var(--nt-accent)]" : item.event === "liquidated" ? "bg-red-500" : "bg-emerald-500"}`} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--nt-text)]">{item.asset.replace("USDT", "")}/USDT <span className={item.side === "buy" ? "text-[var(--nt-accent)]" : "text-red-400"}>{item.side.toUpperCase()}</span> · {item.event}</p>
                      <p className="text-xs text-[var(--nt-muted)]">{new Date(item.timestamp).toLocaleTimeString()}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right font-mono text-sm text-[var(--nt-text)]">
                    ${item.price.toFixed(2)}
                    {item.pnl != null && <p className={`text-xs ${item.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>{item.pnl >= 0 ? "+" : "−"}${Math.abs(item.pnl).toFixed(2)}</p>}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="flex h-full min-h-40 flex-col items-center justify-center px-4 text-center">
              <span className="text-sm font-medium text-[var(--nt-text)]">No live orders yet</span>
              <span className="mt-1 text-xs text-[var(--nt-muted)]">New orders and closes will appear here in real time.</span>
            </div>
          )
        ) : historyError ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 px-4 text-center">
            <span className="text-sm text-red-400">{historyError}</span>
            <button type="button" onClick={() => fetchClosedOrders()} className="min-h-10 rounded-md border border-[var(--nt-border)] px-4 text-sm text-[var(--nt-text)] hover:bg-[var(--nt-surface2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nt-accent)]">Try again</button>
          </div>
        ) : closedOrders.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--nt-muted)] border-b border-[color:color-mix(in_srgb,var(--nt-border)_40%,transparent)]">
                  <th className="py-3 px-3 text-left font-medium w-12">#</th>
                  <th className="py-3 px-3 text-left font-medium">Symbol</th>
                  <th className="py-3 px-3 text-right font-medium">Type</th>
                  <th className="py-3 px-3 text-right font-medium">Margin</th>
                  <th className="py-3 px-3 text-right font-medium">Open Price</th>
                  <th className="py-3 px-3 text-right font-medium">Close Price</th>
                  <th className="py-3 px-3 text-right font-medium">P&L</th>
                </tr>
              </thead>
              <tbody>
                {closedOrders.map((order, index) => (
                  <tr
                    key={order.orderId}
                    className="border-b border-[color:color-mix(in_srgb,var(--nt-border)_20%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--nt-surface2)_50%,transparent)]"
                  >
                    <td className="py-3 px-3 text-left text-[var(--nt-muted)] font-medium">
                      {index + 1}
                    </td>
                    <td className="py-3 px-3 font-medium text-[var(--nt-text)]">
                      {order.asset || "BTC"}
                      <span className="text-[var(--nt-muted)] text-xs">/USDT</span>
                    </td>
                    <td
                      className={`py-3 px-3 text-right font-medium ${
                        order.type === "buy"
                          ? "text-[var(--nt-accent)]"
                          : "text-[#EB483F]"
                      }`}
                    >
                      {order.type === "buy" ? "LONG" : "SHORT"}
                    </td>
                    <td className="py-3 px-3 text-right text-[var(--nt-text)]">
                      {toDisplayPriceUSD(order.margin)} USD
                    </td>
                    <td className="py-3 px-3 text-right text-[var(--nt-text)]">
                      ${toDisplayPrice(order.openPrice)}
                    </td>
                    <td className="py-3 px-3 text-right text-[var(--nt-text)]">
                      ${toDisplayPrice(order.closePrice)}
                    </td>
                    <td
                      className={`py-3 px-3 text-right font-medium ${
                        toDisplayPriceUSD(order.pnl) >= 0
                          ? "text-green-500"
                          : "text-[#EB483F]"
                      }`}
                    >
                      {toDisplayPriceUSD(order.pnl) >= 0 ? "+" : ""}
                      {toDisplayPriceUSD(order.pnl)} USD
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex min-h-40 flex-col items-center justify-center text-center">
            <span className="text-sm font-medium text-[var(--nt-text)]">No order history yet</span>
            <span className="mt-1 text-xs text-[var(--nt-muted)]">Closed trades will appear here.</span>
          </div>
        )}
      </div>
    </div>
  );
}
