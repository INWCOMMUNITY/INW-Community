/**
 * Read-only: why INW→eBay content push would skip for the latest edited linked listing.
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
  const { storeItemContentHash, syncContentHash, inwSavedAfterChannelPush } = await import(
    "../src/lib/channels/sync-baseline"
  );
  const { toSyncStoreItem } = await import("../src/lib/channels/store-item");
  const { shouldPushSoldOutInventoryOnly } = await import("../src/lib/channels/sold-out-guard");
  const { shouldSkipEndedEbayOutbound } = await import("../src/lib/channels/listing-link-flags");
  const { isImportedEbayLink } = await import("../src/lib/channels/ebay/listing-origin");
  const { variantsFingerprint } = await import("../src/lib/channels/variant-sync");

  const links = await prisma.channelListingLink.findMany({
    where: { provider: "ebay", syncEnabled: true },
    orderBy: { storeItem: { updatedAt: "desc" } },
    take: 5,
    include: {
      connection: { select: { id: true, status: true, config: true, memberId: true } },
      storeItem: {
        select: {
          id: true,
          sku: true,
          title: true,
          description: true,
          photos: true,
          priceCents: true,
          quantity: true,
          variants: true,
          status: true,
          condition: true,
          shippingCostCents: true,
          category: true,
          subcategory: true,
          secondaryCategory: true,
          etsyWhoMade: true,
          etsyWhenMade: true,
          etsyIsSupply: true,
          etsyTaxonomyId: true,
          ebayCategoryId: true,
          ebayConditionEnum: true,
          acceptOffers: true,
          minOfferCents: true,
          aspects: true,
          updatedAt: true,
        },
      },
    },
  });

  dbg("A", "debug-ebay-outbound-skip-probe.ts:list", "latest ebay-linked items", {
    count: links.length,
    items: links.map((l) => ({
      storeItemId: l.storeItemId,
      title: l.storeItem.title.slice(0, 40),
      updatedAt: l.storeItem.updatedAt.toISOString(),
      lastPushedAt: l.lastPushedAt?.toISOString() ?? null,
      syncStatus: l.syncStatus,
      syncError: l.syncError?.slice(0, 160) ?? null,
      connectionStatus: l.connection.status,
    })),
  });

  for (const link of links) {
    const item = toSyncStoreItem(link.storeItem);
    const hash = storeItemContentHash(item);
    const contentUnchanged = link.lastPushedHash === hash;
    const savedAfterThisChannel = inwSavedAfterChannelPush({
      inwUpdatedAt: link.storeItem.updatedAt,
      lastPushedAt: link.lastPushedAt,
    });
    const inventoryDrift =
      link.syncBaselineQty !== item.quantity ||
      (link.syncBaselineVariantsHash ?? "") !== variantsFingerprint(item.variants);
    const ended = shouldSkipEndedEbayOutbound("ebay", link.conflictDetails);
    const inventoryOnly = shouldPushSoldOutInventoryOnly({
      quantity: item.quantity,
      status: item.status,
      contentUnchanged,
      inventoryDrift,
      syncBaselineHash: link.syncBaselineHash,
      contentHashNow: syncContentHash(item),
    });
    const connConfig = (link.connection.config ?? {}) as Record<string, unknown>;
    const syncDirection = (connConfig.syncDirection as string) ?? "two_way";
    const prefs = await prisma.memberSyncPreferences.findUnique({
      where: { memberId: link.connection.memberId },
      select: {
        syncEnabled: true,
        syncTitles: true,
        syncDescriptions: true,
        syncPhotos: true,
        syncPrices: true,
      },
    });
    const wouldHashSkip = contentUnchanged && !inventoryDrift && !savedAfterThisChannel;
    const imported = isImportedEbayLink({
      provider: "ebay",
      externalListingId: link.externalListingId,
      storeItemId: item.id,
      linkOrigin: link.linkOrigin,
    });

    dbg("A", "debug-ebay-outbound-skip-probe.ts:decide", "outbound skip decision", {
      storeItemId: item.id,
      title: item.title.slice(0, 50),
      imported,
      ended,
      connectionStatus: link.connection.status,
      syncDirection,
      syncEnabled: prefs?.syncEnabled ?? null,
      syncTitles: prefs?.syncTitles ?? null,
      contentUnchanged,
      inventoryDrift,
      savedAfterThisChannel,
      inventoryOnly,
      wouldHashSkip,
      wouldSkip:
        ended ||
        wouldHashSkip ||
        prefs?.syncEnabled === false ||
        syncDirection === "pull_only" ||
        syncDirection === "paused",
      inwUpdatedAt: link.storeItem.updatedAt.toISOString(),
      lastPushedAt: link.lastPushedAt?.toISOString() ?? null,
      hashPrefix: hash.slice(0, 12),
      lastHashPrefix: (link.lastPushedHash ?? "").slice(0, 12),
      lastHashLen: link.lastPushedHash?.length ?? 0,
      hashLen: hash.length,
      hashesEqual: link.lastPushedHash === hash,
      lastHashIsSyncContent:
        link.lastPushedHash != null && link.lastPushedHash === syncContentHash(item),
      qty: item.quantity,
      status: item.status,
      syncStatus: link.syncStatus,
      syncError: link.syncError?.slice(0, 200) ?? null,
    });
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
