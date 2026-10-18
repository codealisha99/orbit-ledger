import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import { prisma } from "@orbitledger/database";
import { authMiddleware } from "../middleware/auth";
import {
  apiRateLimit,
  tradeOpenRateLimit,
  tradeCloseRateLimit,
} from "../middleware/rateLimit";
import {
  accountSummary,
  mutateAccount,
  DomainError,
} from "../services/accountService";
import {
  openTradeSchema,
  partialCloseSchema,
  addMarginSchema,
  closeTradeSchema,
} from "../types";

export const tradeRoutes = Router();
tradeRoutes.use(authMiddleware);
tradeRoutes.use((_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});
const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
const schemas = {
  open: openTradeSchema,
  close: closeTradeSchema,
  partial_close: partialCloseSchema,
  add_margin: addMarginSchema,
  protection: z.object({
    orderId: z.string().min(1),
    takeProfit: z.number().positive().max(1e10).nullable().optional(),
    stopLoss: z.number().positive().max(1e10).nullable().optional(),
  }),
};
for (const [path, kind] of [
  ["open", "open"],
  ["close", "close"],
  ["partial-close", "partial_close"],
  ["add-margin", "add_margin"],
  ["protection", "protection"],
] as const) {
  tradeRoutes.post(
    `/${path}`,
    kind === "open" ? tradeOpenRateLimit : tradeCloseRateLimit,
    handle(async (req, res) => {
      const parsed = schemas[kind].safeParse(req.body);
      if (!parsed.success)
        throw new DomainError(
          400,
          "INVALID_INPUT",
          parsed.error.issues.map((i) => i.message).join(" "),
        );
      const result = await mutateAccount(
        req.userId!,
        req.get("Idempotency-Key") ?? "",
        { ...parsed.data, kind } as Parameters<typeof mutateAccount>[2],
      );
      res.status(kind === "open" ? 201 : 200).json(result);
    }),
  );
}
tradeRoutes.get(
  "/summary",
  apiRateLimit,
  handle(async (req, res) => res.json(await accountSummary(req.userId!))),
);
tradeRoutes.get(
  "/open",
  apiRateLimit,
  handle(async (req, res) =>
    res.json({ orders: (await accountSummary(req.userId!)).orders }),
  ),
);
tradeRoutes.get(
  "/history",
  apiRateLimit,
  handle(async (req, res) => {
    const query = z
      .object({
        order: z.enum(["asc", "desc"]).default("desc"),
        asset: z.enum(["BTC", "ETH", "SOL"]).optional(),
        side: z.enum(["buy", "sell"]).optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        from: z.iso.datetime().optional(),
        to: z.iso.datetime().optional(),
        search: z.string().max(128).optional(),
      })
      .parse(req.query);
    const rows = await prisma.closedOrder.findMany({
      where: {
        userId: req.userId!,
        asset: query.asset,
        type: query.side,
        closedAt: {
          gte: query.from ? new Date(query.from) : undefined,
          lte: query.to ? new Date(query.to) : undefined,
        },
        ...(query.search
          ? {
              OR: [
                { orderId: { contains: query.search } },
                { positionId: { contains: query.search } },
              ],
            }
          : {}),
      },
      orderBy: [{ closedAt: query.order }, { orderId: query.order }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { orderId: query.cursor }, skip: 1 } : {}),
    });
    res.json({
      orders: rows.slice(0, query.limit).map((o) => ({
        ...o,
        netPnlCents: o.feesRecorded ? o.netPnlCents : null,
      })),
      nextCursor:
        rows.length > query.limit ? rows[query.limit - 1]!.orderId : null,
    });
  }),
);
tradeRoutes.get(
  "/events",
  apiRateLimit,
  handle(async (req, res) => {
    const after = z.coerce
      .number()
      .int()
      .nonnegative()
      .default(0)
      .parse(req.query.after);
    const events = await prisma.accountEvent.findMany({
      where: { userId: req.userId!, version: { gt: after } },
      orderBy: { version: "asc" },
      take: 100,
    });
    res.json({ events });
  }),
);
tradeRoutes.get(
  "/receipt/:id",
  apiRateLimit,
  handle(async (req, res) => {
    const events = await prisma.accountEvent.findMany({
      where: { userId: req.userId!, positionId: String(req.params.id) },
      orderBy: { version: "asc" },
    });
    const executions = await prisma.closedOrder.findMany({
      where: { userId: req.userId!, positionId: String(req.params.id) },
      orderBy: { closedAt: "asc" },
    });
    res.json({
      events,
      executions: executions.map((o) => ({
        ...o,
        netPnlCents: o.feesRecorded ? o.netPnlCents : null,
      })),
    });
  }),
);
tradeRoutes.get(
  "/equity",
  apiRateLimit,
  handle(async (req, res) => {
    const days = z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .parse(req.query.days);
    // Sample genuine valuations at a resolution suited to the requested period.
    const cadenceMinutes =
      days <= 7 ? 5 : days <= 30 ? 30 : days <= 90 ? 120 : 360;
    const bucket = `${cadenceMinutes} minutes`;
    const rows = await prisma.$queryRaw<
      Array<{ time: Date; equityCents: number | null; stale: boolean }>
    >`
    SELECT DISTINCT ON (bucket) time, "equityCents", stale FROM (
      SELECT date_bin(${bucket}::interval, "createdAt", TIMESTAMP '2001-01-01') AS bucket,
             "createdAt" AS time, "equityCents", stale
      FROM "EquitySnapshot" WHERE "userId" = ${req.userId!} AND "createdAt" >= ${new Date(Date.now() - days * 86400000)}
    ) valuations ORDER BY bucket, time DESC`;
    res.json({
      points: rows,
      source: "recorded_account_valuations",
      cadenceMinutes,
    });
  }),
);
tradeRoutes.get(
  "/performance",
  apiRateLimit,
  handle(async (req, res) => {
    const executions = await prisma.closedOrder.findMany({
      where: { userId: req.userId! },
    });
    const active = new Set(
      (
        await prisma.activeOrder.findMany({
          where: { userId: req.userId! },
          select: { orderId: true },
        })
      ).map((o) => o.orderId),
    );
    const positions = new Map<string, number>();
    for (const e of executions) {
      const id = e.positionId ?? e.orderId;
      positions.set(id, (positions.get(id) ?? 0) + e.netPnlCents);
    }
    const completed = [...positions].filter(([id]) => !active.has(id));
    const feesComplete = executions.every((e) => e.feesRecorded);
    res.json({
      feesComplete,
      grossPnlCents: executions.reduce((n, e) => n + e.pnl, 0),
      netPnlCents: feesComplete
        ? executions.reduce((n, e) => n + e.netPnlCents, 0)
        : null,
      entryCostsCents: executions.reduce((n, e) => n + e.entryFeeCents, 0),
      exitFeesCents: executions.reduce((n, e) => n + e.exitFeeCents, 0),
      executions: executions.length,
      completedPositions: completed.length,
      winningPositions: completed.filter(([, pnl]) => pnl > 0).length,
    });
  }),
);
