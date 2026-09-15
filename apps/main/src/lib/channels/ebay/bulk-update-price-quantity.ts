import type { SyncStoreItem } from "../types";
import { channelQuantityForTracked } from "@/lib/listing-variant-matrix";
import { normalizeVariantMatrix } from "@/lib/listing-variant-matrix";
import { ebayGet, ebayJson, EbayApiError, ebayGetInventoryItem } from "./client";
import { EBAY_CURRENCY, EBAY_MARKETPLACE_ID } from "./config";
import { isEbayOfferLookupMiss } from "./errors";
import { resolveEbayLivePushSku } from "./inventory-sku";
import { shouldUseInventoryItemGroup, buildVariantInventoryRows, resolveLiveEbayInventoryItemGroup, readInventoryItemGroupVariantSkus, alignVariantRowsToLiveEbayInventory, variationOptionsMatch, type EbayVariantInventoryRow } from "./inventory-groups";
import { ebayPriceFromCents, resolveEbayLegacyListingId } from "./mapping";
import { fetchLiveInventoryItem, readLiveInventoryAvailableQuantity, readOfferPriceCents } from "./passthrough-push";
import {
  ebayOfferIsPublished,
  pickEbayOffer,
  readEbayOfferAvailableQuantity,
  readEbayOfferListingId,
} from "./publish-policy";
import {
  buildEbayBulkUpdatePriceQuantityRequest,
  buildEbayQtyPriceSurfaces,
  ebayBulkUpdateResponseFailed,
  ebayCatchupPriceCents,
  ebayCatchupQuantity,
  ebayCatchupShouldWrite,
  ebayCatchupShouldWriteVariantRow,
  ebayCatchupVariantAddress,
  selectEbayHubCatchupOptionRows,
  summarizeEbayQtyPriceSurfaces,
  type EbayQtyPriceSurfaces,
} from "./qty-price-surfaces";
import { mappedEbayInventorySku, mergeEbaySkuMap, parseEbaySkuMap, persistEbaySkuMap, type EbaySkuMap } from "./sku-map";
import { generateEbayVariationMigrationSku, isValidEbayInventorySku } from "./migrate-prep";
import { ebaySellerHubListedQuantity } from "./trading";

type OfferRow = {
  offerId?: string;
  status?: string;
  availableQuantity?: number;
  pricingSummary?: { price?: { value?: unknown } };
  listing?: { listingId?: string | number | null } | null;
  listingId?: string | number | null;
};

export async function findEbayOfferForSku(accessToken: string, sku: string): Promise<OfferRow | null> {
  try {
    const res = await ebayGet<{ offers?: OfferRow[] }>(
      accessToken,
      `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${EBAY_MARKETPLACE_ID}`
    );
    return pickEbayOffer(res.offers);
  } catch (e) {
    if (e instanceof EbayApiError && (e.status === 404 || isEbayOfferLookupMiss(e))) return null;
    throw e;
  }
}

export async function fetchEbayOfferDetails(
  accessToken: string,
  offerId: string
): Promise<Record<string, unknown> | null> {
  try {
    return await ebayGet<Record<string, unknown>>(
      accessToken,
      `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`
    );
  } catch (e) {
    if (e instanceof EbayApiError && (e.status === 404 || isEbayOfferLookupMiss(e))) return null;
    throw e;
  }
}

export async function ebayBulkUpdatePriceQuantity(args: {
  accessToken: string;
  sku: string;
  offerId: string;
  quantity: number;
  priceCents?: number | null;
}): Promise<void> {
  const payload = buildEbayBulkUpdatePriceQuantityRequest({
    sku: args.sku,
    offerId: args.offerId,
    quantity: args.quantity,
    priceCents: args.priceCents,
    currency: EBAY_CURRENCY,
    priceValue:
      args.priceCents != null && args.priceCents > 0 ? ebayPriceFromCents(args.priceCents) : null,
  });
  const body = await ebayJson<unknown>(
    args.accessToken,
    "/sell/inventory/v1/bulk_update_price_quantity",
    "POST",
    payload
  );
  const failed = ebayBulkUpdateResponseFailed(body, args.sku);
  if (failed) throw new Error(failed);
}

export async function verifyEbayOfferQtyPrice(args: {
  accessToken: string;
  offerId: string;
  sku: string;
  quantity: number;
  priceCents?: number | null;
}): Promise<void> {
  const expected = Math.max(0, Math.round(args.quantity));
  const offer = await fetchEbayOfferDetails(args.accessToken, args.offerId);
  const liveQty = readEbayOfferAvailableQuantity(offer?.availableQuantity);
  if (liveQty != null && liveQty !== expected) {
    throw new Error(
      `eBay inventory verify: availableQuantity is ${liveQty}, expected ${expected}`
    );
  }
  const live = await fetchLiveInventoryItem(args.accessToken, args.sku).catch(() =>
    ebayGetInventoryItem(args.accessToken, args.sku)
  );
  const warehouse = readLiveInventoryAvailableQuantity(live as Record<string, unknown> | null);
  if (warehouse != null && warehouse !== expected) {
    throw new Error(
      `eBay inventory verify: warehouse quantity is ${warehouse}, expected ${expected}`
    );
  }
  if (args.priceCents != null && args.priceCents > 0) {
    const livePrice = readOfferPriceCents(offer);
    if (livePrice != null && livePrice !== args.priceCents) {
      throw new Error(
        `eBay inventory verify: offer price is ${livePrice} cents, expected ${args.priceCents}`
      );
    }
  }
}

export async function pushEbayLivePriceQuantity(args: {
  accessToken: string;
  item: SyncStoreItem;
  externalListingId: string;
  linkOrigin?: string | null;
  quantity: number;
  priceCents?: number | null;
  liveCustomLabel?: string | null;
  skuMap?: unknown;
  linkId?: string;
}): Promise<void> {
  const qty = channelQuantityForTracked(args.quantity, args.item.inventoryTracking);
  const map = parseEbaySkuMap(args.skuMap);
  const discovered: Record<string, string> = {};
  if (shouldUseInventoryItemGroup(args.item)) {
    const legacyListingId = resolveEbayLegacyListingId(args.externalListingId);
    let rows = [] as ReturnType<typeof buildVariantInventoryRows>;
    try {
      rows = buildVariantInventoryRows(args.item, {
        parentSku: undefined,
        legacyListingId,
        imported: args.linkOrigin === "import",
      });
    } catch (e) {
      console.warn("[ebay] variant bulk_update skipped; falling back to parent SKU", {
        storeItemId: args.item.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    if (rows.length > 0) {
      for (const row of rows) {
        const sku = await resolveMappedLiveSku(args.accessToken, row.sku, map);
        discovered[row.sku] = sku;
        const offer = await findEbayOfferForSku(args.accessToken, sku);
        if (!offer?.offerId) {
          throw new Error(`eBay offer not found for variation SKU ${sku}`);
        }
        const rowPrice =
          row.priceCents != null && row.priceCents > 0
            ? row.priceCents
            : args.priceCents != null && args.priceCents > 0
              ? args.priceCents
              : null;
        await ebayBulkUpdatePriceQuantity({
          accessToken: args.accessToken,
          sku,
          offerId: offer.offerId,
          quantity: row.quantity,
          priceCents: rowPrice,
        });
        await verifyEbayOfferQtyPrice({
          accessToken: args.accessToken,
          offerId: offer.offerId,
          sku,
          quantity: row.quantity,
          priceCents: rowPrice,
        });
      }
      await persistDiscoveredSkuMap(args.linkId, map, { variations: discovered });
      return;
    }
  }

  const guessed = await resolveEbayLivePushSku(args.accessToken, {
    itemId: args.item.id,
    itemSku: args.item.sku,
    externalListingId: args.externalListingId,
    linkOrigin: args.linkOrigin,
    liveCustomLabel: args.liveCustomLabel,
  });
  const sku = (await resolveMappedLiveSku(args.accessToken, guessed, map).catch(() => null)) ?? guessed;
  const offer = await findEbayOfferForSku(args.accessToken, sku);
  if (!offer?.offerId) {
    throw new Error(`eBay offer not found for inventory SKU ${sku}`);
  }
  await ebayBulkUpdatePriceQuantity({
    accessToken: args.accessToken,
    sku,
    offerId: offer.offerId,
    quantity: qty,
    priceCents: args.priceCents,
  });
  await verifyEbayOfferQtyPrice({
    accessToken: args.accessToken,
    offerId: offer.offerId,
    sku,
    quantity: qty,
    priceCents: args.priceCents,
  });
  await persistDiscoveredSkuMap(args.linkId, map, { parent: sku });
}

async function probeImportedEbayVariationPins(
  accessToken: string,
  listingId: string,
  count: number
): Promise<string[]> {
  const n = Math.min(Math.max(count, 0), 50);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const sku = generateEbayVariationMigrationSku(listingId, i);
    const live = await fetchLiveInventoryItem(accessToken, sku);
    if (live) out.push(sku);
  }
  return out;
}

async function resolveMappedLiveSku(
  accessToken: string,
  joinKey: string,
  map: EbaySkuMap | null
): Promise<string> {
  const mapped = mappedEbayInventorySku(map, joinKey);
  if (mapped) {
    const offer = await findEbayOfferForSku(accessToken, mapped);
    if (offer?.offerId) return mapped;
  }
  if (joinKey && isValidEbayInventorySku(joinKey)) return joinKey;
  if (mapped) return mapped;
  throw new Error(`No legal eBay Inventory SKU for ${joinKey || "(blank)"}`);
}

async function persistDiscoveredSkuMap(
  linkId: string | undefined,
  current: EbaySkuMap | null,
  next: { parent?: string | null; variations?: Record<string, string> }
): Promise<void> {
  if (!linkId) return;
  const merged = mergeEbaySkuMap(current, next);
  await persistEbaySkuMap(linkId, merged).catch((e) =>
    console.warn("[ebay] persist ebaySkuMap failed", {
      linkId,
      error: e instanceof Error ? e.message : String(e),
    })
  );
}

export async function collectEbayQtyPriceSurfaces(args: {
  accessToken: string;
  item: { id: string; sku?: string | null; quantity: number; priceCents: number };
  externalListingId: string;
  linkOrigin?: string | null;
  hubQuantity: number | null;
  viewItemQuantity: number | null;
  hubPriceCents: number | null;
  liveCustomLabel?: string | null;
  skuMap?: unknown;
}): Promise<EbayQtyPriceSurfaces> {
  const map = parseEbaySkuMap(args.skuMap);
  const guessed = await resolveEbayLivePushSku(args.accessToken, {
    itemId: args.item.id,
    itemSku: args.item.sku,
    externalListingId: args.externalListingId,
    linkOrigin: args.linkOrigin,
    liveCustomLabel: args.liveCustomLabel,
  });
  const sku = mappedEbayInventorySku(map, args.item.sku) ?? guessed;
  const offer = await findEbayOfferForSku(args.accessToken, sku);
  const offerDetails = offer?.offerId
    ? ((await fetchEbayOfferDetails(args.accessToken, offer.offerId)) ?? (offer as Record<string, unknown>))
    : offer;
  const live = await fetchLiveInventoryItem(args.accessToken, sku).catch(() =>
    ebayGetInventoryItem(args.accessToken, sku)
  );
  return buildEbayQtyPriceSurfaces({
    hubQuantity: args.hubQuantity,
    viewItemQuantity: args.viewItemQuantity,
    offerQuantity: readEbayOfferAvailableQuantity(
      offerDetails && typeof offerDetails === "object"
        ? (offerDetails as { availableQuantity?: unknown }).availableQuantity
        : offer?.availableQuantity
    ),
    warehouseQuantity: readLiveInventoryAvailableQuantity(live as Record<string, unknown> | null),
    inwQuantity: args.item.quantity,
    hubPriceCents: args.hubPriceCents,
    offerPriceCents: readOfferPriceCents(
      offerDetails && typeof offerDetails === "object"
        ? (offerDetails as Record<string, unknown>)
        : (offer as unknown as Record<string, unknown>)
    ),
    inwPriceCents: args.item.priceCents,
  });
}

export type EbayPerSkuQtyPriceRow = {
  joinKey: string;
  mappedPin: string;
  hubQuantity: number | null;
  warehouseQuantity: number | null;
  offerQuantity: number | null;
  viewItemQty: number | null;
  inwQuantity: number;
  hubPriceCents: number | null;
  offerPriceCents: number | null;
  inwPriceCents: number;
};

export async function collectEbayInventoryVerifyVariantRows(args: {
  accessToken: string;
  skuMap: unknown;
  inwMatrix: ReturnType<typeof normalizeVariantMatrix>;
}): Promise<{ sku: string; quantity: number; priceCents: number | null }[]> {
  const map = parseEbaySkuMap(args.skuMap);
  if (!map || !args.inwMatrix) return [];
  const out: { sku: string; quantity: number; priceCents: number | null }[] = [];
  for (const row of args.inwMatrix.skus) {
    const join = row.sku?.trim();
    if (!join) continue;
    const pin = mappedEbayInventorySku(map, join);
    if (!pin) continue;
    const offer = await findEbayOfferForSku(args.accessToken, pin);
    if (!offer?.offerId) continue;
    const live = await fetchLiveInventoryItem(args.accessToken, pin).catch(() => null);
    const warehouse = readLiveInventoryAvailableQuantity(live);
    const offerQty = readEbayOfferAvailableQuantity(offer.availableQuantity);
    const parts = [warehouse, offerQty].filter((n): n is number => n != null);
    if (parts.length === 0) continue;
    out.push({
      sku: join,
      quantity: Math.min(...parts),
      priceCents: readOfferPriceCents(offer as Record<string, unknown>),
    });
  }
  return out;
}

export async function collectEbayPerSkuQtyPriceSurfaces(args: {
  accessToken: string;
  item: SyncStoreItem;
  skuMap?: unknown;
  hubRows?: { sku?: string | null; quantity: number; priceCents?: number | null }[];
}): Promise<EbayPerSkuQtyPriceRow[]> {
  const map = parseEbaySkuMap(args.skuMap);
  const inw = normalizeVariantMatrix(args.item.variants);
  const rows: EbayPerSkuQtyPriceRow[] = [];
  const units =
    inw && inw.skus.length > 0
      ? inw.skus.map((s) => ({
          joinKey: s.sku?.trim() || "",
          inwQuantity: s.quantity,
          inwPriceCents: s.priceCents ?? args.item.priceCents,
        }))
      : [{ joinKey: args.item.sku?.trim() || "", inwQuantity: args.item.quantity, inwPriceCents: args.item.priceCents }];
  for (const unit of units) {
    if (!unit.joinKey) continue;
    const pin = mappedEbayInventorySku(map, unit.joinKey) ?? (isValidEbayInventorySku(unit.joinKey) ? unit.joinKey : null);
    if (!pin) continue;
    const hub = (args.hubRows ?? []).find((r) => r.sku?.trim() === unit.joinKey || r.sku?.trim() === pin);
    const offer = await findEbayOfferForSku(args.accessToken, pin);
    const live = await fetchLiveInventoryItem(args.accessToken, pin).catch(() => null);
    const warehouse = readLiveInventoryAvailableQuantity(live);
    const offerQty = readEbayOfferAvailableQuantity(offer?.availableQuantity);
    const parts = [warehouse, offerQty].filter((n): n is number => n != null);
    rows.push({
      joinKey: unit.joinKey,
      mappedPin: pin,
      hubQuantity: hub?.quantity ?? null,
      warehouseQuantity: warehouse,
      offerQuantity: offerQty,
      viewItemQty: parts.length > 0 ? Math.min(...parts) : null,
      inwQuantity: unit.inwQuantity,
      hubPriceCents: hub?.priceCents ?? null,
      offerPriceCents: readOfferPriceCents(offer as Record<string, unknown> | null),
      inwPriceCents: unit.inwPriceCents,
    });
  }
  return rows;
}

export async function catchupEbayListingQtyPrice(args: {
  accessToken: string;
  item: SyncStoreItem;
  externalListingId: string;
  linkOrigin?: string | null;
  hubQuantity: number | null;
  viewItemQuantity: number | null;
  hubPriceCents: number | null;
  liveCustomLabel?: string | null;
  tradingVariants?: unknown;
  skuMap?: unknown;
  linkId?: string;
}): Promise<{ wrote: boolean; surfaces: EbayQtyPriceSurfaces }> {
  const map = parseEbaySkuMap(args.skuMap);
  const discovered: Record<string, string> = {};
  const trading = normalizeVariantMatrix(args.tradingVariants);
  const hubOptionRows = selectEbayHubCatchupOptionRows(trading?.skus ?? []);
  const isVariation =
    shouldUseInventoryItemGroup(args.item) || hubOptionRows.length > 1;
  const stubSurfaces = buildEbayQtyPriceSurfaces({
    hubQuantity: args.hubQuantity,
    viewItemQuantity: args.viewItemQuantity,
    offerQuantity: null,
    warehouseQuantity: null,
    inwQuantity: args.item.quantity,
    hubPriceCents: args.hubPriceCents,
    offerPriceCents: null,
    inwPriceCents: args.item.priceCents,
  });

  if (isVariation) {
    // Parent Custom Label is the group key, not an offer. Do not GET /offer?sku=parent
    // first — that 400 can abort catch-up before any variant bulk_update runs.
    const parentSku =
      args.liveCustomLabel?.trim() ||
      (isValidEbayInventorySku(args.item.sku?.trim() ?? "") ? args.item.sku!.trim() : null);
    const liveGroup = await resolveLiveEbayInventoryItemGroup(
      args.accessToken,
      args.item,
      parentSku
    );
    let liveGroupSkus = readInventoryItemGroupVariantSkus(liveGroup.body);
    if (liveGroupSkus.length === 0) {
      const legacy = resolveEbayLegacyListingId(args.externalListingId);
      if (legacy) {
        liveGroupSkus = await probeImportedEbayVariationPins(
          args.accessToken,
          legacy,
          hubOptionRows.length
        );
      }
    }
    const placeholderRows: EbayVariantInventoryRow[] = hubOptionRows.map((row) => ({
      sku: row.sku ?? "",
      value: Object.values(row.options)[0] ?? "",
      quantity: row.quantity,
      aspectName: Object.keys(row.options)[0] ?? "Option",
      options: row.options,
      ...(row.priceCents != null ? { priceCents: row.priceCents } : {}),
    }));
    const aligned =
      liveGroupSkus.length > 0
        ? await alignVariantRowsToLiveEbayInventory(
            args.accessToken,
            placeholderRows,
            liveGroupSkus
          )
        : placeholderRows;
    const inw = normalizeVariantMatrix(args.item.variants);
    let wrote = false;
    let addressed = 0;
    for (let i = 0; i < hubOptionRows.length; i++) {
      const hub = hubOptionRows[i]!;
      const alignedRow = aligned[i];
      const inwJoin =
        inw?.skus.find((s) => variationOptionsMatch(s.options, hub.options))?.sku?.trim() ?? null;
      const sku = ebayCatchupVariantAddress({
        mappedPin: mappedEbayInventorySku(map, inwJoin ?? hub.sku),
        livePin: alignedRow?.sku,
        hubSku: hub.sku,
        parentSku,
      });
      if (!sku) continue;
      addressed += 1;
      discovered[inwJoin ?? hub.sku ?? sku] = sku;
      try {
        const offer = await findEbayOfferForSku(args.accessToken, sku);
        if (!offer?.offerId) continue;
        const liveQty = readEbayOfferAvailableQuantity(offer.availableQuantity);
        const livePrice = readOfferPriceCents(offer as Record<string, unknown>);
        const liveItem = await fetchLiveInventoryItem(args.accessToken, sku).catch(() => null);
        const warehouse = readLiveInventoryAvailableQuantity(liveItem);
        if (
          !ebayCatchupShouldWriteVariantRow({
            hubQuantity: hub.quantity,
            offerQuantity: liveQty,
            warehouseQuantity: warehouse,
            hubPriceCents: hub.priceCents,
            offerPriceCents: livePrice,
          })
        ) {
          continue;
        }
        await ebayBulkUpdatePriceQuantity({
          accessToken: args.accessToken,
          sku,
          offerId: offer.offerId,
          quantity: hub.quantity,
          priceCents: hub.priceCents,
        });
        await verifyEbayOfferQtyPrice({
          accessToken: args.accessToken,
          offerId: offer.offerId,
          sku,
          quantity: hub.quantity,
          priceCents: hub.priceCents,
        });
        wrote = true;
      } catch (e) {
        console.warn("[ebay] Hub→View Item variation row failed", {
          storeItemId: args.item.id,
          sku,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    await persistDiscoveredSkuMap(args.linkId, map, {
      parent: parentSku,
      variations: discovered,
    });
    console.info("[ebay] Hub→View Item variation catch-up", {
      storeItemId: args.item.id,
      listingId: resolveEbayLegacyListingId(args.externalListingId),
      hubRows: hubOptionRows.length,
      liveGroupKey: liveGroup.key,
      liveGroupSkus: liveGroupSkus.length,
      addressed,
      wrote,
    });
    return { wrote, surfaces: stubSurfaces };
  }

  const surfaces = await collectEbayQtyPriceSurfaces(args);

  if (!ebayCatchupShouldWrite(surfaces)) {
    return { wrote: false, surfaces };
  }

  const quantity = ebayCatchupQuantity(surfaces) ?? surfaces.offerQuantity ?? surfaces.viewItemQuantity;
  if (quantity == null) return { wrote: false, surfaces };
  await pushEbayLivePriceQuantity({
    accessToken: args.accessToken,
    item: args.item,
    externalListingId: args.externalListingId,
    linkOrigin: args.linkOrigin,
    quantity,
    priceCents: ebayCatchupPriceCents(surfaces),
    liveCustomLabel: args.liveCustomLabel,
    skuMap: args.skuMap,
    linkId: args.linkId,
  });
  console.info("[ebay] Hub→View Item catch-up wrote bulk_update", {
    storeItemId: args.item.id,
    listingId: resolveEbayLegacyListingId(args.externalListingId),
    hubQuantity: quantity,
    hubPriceCents: ebayCatchupPriceCents(surfaces),
    viewItemQuantity: surfaces.viewItemQuantity,
    offerQuantity: surfaces.offerQuantity,
  });
  return { wrote: true, surfaces };
}

export function ebayCatchupQtyFromTrading(details: {
  tradingQuantity?: number | null;
  quantity?: number | null;
}): number | null {
  return ebaySellerHubListedQuantity(details);
}

export { summarizeEbayQtyPriceSurfaces, readEbayOfferListingId, ebayOfferIsPublished };
