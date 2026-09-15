/**
 * eBay Inventory API listings have two qty/price surfaces.
 * Seller Hub writes Trading listed remaining / StartPrice.
 * View Item reads the live offer (availableQuantity / pricingSummary).
 * INW copies Hub onto the offer with bulk_update_price_quantity — never a full inventory PUT.
 */

export const EBAY_HUB_CATCHUP_DELAY_MS = 8_000;
export const EBAY_HUB_CATCHUP_RETRY_TYPE = "ebay_hub_catchup";

export type EbayQtyPriceSurfaces = {
  hubQuantity: number | null;
  viewItemQuantity: number | null;
  offerQuantity: number | null;
  warehouseQuantity: number | null;
  inwQuantity: number;
  hubPriceCents: number | null;
  offerPriceCents: number | null;
  inwPriceCents: number;
};

export type EbayQtyPriceSurfaceVerdict =
  | "aligned"
  | "hub_ahead_of_view_item"
  | "inw_ahead"
  | "split";

export function roundEbayQty(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

export function roundEbayPriceCents(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

export function buildEbayQtyPriceSurfaces(args: {
  hubQuantity: number | null;
  viewItemQuantity: number | null;
  offerQuantity: number | null;
  warehouseQuantity: number | null;
  inwQuantity: number;
  hubPriceCents: number | null;
  offerPriceCents: number | null;
  inwPriceCents: number;
}): EbayQtyPriceSurfaces {
  return {
    hubQuantity: roundEbayQty(args.hubQuantity),
    viewItemQuantity: roundEbayQty(args.viewItemQuantity),
    offerQuantity: roundEbayQty(args.offerQuantity),
    warehouseQuantity: roundEbayQty(args.warehouseQuantity),
    inwQuantity: Math.max(0, Math.round(args.inwQuantity)),
    hubPriceCents: roundEbayPriceCents(args.hubPriceCents),
    offerPriceCents: roundEbayPriceCents(args.offerPriceCents),
    inwPriceCents: Math.max(0, Math.round(args.inwPriceCents)),
  };
}

export function ebayHubQtyAheadOfViewItem(surfaces: EbayQtyPriceSurfaces): boolean {
  if (surfaces.hubQuantity == null) return false;
  const view = ebayViewItemQuantity(surfaces);
  if (view == null) return false;
  return surfaces.hubQuantity !== view;
}

export function ebayHubQtyAheadOfWarehouse(surfaces: EbayQtyPriceSurfaces): boolean {
  if (surfaces.hubQuantity == null || surfaces.warehouseQuantity == null) return false;
  return surfaces.hubQuantity !== surfaces.warehouseQuantity;
}

export function ebayHubQtyAheadOfOffer(surfaces: EbayQtyPriceSurfaces): boolean {
  if (surfaces.hubQuantity == null || surfaces.offerQuantity == null) return false;
  return surfaces.hubQuantity !== surfaces.offerQuantity;
}

/** Buyer-facing qty is min(warehouse, offer). Falls back to GetItem QuantityAvailable. */
export function ebayViewItemQuantity(surfaces: Pick<
  EbayQtyPriceSurfaces,
  "offerQuantity" | "warehouseQuantity" | "viewItemQuantity"
>): number | null {
  const parts = [surfaces.offerQuantity, surfaces.warehouseQuantity].filter(
    (n): n is number => n != null
  );
  if (parts.length > 0) return Math.min(...parts);
  return surfaces.viewItemQuantity;
}

export function ebayHubPriceAheadOfOffer(surfaces: EbayQtyPriceSurfaces): boolean {
  if (surfaces.hubPriceCents == null || surfaces.offerPriceCents == null) return false;
  return surfaces.hubPriceCents !== surfaces.offerPriceCents;
}

export function ebayCatchupShouldWrite(surfaces: EbayQtyPriceSurfaces): boolean {
  return (
    ebayHubQtyAheadOfViewItem(surfaces) ||
    ebayHubQtyAheadOfWarehouse(surfaces) ||
    ebayHubQtyAheadOfOffer(surfaces) ||
    ebayHubPriceAheadOfOffer(surfaces)
  );
}

/** Hub listed remaining is the number that must land on the offer. */
export function ebayCatchupQuantity(surfaces: EbayQtyPriceSurfaces): number | null {
  return surfaces.hubQuantity;
}

/** Hub StartPrice/CurrentPrice is the number that must land on the offer. */
export function ebayCatchupPriceCents(surfaces: EbayQtyPriceSurfaces): number | null {
  if (!ebayHubPriceAheadOfOffer(surfaces)) return null;
  return surfaces.hubPriceCents;
}

export type EbayCatchupVariantRow = {
  sku: string;
  quantity: number;
  priceCents: number | null;
};

/** Hub GetItem variation rows only — never INW fallback, hyphen parent, or blank Custom Label. */
export function selectEbayHubCatchupVariantRows(
  rows: { sku?: string | null; quantity: number; priceCents?: number | null }[]
): EbayCatchupVariantRow[] {
  const out: EbayCatchupVariantRow[] = [];
  for (const row of rows) {
    const sku = row.sku?.trim();
    if (!sku || !/^[a-zA-Z0-9]{1,50}$/.test(sku)) continue;
    out.push({
      sku,
      quantity: Math.max(0, Math.round(row.quantity)),
      priceCents: row.priceCents != null && row.priceCents > 0 ? Math.round(row.priceCents) : null,
    });
  }
  return out;
}

export function ebayCatchupShouldWriteVariantRow(args: {
  hubQuantity: number;
  offerQuantity: number | null;
  warehouseQuantity?: number | null;
  hubPriceCents: number | null;
  offerPriceCents: number | null;
}): boolean {
  if (args.offerQuantity == null || args.hubQuantity !== args.offerQuantity) return true;
  if (args.warehouseQuantity != null && args.hubQuantity !== args.warehouseQuantity) return true;
  if (
    args.hubPriceCents != null &&
    args.offerPriceCents != null &&
    args.hubPriceCents !== args.offerPriceCents
  ) {
    return true;
  }
  return false;
}

export function summarizeEbayQtyPriceSurfaces(surfaces: EbayQtyPriceSurfaces): {
  hubAheadOfViewItem: boolean;
  hubPriceAheadOfOffer: boolean;
  verdict: EbayQtyPriceSurfaceVerdict;
} {
  const hubAheadOfViewItem = ebayHubQtyAheadOfViewItem(surfaces);
  const hubPriceAheadOfOffer = ebayHubPriceAheadOfOffer(surfaces);
  const viewQty = ebayViewItemQuantity(surfaces);
  const inwQtyDiffersFromView = viewQty != null && viewQty !== surfaces.inwQuantity;
  const inwQtyDiffersFromHub =
    surfaces.hubQuantity != null && surfaces.hubQuantity !== surfaces.inwQuantity;

  let verdict: EbayQtyPriceSurfaceVerdict = "aligned";
  if (hubAheadOfViewItem || hubPriceAheadOfOffer) verdict = "hub_ahead_of_view_item";
  else if (inwQtyDiffersFromHub && !inwQtyDiffersFromView) verdict = "inw_ahead";
  else if (inwQtyDiffersFromView || inwQtyDiffersFromHub) verdict = "split";

  return { hubAheadOfViewItem, hubPriceAheadOfOffer, verdict };
}

export function buildEbayBulkUpdatePriceQuantityRequest(args: {
  sku: string;
  offerId: string;
  quantity: number;
  priceCents?: number | null;
  currency: string;
  priceValue: string | null;
}): { requests: Record<string, unknown>[] } {
  const quantity = Math.max(0, Math.round(args.quantity));
  const offer: Record<string, unknown> = {
    offerId: args.offerId,
    availableQuantity: quantity,
  };
  if (args.priceValue && args.priceCents != null && args.priceCents > 0) {
    offer.price = { currency: args.currency, value: args.priceValue };
  }
  return {
    requests: [
      {
        sku: args.sku,
        shipToLocationAvailability: { quantity },
        offers: [offer],
      },
    ],
  };
}

export function ebayBulkUpdateResponseFailed(body: unknown, sku: string): string | null {
  if (!body || typeof body !== "object") return `bulk_update_price_quantity returned empty body for ${sku}`;
  const responses = (body as { responses?: unknown }).responses;
  if (!Array.isArray(responses) || responses.length === 0) {
    return `bulk_update_price_quantity returned no per-SKU responses for ${sku}`;
  }
  for (const row of responses) {
    if (!row || typeof row !== "object") continue;
    const rec = row as {
      sku?: unknown;
      statusCode?: unknown;
      errors?: { message?: unknown }[];
    };
    const status = Number(rec.statusCode);
    const errors = Array.isArray(rec.errors) ? rec.errors : [];
    if ((Number.isFinite(status) && status >= 400) || errors.length > 0) {
      const msg = errors
        .map((e) => (typeof e?.message === "string" ? e.message : ""))
        .filter(Boolean)
        .join("; ");
      return msg || `bulk_update_price_quantity failed for ${sku} (${status || "unknown"})`;
    }
  }
  return null;
}
