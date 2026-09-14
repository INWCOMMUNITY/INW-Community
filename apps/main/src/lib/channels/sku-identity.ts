/**
 * INW-owned SKU join key. One alphanumeric string per sellable unit, copied onto
 * every channel. Never invent StoreItem.id, hyphens, or hashes.
 */

import {
  ETSY_SKU_MAX,
  isGeneratedVariantOfItemId,
  skuToAdoptFromRemote,
} from "@/lib/listing-sku";
import { normalizeVariantMatrix } from "@/lib/listing-variant-matrix";
import { isValidEbayInventorySku } from "./ebay/migrate-prep";
import type { VariantMatchQuality } from "./variant-match";
import type { ChannelProvider, SyncStoreItem } from "./types";

export const WIX_SKU_MAX = 40;

export class SkuIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkuIdentityError";
  }
}

export function skusExact(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = a?.trim() ?? "";
  const right = b?.trim() ?? "";
  return Boolean(left && right && left === right);
}

/** Alphanumeric 1–50: legal eBay Inventory SKU and the cross-channel join charset. */
export function isJoinKeySku(sku: string | null | undefined): boolean {
  const trimmed = sku?.trim() ?? "";
  return isValidEbayInventorySku(trimmed);
}

export function skuOwnerKey(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  return trimmed ? trimmed.toLowerCase() : null;
}

export function resolvePublishSku(args: {
  sku: string | null | undefined;
  itemId: string;
  channel?: ChannelProvider;
  comboLabel?: string;
}): string {
  const sku = args.sku?.trim() ?? "";
  const where = args.comboLabel ? ` for ${args.comboLabel}` : "";
  if (!sku) {
    throw new SkuIdentityError(`Missing SKU${where}. Assign a SKU before publishing.`);
  }
  if (sku === args.itemId || isGeneratedVariantOfItemId(sku, args.itemId)) {
    throw new SkuIdentityError(
      `SKU${where} is an INW item id leftover. Assign a real SKU before publishing.`
    );
  }
  if (!isJoinKeySku(sku)) {
    throw new SkuIdentityError(
      `SKU${where} must be letters and numbers only (no hyphens or spaces), at most 50 characters.`
    );
  }
  if (args.channel === "etsy" && sku.length > ETSY_SKU_MAX) {
    throw new SkuIdentityError(`Etsy SKUs cannot be more than ${ETSY_SKU_MAX} characters.`);
  }
  if (args.channel === "wix" && sku.length > WIX_SKU_MAX) {
    throw new SkuIdentityError(`Wix SKUs cannot be more than ${WIX_SKU_MAX} characters.`);
  }
  return sku;
}

export function requireSellableSkusForPublish(
  item: Pick<SyncStoreItem, "id" | "sku" | "variants">,
  channel?: ChannelProvider
): string[] {
  const matrix = normalizeVariantMatrix(item.variants);
  if (matrix && matrix.skus.length > 0) {
    return matrix.skus.map((row) =>
      resolvePublishSku({
        sku: row.sku,
        itemId: item.id,
        channel,
        comboLabel: Object.values(row.options).filter(Boolean).join(" / ") || undefined,
      })
    );
  }
  return [resolvePublishSku({ sku: item.sku, itemId: item.id, channel })];
}

/**
 * Fill blank INW identity from a live channel SKU. Adopts eBay `inw{legacyId}` pins.
 * Rejects StoreItem.id leftovers and non-alphanumeric strings.
 */
export function adoptPinnedEbaySku(args: {
  localSku: string | null | undefined;
  remoteSku: string | null | undefined;
  itemId: string;
}): string | null {
  return skuToAdoptFromRemote(args);
}

/** Qty/price writes require exact SKU match. Option/positional matches are audit-only. */
export function matchAllowsChannelWrite(args: {
  quality: VariantMatchQuality;
  inwSku?: string | null;
  remoteSku?: string | null;
}): boolean {
  return args.quality === "sku" && skusExact(args.inwSku, args.remoteSku);
}
