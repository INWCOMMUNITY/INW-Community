/**
 * Live Inventory pins for a linked eBay listing.
 * INW join keys and Hub Custom Labels are not always the Inventory SKU.
 * Never address hyphen parent SKUs — Inventory API rejects them (#25707).
 */

import { prisma } from "database";
import { isValidEbayInventorySku } from "./migrate-prep";

export type EbaySkuMap = {
  parent?: string | null;
  /** INW join key (or Hub Custom Label) → live Inventory SKU. */
  variations?: Record<string, string>;
};

export function parseEbaySkuMap(raw: unknown): EbaySkuMap | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as { parent?: unknown; variations?: unknown };
  const parent =
    typeof rec.parent === "string" && isValidEbayInventorySku(rec.parent) ? rec.parent.trim() : null;
  const variations: Record<string, string> = {};
  if (rec.variations && typeof rec.variations === "object" && !Array.isArray(rec.variations)) {
    for (const [key, value] of Object.entries(rec.variations as Record<string, unknown>)) {
      const join = key.trim();
      const pin = typeof value === "string" ? value.trim() : "";
      if (!join || !isValidEbayInventorySku(pin)) continue;
      variations[join] = pin;
    }
  }
  if (!parent && Object.keys(variations).length === 0) return null;
  return { parent, variations };
}

export function ebaySkuMapHasPins(map: EbaySkuMap | null | undefined): boolean {
  if (!map) return false;
  if (map.parent && isValidEbayInventorySku(map.parent)) return true;
  return Object.values(map.variations ?? {}).some((sku) => isValidEbayInventorySku(sku));
}

/** Live Inventory SKU for a join key. Never returns a hyphenated parent. */
export function mappedEbayInventorySku(
  map: EbaySkuMap | null | undefined,
  joinKey?: string | null
): string | null {
  const key = joinKey?.trim() || "";
  if (key) {
    const variation = map?.variations?.[key]?.trim();
    if (variation && isValidEbayInventorySku(variation)) return variation;
    if (isValidEbayInventorySku(key) && map?.variations && Object.values(map.variations).includes(key)) {
      return key;
    }
  }
  const parent = map?.parent?.trim() || "";
  if (parent && isValidEbayInventorySku(parent) && (!key || key === parent || !map?.variations?.[key])) {
    if (!key || key === parent) return parent;
  }
  if (key && isValidEbayInventorySku(key)) return key;
  return parent && isValidEbayInventorySku(parent) ? parent : null;
}

export function mergeEbaySkuMap(
  current: EbaySkuMap | null | undefined,
  next: { parent?: string | null; variations?: Record<string, string | null | undefined> }
): EbaySkuMap {
  const variations = { ...(current?.variations ?? {}) };
  for (const [join, pin] of Object.entries(next.variations ?? {})) {
    const key = join.trim();
    const sku = pin?.trim() ?? "";
    if (!key || !isValidEbayInventorySku(sku)) continue;
    variations[key] = sku;
  }
  const parentRaw = next.parent?.trim() ?? current?.parent ?? null;
  const parent = parentRaw && isValidEbayInventorySku(parentRaw) ? parentRaw : current?.parent ?? null;
  return { parent, variations };
}

export function ebaySkuMapProbeCandidates(args: {
  map?: EbaySkuMap | null;
  joinKey?: string | null;
  extra?: string[];
}): string[] {
  const mapped = mappedEbayInventorySku(args.map, args.joinKey);
  const out: string[] = [];
  for (const raw of [mapped ?? "", args.joinKey ?? "", args.map?.parent ?? "", ...(args.extra ?? [])]) {
    const sku = raw.trim();
    if (!sku || !isValidEbayInventorySku(sku) || out.includes(sku)) continue;
    out.push(sku);
  }
  return out;
}

export async function persistEbaySkuMap(linkId: string, map: EbaySkuMap): Promise<void> {
  await prisma.channelListingLink.update({
    where: { id: linkId },
    data: { ebaySkuMap: map as object },
  });
}

export function ebaySkuMapEquals(a: EbaySkuMap | null | undefined, b: EbaySkuMap | null | undefined): boolean {
  const left = JSON.stringify({
    parent: a?.parent ?? null,
    variations: a?.variations ?? {},
  });
  const right = JSON.stringify({
    parent: b?.parent ?? null,
    variations: b?.variations ?? {},
  });
  return left === right;
}
