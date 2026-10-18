import { prisma, Prisma } from "@orbitledger/database";
import { createHash, randomUUID } from "node:crypto";
import {
  feeCents,
  splitAmount,
  pnlCents,
  liquidationPrice,
  quantity,
  isFreshQuote,
  type Side,
} from "@orbitledger/shared";
import { PriceStorageMp } from "../data/store";
import { shouldClosePosition } from "../utils/risk";
import type { Asset } from "@orbitledger/shared";

export class DomainError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function executableQuote(asset: string) {
  const quote = PriceStorageMp.get(asset as Asset);
  if (!isFreshQuote(quote))
    throw new DomainError(
      503,
      "QUOTE_UNAVAILABLE",
      "A fresh market quote is unavailable. Try again when the feed recovers.",
    );
  return quote;
}
export function positionView(
  order: Awaited<ReturnType<typeof prisma.activeOrder.findMany>>[number],
  now = Date.now(),
) {
  const quote = PriceStorageMp.get(order.asset as Asset);
  const fresh = !order.needsReview && isFreshQuote(quote, now);
  const mark = fresh ? (order.type === "buy" ? quote.bid : quote.ask) : null;
  const pnl =
    mark === null
      ? null
      : Math.max(
          -order.margin,
          pnlCents(
            order.openPrice,
            mark,
            order.notionalCents,
            order.type as Side,
          ),
        );
  return {
    ...order,
    openTimestamp: order.openedAt.getTime(),
    quantity: quantity(order.notionalCents, order.openPrice),
    effectiveLeverage: order.notionalCents / order.margin,
    markPrice: mark,
    pnlCents: pnl,
    stale: !fresh,
    quoteTime: quote?.time ?? null,
  };
}
export async function accountSummary(userId: string) {
  return prisma.$transaction(
    async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { userId } });
      const orders = (
        await tx.activeOrder.findMany({
          where: { userId },
          orderBy: { openedAt: "desc" },
        })
      ).map((o) => positionView(o));
      const reservedCents = orders.reduce((n, o) => n + o.margin, 0);
      const stale = orders.some((o) => o.stale);
      const openPnlCents = stale
        ? null
        : orders.reduce((n, o) => n + (o.pnlCents ?? 0), 0);
      return {
        userId,
        version: user.version,
        availableCents: user.balanceCents,
        reservedCents,
        openPnlCents,
        equityCents:
          openPnlCents === null
            ? null
            : user.balanceCents + reservedCents + openPnlCents,
        stale,
        valuedAt: Date.now(),
        orders,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

type Command =
  | {
      kind: "open";
      asset: Asset;
      type: Side;
      margin: number;
      leverage: number;
      takeProfit?: number;
      stopLoss?: number;
      trailingStopLoss?: { enabled: boolean; trailingDistance: number };
    }
  | { kind: "close"; orderId: string; reason?: string }
  | { kind: "partial_close"; orderId: string; percentage: number }
  | { kind: "add_margin"; orderId: string; additionalMargin: number }
  | {
      kind: "protection";
      orderId: string;
      takeProfit?: number | null;
      stopLoss?: number | null;
    };
const scaled = (usd: number) => Math.round(usd * 10000);
const cents = (usd: number) => Math.round(usd * 100);
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function mutateAccount(
  userId: string,
  key: string,
  command: Command,
) {
  if (!key || key.length > 128)
    throw new DomainError(
      400,
      "IDEMPOTENCY_REQUIRED",
      "A request key is required.",
    );
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(command))
    .digest("hex");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Lock before reading balances or positions; works across processes/replicas.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
          const prior = await tx.mutationReceipt.findUnique({
            where: { userId_key: { userId, key } },
          });
          if (prior) {
            if (prior.fingerprint !== fingerprint)
              throw new DomainError(
                409,
                "KEY_REUSED",
                "This request key was used for a different action.",
              );
            return prior.response;
          }
          const user = await tx.user.findUniqueOrThrow({ where: { userId } });
          let balance = user.balanceCents;
          let positionId: string;
          let result: Record<string, unknown>;
          if (command.kind === "open") {
            const q = executableQuote(command.asset);
            const margin = cents(command.margin);
            const fee = feeCents(margin);
            if (balance < margin + fee)
              throw new DomainError(
                400,
                "INSUFFICIENT_BALANCE",
                "Available cash must cover collateral and the opening fee.",
              );
            const openPrice = command.type === "buy" ? q.ask : q.bid;
            const notionalCents = margin * command.leverage;
            const liq = liquidationPrice(
              openPrice,
              margin,
              notionalCents,
              command.type,
            );
            const tp =
              command.takeProfit == null ? null : scaled(command.takeProfit);
            const sl =
              command.stopLoss == null ? null : scaled(command.stopLoss);
            validateProtection(command.type, openPrice, tp, sl);
            const distance = command.trailingStopLoss?.enabled
              ? scaled(command.trailingStopLoss.trailingDistance)
              : null;
            if (
              distance !== null &&
              (distance <= 0 || distance >= Math.abs(openPrice - liq))
            )
              throw new DomainError(
                400,
                "INVALID_PROTECTION",
                "Trailing distance must be positive and inside the liquidation distance.",
              );
            positionId = randomUUID();
            const order = await tx.activeOrder.create({
              data: {
                orderId: positionId,
                userId,
                asset: command.asset,
                type: command.type,
                margin,
                initialMargin: margin,
                addedMargin: 0,
                leverage: command.leverage,
                notionalCents,
                entryFeeCents: fee,
                openPrice,
                liquidationPrice: liq,
                takeProfit: tp,
                stopLoss: distance
                  ? command.type === "buy"
                    ? Math.max(sl ?? 0, openPrice - distance)
                    : Math.min(
                        sl ?? Number.MAX_SAFE_INTEGER,
                        openPrice + distance,
                      )
                  : sl,
                openedAt: new Date(),
                trailingStopLossEnabled: !!distance,
                trailingStopLossDistance: distance,
                trailingStopLossHighestPrice:
                  distance && command.type === "buy" ? openPrice : null,
                trailingStopLossLowestPrice:
                  distance && command.type === "sell" ? openPrice : null,
              },
            });
            balance -= margin + fee;
            result = { order: positionView(order), feeCents: fee };
          } else {
            positionId = command.orderId;
            const order = await tx.activeOrder.findFirst({
              where: { userId, orderId: positionId },
            });
            if (order?.needsReview)
              throw new DomainError(
                409,
                "EXPOSURE_REVIEW",
                "Historical exposure needs reconciliation before this position can be changed.",
              );
            if (!order)
              throw new DomainError(
                409,
                "POSITION_CHANGED",
                "This position is already closed or no longer available. Refresh your account.",
              );
            const side = order.type as Side;
            if (command.kind === "add_margin") {
              const additional = cents(command.additionalMargin);
              const fee = feeCents(additional);
              if (balance < additional + fee)
                throw new DomainError(
                  400,
                  "INSUFFICIENT_BALANCE",
                  "Available cash must cover added collateral and its fee.",
                );
              balance -= additional + fee;
              const margin = order.margin + additional;
              const updated = await tx.activeOrder.update({
                where: { orderId: positionId },
                data: {
                  margin,
                  addedMargin: order.addedMargin + additional,
                  entryFeeCents: order.entryFeeCents + fee,
                  liquidationPrice: liquidationPrice(
                    order.openPrice,
                    margin,
                    order.notionalCents,
                    side,
                  ),
                },
              });
              result = {
                order: positionView(updated),
                feeCents: fee,
                collateralAddedCents: additional,
              };
            } else if (command.kind === "protection") {
              const q = executableQuote(order.asset);
              const mark = side === "buy" ? q.bid : q.ask;
              const tp =
                command.takeProfit == null ? null : scaled(command.takeProfit);
              const sl =
                command.stopLoss == null ? null : scaled(command.stopLoss);
              validateProtection(side, mark, tp, sl);
              const updated = await tx.activeOrder.update({
                where: { orderId: positionId },
                data: { takeProfit: tp, stopLoss: sl },
              });
              result = { order: positionView(updated) };
            } else {
              const q = executableQuote(order.asset);
              const closePrice = side === "buy" ? q.bid : q.ask;
              if (
                command.kind === "close" &&
                command.reason &&
                shouldClosePosition(order, closePrice)?.reason !==
                  command.reason
              )
                throw new DomainError(
                  409,
                  "RISK_CHANGED",
                  "The risk trigger no longer applies.",
                );
              const fraction =
                command.kind === "partial_close" ? command.percentage / 100 : 1;
              const margin = splitAmount(order.margin, fraction * 100);
              const notional = splitAmount(order.notionalCents, fraction * 100);
              if (margin <= 0 || notional <= 0)
                throw new DomainError(
                  400,
                  "POSITION_TOO_SMALL",
                  "The selected exit is too small. Close the entire position.",
                );
              const entryFee =
                fraction === 1
                  ? order.entryFeeCents
                  : splitAmount(order.entryFeeCents, fraction * 100);
              const initialMargin =
                fraction === 1
                  ? order.initialMargin
                  : splitAmount(order.initialMargin, fraction * 100);
              const addedMargin = margin - initialMargin;
              const rawPnl = pnlCents(
                order.openPrice,
                closePrice,
                notional,
                side,
              );
              // Isolated collateral: gap losses cannot consume other positions/cash.
              const pnl = Math.max(-margin, rawPnl);
              const exitFee = Math.min(feeCents(margin), margin + pnl);
              balance += margin + pnl - exitFee;
              const receiptId = randomUUID();
              const { createdAt, updatedAt, needsReview, ...fields } = order;
              const execution = await tx.closedOrder.create({
                data: {
                  ...fields,
                  feesRecorded: order.feesRecorded,
                  orderId: receiptId,
                  positionId,
                  margin,
                  initialMargin,
                  addedMargin,
                  notionalCents: notional,
                  entryFeeCents: entryFee,
                  exitFeeCents: exitFee,
                  netPnlCents: pnl - entryFee - exitFee,
                  closePrice,
                  pnl,
                  closeReason:
                    command.kind === "partial_close"
                      ? "partial_close"
                      : (command.reason ?? "manual"),
                  closedAt: new Date(),
                },
              });
              if (fraction === 1)
                await tx.activeOrder.delete({ where: { orderId: positionId } });
              else
                await tx.activeOrder.update({
                  where: { orderId: positionId },
                  data: {
                    margin: order.margin - margin,
                    initialMargin: order.initialMargin - initialMargin,
                    addedMargin: order.addedMargin - addedMargin,
                    notionalCents: order.notionalCents - notional,
                    entryFeeCents: order.entryFeeCents - entryFee,
                    liquidationPrice: liquidationPrice(
                      order.openPrice,
                      order.margin - margin,
                      order.notionalCents - notional,
                      side,
                    ),
                  },
                });
              result = {
                execution,
                receiptId,
                feeCents: exitFee,
                pnlCents: pnl,
                netPnlCents: pnl - entryFee - exitFee,
              };
            }
          }
          if (!Number.isSafeInteger(balance) || balance < 0)
            throw new DomainError(
              400,
              "ACCOUNT_LIMIT",
              "This operation exceeds the paper account limit.",
            );
          const updated = await tx.user.update({
            where: { userId },
            data: { balanceCents: balance, version: { increment: 1 } },
          });
          const event = await tx.accountEvent.create({
            data: {
              userId,
              version: updated.version,
              kind: command.kind,
              positionId,
              payload: json({
                ...result,
                balanceBeforeCents: user.balanceCents,
                balanceAfterCents: balance,
              }),
            },
          });
          const response = json({
            ...result,
            positionId,
            availableCents: balance,
            version: updated.version,
            eventId: event.id,
          });
          await tx.mutationReceipt.create({
            data: { userId, key, fingerprint, response },
          });
          return response;
        },
        { maxWait: 10000, timeout: 15000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < 2
      )
        continue;
      throw error;
    }
  }
  throw new Error("Transaction retry exhausted");
}
function validateProtection(
  side: Side,
  price: number,
  tp: number | null,
  sl: number | null,
) {
  if (tp !== null && (tp <= 0 || (side === "buy" ? tp <= price : tp >= price)))
    throw new DomainError(
      400,
      "INVALID_PROTECTION",
      "Take profit must be beyond the current price in the profitable direction.",
    );
  if (sl !== null && (sl <= 0 || (side === "buy" ? sl >= price : sl <= price)))
    throw new DomainError(
      400,
      "INVALID_PROTECTION",
      "Stop loss must be beyond the current price in the loss direction.",
    );
}
