import { BINANCE_STREAMS, toInternalPrice } from "@orbitledger/shared";
import { WebSocket } from "ws";
import { EventEmitter } from "events"; // build in function to emit things across the code

export interface Trades {
  tradeId: number;
  symbol: string;
  price: number;
  quantity: string;
  timestamp: number;
}
export const binanceEmitter = new EventEmitter();
let wss: WebSocket | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let isShuttingDown = false;
let reconnectAttempt = 0;

function scheduleReconnect() {
  if (isShuttingDown || reconnectTimeout) return;
  const delay = Math.min(3000 * 2 ** reconnectAttempt, 30000);
  reconnectAttempt = Math.min(reconnectAttempt + 1, 4);
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    console.log("Attempting to reconnect to Binance...");
    startBinance();
  }, delay);
}

export function startBinance() {
  if (isShuttingDown) return;
  try {
    const endpoint = process.env.BINANCE_WS_URL || "wss://data-stream.binance.vision:443/ws";
    wss = new WebSocket(endpoint);
    wss.on("open", () => {
      reconnectAttempt = 0;
      console.log(" Binance WebSocket is Connected");
      const stream = {
        method: "SUBSCRIBE",
        params: Object.values(BINANCE_STREAMS),
        id: 1,
      };
      wss?.send(JSON.stringify(stream));
    });
    wss.on("message", (data: Buffer) => {
      try {
        const message_ws = JSON.parse(data.toString());
        if (message_ws.e == "aggTrade") {
          let liveTrades: Trades = {
            tradeId: message_ws.a,
            symbol: message_ws.s,
            price: toInternalPrice(message_ws.p),
            quantity: message_ws.q,
            timestamp: message_ws.T,
          };
          binanceEmitter.emit("trade", liveTrades);
        }
      } catch (err) {
        console.error("Error in Emitting data in Binance webscoket", err);
      }
    });
    wss.on("close", () => {
      if (isShuttingDown) return;
      console.log("Binance WebSocket connection closed");
      scheduleReconnect();
    });
    wss.on("error", (err) => {
      console.error("[BINANCE] WebSocket error:", err.message);
      wss?.close();
    });
  } catch (err) {
    console.error("[BINANCE] Fatal error starting WebSocket:", err);
    scheduleReconnect();
  }
}

async function gracefulShutdown(signal: string) {
  isShuttingDown = true;
  console.log(`${signal} received: Shutting down Binance WebSocket...`);

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (wss) {
    wss.close();
    wss = null;
  }

  console.log("Binance WebSocket stopped");
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
