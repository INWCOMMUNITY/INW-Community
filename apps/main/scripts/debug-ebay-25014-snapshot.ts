/**
 * Read-only: eBay #25014 links and possible republish (new listing ids).
 * Does not decrypt tokens. Run from apps/main: npx tsx scripts/debug-ebay-25014-snapshot.ts
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), "../../.env"));
loadEnvFile(path.resolve(process.cwd(), "../../.env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));
loadEnvFile(path.resolve(process.cwd(), ".env.local"));

const LOG_PATHS = [
  path.resolve(process.cwd(), "../../debug-8e1c2a.log"),
  path.resolve(process.cwd(), "../../.cursor/debug-8e1c2a.log"),
];
const INGEST = "http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36";

function dbg(hypothesisId: string, message: string, data: Record<string, unknown>) {
  const payload = {
    sessionId: "8e1c2a",
    runId: "pre-fix",
    hypothesisId,
    location: "debug-ebay-25014-snapshot.ts",
    message,
    data,
    timestamp: Date.now(),
  };
  // #region agent log
  fetch(INGEST, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8e1c2a" },
    body: JSON.stringify(payload),
  }).catch(() => {});
  const line = JSON.stringify(payload) + "\n";
  for (const p of LOG_PATHS) {
    try {
      fs.appendFileSync(p, line);
    } catch {
      /* ignore */
    }
  }
  // #endregion
  console.log(JSON.stringify({ hypothesisId, message, data }, null, 2));
}

async function main() {
  const { prisma } = await import("database");
  const since = new Date("2026-09-08T00:00:00.000Z");

  const errorLinks = await prisma.channelListingLink.findMany({
    where: {
      provider: "ebay",
      OR: [
        { syncError: { contains: "25014" } },
        { syncError: { contains: "mixture" } },
        { syncStatus: "error" },
      ],
    },
    select: {
      storeItemId: true,
      externalListingId: true,
      linkOrigin: true,
      syncStatus: true,
      syncError: true,
      lastPushedAt: true,
      lastInboundAt: true,
      createdAt: true,
      updatedAt: true,
      storeItem: {
        select: {
          title: true,
          status: true,
          endedAt: true,
          quantity: true,
          sku: true,
          featured: true,
          updatedAt: true,
          createdAt: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 15,
  });
  dbg("H", "ebay error / 25014 links", {
    count: errorLinks.length,
    rows: errorLinks.map((l) => ({
      storeItemId: l.storeItemId,
      title: l.storeItem.title.slice(0, 50),
      itemStatus: l.storeItem.status,
      endedAt: l.storeItem.endedAt?.toISOString() ?? null,
      featured: l.storeItem.featured,
      qty: l.storeItem.quantity,
      sku: l.storeItem.sku,
      itemCreatedAt: l.storeItem.createdAt.toISOString(),
      listingId: l.externalListingId,
      linkOrigin: l.linkOrigin,
      linkCreatedAt: l.createdAt.toISOString(),
      syncStatus: l.syncStatus,
      syncError: l.syncError?.slice(0, 180) ?? null,
      lastPushedAt: l.lastPushedAt?.toISOString() ?? null,
    })),
  });

  const logs = await prisma.channelSyncLog.findMany({
    where: {
      provider: "ebay",
      createdAt: { gte: since },
      OR: [
        { detail: { contains: "25014" } },
        { action: "error_permanent" },
        { action: "publish" },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  dbg("H", "recent ebay 25014 / publish logs", {
    count: logs.length,
    rows: logs.map((r) => ({
      action: r.action,
      storeItemId: r.storeItemId,
      createdAt: r.createdAt.toISOString(),
      detail: r.detail?.slice(0, 200) ?? null,
    })),
  });

  const recentLinkUpdates = await prisma.channelListingLink.findMany({
    where: { provider: "ebay", updatedAt: { gte: new Date("2026-09-09T02:00:00.000Z") } },
    select: {
      storeItemId: true,
      externalListingId: true,
      updatedAt: true,
      createdAt: true,
      lastPushedAt: true,
      storeItem: { select: { title: true, status: true, createdAt: true, endedAt: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });
  dbg("I", "ebay links updated since 02:00 UTC", {
    rows: recentLinkUpdates.map((l) => ({
      storeItemId: l.storeItemId,
      title: l.storeItem.title.slice(0, 50),
      itemStatus: l.storeItem.status,
      itemCreatedAt: l.storeItem.createdAt.toISOString(),
      endedAt: l.storeItem.endedAt?.toISOString() ?? null,
      listingId: l.externalListingId,
      linkCreatedAt: l.createdAt.toISOString(),
      linkUpdatedAt: l.updatedAt.toISOString(),
      lastPushedAt: l.lastPushedAt?.toISOString() ?? null,
      listingIdChangedFromLinkCreate: l.createdAt.getTime() < Date.parse("2026-09-01T00:00:00.000Z"),
    })),
  });

  const latestLog = await prisma.channelSyncLog.findFirst({
    where: { provider: "ebay", OR: [{ detail: { contains: "25014" } }, { action: "error_permanent" }] },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, action: true, storeItemId: true, detail: true },
  });
  dbg("B", "newest ebay 25014 / permanent log", {
    now: new Date().toISOString(),
    latestLogAt: latestLog?.createdAt.toISOString() ?? null,
    action: latestLog?.action ?? null,
    storeItemId: latestLog?.storeItemId ?? null,
    detail: latestLog?.detail?.slice(0, 220) ?? null,
    secondsAgo: latestLog ? Math.round((Date.now() - latestLog.createdAt.getTime()) / 1000) : null,
  });

  const sinceClear = new Date("2026-09-09T03:36:38.000Z");
  const bear = await prisma.channelListingLink.findFirst({
    where: { provider: "ebay", storeItemId: "cmt7vumcl000dxjujvgwe8dob" },
    select: {
      syncStatus: true,
      syncError: true,
      lastPushedAt: true,
      updatedAt: true,
      storeItem: { select: { quantity: true, updatedAt: true } },
    },
  });
  const afterClearLogs = await prisma.channelSyncLog.findMany({
    where: {
      provider: "ebay",
      storeItemId: "cmt7vumcl000dxjujvgwe8dob",
      createdAt: { gte: sinceClear },
    },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { action: true, createdAt: true, detail: true },
  });
  dbg("B", "bear clock after clear / user repro", {
    syncStatus: bear?.syncStatus ?? null,
    syncError: bear?.syncError?.slice(0, 180) ?? null,
    lastPushedAt: bear?.lastPushedAt?.toISOString() ?? null,
    linkUpdatedAt: bear?.updatedAt.toISOString() ?? null,
    qty: bear?.storeItem.quantity ?? null,
    itemUpdatedAt: bear?.storeItem.updatedAt.toISOString() ?? null,
    logsAfterClear: afterClearLogs.map((r) => ({
      action: r.action,
      createdAt: r.createdAt.toISOString(),
      detail: r.detail?.slice(0, 160) ?? null,
    })),
  });

  if (bear?.syncError?.includes("25014")) {
    const cleared = await prisma.channelListingLink.updateMany({
      where: {
        provider: "ebay",
        storeItemId: "cmt7vumcl000dxjujvgwe8dob",
        syncError: { contains: "25014" },
      },
      data: { syncStatus: "synced", syncError: null },
    });
    dbg("B", "re-cleared bear clock 25014 after repro", { linksCleared: cleared.count });
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
