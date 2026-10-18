import type { Asset } from "@orbitledger/shared";

export type { Asset };

export interface JWTPayload {
  userId: string;
}

export type ClientMessage =
  | { type: "SUBSCRIBE"; symbol: Asset }
  | { type: "UNSUBSCRIBE"; symbol: Asset }
  | { type: "PING" }
  | { type: "AUTH"; token: string };

export interface PriceUpdate {
  symbol: Asset;
  bidPrice: number;
  askPrice: number;
  decimals: number;
  time: number;
}

export interface OrderUpdate {
  orderId: string;
  userId: string;
  asset: Asset;
  type: "buy" | "sell";
  margin: number; // In USD (not cents!)
  leverage: number;
  openPrice: number; // Display format (not PRICE_SCALE)
  openTimestamp: number;
  liquidationPrice: number;
  takeProfit?: number; // Optional
  stopLoss?: number; // Optional
  closePrice?: number;
  closeTimestamp?: number;
  pnl?: number; // In USD (can be negative!)
  closeReason?: "manual" | "take_profit" | "stop_loss" | "liquidation";
}

export type ServerMessage =
  | { type: "PRICE_UPDATE"; data: PriceUpdate }
  | { type: "ORDER_OPENED"; data: OrderUpdate }
  | { type: "ORDER_CLOSED"; data: OrderUpdate }
  | { type: "ORDER_LIQUIDATED"; data: OrderUpdate }
  | { type: "AUTHENTICATED"; userId: string }
  | { type: "UNAUTHENTICATED"; message: string }
  | { type: "ERROR"; message: string }
  | { type: "SUBSCRIBED"; symbol: Asset }
  | { type: "UNSUBSCRIBED"; symbol: Asset }
  | { type: "PONG" };

export interface ClientInfo {
  id: string;
  userId?: string; // Set after successful authentication
  subscriptions: Set<Asset>; // Which symbols they're tracking
  connectedAt: Date;
}
