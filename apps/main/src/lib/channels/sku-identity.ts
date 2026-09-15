/**
 * INW-owned SKU join key. One alphanumeric string per sellable unit. Blank units
 * get a hub mint (`nwc…`); that same string is copied onto every channel.
 * Never publish StoreItem.id or per-channel hyphen/hash generators.
 */

import { randomBytes } from "crypto";
import {
  ETSY_SKU_MAX,
  isGeneratedVariantOfItemId,
  skuToAdoptFromRemote,
  toCanonicalChannelSku,
} from "@/lib/listing-sku";
import { normalizeVariantMatrix, serializeVariantMatrix } from "@/lib/listing-variant-matrix";
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

const MINT_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomAlphanumeric(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += MINT_ALPHABET[bytes[i]! % MINT_ALPHABET.length];
  }
  return out;
}

export const HUB_JOIN_KEY_RE = /^nwc[a-zA-Z0-9]{10}$/;

export function isHubMintedJoinKey(sku: string | null | undefined): boolean {
  return HUB_JOIN_KEY_RE.test((sku ?? "").trim());
}

/** Hub-owned join key. Not StoreItem.id, not a per-channel generator. */
export function mintJoinKeySku(used: Set<string>): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    const sku = `nwc${randomAlphanumeric(10)}`;
    const key = sku.toLowerCase();
    if (!used.has(key) && isHubMintedJoinKey(sku)) {
      used.add(key);
      return sku;
    }
  }
  throw new SkuIdentityError("Could not mint a unique SKU.");
}

/**
 * Keep a legal join key (including live eBay pins). Strip punctuation on seller-typed
 * codes. Reject item-id leftovers so the hub can mint a real key.
 */
export function acceptExistingJoinKey(
  raw: string | null | undefined,
  itemId: string
): string | null {
  const sku = raw?.trim() ?? "";
  if (!sku) return null;
  if (sku === itemId || isGeneratedVariantOfItemId(sku, itemId)) return null;
  if (isJoinKeySku(sku)) return sku;
  const compact = toCanonicalChannelSku(sku);
  if (!compact || compact === itemId || isGeneratedVariantOfItemId(compact, itemId)) return null;
  return compact;
}

export type SellableSkuItem = {
  id: string;
  sku: string | null;
  variants: unknown;
};

function takeJoinKey(
  raw: string | null | undefined,
  itemId: string,
  used: Set<string>
): { sku: string; minted: boolean } {
  const accepted = acceptExistingJoinKey(raw, itemId);
  if (accepted) {
    const key = accepted.toLowerCase();
    if (!used.has(key)) {
      used.add(key);
      return { sku: accepted, minted: accepted !== (raw?.trim() ?? "") };
    }
  }
  return { sku: mintJoinKeySku(used), minted: true };
}

/**
 * Fill blank / leftover / hyphenated SKUs with one hub join key per sellable unit.
 * Variant listings mint combo rows only (parent leftover is cleared, not copied).
 */
export function ensureSellableSkus(
  item: SellableSkuItem,
  used: Set<string>
): { sku: string | null; variants: unknown; changed: boolean } {
  const matrix = normalizeVariantMatrix(item.variants);
  if (matrix && matrix.skus.length > 0) {
    let changed = false;
    const skus = matrix.skus.map((row) => {
      const next = takeJoinKey(row.sku, item.id, used);
      if (next.minted || next.sku !== (row.sku?.trim() ?? "")) changed = true;
      return { ...row, sku: next.sku };
    });
    const comboKeys = new Set(skus.map((row) => row.sku.toLowerCase()));
    const parentAccepted = acceptExistingJoinKey(item.sku, item.id);
    let sku: string | null = null;
    if (
      parentAccepted &&
      !comboKeys.has(parentAccepted.toLowerCase()) &&
      !used.has(parentAccepted.toLowerCase())
    ) {
      sku = parentAccepted;
      used.add(parentAccepted.toLowerCase());
    } else if (item.sku?.trim()) {
      changed = true;
    }
    return {
      sku,
      variants: serializeVariantMatrix({ ...matrix, skus, skusVary: true }),
      changed: changed || sku !== (item.sku?.trim() || null),
    };
  }
  const next = takeJoinKey(item.sku, item.id, used);
  return {
    sku: next.sku,
    variants: item.variants,
    changed: next.minted || next.sku !== (item.sku?.trim() ?? ""),
  };
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
