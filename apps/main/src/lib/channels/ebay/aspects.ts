/**
 * eBay Taxonomy API helpers: category search + per-category item specifics (aspects).
 *
 * Used by the listing-form pickers (`/api/channels/ebay/categories`,
 * `/api/channels/ebay/category-aspects`) so sellers choose a real eBay leaf category
 * and fill in the item specifics eBay requires for that category before we push.
 */

import { ebayGet } from "./client";
import { EBAY_TAXONOMY_BASE, EBAY_TAXONOMY_MARKETPLACE_ID } from "./config";
import { getEbayApplicationAccessToken } from "./oauth";

export type EbayCategorySuggestion = {
  categoryId: string;
  categoryName: string;
  /** Full path from root (e.g. "Collectibles > Coins & Paper Money > Coins: US"). */
  categoryPath?: string;
};

export type EbayAspectMode = "FREE_TEXT" | "SELECTION_ONLY";

export type EbayCategoryAspect = {
  name: string;
  required: boolean;
  mode: EbayAspectMode;
  /** "SINGLE" | "MULTI" — how many values eBay allows for this aspect. */
  cardinality: "SINGLE" | "MULTI";
  suggestedValues: string[];
};

/** Resolve (and lightly cache per process) the default US category tree id. */
let cachedTreeId: { id: string; at: number } | null = null;

export async function getDefaultCategoryTreeId(): Promise<string> {
  const now = Date.now();
  if (cachedTreeId && now - cachedTreeId.at < 6 * 60 * 60 * 1000) {
    return cachedTreeId.id;
  }
  const accessToken = await getEbayApplicationAccessToken();
  const treeUrl = `${EBAY_TAXONOMY_BASE}/get_default_category_tree_id?marketplace_id=${EBAY_TAXONOMY_MARKETPLACE_ID}`;
  let res: { categoryTreeId?: string };
  try {
    res = await ebayGet<{ categoryTreeId?: string }>(accessToken, treeUrl);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.log("[debug-58be99] category tree lookup failed", {
      runId: "verify-fix",
      marketplaceId: EBAY_TAXONOMY_MARKETPLACE_ID,
      error: errMsg.slice(0, 300),
    });
    throw e;
  }
  const id = res.categoryTreeId?.trim();
  if (!id) {
    throw new Error("eBay Taxonomy API returned no category tree id.");
  }
  // #region agent log
  fetch("http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "58be99" },
    body: JSON.stringify({
      sessionId: "58be99",
      runId: "verify-fix",
      hypothesisId: "H1",
      location: "aspects.ts:getDefaultCategoryTreeId",
      message: "resolved category tree id",
      data: { treeId: id, marketplaceId: EBAY_TAXONOMY_MARKETPLACE_ID },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  console.log("[debug-58be99] category tree resolved", {
    runId: "verify-fix",
    treeId: id,
    marketplaceId: EBAY_TAXONOMY_MARKETPLACE_ID,
  });
  cachedTreeId = { id, at: now };
  return id;
}

/** Live leaf-category suggestions for a free-text query (the category picker). */
export async function searchEbayCategories(query: string): Promise<EbayCategorySuggestion[]> {
  const q = query.trim();
  if (!q) return [];
  const treeId = await getDefaultCategoryTreeId();
  const accessToken = await getEbayApplicationAccessToken();
  const res = await ebayGet<{
    categorySuggestions?: {
      category?: { categoryId?: string; categoryName?: string };
      categoryTreeNodeAncestors?: { categoryName?: string }[];
    }[];
  }>(
    accessToken,
    `${EBAY_TAXONOMY_BASE}/category_tree/${encodeURIComponent(
      treeId
    )}/get_category_suggestions?q=${encodeURIComponent(q)}`
  );

  const out: EbayCategorySuggestion[] = [];
  for (const s of res.categorySuggestions ?? []) {
    const id = s.category?.categoryId;
    const name = s.category?.categoryName;
    if (!id || !name) continue;
    // Ancestors come back leaf-first; reverse to read root → leaf.
    const ancestors = (s.categoryTreeNodeAncestors ?? [])
      .map((a) => a.categoryName)
      .filter((n): n is string => Boolean(n))
      .reverse();
    const path = [...ancestors, name].join(" > ");
    out.push({ categoryId: id, categoryName: name, categoryPath: path });
  }
  return out;
}

type AspectApiResponse = {
  aspects?: {
    localizedAspectName?: string;
    aspectConstraint?: {
      aspectRequired?: boolean;
      aspectMode?: string; // FREE_TEXT | SELECTION_ONLY
      itemToAspectCardinality?: string; // SINGLE | MULTI
    };
    aspectValues?: { localizedValue?: string }[];
  }[];
};

/**
 * Required + recommended item specifics for an eBay leaf category.
 * Returns required aspects first, each with mode, cardinality, and suggested values.
 */
export async function getItemAspectsForCategory(categoryId: string): Promise<EbayCategoryAspect[]> {
  const id = categoryId.trim();
  if (!id) return [];
  const treeId = await getDefaultCategoryTreeId();
  const accessToken = await getEbayApplicationAccessToken();
  const res = await ebayGet<AspectApiResponse>(
    accessToken,
    `${EBAY_TAXONOMY_BASE}/category_tree/${encodeURIComponent(
      treeId
    )}/get_item_aspects_for_category?category_id=${encodeURIComponent(id)}`
  );

  const aspects: EbayCategoryAspect[] = [];
  for (const a of res.aspects ?? []) {
    const name = a.localizedAspectName?.trim();
    if (!name) continue;
    const mode: EbayAspectMode =
      a.aspectConstraint?.aspectMode === "SELECTION_ONLY" ? "SELECTION_ONLY" : "FREE_TEXT";
    const cardinality = a.aspectConstraint?.itemToAspectCardinality === "MULTI" ? "MULTI" : "SINGLE";
    const suggestedValues = (a.aspectValues ?? [])
      .map((v) => v.localizedValue?.trim())
      .filter((v): v is string => Boolean(v));
    aspects.push({
      name,
      required: Boolean(a.aspectConstraint?.aspectRequired),
      mode,
      cardinality,
      suggestedValues,
    });
  }

  // Required first, then alphabetical for a stable form order.
  aspects.sort((x, y) => {
    if (x.required !== y.required) return x.required ? -1 : 1;
    return x.name.localeCompare(y.name);
  });
  return aspects;
}
