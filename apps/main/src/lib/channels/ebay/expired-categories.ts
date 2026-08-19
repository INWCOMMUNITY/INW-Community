/**
 * Remap stored eBay leaf category IDs that Taxonomy has retired.
 * GET /commerce/taxonomy/v1/category_tree/{id}/get_expired_categories
 */

import { ebayGet } from "./client";
import { EBAY_TAXONOMY_BASE } from "./config";
import { getDefaultCategoryTreeId } from "./aspects";
import { withEbayApplicationTokenRetry } from "./oauth";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type ExpiredCategoryRow = { fromCategoryId?: string; toCategoryId?: string };

let cachedMap: { map: Record<string, string>; at: number; treeId: string } | null = null;

export function applyExpiredCategoryMap(
  categoryId: string,
  map: Record<string, string>
): string {
  let current = categoryId.trim();
  if (!current) return current;
  const seen = new Set<string>();
  while (map[current] && !seen.has(current)) {
    seen.add(current);
    current = map[current]!;
  }
  return current;
}

export async function fetchExpiredEbayCategoryMap(): Promise<Record<string, string>> {
  const now = Date.now();
  const treeId = await getDefaultCategoryTreeId();
  if (cachedMap && cachedMap.treeId === treeId && now - cachedMap.at < CACHE_TTL_MS) {
    return cachedMap.map;
  }

  const res = await withEbayApplicationTokenRetry((token) =>
    ebayGet<{ expiredCategories?: ExpiredCategoryRow[] }>(
      token,
      `${EBAY_TAXONOMY_BASE}/category_tree/${encodeURIComponent(treeId)}/get_expired_categories`
    )
  );

  const map: Record<string, string> = {};
  for (const row of res.expiredCategories ?? []) {
    const from = row.fromCategoryId?.trim();
    const to = row.toCategoryId?.trim();
    if (from && to && from !== to) map[from] = to;
  }
  cachedMap = { map, at: now, treeId };
  return map;
}

/** Resolve a live leaf category id, following expired-category remaps. */
export async function remapExpiredEbayCategoryId(
  categoryId: string | number | null | undefined,
  categoryMap?: Record<string, string>
): Promise<string | null> {
  if (categoryId == null) return null;
  const id = String(categoryId).trim();
  if (!id) return null;
  try {
    const map = categoryMap ?? (await fetchExpiredEbayCategoryMap());
    return applyExpiredCategoryMap(id, map);
  } catch (e) {
    console.warn("[ebay] getExpiredCategories failed; using original category id", {
      categoryId: id,
      error: e instanceof Error ? e.message : String(e),
    });
    return id;
  }
}

export function clearExpiredEbayCategoryMapCache(): void {
  cachedMap = null;
}

/** Remap an expired leaf id and optionally persist the updated id on the StoreItem. */
export async function resolveRemappedEbayCategoryId(
  categoryId: string | null | undefined,
  options?: {
    storeItemId?: string;
    persist?: boolean;
    currentStoredId?: number | null;
    persistCategoryId?: (storeItemId: string, categoryId: number) => Promise<void>;
    categoryMap?: Record<string, string>;
  }
): Promise<string | null> {
  if (categoryId == null) return null;
  const id = String(categoryId).trim();
  if (!id) return null;
  const remapped = await remapExpiredEbayCategoryId(id, options?.categoryMap);
  if (!remapped) return id;
  if (
    remapped !== id &&
    options?.persist &&
    options.storeItemId &&
    options.persistCategoryId
  ) {
    const parsed = Number(remapped);
    if (Number.isFinite(parsed) && parsed > 0 && options.currentStoredId !== parsed) {
      await options.persistCategoryId(options.storeItemId, parsed);
    }
  }
  return remapped;
}
