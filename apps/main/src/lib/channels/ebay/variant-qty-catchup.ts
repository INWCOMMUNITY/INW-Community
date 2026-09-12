import { type LiveVariantQuantity, type VariantMatrix } from "@/lib/listing-variant-matrix";
import { inventoryVariantsBaselineMatches, variantQuantitiesLookDegraded } from "../variant-sync";
import { ebayGet } from "./client";
import { EBAY_MARKETPLACE_ID } from "./config";
import { pickEbayOffer } from "./publish-policy";
import { fetchLiveInventoryItem, readLiveInventoryAvailableQuantity } from "./passthrough-push";
import { pushEbayVariantGroupQuantities } from "./quantity";

const OFFER_LOOKUP_CONCURRENCY = 4;

export type EbayQuantitySource = "trading" | "inventory" | "offer" | "inw";

export type ChosenEbayLiveQuantity = {
  quantity: number;
  source: EbayQuantitySource;
  writeOffers: boolean;
};

/**
 * Live View Item stock is offer.availableQuantity. Seller Hub writes
 * inventory_item. Copy inventory onto the offer when those two disagree so
 * the live listing matches Seller Hub. GetItem/Trading is lagged and often
 * degraded — never write it onto inventory or the offer.
 */
export function chooseEbayLiveListingQuantity(args: {
  tradingQty: number | null;
  inventoryQty: number | null;
  offerQty: number | null;
  inwQty: number | null;
  tradingLooksDegraded?: boolean;
}): ChosenEbayLiveQuantity | null {
  const trading =
    args.tradingLooksDegraded || args.tradingQty == null || !Number.isFinite(args.tradingQty)
      ? null
      : Math.max(0, Math.round(args.tradingQty));
  const inventory =
    args.inventoryQty == null || !Number.isFinite(args.inventoryQty)
      ? null
      : Math.max(0, Math.round(args.inventoryQty));
  const offer =
    args.offerQty == null || !Number.isFinite(args.offerQty)
      ? null
      : Math.max(0, Math.round(args.offerQty));
  const inw =
    args.inwQty == null || !Number.isFinite(args.inwQty) ? null : Math.max(0, Math.round(args.inwQty));

  if (inventory != null && offer != null) {
    if (inventory !== offer) {
      return { quantity: inventory, source: "inventory", writeOffers: true };
    }
    return { quantity: offer, source: "offer", writeOffers: false };
  }
  if (offer != null) {
    return { quantity: offer, source: "offer", writeOffers: false };
  }
  // Offer search often omits availableQuantity. Seed the offer from Seller Hub
  // inventory — never from lagged GetItem.
  if (inventory != null) {
    return { quantity: inventory, source: "inventory", writeOffers: true };
  }
  if (trading != null) return { quantity: trading, source: "trading", writeOffers: false };
  if (inw != null) return { quantity: inw, source: "inw", writeOffers: false };
  return null;
}

/** Title/price pushes must not PUT INW SKU qty unless the seller actually changed qty on INW. */
export function ebayContentPushShouldWriteVariantQuantities(args: {
  operation: "create" | "update";
  baselineQty: number | null | undefined;
  baselineVariantsHash: string | null | undefined;
  listingQty: number;
  variants: unknown;
}): boolean {
  if (args.operation === "create") return true;
  if (args.baselineQty == null && !args.baselineVariantsHash) return true;
  if (args.baselineQty != null && args.baselineQty !== args.listingQty) return true;
  if (!inventoryVariantsBaselineMatches(args.baselineVariantsHash, args.variants)) return true;
  return false;
}

export type EbayLiveQtyCatchUp = {
  quantities: LiveVariantQuantity[];
  wroteOffers: boolean;
  inwNeedsUpdate: boolean;
};

async function forEachInChunks<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const n = Math.max(1, size);
  for (let i = 0; i < items.length; i += n) {
    await Promise.all(items.slice(i, i + n).map((item) => fn(item)));
  }
}

function tradingQtyForRow(
  trading: VariantMatrix | null,
  row: { sku?: string | null; options: Record<string, string> }
): number | null {
  if (!trading) return null;
  const sku = row.sku?.trim();
  if (sku) {
    const hit = trading.skus.find((s) => s.sku?.trim() === sku);
    if (hit) return hit.quantity;
  }
  const values = Object.values(row.options)
    .map((v) => v.toLowerCase())
    .sort()
    .join("\0");
  const hit = trading.skus.find(
    (s) =>
      Object.values(s.options)
        .map((v) => v.toLowerCase())
        .sort()
        .join("\0") === values
  );
  return hit?.quantity ?? null;
}

function readEbayOfferAvailableQuantity(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

async function fetchEbayOfferQuantity(
  accessToken: string,
  sku: string
): Promise<{ offerId: string | null; quantity: number | null }> {
  try {
    const res = await ebayGet<{
      offers?: Array<{ offerId?: string; status?: string; availableQuantity?: unknown }>;
    }>(
      accessToken,
      `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${EBAY_MARKETPLACE_ID}`
    );
    const offer = pickEbayOffer(res.offers);
    if (!offer?.offerId) return { offerId: null, quantity: null };
    let quantity = readEbayOfferAvailableQuantity(offer.availableQuantity);
    if (quantity == null) {
      try {
        const details = await ebayGet<{ availableQuantity?: unknown }>(
          accessToken,
          `/sell/inventory/v1/offer/${encodeURIComponent(offer.offerId)}`
        );
        quantity = readEbayOfferAvailableQuantity(details.availableQuantity);
      } catch {
        // Keep offerId so a later write can still update the live listing.
      }
    }
    return { offerId: offer.offerId, quantity };
  } catch {
    return { offerId: null, quantity: null };
  }
}

/**
 * When Seller Hub inventory disagrees with the live offer, write inventory onto
 * offers so View Item updates, then return those quantities for INW.
 */
async function catchUpEbayLiveVariantQuantitiesOnce(args: {
  accessToken: string;
  inwMatrix: VariantMatrix;
  tradingMatrix: VariantMatrix | null;
}): Promise<EbayLiveQtyCatchUp> {
  const tradingDegraded = Boolean(
    args.tradingMatrix &&
      variantQuantitiesLookDegraded(args.inwMatrix, args.tradingMatrix)
  );
  const rows = args.inwMatrix.skus.filter((row) => row.sku?.trim());
  const quantities: LiveVariantQuantity[] = [];
  const writes: { sku: string; quantity: number; offerId?: string | null }[] = [];
  let inwNeedsUpdate = false;

  await forEachInChunks(rows, OFFER_LOOKUP_CONCURRENCY, async (row) => {
    const sku = row.sku!.trim();
    const liveItem = await fetchLiveInventoryItem(args.accessToken, sku);
    const inventoryQty = readLiveInventoryAvailableQuantity(liveItem);
    const offer = await fetchEbayOfferQuantity(args.accessToken, sku);
    const chosen = chooseEbayLiveListingQuantity({
      tradingQty: tradingQtyForRow(args.tradingMatrix, row),
      inventoryQty,
      offerQty: offer.quantity,
      inwQty: row.quantity,
      tradingLooksDegraded: tradingDegraded,
    });
    if (!chosen) return;
    quantities.push({ sku, options: row.options, quantity: chosen.quantity });
    if (chosen.quantity !== row.quantity) inwNeedsUpdate = true;
    if (chosen.writeOffers) {
      writes.push({ sku, quantity: chosen.quantity, offerId: offer.offerId });
    }
  });

  if (writes.length > 0) {
    await pushEbayVariantGroupQuantities(args.accessToken, writes);
    console.info("[ebay] caught up live listing offer qty from Seller Hub", {
      skuCount: writes.length,
      sample: writes.slice(0, 3).map((w) => ({ sku: w.sku, quantity: w.quantity })),
    });
  }

  return { quantities, wroteOffers: writes.length > 0, inwNeedsUpdate };
}

/**
 * When Seller Hub inventory disagrees with the live offer, write inventory onto
 * offers so View Item updates, then return those quantities for INW. ItemRevised
 * often arrives before Inventory/offer catch up — webhook callers pass
 * retryIfUnchangedMs so we re-read once.
 */
export async function catchUpEbayLiveVariantQuantities(args: {
  accessToken: string;
  inwMatrix: VariantMatrix;
  tradingMatrix: VariantMatrix | null;
  retryIfUnchangedMs?: number;
}): Promise<EbayLiveQtyCatchUp> {
  const first = await catchUpEbayLiveVariantQuantitiesOnce(args);
  const retryMs = args.retryIfUnchangedMs ?? 0;
  if (retryMs <= 0 || first.wroteOffers || first.inwNeedsUpdate) return first;
  await new Promise((resolve) => setTimeout(resolve, retryMs));
  return catchUpEbayLiveVariantQuantitiesOnce(args);
}
