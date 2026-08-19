/**
 * eBay Taxonomy API helpers: category search + per-category item specifics (aspects).
 *
 * Used by the listing-form pickers (`/api/channels/ebay/categories`,
 * `/api/channels/ebay/category-aspects`) so sellers choose a real eBay leaf category
 * and fill in the item specifics eBay requires for that category before we push.
 */

import { ebayGet, EbayApiError } from "./client";
import { EBAY_TAXONOMY_BASE, EBAY_TAXONOMY_MARKETPLACE_ID, isEbayConfigured } from "./config";
import { clearEbayApplicationAccessTokenCache, getEbayApplicationAccessToken } from "./oauth";

/** Taxonomy uses app credentials (client_credentials), not the seller OAuth token. */
export function requireEbayTaxonomyConfig(): void {
  if (!isEbayConfigured()) {
    throw new Error(
      "eBay category search is not configured on this server (missing EBAY_CLIENT_ID / EBAY_CLIENT_SECRET)."
    );
  }
}

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
  const res = await ebayGet<{ categoryTreeId?: string }>(accessToken, treeUrl);
  const id = res.categoryTreeId?.trim();
  if (!id) {
    throw new Error("eBay Taxonomy API returned no category tree id.");
  }
  cachedTreeId = { id, at: now };
  return id;
}

/** Live leaf-category suggestions for a free-text query (the category picker). */
export async function searchEbayCategories(query: string): Promise<EbayCategorySuggestion[]> {
  const q = query.trim();
  if (!q) return [];
  requireEbayTaxonomyConfig();
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
async function fetchItemAspectsForCategory(
  categoryId: string,
  treeId: string
): Promise<AspectApiResponse> {
  const accessToken = await getEbayApplicationAccessToken();
  try {
    return await ebayGet<AspectApiResponse>(
      accessToken,
      `${EBAY_TAXONOMY_BASE}/category_tree/${encodeURIComponent(
        treeId
      )}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`
    );
  } catch (e) {
    if (e instanceof EbayApiError && e.status === 401) {
      clearEbayApplicationAccessTokenCache();
      const retryToken = await getEbayApplicationAccessToken();
      return await ebayGet<AspectApiResponse>(
        retryToken,
        `${EBAY_TAXONOMY_BASE}/category_tree/${encodeURIComponent(
          treeId
        )}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`
      );
    }
    throw e;
  }
}

export async function getItemAspectsForCategory(categoryId: string): Promise<EbayCategoryAspect[]> {
  const id = categoryId.trim();
  if (!id) return [];
  requireEbayTaxonomyConfig();
  const treeId = await getDefaultCategoryTreeId();
  const res = await fetchItemAspectsForCategory(id, treeId);

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
