"use client";
import { useEffect, useState, useRef } from "react";
import { api } from "@/lib/client";
import { money } from "@orbitledger/shared";
interface Point {
  time: string;
  equityCents: number | null;
  stale: boolean;
}
export default function EquityHistory() {
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(1000);
  const [days, setDays] = useState(7);
  const [cadence, setCadence] = useState(5);
  const [points, setPoints] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    api<{ points: Point[]; cadenceMinutes: number }>(
      `trade/equity?days=${days}`,
      { signal: abort.signal },
    )
      .then((data) => {
        setPoints(data.points);
        setCadence(data.cadenceMinutes);
        setError(null);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [days, retry]);
  const valid = points.filter(
    (p): p is Point & { equityCents: number } =>
      !p.stale && p.equityCents !== null,
  );
  useEffect(() => {
    if (!svg.current) return;
    const measure = () =>
      setWidth(Math.max(280, (svg.current?.clientWidth ?? 1032) - 32));
    const observer = new ResizeObserver(measure);
    observer.observe(svg.current);
    measure();
    return () => observer.disconnect();
  }, [loading, valid.length]);
  const min = Math.min(...valid.map((p) => p.equityCents));
  const max = Math.max(...valid.map((p) => p.equityCents));
  const start = points.length ? new Date(points[0]!.time).getTime() : 0;
  const end = points.length ? new Date(points.at(-1)!.time).getTime() : 1;
  const x = (p: Point) =>
    50 +
    ((new Date(p.time).getTime() - start) / Math.max(1, end - start)) *
      (width - 100);
  const y = (v: number) => 170 - ((v - min) / Math.max(100, max - min)) * 130;
  const segments: Point[][] = [];
  for (const point of points) {
    if (point.stale || point.equityCents === null) {
      segments.push([]);
      continue;
    }
    if (!segments.length) segments.push([]);
    const previous = segments.at(-1)!.at(-1);
    if (
      previous &&
      new Date(point.time).getTime() - new Date(previous.time).getTime() >
        (cadence + 10) * 60000
    )
      segments.push([]);
    segments.at(-1)!.push(point);
  }
  return (
    <section className="surface equity-history">
      <div className="section-heading">
        <div>
          <h2>Equity history</h2>
          <p>Recorded account valuations, including reserved collateral.</p>
        </div>
        <div className="segmented">
          {[7, 30, 90, 365].map((v) => (
            <button
              key={v}
              aria-pressed={days === v}
              onClick={() => setDays(v)}
            >
              {v === 365 ? "1Y" : `${v}D`}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="empty">Loading recorded valuations…</div>
      ) : error ? (
        <div className="empty notice error">
          {error}
          <button onClick={() => setRetry((n) => n + 1)}>
            Retry valuations
          </button>
        </div>
      ) : valid.length < 2 ? (
        <div className="empty">
          <h3>Your equity story starts here</h3>
          <p>
            {valid.length === 1
              ? "One genuine valuation is recorded."
              : "No fresh equity valuations are recorded yet."}{" "}
            The chart appears after at least two recorded valuations. Snapshots
            are collected every five minutes; the chart samples those recorded
            valuations.
          </p>
        </div>
      ) : (
        <>
          <svg
            ref={svg}
            height={210}
            viewBox={`0 0 ${width} 210`}
            role="img"
            aria-label={`Recorded equity over ${days} days. Low ${money(min)}, high ${money(max)}.`}
          >
            <text x="10" y="20">
              {money(max)}
            </text>
            <text x="10" y="190">
              {money(min)}
            </text>
            {segments
              .filter((s) => s.length)
              .map((s, i) => (
                <polyline
                  key={i}
                  fill="none"
                  stroke="var(--nt-accent)"
                  strokeWidth="2.5"
                  points={s
                    .map((p) => `${x(p)},${y(p.equityCents!)}`)
                    .join(" ")}
                />
              ))}
            {valid.map((p) => (
              <circle
                key={p.time}
                cx={x(p)}
                cy={y(p.equityCents)}
                r="3"
                fill="var(--nt-accent)"
              >
                <title>
                  {new Date(p.time).toLocaleString("en-GB", {
                    timeZone: "UTC",
                  })}{" "}
                  UTC: {money(p.equityCents)}
                </title>
              </circle>
            ))}
          </svg>
          <div className="equity-dates">
            <span>{new Date(start).toLocaleDateString()}</span>
            <span>{new Date(end).toLocaleDateString()}</span>
          </div>
        </>
      )}
      <p className="muted">
        Actual snapshots only. Missing or stale valuations create gaps. No
        synthetic balance curve.
      </p>
    </section>
  );
}
