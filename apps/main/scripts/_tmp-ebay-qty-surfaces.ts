/**
 * Read-only dump: INW vs eBay inventory vs live offer vs GetItem qty.
 * Does not write to eBay or INW.
 */
import { prisma } from "database";
import { getConnectionContext } from "../src/lib/channels/connection";
import { ebayGet } from "../src/lib/channels/ebay/client";
import { EBAY_MARKETPLACE_ID } from "../src/lib/channels/ebay/config";
import {
  fetchLiveInventoryItem,
  readLiveInventoryAvailableQuantity,
} from "../src/lib/channels/ebay/passthrough-push";
import { pickEbayOffer } from "../src/lib/channels/ebay/publish-policy";
import { fetchEbayItemDetails } from "../src/lib/channels/ebay/trading";

const STORE_ITEM_ID = "cmt7vumcl000dxjujvgwe8dob";

function asQty(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

function optionKey(options: Record<string, string> | undefined): string {
  return Object.values(options ?? {})
    .map((v) => String(v).trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
}

async function readOffer(accessToken: string, sku: string) {
  const search = await ebayGet<{
    offers?: Array<{
      offerId?: string;
      status?: string;
      availableQuantity?: unknown;
    }>;
  }>(
    accessToken,
    `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${EBAY_MARKETPLACE_ID}`
  );
  const offer = pickEbayOffer(search.offers);
  const searchQty = asQty(offer?.availableQuantity);
  let detailQty: number | null = null;
  if (offer?.offerId) {
    try {
      const details = await ebayGet<{ availableQuantity?: unknown; status?: string }>(
        accessToken,
        `/sell/inventory/v1/offer/${encodeURIComponent(offer.offerId)}`
      );
      detailQty = asQty(details.availableQuantity);
    } catch {
      detailQty = null;
    }
  }
  return {
    offerId: offer?.offerId ?? null,
    status: offer?.status ?? null,
    searchQty,
    detailQty,
    searchQtyType: offer?.availableQuantity == null ? "missing" : typeof offer.availableQuantity,
  };
}

async function main() {
  const item = await prisma.storeItem.findUnique({
    where: { id: STORE_ITEM_ID },
    select: {
      title: true,
      quantity: true,
      updatedAt: true,
      variants: true,
      channelLinks: {
        select: {
          provider: true,
          externalListingId: true,
          lastPushedAt: true,
          lastInboundAt: true,
          syncBaselineQty: true,
          connection: true,
        },
      },
    },
  });
  if (!item) {
    console.log(JSON.stringify({ error: "store item not found" }));
    await prisma.$disconnect();
    return;
  }
  const link = item.channelLinks.find((l) => l.provider === "ebay");
  if (!link) {
    console.log(
      JSON.stringify({
        error: "no ebay link",
        title: item.title,
        providers: item.channelLinks.map((l) => l.provider),
      })
    );
    await prisma.$disconnect();
    return;
  }
  const ctx = await getConnectionContext(link.connection);
  if (!ctx) {
    console.log(JSON.stringify({ error: "no ebay connection context (decrypt or token)" }));
    await prisma.$disconnect();
    return;
  }

  const listingId = link.externalListingId.replace(/^inw/, "");
  const details = await fetchEbayItemDetails(ctx.accessToken, listingId);
  const tradingBySku = new Map<string, number>();
  const tradingByOptions = new Map<string, number>();
  for (const row of details.variants?.skus ?? []) {
    if (row.sku?.trim()) tradingBySku.set(row.sku.trim(), row.quantity);
    tradingByOptions.set(optionKey(row.options), row.quantity);
  }

  const variants = (item.variants ?? {}) as {
    skus?: Array<{ sku?: string; quantity?: number; options?: Record<string, string> }>;
  };
  const rows = [];
  for (const skuRow of variants.skus ?? []) {
    const sku = skuRow.sku?.trim();
    if (!sku) continue;
    const live = await fetchLiveInventoryItem(ctx.accessToken, sku);
    const offer = await readOffer(ctx.accessToken, sku);
    const inventoryQty = readLiveInventoryAvailableQuantity(live);
    const tradingQty = tradingBySku.get(sku) ?? tradingByOptions.get(optionKey(skuRow.options)) ?? null;
    const offerQty = offer.detailQty ?? offer.searchQty;
    rows.push({
      sku,
      options: skuRow.options ?? {},
      inw: skuRow.quantity ?? null,
      inventory: inventoryQty,
      offer: offerQty,
      offerSearch: offer.searchQty,
      offerDetail: offer.detailQty,
      offerQtyType: offer.searchQtyType,
      trading: tradingQty,
      offerStatus: offer.status,
      split: {
        inventoryVsOffer: inventoryQty != null && offerQty != null && inventoryQty !== offerQty,
        inventoryVsInw: inventoryQty != null && skuRow.quantity != null && inventoryQty !== skuRow.quantity,
        offerVsInw: offerQty != null && skuRow.quantity != null && offerQty !== skuRow.quantity,
        tradingVsInventory: tradingQty != null && inventoryQty != null && tradingQty !== inventoryQty,
      },
    });
  }

  const disagree = rows.filter(
    (r) =>
      r.split.inventoryVsOffer ||
      r.split.inventoryVsInw ||
      r.split.offerVsInw ||
      r.split.tradingVsInventory
  );

  console.log(
    JSON.stringify(
      {
        title: item.title,
        listingId,
        listingQtyInw: item.quantity,
        listingQtyGetItem: details.quantity,
        updatedAt: item.updatedAt,
        lastPushedAt: link.lastPushedAt,
        lastInboundAt: link.lastInboundAt,
        syncBaselineQty: link.syncBaselineQty,
        disagreeCount: disagree.length,
        disagree,
        rows,
      },
      null,
      2
    )
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
