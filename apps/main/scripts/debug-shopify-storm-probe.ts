/**
 * READ-ONLY probe: diagnose the Shopify-driven re-push storm + snap-back.
 * Dumps per-link baseline fields, duplicate-link detection, hub churn, and recent sync log cadence.
 * Run from apps/main: npx tsx scripts/debug-shopify-storm-probe.ts
 */
import fs from "fs";
import path from "path";

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}
loadEnvFile(path.resolve(process.cwd(), "../../.env"));
loadEnvFile(path.resolve(process.cwd(), "../../.env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));
loadEnvFile(path.resolve(process.cwd(), ".env.local"));

function out(obj: unknown) {
  console.log(JSON.stringify(obj, null, 2));
}

async function main() {
  const { prisma } = await import("database");

  // 1) Duplicate links per (storeItemId, provider)
  const grouped = await prisma.channelListingLink.groupBy({
    by: ["storeItemId", "provider"],
    _count: { _all: true },
    having: { storeItemId: { _count: { gt: 1 } } },
  });
  out({ probe: "duplicate_links_per_item_provider", count: grouped.length, rows: grouped.slice(0, 30) });

  // 2) Most recently pushed store items (the storm targets)
  const recentLog = await prisma.channelSyncLog.findMany({
    where: { action: { in: ["push_inventory", "push_content", "conflict_resolved"] } },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { provider: true, action: true, detail: true, storeItemId: true, createdAt: true },
  });
  out({
    probe: "recent_push_log",
    rows: recentLog.map((r) => ({
      at: r.createdAt.toISOString(),
      provider: r.provider,
      action: r.action,
      storeItemId: r.storeItemId,
      detail: r.detail?.slice(0, 80) ?? null,
    })),
  });

  // 3) Pick the most active store item from the log and dump its links + hub
  const focusId =
    process.env.DEBUG_STORE_ITEM_ID?.trim() || recentLog.find((r) => r.storeItemId)?.storeItemId || null;
  if (focusId) {
    const item = await prisma.storeItem.findUnique({
      where: { id: focusId },
      select: { id: true, title: true, quantity: true, status: true, updatedAt: true, variants: true },
    });
    const links = await prisma.channelListingLink.findMany({
      where: { storeItemId: focusId },
      select: {
        id: true,
        provider: true,
        externalListingId: true,
        syncEnabled: true,
        syncStatus: true,
        syncError: true,
        syncBaselineQty: true,
        syncBaselineHash: true,
        syncBaselineAt: true,
        lastPushedAt: true,
        lastPushedHash: true,
        lastInboundAt: true,
        linkOrigin: true,
        updatedAt: true,
        connection: { select: { provider: true, status: true } },
      },
    });
    out({
      probe: "focus_item",
      focusId,
      title: item?.title,
      hubQty: item?.quantity,
      hubStatus: item?.status,
      hubUpdatedAt: item?.updatedAt?.toISOString(),
      variantsIsArray: Array.isArray(item?.variants),
      links: links.map((l) => ({
        provider: l.provider,
        linkId: l.id,
        externalListingId: l.externalListingId,
        syncEnabled: l.syncEnabled,
        syncStatus: l.syncStatus,
        connStatus: l.connection?.status,
        linkOrigin: l.linkOrigin,
        syncBaselineQty: l.syncBaselineQty,
        hubQtyMatchesBaseline: l.syncBaselineQty === item?.quantity,
        syncBaselineAt: l.syncBaselineAt?.toISOString() ?? null,
        syncBaselineAtInFuture: l.syncBaselineAt ? l.syncBaselineAt.getTime() > Date.now() : null,
        lastPushedAt: l.lastPushedAt?.toISOString() ?? null,
        lastInboundAt: l.lastInboundAt?.toISOString() ?? null,
        linkUpdatedAt: l.updatedAt?.toISOString() ?? null,
        syncError: l.syncError?.slice(0, 100) ?? null,
      })),
    });

    // 4) Full recent log for this item to see cadence + interleaving
    const itemLog = await prisma.channelSyncLog.findMany({
      where: { storeItemId: focusId },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { provider: true, action: true, detail: true, createdAt: true },
    });
    out({
      probe: "focus_item_log",
      rows: itemLog.map((r) => ({
        at: r.createdAt.toISOString(),
        provider: r.provider,
        action: r.action,
        detail: r.detail?.slice(0, 80) ?? null,
      })),
    });
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
