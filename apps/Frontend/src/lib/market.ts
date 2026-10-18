"use client";
import { api } from "./client";
import { useSyncExternalStore } from "react";
export type Symbol = "BTC" | "ETH" | "SOL";
export interface Print {
  symbol: Symbol;
  tradeId: string;
  price: number;
  quantity: string;
  time: number;
  source: string;
}
export interface MarketQuote extends Print {
  bidPrice: number;
  askPrice: number;
}
type State = {
  connected: boolean;
  quotes: Partial<Record<Symbol, MarketQuote>>;
  trades: Partial<Record<Symbol, Print[]>>;
  reconnects: number;
};
const initial: State = {
  connected: false,
  quotes: {},
  trades: {},
  reconnects: 0,
};
let state = initial;
let socket: WebSocket | null = null;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let reconnect: ReturnType<typeof setTimeout> | undefined;
let attempt = 0;
let lastMessage = 0;
let authTimer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
function emit(next: State) {
  state = next;
  listeners.forEach((fn) => fn());
}
function connect() {
  const ws = new WebSocket(
    process.env.NEXT_PUBLIC_WEBSOCKET_URL || "ws://localhost:8080",
  );
  socket = ws;
  ws.onopen = () => {
    attempt = 0;
    lastMessage = Date.now();
    const authenticate = () =>
      api<{ ticket: string }>("user/ws-ticket")
        .then(({ ticket }) => {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: "AUTH", token: ticket }));
        })
        .catch(() => {});
    void authenticate();
    authTimer = setInterval(authenticate, 45000);
    emit({ ...state, connected: true, reconnects: state.reconnects + 1 });
    for (const symbol of ["BTC", "ETH", "SOL"])
      ws.send(JSON.stringify({ type: "SUBSCRIBE", symbol }));
    heartbeat = setInterval(() => {
      if (Date.now() - lastMessage > 30000) ws.close();
      else if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: "PING" }));
    }, 10000);
  };
  ws.onmessage = (event) => {
    lastMessage = Date.now();
    try {
      const message = JSON.parse(event.data);
      if (message.type === "ACCOUNT_EVENT") {
        window.dispatchEvent(
          new CustomEvent("orbit-account-event", { detail: message.data }),
        );
        return;
      }
      if (message.type !== "PRICE_UPDATE") return;
      const raw = message.data;
      const symbol = String(raw.symbol).replace("USDT", "") as Symbol;
      if (
        !["BTC", "ETH", "SOL"].includes(symbol) ||
        !Number.isFinite(raw.time) ||
        !Number.isFinite(raw.price)
      )
        return;
      const quote: MarketQuote = {
        ...raw,
        symbol,
        tradeId: String(raw.tradeId),
      };
      if ((state.quotes[symbol]?.time ?? 0) > quote.time) return;
      const existing = state.trades[symbol] ?? [];
      const trades = existing.some((t) => t.tradeId === quote.tradeId)
        ? existing
        : [quote, ...existing].slice(0, 100);
      emit({
        ...state,
        quotes: { ...state.quotes, [symbol]: quote },
        trades: { ...state.trades, [symbol]: trades },
      });
    } catch {
      /* Ignore malformed frames; freshness still expires. */
    }
  };
  ws.onerror = () => ws.close();
  ws.onclose = () => {
    if (socket !== ws) return;
    if (heartbeat) clearInterval(heartbeat);
    if (authTimer) clearInterval(authTimer);
    emit({ ...state, connected: false });
    if (listeners.size)
      reconnect = setTimeout(
        connect,
        Math.min(30000, 500 * 2 ** attempt++) + Math.random() * 500,
      );
  };
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  if (listeners.size === 1 && !socket) connect();
  return () => {
    listeners.delete(fn);
    if (!listeners.size) {
      if (reconnect) clearTimeout(reconnect);
      if (authTimer) clearInterval(authTimer);
      if (heartbeat) clearInterval(heartbeat);
      const old = socket;
      socket = null;
      if (old) {
        old.onclose = null;
        old.close();
      }
      emit({ ...state, connected: false });
    }
  };
}
export function useMarket() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => initial,
  );
}
