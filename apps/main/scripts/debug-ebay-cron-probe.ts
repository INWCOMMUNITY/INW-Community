/**
 * Read-only: compare live GetItem vs INW for the tachometer listing.
 * Does not write StoreItem. Token refresh may still persist if the access token is expired.
 * Run from apps/main: npx tsx scripts/debug-ebay-cron-probe.ts
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
    process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), "../../.env"));

const INGEST = "http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36";
const ITEM_ID = "394295737513";
const STORE_ITEM_ID = "cmszdh3g90002en9rd8o2enil";

function dbg(hypothesisId: string, location: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  fetch(INGEST, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "4f2763" },
    body: JSON.stringify({
      sessionId: "4f2763",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

function dbHost(): string {
  const raw = process.env.DATABASE_URL ?? "";
  const m = raw.match(/@([^/?]+)/);
  return m?.[1] ?? (raw ? "(unparseable)" : "(missing)");
}

async function main() {
  dbg("H-E", "debug-ebay-cron-probe.ts:env", "local probe env flags", {
    dbHost: dbHost(),
    hasCronSecret: Boolean(process.env.CRON_SECRET),
    channelCronSyncEnabled: process.env.CHANNEL_CRON_SYNC_ENABLED === "true",
    hasEbayWebhookSecret: Boolean(process.env.EBAY_WEBHOOK_SECRET?.trim()),
    hasEncryptionKey: Boolean(process.env.ENCRYPTION_KEY),
  });

  const { prisma } = await import("database");
  const { getConnectionContext } = await import("../src/lib/channels/connection");
  const { fetchEbayItemDetails } = await import("../src/lib/channels/ebay/trading");
  const { ebayGetItemIsStaleVersusInw } = await import("../src/lib/channels/ebay/pull-ebay-updates");

  const storeItem = await prisma.storeItem.findUnique({
    where: { id: STORE_ITEM_ID },
    select: {
      id: true,
      title: true,
      priceCents: true,
      quantity: true,
      updatedAt: true,
      status: true,
    },
  });

  const links = await prisma.channelListingLink.findMany({
    where: {
      provider: "ebay",
      OR: [{ externalListingId: ITEM_ID }, { externalListingId: `inw${ITEM_ID}` }],
    },
    select: {
      id: true,
      connectionId: true,
      externalListingId: true,
      syncEnabled: true,
      lastInboundAt: true,
      syncStatus: true,
      syncError: true,
    },
  });

  const connectionIds = [...new Set(links.map((l) => l.connectionId))];
  const connections = await prisma.channelConnection.findMany({
    where: { id: { in: connectionIds } },
    select: {
      id: true,
      provider: true,
      status: true,
      tokenExpiresAt: true,
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true,
      lastError: true,
      lastReconciledAt: true,
    },
  });

  dbg("H-C", "debug-ebay-cron-probe.ts:db", "INW listing + link + connection", {
    foundStoreItem: Boolean(storeItem),
    inwTitle: storeItem?.title ?? null,
    inwPriceCents: storeItem?.priceCents ?? null,
    inwQty: storeItem?.quantity ?? null,
    inwUpdatedAt: storeItem?.updatedAt.toISOString() ?? null,
    inwStatus: storeItem?.status ?? null,
    linkCount: links.length,
    links: links.map((l) => ({
      connectionId: l.connectionId,
      externalListingId: l.externalListingId,
      syncEnabled: l.syncEnabled,
      lastInboundAt: l.lastInboundAt?.toISOString() ?? null,
      syncStatus: l.syncStatus,
      hasSyncError: Boolean(l.syncError),
    })),
    connections: connections.map((c) => ({
      id: c.id,
      provider: c.provider,
      status: c.status,
      tokenExpiresAt: c.tokenExpiresAt?.toISOString() ?? null,
      tokenExpired: c.tokenExpiresAt != null && c.tokenExpiresAt.getTime() < Date.now(),
      hasAccessToken: Boolean(c.accessTokenEncrypted),
      hasRefreshToken: Boolean(c.refreshTokenEncrypted),
      lastReconciledAt: c.lastReconciledAt?.toISOString() ?? null,
      hasLastError: Boolean(c.lastError),
    })),
  });

  const conn = await prisma.channelConnection.findFirst({
    where: { id: connections[0]?.id ?? "" },
  });
  if (!storeItem || !conn) {
    dbg("H-C", "debug-ebay-cron-probe.ts:missing", "store item or connection missing", {
      hasStoreItem: Boolean(storeItem),
      hasConnection: Boolean(conn),
    });
    await prisma.$disconnect();
    return;
  }

  const ctx = await getConnectionContext(conn);
  if (!ctx) {
    dbg("H-C", "debug-ebay-cron-probe.ts:noCtx", "could not decrypt/refresh eBay token", {
      connectionId: conn.id,
      status: conn.status,
    });
    await prisma.$disconnect();
    return;
  }

  const details = await fetchEbayItemDetails(ctx.accessToken, ITEM_ID);
  const link = links[0];
  const staleVersusInw = ebayGetItemIsStaleVersusInw({
    lastInboundAt: link?.lastInboundAt ?? null,
    inwUpdatedAt: storeItem.updatedAt,
    ebayLastModified: details.remoteUpdatedAt,
  });
  const titleDiff = (details.title ?? "") !== storeItem.title;
  const priceDiff = details.priceCents != null && details.priceCents !== storeItem.priceCents;
  const qtyDiff = details.quantity != null && details.quantity !== storeItem.quantity;
  const cronWouldSkip = staleVersusInw;
  const cronWouldWrite = !cronWouldSkip && (titleDiff || priceDiff || qtyDiff);

  dbg("H-A", "debug-ebay-cron-probe.ts:stale", "echo-window decision for cron vs refresh", {
    staleVersusInw,
    cronPassesForce: false,
    refreshPassesForce: true,
    lastInboundAt: link?.lastInboundAt?.toISOString() ?? null,
    inwUpdatedAt: storeItem.updatedAt.toISOString(),
    ebayLastModified: details.remoteUpdatedAt?.toISOString() ?? null,
    msSinceInbound:
      link?.lastInboundAt != null ? Date.now() - link.lastInboundAt.getTime() : null,
  });

  dbg("H-B", "debug-ebay-cron-probe.ts:getitem", "live GetItem vs INW", {
    getItemTitle: details.title,
    getItemPriceCents: details.priceCents,
    getItemQty: details.quantity,
    listingEnded: details.listingEnded,
    inwTitle: storeItem.title,
    inwPriceCents: storeItem.priceCents,
    inwQty: storeItem.quantity,
    titleDiff,
    priceDiff,
    qtyDiff,
    cronWouldSkip,
    cronWouldWrite,
  });

  dbg("H-D", "debug-ebay-cron-probe.ts:force", "cron vs refresh force flag", {
    cronForce: false,
    refreshForce: true,
    staleVersusInw,
    sameGetItemWouldApplyOnRefresh: staleVersusInw && (titleDiff || priceDiff || qtyDiff),
  });

  console.log(
    JSON.stringify(
      {
        dbHost: dbHost(),
        inwTitle: storeItem.title,
        getItemTitle: details.title,
        staleVersusInw,
        cronWouldSkip,
        cronWouldWrite,
      },
      null,
      2
    )
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  dbg("H-C", "debug-ebay-cron-probe.ts:fatal", "probe threw", {
    error: e instanceof Error ? e.message : String(e),
  });
  console.error(e);
  process.exit(1);
});
