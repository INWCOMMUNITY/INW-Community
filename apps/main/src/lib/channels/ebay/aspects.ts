/**
 * eBay Taxonomy API helpers: category search + per-category item specifics (aspects).
 *
 * Used by the listing-form pickers (`/api/channels/ebay/categories`,
 * `/api/channels/ebay/category-aspects`) so sellers choose a real eBay leaf category
 * and fill in the item specifics eBay requires for that category before we push.
 */

import { prisma } from "database";
import { ebayGet } from "./client";
import {
  EBAY_MARKETPLACE_ID,
  EBAY_METADATA_BASE,
  EBAY_TAXONOMY_BASE,
  EBAY_US_CATEGORY_TREE_ID,
  isEbayConfigured,
} from "./config";
import { EbayApiError, isEbayRateLimitError } from "./errors";
import { withEbayApplicationTokenRetry } from "./oauth";

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

export function clearEbayCategoryTreeIdCache(): void {
  cachedTreeId = null;
}

const TAXONOMY_COOLDOWN_MS = 60_000;
const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let taxonomyCoolDownUntil = 0;
const categorySearchCache = new Map<string, { categories: EbayCategorySuggestion[]; at: number }>();

export const EBAY_CATEGORY_SEARCH_BUSY_NOTICE =
  "eBay is busy right now. Wait a minute and search again.";

export function markEbayTaxonomyRateLimited(): void {
  taxonomyCoolDownUntil = Date.now() + TAXONOMY_COOLDOWN_MS;
}

export function isEbayTaxonomyCoolingDown(): boolean {
  return Date.now() < taxonomyCoolDownUntil;
}

export function clearEbayTaxonomyCooldown(): void {
  taxonomyCoolDownUntil = 0;
}

export function clearEbayCategorySearchCache(): void {
  categorySearchCache.clear();
}

function searchCacheKey(query: string): string {
  return query.trim().toLowerCase();
}

export function cacheEbayCategorySearch(query: string, categories: EbayCategorySuggestion[]): void {
  const key = searchCacheKey(query);
  if (!key) return;
  categorySearchCache.set(key, { categories, at: Date.now() });
}

export function getCachedEbayCategorySearch(query: string): EbayCategorySuggestion[] | null {
  const entry = categorySearchCache.get(searchCacheKey(query));
  if (!entry) return null;
  if (Date.now() - entry.at > SEARCH_CACHE_TTL_MS) return null;
  return entry.categories;
}

function suggestionsFromTaxonomyResponse(res: {
  categorySuggestions?: {
    category?: { categoryId?: string; categoryName?: string };
    categoryTreeNodeAncestors?: { categoryName?: string }[];
  }[];
}): EbayCategorySuggestion[] {
  const out: EbayCategorySuggestion[] = [];
  for (const s of res.categorySuggestions ?? []) {
    const id = s.category?.categoryId;
    const name = s.category?.categoryName;
    if (!id || !name) continue;
    const ancestors = (s.categoryTreeNodeAncestors ?? [])
      .map((a) => a.categoryName)
      .filter((n): n is string => Boolean(n))
      .reverse();
    const path = [...ancestors, name].join(" > ");
    out.push({ categoryId: id, categoryName: name, categoryPath: path });
  }
  return out;
}

/**
 * US tree id is always "0". Do not call get_default_category_tree_id —
 * that Taxonomy request is easy to 429 and does not change for EBAY_US.
 */
export async function getDefaultCategoryTreeId(): Promise<string> {
  const now = Date.now();
  if (cachedTreeId && now - cachedTreeId.at < 6 * 60 * 60 * 1000) {
    return cachedTreeId.id;
  }
  // US tree is always "0". Skip the live lookup so Taxonomy 429s are not wasted here.
  cachedTreeId = { id: EBAY_US_CATEGORY_TREE_ID, at: now };
  return cachedTreeId.id;
}

/** Live leaf-category suggestions for a free-text query (the category picker). */
export async function searchEbayCategories(query: string): Promise<EbayCategorySuggestion[]> {
  const q = query.trim();
  if (!q) return [];
  requireEbayTaxonomyConfig();
  const cached = getCachedEbayCategorySearch(q);
  if (cached && isEbayTaxonomyCoolingDown()) return cached;

  const treeId = await getDefaultCategoryTreeId();
  try {
    const res = await withEbayApplicationTokenRetry((accessToken) =>
      ebayGet<{
        categorySuggestions?: {
          category?: { categoryId?: string; categoryName?: string };
          categoryTreeNodeAncestors?: { categoryName?: string }[];
        }[];
      }>(
        accessToken,
        `${EBAY_TAXONOMY_BASE}/category_tree/${encodeURIComponent(
          treeId
        )}/get_category_suggestions?q=${encodeURIComponent(q)}`
      )
    );
    const out = suggestionsFromTaxonomyResponse(res);
    cacheEbayCategorySearch(q, out);
    return out;
  } catch (e) {
    if (isEbayRateLimitError(e)) {
      markEbayTaxonomyRateLimited();
      if (cached) return cached;
    }
    throw e;
  }
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

const ASPECT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const aspectCache = new Map<string, { aspects: EbayCategoryAspect[]; at: number; treeId: string }>();

function aspectCacheKey(treeId: string, categoryId: string): string {
  return `${treeId}:${categoryId}`;
}

export function parseAspectApiResponse(res: AspectApiResponse): EbayCategoryAspect[] {
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

  aspects.sort((x, y) => {
    if (x.required !== y.required) return x.required ? -1 : 1;
    return x.name.localeCompare(y.name);
  });
  return aspects;
}

export function cacheCategoryAspects(
  categoryId: string,
  treeId: string,
  aspects: EbayCategoryAspect[]
): void {
  aspectCache.set(aspectCacheKey(treeId, categoryId), { aspects, at: Date.now(), treeId });
}

export function getCachedCategoryAspects(
  categoryId: string,
  treeId: string,
  opts?: { allowStale?: boolean }
): EbayCategoryAspect[] | null {
  const entry = aspectCache.get(aspectCacheKey(treeId, categoryId));
  if (!entry) return null;
  if (!opts?.allowStale && Date.now() - entry.at > ASPECT_CACHE_TTL_MS) return null;
  return entry.aspects;
}

export function clearCategoryAspectCache(): void {
  aspectCache.clear();
}

function shouldUseAspectCacheFallback(error: unknown): boolean {
  if (isEbayRateLimitError(error)) return true;
  if (error instanceof EbayApiError) {
    return error.status === 401 || error.status === 429 || error.status >= 500;
  }
  return false;
}

/**
 * Required + recommended item specifics for an eBay leaf category.
 * Returns required aspects first, each with mode, cardinality, and suggested values.
 */
async function fetchItemAspectsForCategory(
  categoryId: string,
  treeId: string
): Promise<AspectApiResponse> {
  return withEbayApplicationTokenRetry((accessToken) =>
    ebayGet<AspectApiResponse>(
      accessToken,
      `${EBAY_TAXONOMY_BASE}/category_tree/${encodeURIComponent(
        treeId
      )}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`
    )
  );
}

/**
 * Official item specifics via Sell Metadata + application token.
 * Separate quota from Taxonomy category search — do not use the seller user token
 * (that 404s and then burns Taxonomy, which also powers the category picker).
 */
export async function fetchItemAspectsForCategoryViaMetadata(
  categoryId: string
): Promise<AspectApiResponse> {
  return withEbayApplicationTokenRetry((accessToken) =>
    ebayGet<AspectApiResponse>(
      accessToken,
      `${EBAY_METADATA_BASE}/marketplace/${encodeURIComponent(
        EBAY_MARKETPLACE_ID
      )}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`
    )
  );
}

function persistedAspectsKey(treeId: string, categoryId: string): string {
  return `ebay_aspects:${treeId}:${categoryId}`;
}

function parsePersistedAspects(value: unknown): { aspects: EbayCategoryAspect[]; at: number } | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as { aspects?: unknown; at?: unknown };
  if (!Array.isArray(rec.aspects)) return null;
  const aspects: EbayCategoryAspect[] = [];
  for (const row of rec.aspects) {
    if (!row || typeof row !== "object") continue;
    const item = row as Partial<EbayCategoryAspect>;
    if (typeof item.name !== "string" || !item.name.trim()) continue;
    aspects.push({
      name: item.name,
      required: Boolean(item.required),
      mode: item.mode === "SELECTION_ONLY" ? "SELECTION_ONLY" : "FREE_TEXT",
      cardinality: item.cardinality === "MULTI" ? "MULTI" : "SINGLE",
      suggestedValues: Array.isArray(item.suggestedValues)
        ? item.suggestedValues.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        : [],
    });
  }
  if (aspects.length === 0) return null;
  return { aspects, at: typeof rec.at === "number" ? rec.at : 0 };
}

async function readPersistedCategoryAspects(
  categoryId: string,
  treeId: string,
  allowStale: boolean
): Promise<EbayCategoryAspect[] | null> {
  try {
    const row = await prisma.siteSetting.findUnique({
      where: { key: persistedAspectsKey(treeId, categoryId) },
    });
    const parsed = parsePersistedAspects(row?.value);
    if (!parsed) return null;
    if (!allowStale && Date.now() - parsed.at > ASPECT_CACHE_TTL_MS) return null;
    return parsed.aspects;
  } catch {
    return null;
  }
}

async function writePersistedCategoryAspects(
  categoryId: string,
  treeId: string,
  aspects: EbayCategoryAspect[]
): Promise<void> {
  const key = persistedAspectsKey(treeId, categoryId);
  const value = { aspects, at: Date.now() };
  try {
    await prisma.siteSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  } catch (e) {
    console.warn("[ebay] persist category aspects failed", {
      categoryId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export type GetItemAspectsOptions = {
  /** Unused; Metadata uses the application token. Kept so callers do not break. */
  sellerAccessToken?: string | null;
};

/** True when Type or Brand is missing, or eBay listed no official values for them. */
export function aspectSchemaNeedsOfficialValues(aspects: EbayCategoryAspect[]): boolean {
  if (aspects.length === 0) return true;
  const type = aspects.find((aspect) => aspect.name.trim().toLowerCase() === "type");
  const brand = aspects.find((aspect) => /^(brand|brand name)$/i.test(aspect.name.trim()));
  if (!type || !brand) return true;
  return type.suggestedValues.length === 0 || brand.suggestedValues.length === 0;
}

function rememberAspects(categoryId: string, treeId: string, aspects: EbayCategoryAspect[]): EbayCategoryAspect[] {
  cacheCategoryAspects(categoryId, treeId, aspects);
  void writePersistedCategoryAspects(categoryId, treeId, aspects);
  return aspects;
}

export async function getItemAspectsForCategory(
  categoryId: string,
  _opts?: GetItemAspectsOptions
): Promise<EbayCategoryAspect[]> {
  const id = categoryId.trim();
  if (!id) return [];
  requireEbayTaxonomyConfig();
  const treeId = await getDefaultCategoryTreeId();
  const fresh = getCachedCategoryAspects(id, treeId);
  if (fresh?.length) return fresh;

  const persisted = await readPersistedCategoryAspects(id, treeId, false);
  if (persisted?.length) {
    cacheCategoryAspects(id, treeId, persisted);
    return persisted;
  }

  try {
    const meta = await fetchItemAspectsForCategoryViaMetadata(id);
    const aspects = parseAspectApiResponse(meta);
    if (aspects.length > 0) return rememberAspects(id, treeId, aspects);
  } catch (metaErr) {
    console.warn("[ebay] getItemAspectsForCategory: Metadata lookup failed", {
      categoryId: id,
      error: metaErr instanceof Error ? metaErr.message : String(metaErr),
    });
    if (isEbayRateLimitError(metaErr)) {
      const stale =
        getCachedCategoryAspects(id, treeId, { allowStale: true }) ??
        (await readPersistedCategoryAspects(id, treeId, true));
      if (stale?.length) {
        cacheCategoryAspects(id, treeId, stale);
        return stale;
      }
    }
  }

  if (isEbayTaxonomyCoolingDown()) {
    const stale = getCachedCategoryAspects(id, treeId, { allowStale: true })
      ?? (await readPersistedCategoryAspects(id, treeId, true));
    return stale ?? [];
  }

  try {
    const res = await fetchItemAspectsForCategory(id, treeId);
    const aspects = parseAspectApiResponse(res);
    if (aspects.length > 0) return rememberAspects(id, treeId, aspects);
    return aspects;
  } catch (e) {
    if (isEbayRateLimitError(e)) markEbayTaxonomyRateLimited();
    const cached = getCachedCategoryAspects(id, treeId, { allowStale: true })
      ?? (await readPersistedCategoryAspects(id, treeId, true));
    if (cached && shouldUseAspectCacheFallback(e)) {
      console.warn("[ebay] getItemAspectsForCategory: serving cached aspects", {
        categoryId: id,
        error: e instanceof Error ? e.message : String(e),
      });
      cacheCategoryAspects(id, treeId, cached);
      return cached;
    }
    throw e;
  }
}
