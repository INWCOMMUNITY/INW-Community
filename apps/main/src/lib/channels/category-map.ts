import { prisma } from "database";
import { etsyGet } from "./etsy/client";
import { ebayGet } from "./ebay/client";
import { EBAY_APIZ_BASE, EBAY_MARKETPLACE_ID } from "./ebay/config";
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

/** Walk Etsy seller taxonomy nodes and find best leaf match by name. */
async function searchEtsyTaxonomy(
  accessToken: string,
  keyword: string
): Promise<number | null> {
  const q = keyword.trim().toLowerCase();
  if (!q) return null;
  try {
    const res = await etsyGet<{ results?: { id: number; name?: string; children?: unknown[] }[] }>(
      accessToken,
      `/application/seller-taxonomy/nodes`
    );
    type Node = { id: number; name?: string; children?: Node[] };
    const nodes = (res.results ?? []) as Node[];
    let best: { id: number; score: number } | null = null;

  function walk(list: Node[], depth: number): void {
      for (const n of list) {
        const name = (n.name ?? "").toLowerCase();
        let score = 0;
        if (name === q) score = 1;
        else if (name.includes(q) || q.includes(name)) score = 0.85;
        else if (name.split(/\s+/).some((w) => q.includes(w))) score = 0.6;
        const isLeaf = !n.children || n.children.length === 0;
        if (isLeaf && score > (best?.score ?? 0)) best = { id: n.id, score };
        if (n.children?.length) walk(n.children, depth + 1);
      }
    }
    walk(nodes, 0);
    const picked = best as { id: number; score: number } | null;
    if (picked !== null && picked.score >= 0.6) return picked.id;
    return null;
  } catch {
    return null;
  }
}

async function ebayCategoryTreeId(accessToken: string): Promise<string> {
  try {
    const res = await ebayGet<{ categoryTreeId?: string }>(
      accessToken,
      `${EBAY_APIZ_BASE}/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${EBAY_MARKETPLACE_ID}`
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
      `${EBAY_APIZ_BASE}/commerce/taxonomy/v1/category_tree/${encodeURIComponent(treeId)}/get_category_suggestions?q=${encodeURIComponent(q)}`
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
    const id = await searchEtsyTaxonomy(conn.accessToken, label);
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
