/**
 * Live taxonomy sync from eBay Commerce Taxonomy + Etsy seller taxonomy APIs.
 * Supplements static seed data with the full category trees (including all leaf IDs).
 */

import { prisma } from "database";
import { getConnectionContext } from "./connection";
import { ebayGet } from "./ebay/client";
import { EBAY_APIZ_BASE, EBAY_MARKETPLACE_ID } from "./ebay/config";
import { getDefaultCategoryTreeId } from "./ebay/aspects";
import { etsyGet } from "./etsy/client";
import { planInwMappingForMarketplacePath } from "./category-resolver";
import {
  normalizeCategoryMatchKey,
  normalizeCategoryPathKey,
  priorityForMatchType,
  upsertChannelCategoryMappings,
  type ChannelCategoryMappingRow,
} from "./channel-category-mapping";

type EbayTreeNode = {
  category?: { categoryId?: string; categoryName?: string };
  categoryTreeNodeLevel?: number;
  childCategoryTreeNodes?: EbayTreeNode[];
  leafCategoryTreeNode?: boolean;
};

type EtsyTaxonomyNode = {
  id: number;
  name?: string;
  children?: EtsyTaxonomyNode[];
};

function flattenEbayTree(
  node: EbayTreeNode,
  ancestors: string[],
  out: Array<{ id: string; path: string }>
): void {
  const name = node.category?.categoryName?.trim();
  const id = node.category?.categoryId?.trim();
  const pathParts = name ? [...ancestors, name] : [...ancestors];
  const path = pathParts.join(" > ");

  if (id && path) {
    out.push({ id, path });
  }

  for (const child of node.childCategoryTreeNodes ?? []) {
    flattenEbayTree(child, pathParts, out);
  }
}

function flattenEtsyTaxonomy(
  nodes: EtsyTaxonomyNode[],
  ancestors: string[],
  out: Array<{ id: number; path: string }>
): void {
  for (const node of nodes) {
    const name = node.name?.trim();
    if (!name || !node.id) continue;
    const pathParts = [...ancestors, name];
    const path = pathParts.join(" > ");
    out.push({ id: node.id, path });
    if (node.children?.length) {
      flattenEtsyTaxonomy(node.children, pathParts, out);
    }
  }
}

function rowsFromTaxonomyEntries(
  provider: "ebay" | "etsy",
  entries: Array<{ id: string | number; path: string }>,
  source: string
): ChannelCategoryMappingRow[] {
  const rows: ChannelCategoryMappingRow[] = [];

  for (const entry of entries) {
    const planned = planInwMappingForMarketplacePath(provider, entry.path);
    if (!planned) continue;

    const pathKey = normalizeCategoryPathKey(entry.path);
    if (pathKey) {
      rows.push({
        provider,
        matchType: "path",
        matchKey: pathKey,
        remoteLabel: entry.path,
        inwCategory: planned.category,
        inwSubcategory: planned.subcategory,
        priority: priorityForMatchType("path", pathKey),
        source,
      });
    }

    const idKey = String(entry.id);
    rows.push({
      provider,
      matchType: "category_id",
      matchKey: idKey,
      remoteLabel: entry.path,
      inwCategory: planned.category,
      inwSubcategory: planned.subcategory,
      priority: priorityForMatchType("category_id", idKey),
      source,
    });

    const leaf = entry.path.split(">").pop()?.trim() ?? entry.path;
    const labelKey = normalizeCategoryMatchKey(leaf);
    if (labelKey) {
      rows.push({
        provider,
        matchType: "label",
        matchKey: labelKey,
        remoteLabel: entry.path,
        inwCategory: planned.category,
        inwSubcategory: planned.subcategory,
        priority: priorityForMatchType("label", labelKey),
        source,
      });
    }
  }

  return rows;
}

/** Pull the full eBay US category tree and upsert planned INW mappings. */
export async function syncEbayCategoryTreeMappings(
  accessToken: string
): Promise<{ entries: number; upserted: number }> {
  const treeId = await getDefaultCategoryTreeId(accessToken);
  const res = await ebayGet<{ rootCategoryNode?: EbayTreeNode }>(
    accessToken,
    `${EBAY_APIZ_BASE}/commerce/taxonomy/v1/category_tree/${encodeURIComponent(treeId)}`
  );

  const flat: Array<{ id: string; path: string }> = [];
  if (res.rootCategoryNode) {
    flattenEbayTree(res.rootCategoryNode, [], flat);
  }

  const rows = rowsFromTaxonomyEntries("ebay", flat, "ebay_api_sync");
  const { inserted, updated } = await upsertChannelCategoryMappings(rows);
  return { entries: flat.length, upserted: inserted + updated };
}

/** Pull Etsy seller taxonomy nodes and upsert planned INW mappings. */
export async function syncEtsyTaxonomyMappings(
  accessToken: string
): Promise<{ entries: number; upserted: number }> {
  const res = await etsyGet<{ results?: EtsyTaxonomyNode[] }>(
    accessToken,
    `/application/seller-taxonomy/nodes`
  );

  const flat: Array<{ id: number; path: string }> = [];
  flattenEtsyTaxonomy(res.results ?? [], [], flat);

  const rows = rowsFromTaxonomyEntries("etsy", flat, "etsy_api_sync");
  const { inserted, updated } = await upsertChannelCategoryMappings(rows);
  return { entries: flat.length, upserted: inserted + updated };
}

/** Find any active channel connection token for live taxonomy sync. */
export async function findChannelAccessToken(
  provider: "ebay" | "etsy"
): Promise<string | null> {
  const conn = await prisma.channelConnection.findFirst({
    where: { provider, status: "active" },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      memberId: true,
      provider: true,
      externalShopId: true,
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true,
      tokenExpiresAt: true,
      status: true,
      etsyShippingProfileId: true,
      config: true,
    },
  });
  if (!conn) return null;
  const ctx = await getConnectionContext(conn);
  return ctx?.accessToken ?? null;
}
