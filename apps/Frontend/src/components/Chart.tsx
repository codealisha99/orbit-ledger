"use client";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type UTCTimestamp,
  type Time,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { bucketStart, type CandleInterval } from "@orbitledger/shared";
import { api } from "@/lib/client";
import { useMarket, type Symbol } from "@/lib/market";
import type { Position } from "@/lib/account";

export type Range = "1D" | "1W" | "3W" | "1M" | "3M" | "1Y" | "ALL";
export const rangeDays: Record<Range, number> = {
  "1D": 1,
  "1W": 7,
  "3W": 21,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
  ALL: 3000,
};
export const defaultInterval: Record<Range, CandleInterval> = {
  "1D": "15m",
  "1W": "1h",
  "3W": "4h",
  "1M": "4h",
  "3M": "1d",
  "1Y": "1d",
  ALL: "1w",
};
interface Bar extends CandlestickData<UTCTimestamp> {
  volume?: string;
}
interface Coverage {
  actualStart: number | null;
  actualEnd: number | null;
  complete: boolean;
  source: string;
  count: number;
}
export default function Chart({
  symbol,
  interval,
  range,
  style,
  onInterval,
  onRange,
  onStyle,
  positions = [],
}: {
  symbol: Symbol;
  interval: CandleInterval;
  range: Range;
  style: "candles" | "line";
  onInterval: (v: CandleInterval) => void;
  onRange: (v: Range) => void;
  onStyle: (v: "candles" | "line") => void;
  positions?: Position[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const line = useRef<ISeriesApi<"Line"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const bars = useRef<Bar[]>([]);
  const byTime = useRef(new Map<number, Bar>());
  const hovering = useRef(false);
  const following = useRef(true);
  const [hover, setHover] = useState<Bar | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [retry, setRetry] = useState(0);
  const [follow, setFollow] = useState(true);
  const [showVolume, setShowVolume] = useState(false);
  const market = useMarket();
  const quote = market.quotes[symbol];
  useEffect(() => {
    if (!host.current) return;
    const c = createChart(host.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#000000" },
        textColor: "#9b9ba4",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#151519" },
        horzLines: { color: "#151519" },
      },
      rightPriceScale: { borderColor: "#242429" },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        minBarSpacing: 0.01,
        borderColor: "#242429",
      },
      localization: {
        timeFormatter: (time: Time) =>
          new Date(Number(time) * 1000).toLocaleString("en-GB", {
            timeZone: "UTC",
            dateStyle: "medium",
            timeStyle: "short",
          }),
      },
    });
    chart.current = c;
    candles.current = c.addSeries(CandlestickSeries, {
      upColor: "#4c94ff",
      downColor: "#ed6969",
      wickUpColor: "#4c94ff",
      wickDownColor: "#ed6969",
      borderVisible: false,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    line.current = c.addSeries(LineSeries, {
      color: "#4c94ff",
      lineWidth: 2,
      visible: false,
    });
    volume.current = c.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      visible: false,
    });
    c.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
      visible: false,
    });
    c.subscribeCrosshairMove((param) => {
      hovering.current = param.time !== undefined;
      setHover(
        param.time !== undefined
          ? (byTime.current.get(Number(param.time)) ?? null)
          : (bars.current.at(-1) ?? null),
      );
    });
    const theme = () => {
      const css = getComputedStyle(document.documentElement);
      const val = (name: string) => css.getPropertyValue(name).trim();
      candles.current?.applyOptions({
        upColor: val("--nt-accent"),
        wickUpColor: val("--nt-accent"),
        downColor: val("--nt-sell"),
        wickDownColor: val("--nt-sell"),
      });
      line.current?.applyOptions({ color: val("--nt-accent") });
      volume.current?.applyOptions({ color: val("--nt-accent") });
      c.applyOptions({
        layout: {
          background: { type: ColorType.Solid, color: val("--nt-bg") },
          textColor: val("--nt-muted"),
        },
        grid: {
          vertLines: { color: val("--nt-grid") },
          horzLines: { color: val("--nt-grid") },
        },
        rightPriceScale: { borderColor: val("--nt-border") },
        timeScale: { borderColor: val("--nt-border") },
      });
    };
    theme();
    const observer = new MutationObserver(theme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      observer.disconnect();
      c.remove();
      chart.current = null;
    };
  }, []);
  useEffect(() => {
    candles.current?.applyOptions({ visible: style === "candles" });
    line.current?.applyOptions({ visible: style === "line" });
  }, [style]);
  useEffect(() => {
    volume.current?.applyOptions({ visible: showVolume });
    chart.current?.applyOptions({
      rightPriceScale: {
        scaleMargins: { top: 0.08, bottom: showVolume ? 0.23 : 0.08 },
      },
    });
  }, [showVolume]);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    setCoverage(null);
    setHover(null);
    bars.current = [];
    byTime.current.clear();
    candles.current?.setData([]);
    line.current?.setData([]);
    volume.current?.setData([]);
    const start =
      range === "ALL"
        ? Date.UTC(2019, 0, 1) / 1000
        : Math.floor(Date.now() / 1000 - rangeDays[range] * 86400);
    api<{ candles: Bar[]; meta: Coverage }>(
      `asset/candles?asset=${symbol}&ts=${interval}&startTime=${start}&endTime=${Math.floor(Date.now() / 1000)}`,
      { signal: abort.signal },
    )
      .then((data) => {
        if (abort.signal.aborted) return;
        bars.current = data.candles;
        byTime.current = new Map(data.candles.map((b) => [Number(b.time), b]));
        candles.current?.setData(data.candles);
        line.current?.setData(
          data.candles.map((b) => ({ time: b.time, value: b.close })),
        );
        volume.current?.setData(
          data.candles.map((b) => ({
            time: b.time,
            value: Number(b.volume ?? 0),
          })),
        );
        chart.current?.timeScale().fitContent();
        following.current = true;
        setFollow(true);
        setHover(data.candles.at(-1) ?? null);
        setCoverage(data.meta);
        setLoading(false);
      })
      .catch((err) => {
        if (!abort.signal.aborted) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [symbol, interval, range, retry, market.reconnects]);
  useEffect(() => {
    if (loading || !quote || quote.symbol !== symbol) return;
    const time = bucketStart(
      Math.floor(quote.time / 1000),
      interval,
    ) as UTCTimestamp;
    const last = bars.current.at(-1);
    if (last && time < last.time) return;
    const price = quote.price / 10000;
    const bar: Bar =
      last?.time === time
        ? {
            ...last,
            close: price,
            high: Math.max(last.high, price),
            low: Math.min(last.low, price),
          }
        : { time, open: price, high: price, low: price, close: price };
    if (last?.time === time) bars.current[bars.current.length - 1] = bar;
    else bars.current.push(bar);
    byTime.current.set(Number(time), bar);
    candles.current?.update(bar);
    line.current?.update({ time, value: price });
    if (!hovering.current) setHover(bar);
    if (following.current && last?.time !== time)
      chart.current?.timeScale().scrollToRealTime();
  }, [quote, symbol, interval, loading]);
  useEffect(() => {
    const series = candles.current;
    if (!series) return;
    const lines = positions
      .filter((p) => p.asset === symbol)
      .flatMap<readonly [number | null, string]>(
        (p) =>
          [
            [p.openPrice, `${p.type === "buy" ? "Long" : "Short"} entry`],
            [p.takeProfit, "TP"],
            [p.stopLoss, "SL"],
            [p.liquidationPrice, "Liq"],
          ] as const,
      )
      .filter(
        (p): p is readonly [number, string] =>
          typeof p[0] === "number" && p[0] > 0,
      )
      .map(([price, title]) =>
        series.createPriceLine({
          price: price / 10000,
          title,
          color: title === "Liq" ? "#ed6969" : "#727985",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
        }),
      );
    return () => {
      if (chart.current) lines.forEach((l) => series.removePriceLine(l));
    };
  }, [positions, symbol]);
  const pause = () => {
    following.current = false;
    setFollow(false);
  };
  const stamp = (time: number) =>
    new Date(time * 1000).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  return (
    <section
      ref={panel}
      className="chart-panel surface"
      aria-label={`${symbol} price chart`}
    >
      <div className="chart-toolbar">
        <label>
          Candle interval{" "}
          <select
            aria-label="Candle interval"
            value={interval}
            onChange={(e) => onInterval(e.target.value as CandleInterval)}
          >
            {["1m", "5m", "15m", "1h", "4h", "1d", "1w"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <div className="segmented" aria-label="Chart style">
          {(["candles", "line"] as const).map((v) => (
            <button
              key={v}
              aria-pressed={style === v}
              onClick={() => onStyle(v)}
            >
              {v === "candles" ? "Candles" : "Line"}
            </button>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={showVolume}
            onChange={(e) => setShowVolume(e.target.checked)}
          />
          Volume (history)
        </label>
        <button
          className="quiet"
          aria-label="Zoom in chart"
          onClick={() => {
            const t = chart.current?.timeScale();
            const r = t?.getVisibleLogicalRange();
            if (t && r) {
              const n = (r.to - r.from) * 0.15;
              t.setVisibleLogicalRange({ from: r.from + n, to: r.to - n });
            }
          }}
        >
          +
        </button>
        <button
          className="quiet"
          aria-label="Zoom out chart"
          onClick={() => {
            const t = chart.current?.timeScale();
            const r = t?.getVisibleLogicalRange();
            if (t && r) {
              const n = (r.to - r.from) * 0.15;
              t.setVisibleLogicalRange({ from: r.from - n, to: r.to + n });
            }
          }}
        >
          −
        </button>
        <button
          className="quiet fullscreen"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void panel.current?.requestFullscreen();
          }}
        >
          Fullscreen
        </button>
      </div>
      <div className="ohlc" aria-live="off">
        {(style === "candles"
          ? [
              ["O", hover?.open],
              ["H", hover?.high],
              ["L", hover?.low],
              ["C", hover?.close],
            ]
          : [["Price", hover?.close]]
        ).map(([label, value]) => (
          <span key={String(label)}>
            {label}{" "}
            <b>
              {typeof value === "number"
                ? value.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 4,
                  })
                : "—"}
            </b>
          </span>
        ))}
        <time>
          {hover
            ? new Date(Number(hover.time) * 1000).toLocaleString("en-GB", {
                timeZone: "UTC",
                dateStyle: "medium",
                timeStyle: "short",
              }) + " UTC"
            : ""}
        </time>
      </div>
      <div
        className="chart-canvas"
        ref={host}
        onWheel={pause}
        onPointerDown={pause}
      />
      {(loading || error || !coverage?.count) && (
        <div className="chart-state" role="status">
          {loading ? (
            "Loading market history…"
          ) : error ? (
            <>
              {error}
              <button onClick={() => setRetry((n) => n + 1)}>
                Retry history
              </button>
            </>
          ) : (
            "No stored history for this period. Try a different interval or range."
          )}
        </div>
      )}
      <div className="chart-range">
        <span>Range</span>
        <div className="range-buttons">
          {(Object.keys(rangeDays) as Range[]).map((v) => (
            <button
              key={v}
              aria-pressed={range === v}
              onClick={() => onRange(v)}
            >
              {v === "ALL" ? "All" : v}
            </button>
          ))}
        </div>
        <button
          className="quiet"
          onClick={() => {
            chart.current?.timeScale().fitContent();
            following.current = true;
            setFollow(true);
          }}
        >
          Fit range
        </button>
        {!follow && (
          <button
            className="quiet"
            onClick={() => {
              chart.current?.timeScale().scrollToRealTime();
              following.current = true;
              setFollow(true);
            }}
          >
            Return to latest
          </button>
        )}
      </div>
      <div className="coverage">
        {coverage?.actualStart != null && coverage.actualEnd != null ? (
          <>
            {stamp(coverage.actualStart)} – {stamp(coverage.actualEnd)} ·{" "}
            {coverage.count.toLocaleString()} bars · {interval} candles · UTC
            {!coverage.complete && <strong> Partial history</strong>}
          </>
        ) : (
          "Historical coverage unavailable"
        )}
        <span>{coverage?.source}</span>
      </div>
    </section>
  );
}
