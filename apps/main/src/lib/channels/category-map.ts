import { prisma } from "database";
import { ebayGet } from "./ebay/client";
import { EBAY_TAXONOMY_BASE, EBAY_TAXONOMY_MARKETPLACE_ID } from "./ebay/config";
import { searchEtsyCategories } from "./etsy/taxonomy-search";
import type { ChannelConnectionContext, ChannelProvider } from "./types";

export type CategoryMapEntry = {
  etsyTaxonomyId?: number;
  ebayCategoryId?: string;
  shopifyProductType?: string;
  wixCollectionId?: string;
  wixCollectionName?: string;
};

export type ConnectionCategoryMap = Record<string, CategoryMapEntry>;

function mapKey(label: string): string {
  return label.trim().toLowerCase();
}

export function getCategoryMap(config: Record<string, unknown> | null): ConnectionCategoryMap {
  const raw = config?.categoryMap;
  if (!raw || typeof raw !== "object") return {};
  return raw as ConnectionCategoryMap;
}

async function persistCategoryMapEntry(
  connectionId: string,
  config: Record<string, unknown> | null,
  label: string,
  entry: CategoryMapEntry
): Promise<void> {
  const key = mapKey(label);
  const map = getCategoryMap(config);
  map[key] = { ...map[key], ...entry };
  await prisma.channelConnection.update({
    where: { id: connectionId },
    data: { config: { ...(config ?? {}), categoryMap: map } },
  });
}

/** Best leaf match from Etsy seller taxonomy (GET /seller-taxonomy/nodes). */
async function searchEtsyTaxonomy(
  accessToken: string,
  keyword: string,
  connectionId?: string
): Promise<number | null> {
  const q = keyword.trim();
  if (!q) return null;
  try {
    const hits = await searchEtsyCategories(accessToken, q, connectionId);
    return hits[0]?.taxonomyId ?? null;
  } catch {
    return null;
  }
}

async function ebayCategoryTreeId(accessToken: string): Promise<string> {
  try {
    const res = await ebayGet<{ categoryTreeId?: string }>(
      accessToken,
      `${EBAY_TAXONOMY_BASE}/get_default_category_tree_id?marketplace_id=${EBAY_TAXONOMY_MARKETPLACE_ID}`
    );
    return res.categoryTreeId ?? "0";
  } catch {
    return "0";
  }
}

async function searchEbayCategory(accessToken: string, keyword: string): Promise<string | null> {
  const q = keyword.trim();
  if (!q) return null;
  try {
    const treeId = await ebayCategoryTreeId(accessToken);
    const res = await ebayGet<{
      categorySuggestions?: { category?: { categoryId?: string; categoryName?: string } }[];
    }>(
      accessToken,
      `${EBAY_TAXONOMY_BASE}/category_tree/${encodeURIComponent(treeId)}/get_category_suggestions?q=${encodeURIComponent(q)}`
    );
    const first = res.categorySuggestions?.[0]?.category?.categoryId;
    return first ?? null;
  } catch {
    return null;
  }
}

export type ResolvedProviderCategory = {
  etsyTaxonomyId?: number;
  ebayCategoryId?: string;
  shopifyProductType?: string;
  wixCollectionName?: string;
};

/**
 * Resolve INW category label → provider-specific category id/type.
 * Results are cached on ChannelConnection.config.categoryMap.
 */
export async function resolveProviderCategoryId(
  conn: ChannelConnectionContext,
  provider: ChannelProvider,
  inwCategoryLabel: string | null | undefined
): Promise<ResolvedProviderCategory> {
  const label = inwCategoryLabel?.trim();
  if (!label) return {};

  const map = getCategoryMap(conn.config);
  const cached = map[mapKey(label)];
  if (cached) {
    return {
      etsyTaxonomyId: cached.etsyTaxonomyId,
      ebayCategoryId: cached.ebayCategoryId,
      shopifyProductType: cached.shopifyProductType ?? label,
      wixCollectionName: cached.wixCollectionName ?? label,
    };
  }

  const entry: CategoryMapEntry = {};
  if (provider === "etsy") {
    const id = await searchEtsyTaxonomy(conn.accessToken, label, conn.id);
    if (id) entry.etsyTaxonomyId = id;
  }
  if (provider === "ebay") {
    const id = await searchEbayCategory(conn.accessToken, label);
    if (id) entry.ebayCategoryId = id;
  }
  if (provider === "shopify") {
    entry.shopifyProductType = label;
  }
  if (provider === "wix") {
    entry.wixCollectionName = label;
  }

  if (Object.keys(entry).length > 0) {
    await persistCategoryMapEntry(conn.id, conn.config, label, entry);
  }

  return {
    etsyTaxonomyId: entry.etsyTaxonomyId,
    ebayCategoryId: entry.ebayCategoryId,
    shopifyProductType: entry.shopifyProductType ?? label,
    wixCollectionName: entry.wixCollectionName ?? label,
  };
}

export async function cacheProviderCategoryId(
  conn: ChannelConnectionContext,
  inwCategoryLabel: string,
  entry: CategoryMapEntry
): Promise<void> {
  await persistCategoryMapEntry(conn.id, conn.config, inwCategoryLabel, entry);
}
