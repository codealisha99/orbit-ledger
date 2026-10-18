import { Router } from "express";
import { z } from "zod";
import { prisma } from "@orbitledger/database";
import { isFreshQuote } from "@orbitledger/shared";
import { authMiddleware } from "../middleware/auth";
import { apiRateLimit } from "../middleware/rateLimit";
import { PriceStorageMp } from "../data/store";
import { DomainError } from "../services/accountService";

export const workspaceRouter = Router();
workspaceRouter.use(authMiddleware, apiRateLimit);
const asset = z.enum(["BTC", "ETH", "SOL"]);
const alertInput = z
  .object({
    id: z.string().uuid(),
    asset,
    direction: z.enum(["above", "below"]),
    targetPrice: z
      .number()
      .finite()
      .positive()
      .max(1e9)
      .refine(
        (v) =>
          Number.isSafeInteger(v * 10000) ||
          Math.abs(v * 10000 - Math.round(v * 10000)) < 0.00001,
        "Use at most four decimal places",
      ),
  })
  .strict();
const serializeAlert = (a: {
  targetPrice: number;
  [key: string]: unknown;
}) => ({ ...a, targetPrice: a.targetPrice / 10000 });
async function requireUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { userId },
    select: { userId: true, email: true, provider: true, createdAt: true },
  });
  if (!user)
    throw new DomainError(
      401,
      "AUTH_REQUIRED",
      "Account not found. Sign in again.",
    );
  return user;
}
workspaceRouter.get("/profile", async (req, res) => {
  res.json(await requireUser(req.userId!));
});
workspaceRouter.get("/workspace", async (req, res) => {
  const userId = req.userId!;
  const [profile, watchlist, alerts] = await Promise.all([
    requireUser(userId),
    prisma.watchMarket.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.priceAlert.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  res.json({
    profile,
    watchlist: watchlist.map((w) => w.asset),
    alerts: alerts.map(serializeAlert),
  });
});
workspaceRouter.post("/workspace/watchlist", async (req, res) => {
  const { asset: market, watching } = z
    .object({ asset, watching: z.boolean() })
    .strict()
    .parse(req.body);
  const userId = req.userId!;
  await requireUser(userId);
  if (watching)
    await prisma.watchMarket.upsert({
      where: { userId_asset: { userId, asset: market } },
      create: { userId, asset: market },
      update: {},
    });
  else
    await prisma.watchMarket.deleteMany({ where: { userId, asset: market } });
  res.json({ asset: market, watching });
});
workspaceRouter.post("/workspace/alerts", async (req, res) => {
  const input = alertInput.parse(req.body);
  const userId = req.userId!;
  await requireUser(userId);
  const targetPrice = Math.round(input.targetPrice * 10000);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const existing = await tx.priceAlert.findUnique({
      where: { id: input.id },
    });
    if (existing) {
      if (
        existing.userId !== userId ||
        existing.asset !== input.asset ||
        existing.direction !== input.direction ||
        existing.targetPrice !== targetPrice
      )
        throw new DomainError(
          409,
          "KEY_REUSED",
          "This alert request has different details. Try again with a new request.",
        );
      return existing;
    }
    if ((await tx.priceAlert.count({ where: { userId } })) >= 12)
      throw new DomainError(
        400,
        "ALERT_LIMIT",
        "You can save up to 12 alerts. Remove an old alert to add another.",
      );
    return tx.priceAlert.create({ data: { ...input, userId, targetPrice } });
  });
  res.status(201).json(serializeAlert(result));
});
workspaceRouter.post("/workspace/alerts/:id", async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { action } = z
    .object({ action: z.enum(["remove", "rearm"]) })
    .strict()
    .parse(req.body);
  const where = { id, userId: req.userId! };
  const result =
    action === "remove"
      ? await prisma.priceAlert.deleteMany({ where })
      : await prisma.priceAlert.updateMany({
          where,
          data: { triggeredAt: null },
        });
  if (!result.count)
    throw new DomainError(404, "NOT_FOUND", "Alert not found.");
  res.json({ ok: true });
});
workspaceRouter.post("/workspace/check-alerts", async (req, res) => {
  const userId = req.userId!;
  const alerts = await prisma.priceAlert.findMany({
    where: { userId, triggeredAt: null },
  });
  const triggered = [];
  for (const alert of alerts) {
    const quote = PriceStorageMp.get(asset.parse(alert.asset));
    if (!isFreshQuote(quote)) continue;
    const mark = (quote!.bid + quote!.ask) / 2;
    if (
      alert.direction === "above"
        ? mark < alert.targetPrice
        : mark > alert.targetPrice
    )
      continue;
    const changed = await prisma.priceAlert.updateMany({
      where: { id: alert.id, userId, triggeredAt: null },
      data: { triggeredAt: new Date() },
    });
    if (changed.count) triggered.push(alert.id);
  }
  res.json({ triggered });
});
