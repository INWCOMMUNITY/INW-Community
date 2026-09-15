/**
 * Cron-like eBay inbound for qty/price debug (no force). Catch-up may write live offer qty.
 * Run from apps/main after editing the listing on eBay:
 *   npx tsx scripts/debug-ebay-qty-price-repro.ts <storeItemId-or-listingId> [...]
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

const TARGETS = process.argv.slice(2).filter(Boolean);

async function main() {
  if (TARGETS.length === 0) {
    console.error("Pass at least one INW store item id or eBay listing id.");
    process.exit(1);
  }

  const { prisma } = await import("database");
  const { getConnectionContext } = await import("../src/lib/channels/connection");
  const { resolveEbayLegacyListingId } = await import("../src/lib/channels/ebay/mapping");
  const { refreshEbayListingByItemId } = await import("../src/lib/channels/ebay/pull-ebay-updates");
  const { updateStoreItemOnChannels } = await import("../src/lib/channels/outbound");
  const { normalizeVariantMatrix } = await import("../src/lib/listing-variant-matrix");
  const { isValidEbayInventorySku, toEbayInventorySku } = await import(
    "../src/lib/channels/ebay/migrate-prep"
  );
  const { hasOptionQuantities } = await import("../src/lib/store-item-variants");

  const dbg = (hypothesisId: string, location: string, message: string, data: Record<string, unknown>) => {
    // #region agent log
    fetch("http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6bee04" },
      body: JSON.stringify({
        sessionId: "6bee04",
        hypothesisId,
        location,
        message,
        data,
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  };

  async function dumpInwSkus(storeItemId: string) {
    const item = await prisma.storeItem.findUnique({
      where: { id: storeItemId },
      select: { id: true, title: true, sku: true, quantity: true, priceCents: true, variants: true },
    });
    if (!item) return;
    const matrix = normalizeVariantMatrix(item.variants);
    const rows = (matrix?.skus ?? []).map((s) => {
      const sku = s.sku?.trim() || null;
      const compact = sku ? toEbayInventorySku(sku) : null;
      return {
        sku,
        compact,
        options: s.options,
        qty: s.quantity,
        priceCents: s.priceCents ?? null,
        hasNonAlnum: Boolean(sku && compact && compact !== sku),
        validEbaySku: sku ? isValidEbayInventorySku(sku) : false,
      };
    });
    const payload = {
      storeItemId: item.id,
      title: item.title,
      parentSku: item.sku,
      parentCompact: item.sku ? toEbayInventorySku(item.sku) : null,
      parentValidEbay: item.sku ? isValidEbayInventorySku(item.sku) : false,
      listingQty: item.quantity,
      listingPriceCents: item.priceCents,
      hyphenSkuCount: rows.filter((r) => r.hasNonAlnum).length,
      invalidEbaySkuCount: rows.filter((r) => r.sku && !r.validEbaySku).length,
      skuCount: rows.length,
      rows: rows.slice(0, 12),
    };
    dbg("F", "debug-ebay-qty-price-repro.ts:inwSkus", "INW SKUs vs eBay alphanumeric key", payload);
    console.log(JSON.stringify({ skuDump: payload }, null, 2));
  }

  // #region agent log
  fetch("http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6bee04" },
    body: JSON.stringify({
      sessionId: "6bee04",
      hypothesisId: "B",
      location: "debug-ebay-qty-price-repro.ts:start",
      message: "cron-like ebay pull starting",
      data: { targets: TARGETS },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  for (const target of TARGETS) {
    const byId = await prisma.storeItem.findUnique({
      where: { id: target },
      select: {
        id: true,
        title: true,
        quantity: true,
        priceCents: true,
        channelLinks: {
          where: { provider: "ebay" },
          select: { externalListingId: true, connection: true },
        },
      },
    });
    let storeItemId = byId?.id ?? null;
    let listingId = byId ? resolveEbayLegacyListingId(byId.channelLinks[0]?.externalListingId ?? "") : null;
    let connection = byId?.channelLinks[0]?.connection ?? null;

    if (!storeItemId) {
      const link = await prisma.channelListingLink.findFirst({
        where: {
          OR: [
            { externalListingId: target },
            { externalListingId: `inw${target}` },
            { externalListingId: { contains: target } },
          ],
        },
        include: {
          storeItem: { select: { id: true, title: true, quantity: true, priceCents: true, variants: true } },
          connection: true,
        },
      });
      storeItemId = link?.storeItem.id ?? null;
      listingId = resolveEbayLegacyListingId(link?.externalListingId ?? target);
      connection = link?.connection ?? null;
      console.log(
        JSON.stringify({
          target,
          resolvedFrom: "listingId",
          provider: link?.provider ?? null,
          storeItemId,
          title: link?.storeItem.title,
          inwQty: link?.storeItem.quantity,
          inwPriceCents: link?.storeItem.priceCents,
          isSimple: link?.storeItem ? !hasOptionQuantities(link.storeItem.variants) : null,
        })
      );
    } else {
      console.log(
        JSON.stringify({
          target,
          resolvedFrom: "storeItemId",
          storeItemId,
          title: byId?.title,
          inwQty: byId?.quantity,
          inwPriceCents: byId?.priceCents,
        })
      );
    }

    if (!storeItemId) {
      const simple = await prisma.channelListingLink.findMany({
        where: { provider: "ebay", syncEnabled: true },
        take: 30,
        select: {
          externalListingId: true,
          storeItem: { select: { id: true, title: true, quantity: true, variants: true } },
        },
      });
      const simpleHits = simple
        .filter((row) => !hasOptionQuantities(row.storeItem.variants))
        .slice(0, 8)
        .map((row) => ({
          storeItemId: row.storeItem.id,
          listingId: row.externalListingId,
          title: row.storeItem.title,
          qty: row.storeItem.quantity,
        }));
      dbg("C", "debug-ebay-qty-price-repro.ts:unresolved", "listing id not linked; sample simple ebay items", {
        target,
        simpleHits,
      });
      console.error("Could not resolve eBay link for", target);
      console.log(JSON.stringify({ simpleEbayListings: simpleHits }, null, 2));
      continue;
    }

    await dumpInwSkus(storeItemId);

    if (!listingId || !connection) {
      console.error("Could not resolve eBay link for", target);
      continue;
    }

    const ctx = await getConnectionContext(connection);
    if (!ctx) {
      dbg("F", "debug-ebay-qty-price-repro.ts:noToken", "local decrypt blocked; SKU dump only", {
        storeItemId,
        listingId,
      });
      console.error(
        "No eBay token from this local process (hosted DB). SKU dump above is still valid. Use Refresh from eBay on the live site only after a deploy, or rerun with production ENCRYPTION_KEY."
      );
      continue;
    }

    const result = await refreshEbayListingByItemId(ctx.accessToken, listingId, { source: "cron" });
    console.log(JSON.stringify({ target, listingId, pull: result }, null, 2));

    const outbound = await updateStoreItemOnChannels(storeItemId);
    console.log(JSON.stringify({ target, outbound }, null, 2));
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
