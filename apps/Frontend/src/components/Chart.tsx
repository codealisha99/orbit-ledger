"use client";

import {
  createChart,
  ColorType,
  CandlestickSeries,
  type IChartApi,
  type CandlestickData,
  type CandlestickSeriesOptions,
  type CandlestickStyleOptions,
  type DeepPartial,
  type ISeriesApi,
  type SeriesOptionsCommon,
  type Time,
  type WhitespaceData,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import type { SYMBOL } from "../utils/constants";
import { Duration } from "../utils/constants";
import { Signalingmanager } from "../utils/subscription_manager";
import {
  getChartData,
  processRealupdate,
  resetLastCandle,
  type RealtimeUpdate,
} from "../utils/chart_agg_ws_api";
import type { Trade } from "./AskBidsTable";

export default function ChartComponent({
  duration,
  symbol,
  onPriceUpdate,
}: {
  duration: Duration;
  symbol: SYMBOL;
  onPriceUpdate?: (prices: { bidPrice: number; askPrice: number }) => void;
}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [tooltip, setTooltip] = useState<string | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [followMode, setFollowMode] = useState<boolean>(true);
  const tooltipTimeoutRef = useRef<number | null>(null);
  const userScrolledRef = useRef<boolean>(false);
  const lastCandleTimeRef = useRef<number>(0);

  useEffect(() => {
  }, [symbol]);

  useEffect(() => {
    if (tooltip) {
      setTooltipVisible(true);
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
      tooltipTimeoutRef.current = window.setTimeout(() => {
        setTooltipVisible(false);
        setTooltip(null);
      }, 1500);
    }
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
    };
  }, [tooltip]);

  useEffect(() => {
    if (!chartContainerRef.current || !symbol) return;

    let candlestickSeries: ISeriesApi<
      "Candlestick",
      Time,
      CandlestickData<Time> | WhitespaceData<Time>,
      CandlestickSeriesOptions,
      DeepPartial<CandlestickStyleOptions & SeriesOptionsCommon>
    > | null = null;
    let chart: IChartApi | null = null;
    let unwatch: (() => void) | null = null;
    let isCleanedUp = false;

    const initChart = async () => {
      try {
        setLoading(true);
        setError(null);

        chart = createChart(chartContainerRef.current!, {
          layout: {
            background: {
              type: ColorType.VerticalGradient,
              topColor: "#141D22",
              bottomColor: "#141D22",
            },
            textColor: "#FFFFFF",
          },
          width: chartContainerRef.current!.clientWidth,
          height: chartContainerRef.current!.clientHeight,
          timeScale: {
            timeVisible: true,
            secondsVisible: false,
            barSpacing: 12,
            minBarSpacing: 8,
            rightOffset: 12,
          },
          localization: {
            timeFormatter: (timestamp: any) => {
              const date = new Date(timestamp * 1000);
              const hours = date.getHours().toString().padStart(2, "0");
              const minutes = date.getMinutes().toString().padStart(2, "0");
              return `${hours}:${minutes}`;
            },
          },
        });

        candlestickSeries = chart.addSeries(CandlestickSeries, {
          upColor: "#0EA5E9",
          downColor: "#EB483F",
          borderVisible: false,
          wickUpColor: "#0EA5E9",
          wickDownColor: "#EB483F",
        });

        const tickWrapper = (trade: Trade) => {
          if (isCleanedUp) {
            return;
          }

          if (!trade.symbol || trade.symbol !== symbol) {
            return;
          }

          if (!trade.bidPrice || !trade.askPrice || isNaN(trade.bidPrice) || isNaN(trade.askPrice)) {
            console.warn(`[CHART] Invalid price data for ${symbol}:`, trade);
            return;
          }

          const prices = { bidPrice: trade.bidPrice || 0, askPrice: trade.askPrice || 0 };
          if (onPriceUpdate && prices.bidPrice > 0 && prices.askPrice > 0) {
            onPriceUpdate(prices);
          }

          const tick: RealtimeUpdate = {
            symbol: trade.symbol,
            bidPrice: trade.bidPrice,
            askPrice: trade.askPrice,
            time: Math.floor(Date.now() / 1000),
          };

          const candle = processRealupdate(tick, duration);

          if (candle && candlestickSeries) {
            candlestickSeries.update(candle);
            if (followMode && !userScrolledRef.current && chart) {
              if (candle.time !== lastCandleTimeRef.current) {
                lastCandleTimeRef.current = candle.time as number;
                setTimeout(() => {
                  if (chart) {
                    chart.timeScale().scrollToRealTime();
                  }
                }, 50);
              }
            }
          } else {
            console.warn(`[CHART] Failed to update candle - candle:`, candle, "series:", !!candlestickSeries);
          }
        };

        const rawData = await getChartData(symbol, duration);
        if (isCleanedUp) return;

        if (candlestickSeries) {
          candlestickSeries.setData([]);
          candlestickSeries.setData(rawData);
        }
        if (chart) {
          const dataLength = rawData.length;
          if (dataLength > 0) {
            let visibleCandles: number;
            switch (duration) {
              case Duration.candles_1m:
                visibleCandles = 60;
                break;
              case Duration.candles_1d:
                visibleCandles = 30;
                break;
              case Duration.candles_1w:
                visibleCandles = 20;
                break;
              default:
                visibleCandles = 60;
            }
            const from = Math.max(0, dataLength - visibleCandles);
            const to = dataLength - 1;
            chart.timeScale().setVisibleLogicalRange({ from, to });
          } else {
            chart.timeScale().fitContent();
          }

          chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
            if (!followMode) return;
            userScrolledRef.current = true;
            setTimeout(() => {
              userScrolledRef.current = false;
            }, 3000);
          });
        }

        const signalingManager = Signalingmanager.getInstance();
        unwatch = signalingManager.watch(symbol, tickWrapper);
        chartRef.current = chart;
        setLoading(false);
      } catch (err) {
        if (isCleanedUp) return;

        console.error("Failed to load chart data:", err);
        setError("Failed to load chart data. Please try again.");
        setLoading(false);
      }
    };

    const handleResize = () => {
      if (chartContainerRef.current && chart) {
        const parent = chartContainerRef.current;
        chart.applyOptions({
          width: parent.clientWidth,
          height: parent.clientHeight,
        });
        chart.timeScale().fitContent();
      }
    };

    initChart();
    setTimeout(handleResize, 100);
    window.addEventListener("resize", handleResize);

    return () => {
      isCleanedUp = true;

      if (unwatch) {
        unwatch();
        unwatch = null;
      }

      window.removeEventListener("resize", handleResize);
      resetLastCandle(symbol, duration);

      if (chart) {
        chart.remove();
        chart = null;
      }

      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
      candlestickSeries = null;
    };
  }, [duration, symbol, onPriceUpdate]);

  return (
    <div className="text-[#f3f4f6] h-full w-full relative">
      {tooltipVisible && tooltip && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2 bg-[#0a1929]/90 backdrop-blur-sm border border-[#1e3a5f] rounded-lg text-sm shadow-lg transition-opacity">
          {tooltip}
        </div>
      )}
      <div className="bg-[#0f0f10] backdrop-blur-xl border border-[#2b2b2c] rounded-xl overflow-hidden h-full w-full flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-b border-[#2b2b2c]">
          <div>
            <h2 className="text-lg font-semibold text-[#f3f4f6]">{symbol}</h2>
            <div className="text-sm text-[#9ca3af]">
              {duration === Duration.candles_1m && "1 Minute Chart"}
              {duration === Duration.candles_1d && "Daily Chart"}
              {duration === Duration.candles_1w && "Weekly Chart"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setFollowMode(!followMode);
                setTooltip(followMode ? "Follow Mode: OFF" : "Follow Mode: ON");
                if (!followMode && chartRef.current) {
                  chartRef.current.timeScale().scrollToRealTime();
                }
              }}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                followMode
                  ? "bg-white/10 text-white border border-white/30"
                  : "bg-[#171717] text-[#9ca3af] border border-[#2f2f2f]"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {followMode ? (
                    <>
                      <polyline points="23 4 23 10 17 10"></polyline>
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                    </>
                  ) : (
                    <>
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="8" x2="12" y2="12"></line>
                      <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </>
                  )}
                </svg>
                <span>{followMode ? "Live" : "Paused"}</span>
              </div>
            </button>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center border border-[#2f2f2f] rounded-lg bg-[#171717]">
              <button
                className="p-2 rounded-l-lg hover:bg-white/10 transition-colors text-[#9ca3af] hover:text-[#f3f4f6]"
                onClick={() => {
                  if (chartRef.current) {
                    const logicalRange = chartRef.current.timeScale().getVisibleLogicalRange();
                    if (logicalRange !== null) {
                      chartRef.current.timeScale().setVisibleLogicalRange({
                        from: logicalRange.from + (logicalRange.to - logicalRange.from) * 0.2,
                        to: logicalRange.to - (logicalRange.to - logicalRange.from) * 0.2,
                      });
                      setTooltip("Zoomed in");
                    }
                  }
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  <line x1="11" y1="8" x2="11" y2="14"></line>
                  <line x1="8" y1="11" x2="14" y2="11"></line>
                </svg>
              </button>
              <div className="w-[1px] h-8 bg-[#2f2f2f]"></div>
              <button
                className="p-2 hover:bg-white/10 transition-colors text-[#9ca3af] hover:text-[#f3f4f6]"
                onClick={() => {
                  if (chartRef.current) {
                    const logicalRange = chartRef.current.timeScale().getVisibleLogicalRange();
                    if (logicalRange !== null) {
                      const rangeSize = logicalRange.to - logicalRange.from;
                      chartRef.current.timeScale().setVisibleLogicalRange({
                        from: logicalRange.from - rangeSize * 0.2,
                        to: logicalRange.to + rangeSize * 0.2,
                      });
                      setTooltip("Zoomed out");
                    }
                  }
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  <line x1="8" y1="11" x2="14" y2="11"></line>
                </svg>
              </button>
              <div className="w-[1px] h-8 bg-[#2f2f2f]"></div>
              <button
                className="p-2 rounded-r-lg hover:bg-white/10 transition-colors text-[#9ca3af] hover:text-[#f3f4f6]"
                onClick={() => {
                  if (chartRef.current) {
                    chartRef.current.timeScale().fitContent();
                    setTooltip("Reset zoom");
                  }
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                  <polyline points="9 22 9 12 15 12 15 22"></polyline>
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div className="flex-grow relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0a1929]/50 backdrop-blur-sm z-10">
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 border-4 border-[#1e3a5f] border-t-[#0EA5E9] rounded-full animate-spin"></div>
                <p className="text-sm text-[#94a3b8]">Loading chart data...</p>
              </div>
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0a1929]/50 backdrop-blur-sm z-10">
              <div className="flex flex-col items-center gap-3 p-6 bg-[#0d2137] border border-red-500/30 rounded-xl">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <p className="text-red-400 font-medium">{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="mt-2 px-4 py-2 bg-[#1e3a5f] hover:bg-[#0EA5E9]/20 text-[#e2e8f0] rounded-lg transition-colors"
                >
                  Reload Page
                </button>
              </div>
            </div>
          )}
          <div ref={chartContainerRef} className="h-full w-full" />
        </div>
      </div>
    </div>
  );
}
