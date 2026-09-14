import {
  optionValuesKey,
  skuSelectionKey,
  type LiveVariantQuantity,
  type VariantMatrix,
} from "@/lib/listing-variant-matrix";
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
 * Live View Item stock is offer.availableQuantity. Seller Hub's variation editor writes
 * the Trading layer, which is what the revise form redisplays; the Inventory API copies
 * lag behind it. Copy whichever surface holds the seller's edit onto the offer so the
 * live listing matches what the seller typed.
 *
 * Trading is also what lags right after an INW push, so only treat a Trading-only
 * difference as the seller's edit when INW has not just written (`inwPushedRecently`).
 */
export function chooseEbayLiveListingQuantity(args: {
  tradingQty: number | null;
  inventoryQty: number | null;
  offerQty: number | null;
  inwQty: number | null;
  tradingLooksDegraded?: boolean;
  inwPushedRecently?: boolean;
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

  const finish = (chosen: ChosenEbayLiveQuantity): ChosenEbayLiveQuantity => {
    // Inventory vs offer lag after our own write is not a Seller Hub edit.
    if (inw != null && chosen.quantity === inw) {
      return { ...chosen, writeOffers: false };
    }
    return chosen;
  };

  // Seller Hub revise wrote Trading while the Inventory API still echoes our last push.
  // A Trading value that matches INW is our own lag, not an edit.
  if (
    trading != null &&
    !args.inwPushedRecently &&
    trading !== inw &&
    trading !== inventory &&
    trading !== offer &&
    (inventory != null || offer != null)
  ) {
    return finish({ quantity: trading, source: "trading", writeOffers: true });
  }

  // eBay updates inventory_item and the offer at different times, so on a Seller Hub
  // revise one of them still holds INW's number. Whichever surface still equals INW is
  // our own echo — copying it over the other one is what silently erased seller edits.
  if (inventory != null && offer != null) {
    if (inventory === offer) {
      return finish({ quantity: offer, source: "offer", writeOffers: false });
    }
    if (inw != null && inventory === inw) {
      return finish({ quantity: offer, source: "offer", writeOffers: true });
    }
    if (inw != null && offer === inw) {
      if (args.inwPushedRecently) {
        return finish({ quantity: offer, source: "offer", writeOffers: false });
      }
      return finish({ quantity: inventory, source: "inventory", writeOffers: true });
    }
    // Both moved away from INW: the live listing is what buyers see.
    return finish({ quantity: offer, source: "offer", writeOffers: true });
  }
  if (offer != null) {
    return finish({ quantity: offer, source: "offer", writeOffers: false });
  }
  // Offer search often omits availableQuantity. Seed the offer from Seller Hub
  // inventory — never from lagged GetItem.
  if (inventory != null) {
    return finish({ quantity: inventory, source: "inventory", writeOffers: true });
  }
  if (trading != null) return finish({ quantity: trading, source: "trading", writeOffers: false });
  if (inw != null) return finish({ quantity: inw, source: "inw", writeOffers: false });
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

/** True when catch-up actually took Seller Hub / View Item stock, not merely read SKUs. */
export function ebayCatchUpAdoptedLiveQty(catchUp: EbayLiveQtyCatchUp | null | undefined): boolean {
  return Boolean(catchUp && (catchUp.inwNeedsUpdate || catchUp.wroteOffers));
}

/** One-SKU matrix so simple (non-variation) listings reuse the offer catch-up. */
export function ebaySingleSkuQtyMatrix(sku: string, quantity: number): VariantMatrix {
  return {
    axes: [],
    skus: [{ sku, options: {}, quantity: Math.max(0, Math.round(quantity)) }],
  };
}

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

/** Same SKU / option matching as inbound overlay so Seller Hub GetItem qty is not dropped. */
export function tradingQtyForRow(
  trading: VariantMatrix | null,
  row: { sku?: string | null; options: Record<string, string> }
): number | null {
  if (!trading) return null;
  const sku = row.sku?.trim();
  if (sku) {
    const hit = trading.skus.find((s) => s.sku?.trim() === sku);
    if (hit) return hit.quantity;
  }
  const optionKey = skuSelectionKey(row.options);
  if (optionKey) {
    const byOptions = trading.skus.find((s) => skuSelectionKey(s.options) === optionKey);
    if (byOptions) return byOptions.quantity;
  }
  const values = optionValuesKey(row.options);
  if (!values) return null;
  const byValues = trading.skus.find((s) => optionValuesKey(s.options) === values);
  return byValues?.quantity ?? null;
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
  tradingListingQuantity?: number | null;
  inwPushedRecently?: boolean;
}): Promise<EbayLiveQtyCatchUp> {
  const tradingDegraded = Boolean(
    args.tradingMatrix &&
      variantQuantitiesLookDegraded(
        args.inwMatrix,
        args.tradingMatrix,
        args.tradingListingQuantity
      )
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
      inwPushedRecently: args.inwPushedRecently,
    });
    if (!chosen) return;
    quantities.push({ sku, options: row.options, quantity: chosen.quantity });
    if (chosen.quantity !== row.quantity) {
      // Lagged Inventory/Trading after our own push is not a Seller Hub edit.
      if (!(args.inwPushedRecently && !chosen.writeOffers)) {
        inwNeedsUpdate = true;
      }
    }
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
 * Copy already-chosen SKU qtys onto live offers. Used when GetItem overlay applies
 * Seller Hub stock that inventory/offer catch-up did not adopt.
 */
export async function writeEbayLiveVariantQuantitiesToOffers(args: {
  accessToken: string;
  quantities: LiveVariantQuantity[];
}): Promise<boolean> {
  const rows = args.quantities.filter((row) => row.sku?.trim());
  const writes: { sku: string; quantity: number; offerId?: string | null }[] = [];
  await forEachInChunks(rows, OFFER_LOOKUP_CONCURRENCY, async (row) => {
    const sku = row.sku!.trim();
    const offer = await fetchEbayOfferQuantity(args.accessToken, sku);
    if (offer.quantity === row.quantity) return;
    writes.push({ sku, quantity: row.quantity, offerId: offer.offerId });
  });
  if (writes.length === 0) return false;
  await pushEbayVariantGroupQuantities(args.accessToken, writes);
  console.info("[ebay] wrote GetItem SKU qty onto live listing offers", {
    skuCount: writes.length,
    sample: writes.slice(0, 3).map((w) => ({ sku: w.sku, quantity: w.quantity })),
  });
  return true;
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
  tradingListingQuantity?: number | null;
  inwPushedRecently?: boolean;
  retryIfUnchangedMs?: number;
}): Promise<EbayLiveQtyCatchUp> {
  const first = await catchUpEbayLiveVariantQuantitiesOnce(args);
  const retryMs = args.retryIfUnchangedMs ?? 0;
  if (retryMs <= 0 || first.wroteOffers || first.inwNeedsUpdate) return first;
  await new Promise((resolve) => setTimeout(resolve, retryMs));
  return catchUpEbayLiveVariantQuantitiesOnce(args);
}
