import { prisma } from "@orbitledger/database";
import { accountSummary } from "./accountService";
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
async function saveSnapshots() {
  try {
    const users = await prisma.user.findMany({ select: { userId: true } });
    for (const user of users) {
      const s = await accountSummary(user.userId);
      await prisma.equitySnapshot.create({
        data: {
          userId: user.userId,
          availableCents: s.availableCents,
          reservedCents: s.reservedCents,
          pnlCents: s.openPnlCents,
          equityCents: s.equityCents,
          stale: s.stale,
        },
      });
    }
    const cutoff = new Date(Date.now() - 366 * 86400000);
    await prisma.equitySnapshot.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    // Legacy snapshots serve only operational recovery and are bounded to seven days.
    const retentionDays = Number(
      process.env.LEGACY_SNAPSHOT_RETENTION_DAYS ?? 0,
    );
    if (retentionDays > 0) {
      const legacyCutoff = new Date(Date.now() - retentionDays * 86400000);
      await prisma.userSnapshot.deleteMany({
        where: { snapshotAt: { lt: legacyCutoff } },
      });
      await prisma.orderSnapshot.deleteMany({
        where: { snapshotAt: { lt: legacyCutoff } },
      });
    }
    await prisma.authSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    await prisma.loginCode.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  } catch (error) {
    console.error("[SNAPSHOT]", error);
  } finally {
    if (running) timer = setTimeout(saveSnapshots, 300000);
  }
}
export function startSnapshotService() {
  if (!running) {
    running = true;
    void saveSnapshots();
  }
}
export function stopSnapshotService() {
  running = false;
  if (timer) clearTimeout(timer);
}
