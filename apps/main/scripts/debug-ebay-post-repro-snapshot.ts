/**
 * Read-only post-repro snapshot. Does not decrypt tokens or call eBay.
 * Run from apps/main: npx tsx scripts/debug-ebay-post-repro-snapshot.ts
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
const FOCUS_ID = "cmt7vumcl000dxjujvgwe8dob";
const SINCE = new Date("2026-09-09T02:10:00.000Z");

function dbg(hypothesisId: string, location: string, message: string, data: Record<string, unknown>) {
  const payload = {
    sessionId: "8e1c2a",
    runId: "post-repro",
    hypothesisId,
    location,
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
  console.log(JSON.stringify({ hypothesisId, location, message, data }, null, 2));
}

function pauseReasonOf(config: unknown): string | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const v = (config as Record<string, unknown>).pauseReason;
  return typeof v === "string" ? v : null;
}

async function main() {
  const { prisma } = await import("database");

  const conns = await prisma.channelConnection.findMany({
    select: {
      provider: true,
      status: true,
      lastError: true,
      config: true,
      updatedAt: true,
    },
  });
  dbg("F", "debug-ebay-post-repro-snapshot.ts:conns", "connection health after repro", {
    rows: conns.map((c) => ({
      provider: c.provider,
      status: c.status,
      pauseReason: pauseReasonOf(c.config),
      lastErrorPrefix: c.lastError?.slice(0, 120) ?? null,
      updatedAt: c.updatedAt.toISOString(),
    })),
  });

  const item = await prisma.storeItem.findUnique({
    where: { id: FOCUS_ID },
    select: { id: true, title: true, updatedAt: true, quantity: true, priceCents: true, status: true },
  });
  const links = await prisma.channelListingLink.findMany({
    where: { storeItemId: FOCUS_ID },
    select: {
      provider: true,
      syncStatus: true,
      syncError: true,
      lastPushedAt: true,
      lastInboundAt: true,
      updatedAt: true,
    },
  });
  dbg("D", "debug-ebay-post-repro-snapshot.ts:item", "focus item + links", {
    title: item?.title ?? null,
    inwUpdatedAt: item?.updatedAt.toISOString() ?? null,
    qty: item?.quantity ?? null,
    priceCents: item?.priceCents ?? null,
    status: item?.status ?? null,
    links: links.map((l) => ({
      provider: l.provider,
      syncStatus: l.syncStatus,
      syncError: l.syncError?.slice(0, 180) ?? null,
      lastPushedAt: l.lastPushedAt?.toISOString() ?? null,
      lastInboundAt: l.lastInboundAt?.toISOString() ?? null,
      linkUpdatedAt: l.updatedAt.toISOString(),
    })),
  });

  const retries = await prisma.channelSyncRetry.findMany({
    where: { storeItemId: FOCUS_ID },
  });
  dbg("D", "debug-ebay-post-repro-snapshot.ts:retries", "retry queue after repro", {
    count: retries.length,
    rows: retries.map((r) => ({
      provider: r.provider,
      retryType: r.retryType,
      attempts: r.attempts,
      nextRetryAt: r.nextRetryAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      lastError: r.lastError?.slice(0, 160) ?? null,
    })),
  });

  const logs = await prisma.channelSyncLog.findMany({
    where: {
      createdAt: { gte: SINCE },
      OR: [
        { storeItemId: FOCUS_ID },
        { action: { in: ["conflict_resolved", "token_expired", "pause_classified", "error_permanent"] } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  dbg("G", "debug-ebay-post-repro-snapshot.ts:logs", "sync log since restore window", {
    since: SINCE.toISOString(),
    count: logs.length,
    rows: logs.map((r) => ({
      provider: r.provider,
      action: r.action,
      storeItemId: r.storeItemId,
      createdAt: r.createdAt.toISOString(),
      detail: r.detail?.slice(0, 180) ?? null,
    })),
  });

  const activity = await prisma.sellerActivityLog.findMany({
    where: { entityId: FOCUS_ID, createdAt: { gte: SINCE } },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  dbg("C", "debug-ebay-post-repro-snapshot.ts:activity", "seller saves since restore", {
    count: activity.length,
    rows: activity.map((r) => ({
      action: r.action,
      createdAt: r.createdAt.toISOString(),
      title: (r.detail as { title?: string } | null)?.title ?? null,
    })),
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
