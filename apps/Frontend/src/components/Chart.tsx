"use client";

import {
  createChart,
  ColorType,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
  type CandlestickData,
  type CandlestickSeriesOptions,
  type CandlestickStyleOptions,
  type DeepPartial,
  type ISeriesApi,
  type SeriesOptionsCommon,
  type Time,
  type TickMarkType,
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
import { toDisplayPrice } from "../utils/utils";

type HistoryRange = "1D" | "3D" | "1W" | "1M" | "3M" | "1Y" | "ALL";

const HISTORY_RANGES: Record<Duration, HistoryRange[]> = {
  "1m": ["1D", "3D"],
  "5m": ["1D", "1W", "1M"],
  "15m": ["1W", "1M", "3M"],
  "1h": ["1W", "1M", "1Y"],
  "4h": ["1M", "3M", "1Y"],
  "1d": ["1M", "3M", "1Y", "ALL"],
  "1w": ["1M", "3M", "1Y", "ALL"],
};

function getHistoryStartTime(range: HistoryRange): number {
  const now = Date.now();
  if (range === "ALL") return Math.floor(Date.UTC(2019, 0, 1) / 1000);
  const durationMs: Record<Exclude<HistoryRange, "ALL">, number> = {
    "1D": 24 * 60 * 60 * 1000,
    "3D": 3 * 24 * 60 * 60 * 1000,
    "1W": 7 * 24 * 60 * 60 * 1000,
    "1M": 30 * 24 * 60 * 60 * 1000,
    "3M": 90 * 24 * 60 * 60 * 1000,
    "1Y": 365 * 24 * 60 * 60 * 1000,
  };
  return Math.floor((now - durationMs[range]) / 1000);
}

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
  const fitChartToDataRef = useRef<() => void>(() => {});
  const [tooltip, setTooltip] = useState<string | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [followMode, setFollowMode] = useState<boolean>(true);
  const [historyRange, setHistoryRange] = useState<HistoryRange>("1D");
  const [chartType, setChartType] = useState<"candles" | "line">("candles");
  const selectedHistoryRange = HISTORY_RANGES[duration].includes(historyRange)
    ? historyRange
    : duration === Duration.candles_1d || duration === Duration.candles_1w
      ? "ALL"
      : HISTORY_RANGES[duration][0];
  const [theme, setTheme] = useState("dark");
  const tooltipTimeoutRef = useRef<number | null>(null);
  const userScrolledRef = useRef<boolean>(false);
  const lastCandleTimeRef = useRef<number>(0);
  const followModeRef = useRef(true);
  const latestLogicalIndexRef = useRef(0);
  const isHoveringChartRef = useRef(false);
  const [hoveredCandle, setHoveredCandle] = useState<CandlestickData<Time> | null>(null);
  followModeRef.current = followMode;

  useEffect(() => {
    const root = document.documentElement;
    const updateTheme = () => setTheme(root.dataset.theme || "dark");
    const observer = new MutationObserver(updateTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    updateTheme();
    return () => observer.disconnect();
  }, []);

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
    let lineSeries: ISeriesApi<"Line"> | null = null;
    let chart: IChartApi | null = null;
    let unwatch: (() => void) | null = null;
    let isCleanedUp = false;

    const initChart = async () => {
      try {
        setLoading(true);
        setError(null);

        const styles = getComputedStyle(document.documentElement);
        const surface = styles.getPropertyValue("--nt-surface2").trim();
        const foreground = styles.getPropertyValue("--nt-text").trim();
        const accent = styles.getPropertyValue("--nt-accent").trim();
        chart = createChart(chartContainerRef.current!, {
          layout: {
            background: {
              type: ColorType.VerticalGradient,
              topColor: surface,
              bottomColor: surface,
            },
            textColor: foreground,
          },
          grid: {
            vertLines: { color: theme === "dark" ? "rgba(148,163,184,0.09)" : "rgba(71,85,105,0.12)" },
            horzLines: { color: theme === "dark" ? "rgba(148,163,184,0.09)" : "rgba(71,85,105,0.12)" },
          },
          width: chartContainerRef.current!.clientWidth,
          height: chartContainerRef.current!.clientHeight,
          rightPriceScale: { borderColor: styles.getPropertyValue("--nt-border").trim(), scaleMargins: { top: 0.08, bottom: 0.08 } },
          timeScale: {
            timeVisible: duration !== Duration.candles_1d && duration !== Duration.candles_1w,
            secondsVisible: false,
            barSpacing: 8,
            minBarSpacing: 4,
            rightOffset: 6,
            borderColor: styles.getPropertyValue("--nt-border").trim(),
            lockVisibleTimeRangeOnResize: true,
            tickMarkFormatter: (timestamp: Time, _tickMarkType: TickMarkType, locale: string) => {
              const date = typeof timestamp === "number"
                ? new Date(timestamp * 1000)
                : typeof timestamp === "string"
                  ? new Date(timestamp)
                  : new Date(Date.UTC(timestamp.year, timestamp.month - 1, timestamp.day));
              if (duration === Duration.candles_1w || duration === Duration.candles_1d) {
                return date.toLocaleDateString(locale, { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" });
              }
              return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
            },
          },
          localization: {
            timeFormatter: (timestamp: Time) => {
              const date = typeof timestamp === "number"
                ? new Date(timestamp * 1000)
                : typeof timestamp === "string"
                  ? new Date(timestamp)
                  : new Date(Date.UTC(timestamp.year, timestamp.month - 1, timestamp.day));
              if (duration === Duration.candles_1w || duration === Duration.candles_1d) {
                return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" });
              }
              return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
            },
          },
          crosshair: {
            vertLine: { color: `${accent}80`, labelBackgroundColor: accent },
            horzLine: { color: `${accent}80`, labelBackgroundColor: accent },
          },
        });

        if (chartType === "candles") candlestickSeries = chart.addSeries(CandlestickSeries, {
          upColor: accent,
          downColor: "#EB483F",
          borderVisible: false,
          wickUpColor: accent,
          wickDownColor: "#EB483F",
          lastValueVisible: true,
          priceLineVisible: true,
          priceLineColor: accent,
          priceLineStyle: 2,
          priceLineWidth: 1,
        });
        else lineSeries = chart.addSeries(LineSeries, {
          color: accent,
          lineWidth: 2,
          lastValueVisible: true,
          priceLineVisible: true,
          priceLineColor: accent,
          priceLineStyle: 2,
          priceLineWidth: 1,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 4,
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

          if (candle && (candlestickSeries || lineSeries)) {
            const isNewCandle = Number(candle.time) > lastCandleTimeRef.current;
            if (isNewCandle) {
              lastCandleTimeRef.current = Number(candle.time);
              latestLogicalIndexRef.current += 1;
            }
            if (candlestickSeries) candlestickSeries.update(candle);
            if (lineSeries) lineSeries.update({ time: candle.time, value: candle.close });
            if (!isHoveringChartRef.current) setHoveredCandle(candle);
            if (isNewCandle && followModeRef.current && !userScrolledRef.current && chart) {
              chart.timeScale().scrollToRealTime();
            }
          } else {
            console.warn(`[CHART] Failed to update candle - candle:`, candle, "series:", !!(candlestickSeries || lineSeries));
          }
        };

        const rawData = await getChartData(symbol, duration, getHistoryStartTime(selectedHistoryRange)) as CandlestickData<Time>[];
        if (isCleanedUp) return;

        if (candlestickSeries) {
          candlestickSeries.setData([]);
          candlestickSeries.setData(rawData);
          const latest = rawData[rawData.length - 1] as CandlestickData<Time> | undefined;
          setHoveredCandle(latest ?? null);
          latestLogicalIndexRef.current = Math.max(0, rawData.length - 1);
          lastCandleTimeRef.current = latest ? Number(latest.time) : 0;
        }
        if (lineSeries) {
          lineSeries.setData(rawData.map(({ time, close }) => ({ time, value: close })));
          const latest = rawData[rawData.length - 1];
          setHoveredCandle(latest ?? null);
          latestLogicalIndexRef.current = Math.max(0, rawData.length - 1);
          lastCandleTimeRef.current = latest ? Number(latest.time) : 0;
        }
        if (chart) {
          const dataLength = rawData.length;
          const normalVisibleCandles = duration === Duration.candles_1w ? 40 : duration === Duration.candles_1d ? 45 : 75;
          const visibleCandles = selectedHistoryRange === "ALL" && dataLength >= 20
            ? dataLength + 6
            : normalVisibleCandles;
          fitChartToDataRef.current = () => {
            if (!chart || (!candlestickSeries && !lineSeries)) return;
            const seriesLength = (candlestickSeries ?? lineSeries)!.data().length;
            if (seriesLength < 20) {
              const rangeEnd = seriesLength + 6;
              chart.timeScale().setVisibleLogicalRange({ from: rangeEnd - visibleCandles, to: rangeEnd });
            } else {
              chart.timeScale().fitContent();
            }
          };
          if (dataLength > 0) {
            const to = dataLength + 6;
            chart.timeScale().setVisibleLogicalRange({ from: to - visibleCandles, to });
            chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
              if (!range) return;
              const shouldPause = range.to < latestLogicalIndexRef.current - 0.5;
              userScrolledRef.current = shouldPause;
              if (followModeRef.current === shouldPause) {
                followModeRef.current = !shouldPause;
                setFollowMode(!shouldPause);
              }
            });
          } else {
            chart.timeScale().fitContent();
          }

          if (candlestickSeries || lineSeries) {
            chart.subscribeCrosshairMove((param) => {
              isHoveringChartRef.current = param.time !== undefined;
              if (candlestickSeries) {
                const data = param.seriesData.get(candlestickSeries);
                if (data && "open" in data) setHoveredCandle(data as CandlestickData<Time>);
                else setHoveredCandle((candlestickSeries.data().at(-1) as CandlestickData<Time> | undefined) ?? null);
              } else if (lineSeries) {
                const lineData = param.seriesData.get(lineSeries);
                const lineValue = lineData && "value" in lineData ? lineData.value : undefined;
                if (lineValue !== undefined) {
                  const latest = rawData[rawData.length - 1];
                  if (latest) setHoveredCandle({ ...latest, close: lineValue });
                } else setHoveredCandle(rawData[rawData.length - 1] ?? null);
              }
            });
          }
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
      }
    };

    initChart();
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      isCleanedUp = true;

      if (unwatch) {
        unwatch();
        unwatch = null;
      }

      resizeObserver.disconnect();
      resetLastCandle(symbol, duration);

      if (chart) {
        chart.remove();
        chart = null;
      }
      fitChartToDataRef.current = () => {};

      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
      candlestickSeries = null;
      lineSeries = null;
    };
  }, [duration, selectedHistoryRange, symbol, onPriceUpdate, theme, chartType]);

  return (
    <div className="text-[var(--nt-text)] h-full w-full relative">
      {tooltipVisible && tooltip && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2 bg-[color:color-mix(in_srgb,var(--nt-surface)_90%,transparent)] backdrop-blur-sm border border-[var(--nt-border)] rounded-lg text-sm shadow-lg transition-opacity">
          {tooltip}
        </div>
      )}
      <div className="bg-[var(--nt-surface)] backdrop-blur-xl border border-[var(--nt-border)] rounded-xl overflow-hidden h-full w-full flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-b border-[var(--nt-border)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--nt-text)]">{symbol}</h2>
            <div className="text-sm text-[var(--nt-muted)]">
              {duration === Duration.candles_1m && "1 minute"}
              {duration === Duration.candles_5m && "5 minutes"}
              {duration === Duration.candles_15m && "15 minutes"}
              {duration === Duration.candles_1h && "1 hour"}
              {duration === Duration.candles_4h && "4 hours"}
              {duration === Duration.candles_1d && "1 day"}
              {duration === Duration.candles_1w && "1 week"}
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-x-4 gap-y-1 px-2 font-mono text-[11px] sm:text-xs" aria-label={chartType === "candles" ? "Selected candle values" : "Selected price"}>
            {(chartType === "candles" ? [['O', hoveredCandle?.open], ['H', hoveredCandle?.high], ['L', hoveredCandle?.low], ['C', hoveredCandle?.close]] as const : [['Price', hoveredCandle?.close]] as const).map(([label, value]) => (
              <span key={label} className="whitespace-nowrap text-[var(--nt-muted)]">{label} <strong className="font-medium text-[var(--nt-text)]">{value == null ? "—" : `$${toDisplayPrice(value)}`}</strong></span>
            ))}
          </div>
          <div className="flex items-center gap-0.5 rounded-lg bg-[var(--nt-surface2)] p-1" role="group" aria-label="Chart style">
            {([['candles', 'Candles'], ['line', 'Line']] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={chartType === value} onClick={() => setChartType(value)} className={`min-h-9 rounded-md px-2.5 text-[10px] font-medium transition-colors sm:text-xs ${chartType === value ? "bg-[var(--nt-bg)] text-[var(--nt-text)] shadow-sm" : "text-[var(--nt-muted)] hover:text-[var(--nt-text)]"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-0.5 rounded-lg bg-[var(--nt-surface2)] p-1" role="group" aria-label="Chart history range">
            {HISTORY_RANGES[duration].map((range) => (
              <button
                key={range}
                type="button"
                aria-pressed={selectedHistoryRange === range}
                title={range === "ALL" ? "Show all stored history since 2019" : `Show ${range} of history`}
                onClick={() => setHistoryRange(range)}
                className={`min-h-9 rounded-md px-2 text-[10px] font-medium transition-colors sm:px-2.5 sm:text-xs ${selectedHistoryRange === range ? "bg-[var(--nt-bg)] text-[var(--nt-text)] shadow-sm" : "text-[var(--nt-muted)] hover:text-[var(--nt-text)]"}`}
              >
                {range}
              </button>
            ))}
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
                  ? "bg-[color:color-mix(in_srgb,var(--nt-surface2)_10%,transparent)] text-[var(--nt-text)] border border-[color:color-mix(in_srgb,var(--nt-border)_30%,transparent)]"
                  : "bg-[var(--nt-surface2)] text-[var(--nt-muted)] border border-[var(--nt-border)]"
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
            <div className="flex items-center border border-[var(--nt-border)] rounded-lg bg-[var(--nt-surface2)]">
              <button
                aria-label="Zoom in"
                title="Zoom in"
                className="min-h-10 min-w-10 flex items-center justify-center rounded-l-lg hover:bg-[var(--nt-surface)] transition-colors text-[var(--nt-muted)] hover:text-[var(--nt-text)]"
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
              <div className="w-[1px] h-8 bg-[var(--nt-border)]"></div>
              <button
                aria-label="Zoom out"
                title="Zoom out"
                className="min-h-10 min-w-10 flex items-center justify-center hover:bg-[var(--nt-surface)] transition-colors text-[var(--nt-muted)] hover:text-[var(--nt-text)]"
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
              <div className="w-[1px] h-8 bg-[var(--nt-border)]"></div>
              <button
                aria-label="Fit chart to data"
                title="Fit chart to data"
                className="min-h-10 min-w-10 flex items-center justify-center rounded-r-lg hover:bg-[var(--nt-surface)] transition-colors text-[var(--nt-muted)] hover:text-[var(--nt-text)]"
                onClick={() => {
                  if (chartRef.current) {
                    fitChartToDataRef.current();
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
            <div className="absolute inset-0 flex items-center justify-center bg-[color:color-mix(in_srgb,var(--nt-surface)_50%,transparent)] backdrop-blur-sm z-10">
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 border-4 border-[var(--nt-border)] border-t-[var(--nt-accent)] rounded-full animate-spin"></div>
                <p className="text-sm text-[var(--nt-muted)]">Loading chart data...</p>
              </div>
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[color:color-mix(in_srgb,var(--nt-surface)_50%,transparent)] backdrop-blur-sm z-10">
              <div className="flex flex-col items-center gap-3 p-6 bg-[var(--nt-surface2)] border border-red-500/30 rounded-xl">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <p className="text-red-400 font-medium">{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="mt-2 px-4 py-2 bg-[var(--nt-border)] hover:bg-[color:color-mix(in_srgb,var(--nt-accent)_20%,transparent)] text-[var(--nt-text)] rounded-lg transition-colors"
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
