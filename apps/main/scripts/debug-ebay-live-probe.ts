/**
 * Read-only: retries, inbound stamps, other-channel links, live eBay vs INW
 * for the latest eBay-linked listings (especially the Bear Clock 500).
 * Run from apps/main: npx tsx scripts/debug-ebay-outbound-skip-probe.ts
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

const LOG_PATH = path.resolve(process.cwd(), "../../debug-8e1c2a.log");
const INGEST = "http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36";
const FOCUS_ID = process.env.DEBUG_STORE_ITEM_ID ?? "cmt7vumcl000dxjujvgwe8dob";

function dbg(hypothesisId: string, location: string, message: string, data: Record<string, unknown>) {
  const payload = {
    sessionId: "8e1c2a",
    runId: "pre-fix",
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
  try {
    fs.appendFileSync(LOG_PATH, JSON.stringify(payload) + "\n");
  } catch {
    /* ignore */
  }
  // #endregion
  console.log(JSON.stringify({ hypothesisId, location, message, data }, null, 2));
}

async function main() {
  const { prisma } = await import("database");
  const { classifyError } = await import("../src/lib/channels/error-classifier");
  const { isCircuitOpen, hydrateCircuitFromConfig } = await import(
    "../src/lib/channels/circuit-breaker"
  );

  const item = await prisma.storeItem.findUnique({
    where: { id: FOCUS_ID },
    select: {
      id: true,
      title: true,
      description: true,
      priceCents: true,
      quantity: true,
      status: true,
      updatedAt: true,
      sku: true,
    },
  });
  if (!item) {
    dbg("D", "debug-ebay-live-probe.ts:missing", "focus item missing", { FOCUS_ID });
    await prisma.$disconnect();
    return;
  }

  const links = await prisma.channelListingLink.findMany({
    where: { storeItemId: FOCUS_ID },
    include: {
      connection: { select: { id: true, status: true, config: true, memberId: true, provider: true } },
    },
  });

  dbg("E", "debug-ebay-live-probe.ts:links", "all channel links on focus item", {
    storeItemId: item.id,
    title: item.title,
    inwUpdatedAt: item.updatedAt.toISOString(),
    qty: item.quantity,
    priceCents: item.priceCents,
    status: item.status,
    sku: item.sku,
    links: links.map((l) => ({
      provider: l.provider,
      externalListingId: l.externalListingId,
      syncEnabled: l.syncEnabled,
      syncStatus: l.syncStatus,
      syncError: l.syncError?.slice(0, 220) ?? null,
      lastPushedAt: l.lastPushedAt?.toISOString() ?? null,
      lastInboundAt: l.lastInboundAt?.toISOString() ?? null,
      linkOrigin: l.linkOrigin,
      connectionStatus: l.connection.status,
    })),
  });

  const retries = await prisma.channelSyncRetry.findMany({
    where: { storeItemId: FOCUS_ID },
  });
  dbg("D", "debug-ebay-live-probe.ts:retries", "retry queue rows", {
    count: retries.length,
    rows: retries.map((r) => ({
      provider: r.provider,
      retryType: r.retryType,
      attempts: r.attempts,
      nextRetryAt: r.nextRetryAt.toISOString(),
      lastError: r.lastError?.slice(0, 180) ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  });

  const logs = await prisma.channelSyncLog.findMany({
    where: { storeItemId: FOCUS_ID },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  dbg("D", "debug-ebay-live-probe.ts:synclog", "recent channel sync log", {
    count: logs.length,
    rows: logs.map((r) => ({
      provider: r.provider,
      action: r.action,
      detail: r.detail?.slice(0, 180) ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  });

  const activity = await prisma.sellerActivityLog.findMany({
    where: { entityId: FOCUS_ID },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  dbg("C", "debug-ebay-live-probe.ts:activity", "seller activity on focus item", {
    rows: activity.map((r) => ({
      action: r.action,
      createdAt: r.createdAt.toISOString(),
      detail: r.detail,
    })),
  });

  const ebayLink = links.find((l) => l.provider === "ebay");
  if (ebayLink) {
    hydrateCircuitFromConfig(ebayLink.connectionId, ebayLink.connection.config);
    const cfg =
      ebayLink.connection.config && typeof ebayLink.connection.config === "object"
        ? (ebayLink.connection.config as Record<string, unknown>)
        : {};
    dbg("D", "debug-ebay-live-probe.ts:circuit", "ebay circuit + retry drop predicate", {
      circuitOpen: isCircuitOpen(ebayLink.connectionId),
      lastInboundAt: ebayLink.lastInboundAt?.toISOString() ?? null,
      lastPushedAt: ebayLink.lastPushedAt?.toISOString() ?? null,
      wouldDropContentRetry:
        retries.some(
          (r) =>
            r.provider === "ebay" &&
            r.retryType === "content" &&
            ebayLink.lastInboundAt != null &&
            ebayLink.lastInboundAt.getTime() > r.createdAt.getTime()
        ) ||
        (ebayLink.lastInboundAt != null &&
          retries.length === 0 &&
          ebayLink.lastInboundAt.getTime() > Date.parse("2026-09-09T01:57:00.000Z")),
      classified: classifyError(ebayLink.syncError ?? ""),
      classifiedRaw500: classifyError(
        "[#25002 · API_INVENTORY · Request · HTTP 500] A user error has occurred. System error. Unable to process your request. Please try again later."
      ),
      circuitKeys: Object.keys(cfg).filter((k) => /circuit/i.test(k)),
    });
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
