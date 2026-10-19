import { createServer } from "node:http";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { createClient, RedisClientType } from "redis";
import { SUPPORTED_ASSETS, type Asset } from "@orbitledger/shared";
import { SubscriptionManager } from "./subscription-manager";
import type { ClientMessage, ServerMessage, PriceUpdate } from "./types";
import { prisma } from "@orbitledger/database";
import { securitySecret } from "@orbitledger/shared/security";
import { Verifytokenws } from "./utils/wsjwt";

let orderRedis: RedisClientType = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});
const redis = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

const WS_PORT = Number(process.env.WEBSOCKET_PORT || process.env.PORT) || 8080;
const server = createServer(async (req, res) => {
  let database = false;
  if (req.url === "/ready") {
    try {
      await prisma.$queryRaw`SELECT 1 FROM auth_sessions LIMIT 1`;
      database = true;
    } catch {}
  }
  const ready =
    redis.isReady && orderRedis.isReady && (req.url !== "/ready" || database);
  res.writeHead(req.url === "/ready" && !ready ? 503 : 200, {
    "Content-Type": "application/json",
  });
  res.end(
    JSON.stringify({
      status: "ok",
      ready,
      ...(req.url === "/ready" ? { database } : {}),
      revision:
        process.env.RAILWAY_GIT_COMMIT_SHA ??
        process.env.APP_REVISION ??
        "local",
    }),
  );
});
securitySecret();
const allowedOrigins = new Set(
  (
    process.env.CORS_ORIGINS ||
    process.env.FRONTEND_URL ||
    "http://localhost:3000,https://orbit-ledger-web.vercel.app"
  )
    .split(",")
    .map((value) => value.trim()),
);
const wss = new WebSocketServer({
  server,
  maxPayload: 4096,
  verifyClient: ({ origin }: { origin: string }) =>
    !origin || allowedOrigins.has(origin),
});
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
      void handleOrderUpdate(channel, message);
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
      if (wss.clients.size > 2000) {
        ws.close(1013, "Server capacity reached");
        return;
      }
      SubsManager.addClient(ws);
      let alive = true;
      ws.on("pong", () => {
        alive = true;
      });
      const heartbeat = setInterval(() => {
        if (!alive) {
          ws.terminate();
          return;
        }
        alive = false;
        ws.ping();
      }, 30000);
      ws.once("close", () => clearInterval(heartbeat));
      console.log("Client connected");
      let windowStart = Date.now(),
        count = 0;
      let pending = Promise.resolve();
      ws.on("message", (mmsgg) => {
        if (Date.now() - windowStart >= 10000) {
          windowStart = Date.now();
          count = 0;
        }
        if (++count > 50) {
          ws.close(1008, "Message rate exceeded");
          return;
        }
        pending = pending
          .then(() => handleClientMessage(ws, mmsgg))
          .catch(() => ws.close(1011, "Authentication unavailable"));
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

async function handleClientMessage(ws: WebSocket, mssg: RawData) {
  try {
    let message = JSON.parse(mssg.toString());
    if (!message || typeof message !== "object" || Array.isArray(message))
      return;
    if (
      ["SUBSCRIBE", "UNSUBSCRIBE"].includes(message.type) &&
      !SUPPORTED_ASSETS.includes(message.symbol)
    ) {
      ws.send(JSON.stringify({ type: "ERROR", message: "Unsupported market" }));
      return;
    }
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
      const previous = SubsManager.clients.get(ws);
      if (previous) {
        delete previous.userId;
        delete previous.sessionId;
        delete previous.authenticatedUntil;
      }
      if (!message.token) {
        console.log("Authentication failed: No token provided");
        let response: ServerMessage = {
          type: "UNAUTHENTICATED",
          message: "No token provided",
        };
        ws.send(JSON.stringify(response));
        return;
      }

      const verify = await Verifytokenws(message.token);
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
      if (info) {
        info.authenticatedUntil = verify.authenticatedUntil;
        info.sessionId = verify.sessionId;
      }
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

async function handleOrderUpdate(channel: string, message: string) {
  try {
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
    const sessions = await prisma.authSession.findMany({
      where: {
        userId,
        expiresAt: { gt: new Date() },
        id: {
          in: userConnections.map(
            (ws) => SubsManager.clients.get(ws)?.sessionId ?? "",
          ),
        },
      },
      select: { id: true },
    });
    const activeSessions = new Set(sessions.map((session) => session.id));
    userConnections.forEach((ws) => {
      const info = SubsManager.clients.get(ws);
      if (ws.bufferedAmount > 1024 * 1024) {
        ws.close(1008, "Slow consumer");
        return;
      }
      if (
        ws.readyState === WebSocket.OPEN &&
        activeSessions.has(info?.sessionId ?? "") &&
        (info?.authenticatedUntil ?? 0) > Date.now()
      ) {
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
