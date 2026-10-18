import { createClient } from "redis";
import { prisma } from "@orbitledger/database";
const client = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});
client.on("error", (error) =>
  console.error("[OUTBOX] Redis connection", error.message),
);
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
export async function initOrderBroadcast() {
  if (!client.isOpen) await client.connect();
}
export async function stopOrderBroadcast() {
  stopOutbox();
  if (client.isOpen) await client.quit();
}
export function startOutbox() {
  if (running) return;
  running = true;
  void deliver();
}
async function deliver() {
  try {
    if (client.isReady) {
      const events = await prisma.accountEvent.findMany({
        where: { deliveredAt: null },
        orderBy: { createdAt: "asc" },
        take: 100,
      });
      for (const event of events) {
        await client.publish(
          `orders:${event.userId}`,
          JSON.stringify({ type: "ACCOUNT_EVENT", data: event }),
        );
        await prisma.accountEvent.update({
          where: { id: event.id },
          data: { deliveredAt: new Date() },
        });
      }
    }
  } catch (error) {
    console.error(
      "[OUTBOX] Delivery deferred; events remain replayable",
      error,
    );
  } finally {
    if (running) timer = setTimeout(deliver, 250);
  }
}
export function stopOutbox() {
  running = false;
  if (timer) clearTimeout(timer);
}
