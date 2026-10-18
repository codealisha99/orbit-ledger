"use client";
import { useEffect, useState, useRef } from "react";
import { money, signedMoney } from "@orbitledger/shared";
import { useAccount, type Execution } from "@/lib/account";
import { api } from "@/lib/client";
import { price, date } from "./format";
type Filters = {
  order: string;
  asset: string;
  side: string;
  search: string;
  from: string;
  to: string;
};
const defaults: Filters = {
  order: "desc",
  asset: "",
  side: "",
  search: "",
  from: "",
  to: "",
};
function query(filters: Filters, cursor?: string) {
  const params = new URLSearchParams({ limit: "50" });
  for (const [key, value] of Object.entries(filters))
    if (value)
      params.set(
        key,
        key === "from" || key === "to"
          ? new Date(
              value + (key === "to" ? "T23:59:59.999Z" : "T00:00:00.000Z"),
            ).toISOString()
          : value,
      );
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}
export default function History({
  onReceipt,
}: {
  onReceipt: (id: string) => Promise<void>;
}) {
  const [filters, setFilters] = useState<Filters>(defaults);
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<Execution[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [exporting, setExporting] = useState(false);
  const filterKey = JSON.stringify(filters);
  const currentFilter = useRef(filterKey);
  currentFilter.current = filterKey;
  const { summary } = useAccount();
  useEffect(() => {
    try {
      setFilters({
        ...defaults,
        ...JSON.parse(localStorage.getItem("orbit-history-filters") || "{}"),
      });
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    localStorage.setItem("orbit-history-filters", JSON.stringify(filters));
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      api<{ orders: Execution[]; nextCursor: string | null }>(
        `trade/history?${query(filters)}`,
        { signal: abort.signal },
      )
        .then((data) => {
          if (!abort.signal.aborted) {
            setRows(data.orders);
            setCursor(data.nextCursor);
          }
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [filters, ready, reload, summary?.version]);
  async function more() {
    const requestFilter = filterKey;
    if (!cursor) return;
    setLoading(true);
    try {
      const data = await api<{
        orders: Execution[];
        nextCursor: string | null;
      }>(`trade/history?${query(filters, cursor)}`);
      if (currentFilter.current !== requestFilter) return;
      setRows((current) => [
        ...current,
        ...data.orders.filter(
          (o) => !current.some((c) => c.orderId === o.orderId),
        ),
      ]);
      setCursor(data.nextCursor);
    } catch (e) {
      if (currentFilter.current === requestFilter)
        setError((e as Error).message);
    } finally {
      if (currentFilter.current === requestFilter) setLoading(false);
    }
  }
  async function exportCsv() {
    setExporting(true);
    try {
      let after: string | undefined;
      const all: Execution[] = [];
      do {
        const data = await api<{
          orders: Execution[];
          nextCursor: string | null;
        }>(`trade/history?${query(filters, after)}`);
        all.push(...data.orders);
        after = data.nextCursor ?? undefined;
      } while (after);
      const columns = [
        "receipt",
        "position",
        "asset",
        "side",
        "opened_utc",
        "closed_utc",
        "reason",
        "exposure_cents",
        "gross_pnl_cents",
        "entry_costs_cents",
        "exit_fee_cents",
        "net_pnl_cents",
      ];
      const csv = [
        columns,
        ...all.map((o) => [
          o.orderId,
          o.positionId,
          o.asset,
          o.type,
          o.openedAt,
          o.closedAt,
          o.closeReason,
          o.notionalCents,
          o.pnl,
          o.entryFeeCents,
          o.exitFeeCents,
          o.netPnlCents,
        ]),
      ]
        .map((row) =>
          row
            .map((v) => '"' + String(v ?? "").replaceAll('"', '""') + '"')
            .join(","),
        )
        .join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "orbitledger-trades.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <div className="history-filters">
        <label>
          Sort
          <select
            value={filters.order}
            onChange={(e) => setFilters({ ...filters, order: e.target.value })}
          >
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </label>
        <label>
          Market
          <select
            value={filters.asset}
            onChange={(e) => setFilters({ ...filters, asset: e.target.value })}
          >
            <option value="">All markets</option>
            {["BTC", "ETH", "SOL"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Side
          <select
            value={filters.side}
            onChange={(e) => setFilters({ ...filters, side: e.target.value })}
          >
            <option value="">All sides</option>
            <option value="buy">Long</option>
            <option value="sell">Short</option>
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          />
        </label>
        <label>
          Receipt / position
          <input
            placeholder="Search ID"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
        </label>
        <button disabled={exporting} onClick={() => void exportCsv()}>
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}{" "}
          <button onClick={() => setReload((n) => n + 1)}>Retry history</button>{" "}
          Previously loaded rows remain below.
        </div>
      )}
      {loading && (
        <p className="muted panel-tools" role="status">
          Loading history…
        </p>
      )}
      {!loading && !error && rows.length === 0 ? (
        <p className="empty">No completed executions match these filters.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Market / side</th>
                <th>Closed (UTC)</th>
                <th>Exit / reason</th>
                <th>Gross P&L</th>
                <th>Entry costs / exit fee</th>
                <th>Net P&L</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.orderId}>
                  <td>
                    <b>{o.asset}</b>
                    <span>{o.type === "buy" ? "Long" : "Short"}</span>
                  </td>
                  <td>
                    {date(o.closedAt)}
                    <span>Opened {date(o.openedAt)}</span>
                  </td>
                  <td>
                    {price(o.closePrice)}
                    <span>{o.closeReason.replaceAll("_", " ")}</span>
                  </td>
                  <td className={o.pnl < 0 ? "negative" : "positive"}>
                    {signedMoney(o.pnl)}
                  </td>
                  <td>
                    {money(o.entryFeeCents)} / {money(o.exitFeeCents)}
                  </td>
                  <td
                    className={
                      o.netPnlCents !== null && o.netPnlCents < 0
                        ? "negative"
                        : "positive"
                    }
                  >
                    {o.feesRecorded && o.netPnlCents !== null
                      ? signedMoney(o.netPnlCents)
                      : "Unknown legacy fees"}
                  </td>
                  <td>
                    <button
                      onClick={() => void onReceipt(o.positionId || o.orderId)}
                    >
                      {o.orderId.slice(0, 8)}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor && (
        <button
          className="load-more"
          disabled={loading}
          onClick={() => void more()}
        >
          Load more completed trades
        </button>
      )}
      <p className="panel-tools muted">
        Executions sorted by close time. Partial exits belong to their original
        position; net P&L includes allocated entry costs and the exit fee.
      </p>
    </>
  );
}
