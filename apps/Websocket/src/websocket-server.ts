import { createServer } from "node:http";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { createClient, RedisClientType } from "redis";
import { SUPPORTED_ASSETS, type Asset } from "@orbitledger/shared";
import { SubscriptionManager } from "./subscription-manager";
import type { ClientMessage, ServerMessage, PriceUpdate } from "./types";
import { Verifytokenws } from "./utils/wsjwt";

let orderRedis: RedisClientType = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});
const redis = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

const WS_PORT = Number(process.env.WEBSOCKET_PORT || process.env.PORT) || 8080;
const server = createServer((req, res) => {
  const ready = redis.isReady && orderRedis.isReady;
  res.writeHead(req.url === "/ready" && !ready ? 503 : 200, {
    "Content-Type": "application/json",
  });
  res.end(
    JSON.stringify({
      status: "ok",
      ready,
      revision: process.env.RAILWAY_GIT_COMMIT_SHA ?? "local",
    }),
  );
});
const wss = new WebSocketServer({ server, maxPayload: 4096 });
server.listen(WS_PORT);
const SubsManager = new SubscriptionManager();
let isShuttingDown = false;

export async function StartWs() {
  await connectRedis();
  await WS();
}

async function connectRedis() {
  try {
    await redis.connect();
    console.log("Redis connected in WebSocket");
    await orderRedis.connect();
    console.log("Order Redis connected for pattern subscriptions");

    for (const asset of SUPPORTED_ASSETS) {
      await redis.subscribe(asset, (mssg) => {
        handlePriceUpdate(asset, mssg);
      });
      console.log(`Subscribed to ${asset}`);
    }
    await orderRedis.pSubscribe("orders:*", (message, channel) => {
      handleOrderUpdate(channel, message);
    });
    console.log("Subscribed to pattern: orders:*");
  } catch (err) {
    console.error("Redis connection failed, retrying in 3s");
    setTimeout(() => {
      connectRedis();
    }, 3000);
  }
}

async function WS() {
  try {
    wss.on("connection", function connection(ws) {
      SubsManager.addClient(ws);
      console.log("Client connected");
      ws.on("message", (mmsgg) => {
        handleClientMessage(ws, mmsgg);
      });
      ws.on("close", () => {
        SubsManager.removeClient(ws);
        console.log("Client disconnected");
      });
      ws.on("error", (err) => {
        console.error("Error Occurred in WebSocket", err);
      });
    });
    console.log(`WebSocket listening on port ${WS_PORT}`);
  } catch (err) {
    console.error("Error setting up WebSocket server:", err);
  }
}

function handlePriceUpdate(asset: Asset, mssg: string) {
  try {
    const newData = JSON.parse(mssg);
    const PriceChange: PriceUpdate = {
      symbol: newData.symbol,
      bidPrice: newData.bidPrice,
      askPrice: newData.askPrice,
      decimals: newData.decimals,
      time: newData.time,
      tradeId: newData.tradeId,
      price: newData.price,
      quantity: newData.quantity,
      source: newData.source,
    };
    let response: ServerMessage = {
      type: "PRICE_UPDATE",
      data: PriceChange,
    };
    SubsManager.broadcast(asset, response);
  } catch (err) {
    console.error("Can't Able to Update Price", err);
  }
}

function handleClientMessage(ws: WebSocket, mssg: RawData) {
  try {
    let message = JSON.parse(mssg.toString());
    if (message.type === "SUBSCRIBE") {
      SubsManager.subscribeClient(ws, message.symbol);
      let response: ServerMessage = {
        type: "SUBSCRIBED",
        symbol: message.symbol,
      };
      ws.send(JSON.stringify(response));
    } else if (message.type === "UNSUBSCRIBE") {
      SubsManager.unsubscribeClient(ws, message.symbol);
      let response: ServerMessage = {
        type: "UNSUBSCRIBED",
        symbol: message.symbol,
      };
      ws.send(JSON.stringify(response));
    } else if (message.type === "PING") {
      ws.send(JSON.stringify({ type: "PONG" }));
    } else if (message.type === "AUTH") {
      if (!message.token) {
        console.log("Authentication failed: No token provided");
        let response: ServerMessage = {
          type: "UNAUTHENTICATED",
          message: "No token provided",
        };
        ws.send(JSON.stringify(response));
        return;
      }

      const verify = Verifytokenws(message.token);
      if (!verify || verify == null) {
        console.log("Authentication failed: Token verification returned null");
        let response: ServerMessage = {
          type: "UNAUTHENTICATED",
          message: "Invalid TOKEN",
        };
        ws.send(JSON.stringify(response));
        return;
      }
      const userid = verify.userId;

      SubsManager.setUserId(ws, userid);
      const info = SubsManager.clients.get(ws);
      if (info) info.authenticatedUntil = Date.now() + 60000;
      console.log(`User ${userid} authenticated successfully via WebSocket`);
      ws.send(JSON.stringify({ type: "AUTHENTICATED", userId: userid }));
    } else {
      ws.send(
        JSON.stringify({ type: "ERROR", message: "Unknown message type" }),
      );
    }
  } catch (err) {
    console.error("Error parsing message:", err);
  }
}

function handleOrderUpdate(channel: string, message: string) {
  try {
    console.log(`Received order update on ${channel}:`, message);
    const userId = channel.split(":")[1];
    if (!userId) {
      console.error("Invalid channel format:", channel);
      return;
    }
    const orderMessage = JSON.parse(message);
    const messageType = orderMessage.type;
    const messageData = orderMessage.data;

    const serverMessage = {
      type: messageType, // sending message type
      data: messageData, // sending message data
    } as ServerMessage;
    const userConnections: WebSocket[] = [];
    SubsManager.clients.forEach((clientInfo, ws) => {
      if (
        clientInfo.userId === userId &&
        (clientInfo.authenticatedUntil ?? 0) > Date.now()
      ) {
        userConnections.push(ws);
      }
    });
    if (userConnections.length === 0) {
      console.log(`No active connections for user ${userId}`);
      return;
    }
    userConnections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(serverMessage));
      }
    });
    console.log(
      `Sent ${messageType} to ${userConnections.length} connections for user ${userId}`,
    );
  } catch (err) {
    console.error("Error handling order update:", err);
  }
}

async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("\nShutting down WebSocket server gracefully...");

  wss.clients.forEach((client) => {
    client.close(1000, "Server shutting down");
  });

  server.close();
  wss.close(() => {
    console.log("WebSocket server closed");
  });

  await redis.quit();
  console.log("Redis disconnected");

  await orderRedis.quit();
  console.log("Order Redis disconnected");

  console.log("Graceful shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
