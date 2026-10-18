import { beforeAll, afterAll, test, expect } from "bun:test";
import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { prisma } from "@orbitledger/database";
import { generateToken } from "../src/utils/jwt";
import { PriceStorageMp } from "../src/data/store";
const target = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/");
if (
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  !target.pathname.startsWith("/actioncd_quality_") ||
  target.searchParams.has("host")
)
  throw new Error("Dedicated local quality database required");
process.env.REDIS_URL = "";
process.env.RATE_LIMIT_REDIS_URL = "";
process.env.JWT_SECRET = "integration-local-only";
const { tradeRoutes } = await import("../src/routes/trades");
const { userRouter } = await import("../src/routes/user");
const { oauthRouter } = await import("../src/routes/oauth");
const { DomainError } = await import("../src/services/accountService");
const { ZodError } = await import("zod");
const app = express();
app.use(express.json());
app.use("/user", userRouter);
app.use("/trade", tradeRoutes);
app.use("/auth", oauthRouter);
app.use(
  (
    error: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res
      .status(
        error instanceof DomainError
          ? error.status
          : error instanceof ZodError
            ? 400
            : 500,
      )
      .json({ error: error.message });
  },
);
const server = createServer(app);
let base = "";
const userId = `http-${randomUUID()}`;
let token = "";
beforeAll(async () => {
  await prisma.user.create({
    data: {
      userId,
      email: `${userId}@example.test`,
      password: "",
      balanceCents: 500000,
    },
  });
  token = generateToken(userId);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  PriceStorageMp.set("BTC", {
    bid: 600000000,
    ask: 600000000,
    time: Date.now(),
  });
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await prisma.activeOrder.deleteMany({ where: { userId } });
  await prisma.closedOrder.deleteMany({ where: { userId } });
  await prisma.accountEvent.deleteMany({ where: { userId } });
  await prisma.mutationReceipt.deleteMany({ where: { userId } });
  await prisma.equitySnapshot.deleteMany({ where: { userId } });
  await prisma.loginCode.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { userId } });
  await prisma.$disconnect();
});
const headers = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
});
test("private account endpoints require authentication and mutation keys", async () => {
  expect((await fetch(`${base}/trade/summary`)).status).toBe(401);
  const response = await fetch(`${base}/trade/open`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      asset: "BTC",
      type: "buy",
      margin: 100,
      leverage: 1,
    }),
  });
  expect(response.status).toBe(400);
  expect(await prisma.activeOrder.count({ where: { userId } })).toBe(0);
});
test("HTTP retries return one durable receipt and consistent cents", async () => {
  const key = randomUUID();
  const options = {
    method: "POST",
    headers: { ...headers(), "Idempotency-Key": key },
    body: JSON.stringify({
      asset: "BTC",
      type: "buy",
      margin: 100,
      leverage: 1,
    }),
  };
  const first = await fetch(`${base}/trade/open`, options);
  expect(first.status).toBe(201);
  const a = (await first.json()) as any;
  const b = (await (await fetch(`${base}/trade/open`, options)).json()) as any;
  expect(a.eventId).toBe(b.eventId);
  const s = (await (
    await fetch(`${base}/trade/summary`, { headers: headers() })
  ).json()) as any;
  expect(s.availableCents).toBe(489950);
  expect(s.reservedCents).toBe(10000);
  expect(s.equityCents).toBe(499950);
  expect(s.orders[0].openPrice).toBe(600000000);
});
test("receipts and events never return another account’s records", async () => {
  const event = await prisma.accountEvent.findFirstOrThrow({
    where: { userId },
  });
  const otherToken = generateToken(`other-${randomUUID()}`);
  const response = await fetch(`${base}/trade/receipt/${event.positionId}`, {
    headers: { Authorization: `Bearer ${otherToken}` },
  });
  const result = (await response.json()) as any;
  expect(result.events).toEqual([]);
  expect(result.executions).toEqual([]);
  const events = (await (
    await fetch(`${base}/trade/events?after=0`, { headers: headers() })
  ).json()) as any;
  expect(events.events.every((e: any) => e.userId === userId)).toBe(true);
});
test("invalid history queries fail clearly without removing durable history", async () => {
  expect(
    (await fetch(`${base}/trade/history?limit=100000`, { headers: headers() }))
      .status,
  ).toBe(400);
  expect(
    (
      await fetch(`${base}/trade/history?asset=BTC&limit=25`, {
        headers: headers(),
      })
    ).status,
  ).toBe(200);
});
test("OAuth codes expire and can only be exchanged once", async () => {
  const code = randomUUID();
  await prisma.loginCode.create({
    data: { code, userId, expiresAt: new Date(Date.now() + 60000) },
  });
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  };
  const first = await fetch(`${base}/auth/exchange`, options);
  expect(first.status).toBe(200);
  expect((await fetch(`${base}/auth/exchange`, options)).status).toBe(401);
  const expired = randomUUID();
  await prisma.loginCode.create({
    data: { code: expired, userId, expiresAt: new Date(Date.now() - 1000) },
  });
  expect(
    (
      await fetch(`${base}/auth/exchange`, {
        ...options,
        body: JSON.stringify({ code: expired }),
      })
    ).status,
  ).toBe(401);
});

test("unknown legacy fees never become an asserted net result", async () => {
  const id = randomUUID();
  await prisma.closedOrder.create({
    data: {
      orderId: id,
      positionId: id,
      userId,
      asset: "BTC",
      type: "buy",
      margin: 1000,
      initialMargin: 1000,
      addedMargin: 0,
      notionalCents: 1000,
      leverage: 1,
      openPrice: 600000000,
      closePrice: 600000000,
      liquidationPrice: 0,
      pnl: 0,
      closeReason: "manual",
      openedAt: new Date(),
      closedAt: new Date(),
    },
  });
  const history = (await (
    await fetch(`${base}/trade/history`, { headers: headers() })
  ).json()) as any;
  expect(
    history.orders.find((o: any) => o.orderId === id).netPnlCents,
  ).toBeNull();
  const stats = (await (
    await fetch(`${base}/trade/performance`, { headers: headers() })
  ).json()) as any;
  expect(stats.feesComplete).toBe(false);
  expect(stats.netPnlCents).toBeNull();
});
test("provider identities cannot link by matching email or bypass verification", async () => {
  const { findOrCreateOAuthUser } =
    await import("../src/services/oauthService");
  await expect(
    findOrCreateOAuthUser({
      provider: "github",
      providerId: randomUUID(),
      email: `${userId}@example.test`,
      emailVerified: true,
    }),
  ).rejects.toThrow("original method");
  await expect(
    findOrCreateOAuthUser({
      provider: "google",
      providerId: randomUUID(),
      email: "unverified-quality@example.test",
      emailVerified: false,
    }),
  ).rejects.toThrow("verified provider email");
  expect(
    (await prisma.user.findUniqueOrThrow({ where: { userId } })).provider,
  ).toBeNull();
});

test("equity sampling preserves actual timestamps and stale gaps", async () => {
  const at = Date.now();
  await prisma.equitySnapshot.createMany({
    data: [
      {
        userId,
        availableCents: 489950,
        reservedCents: 10000,
        pnlCents: 0,
        equityCents: 499950,
        stale: false,
        createdAt: new Date(at - 15 * 60000),
      },
      {
        userId,
        availableCents: 489950,
        reservedCents: 10000,
        pnlCents: 50,
        equityCents: 500000,
        stale: false,
        createdAt: new Date(at - 10 * 60000),
      },
      {
        userId,
        availableCents: 489950,
        reservedCents: 10000,
        pnlCents: null,
        equityCents: null,
        stale: true,
        createdAt: new Date(at - 5 * 60000),
      },
    ],
  });
  const response = await fetch(`${base}/trade/equity?days=7`, {
    headers: headers(),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.points.map((p: any) => p.equityCents)).toEqual([
    499950,
    500000,
    null,
  ]);
  expect(body.cadenceMinutes).toBe(5);
  expect(body.points.at(-1).stale).toBe(true);
});

test("password allocation reconciles and legacy mixed-case email still signs in", async () => {
  const { INITIAL_BALANCE_CENTS, StoreData } =
    await import("../src/data/store");
  const { hashPassword } = await import("../src/utils/password");
  const legacyId = `legacy-${randomUUID()}`,
    legacyEmail = `Legacy-${randomUUID()}@example.test`;
  await prisma.user.create({
    data: {
      userId: legacyId,
      email: legacyEmail,
      password: hashPassword("LocalLegacyOnly2026!"),
      balanceCents: 12345,
    },
  });
  let newId: string | undefined;
  try {
    const login = await fetch(`${base}/user/signin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: legacyEmail.toLowerCase(),
        password: "LocalLegacyOnly2026!",
      }),
    });
    expect(login.status).toBe(200);
    const created = await fetch(`${base}/user/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `New-${randomUUID()}@example.test`,
        password: "LocalNewOnly2026!",
      }),
    });
    expect(created.status).toBe(201);
    newId = ((await created.json()) as any).userId;
    const stored = await prisma.user.findUniqueOrThrow({
      where: { userId: newId! },
    });
    expect(stored.balanceCents).toBe(INITIAL_BALANCE_CENTS);
    expect(StoreData.get(newId!)?.balance.usd_balance).toBe(
      stored.balanceCents,
    );
    expect(stored.email).toBe(stored.email.toLowerCase());
  } finally {
    await prisma.user.delete({ where: { userId: legacyId } });
    if (newId) await prisma.user.delete({ where: { userId: newId } });
  }
});
