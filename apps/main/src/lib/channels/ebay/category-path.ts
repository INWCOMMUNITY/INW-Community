/**
 * Resolve a full eBay category path (e.g. "Collectibles > Coins > US Coins")
 * from a leaf category id. GetItem only returns the leaf CategoryName.
 */

import { prisma } from "database";
import { ebayGet } from "./client";
import { EbayApiError, isEbayRateLimitError } from "./errors";
import { EBAY_API_BASE, EBAY_TAXONOMY_BASE } from "./config";
import {
  getDefaultCategoryTreeId,
  hydrateEbayTaxonomyCooldown,
  isEbayTaxonomyCoolingDown,
  markEbayTaxonomyRateLimited,
} from "./aspects";
import { withEbayApplicationTokenRetry } from "./oauth";

type TaxonomySubtreeNode = {
  category?: { categoryId?: string; categoryName?: string };
  parentCategoryTreeNodeHref?: string;
};

function normalizeTaxonomyHref(href: string): string {
  const trimmed = href.trim();
  if (trimmed.startsWith("http")) return trimmed;
  return `${EBAY_API_BASE}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

/** Walking parent hrefs eventually hits the tree root; eBay 400s that subtree call. */
export function isEbayTaxonomyRootCategoryError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /62008|root for the category tree/i.test(msg);
}

/** Look up a cached full path from seeded taxonomy mappings. */
async function lookupCachedEbayCategoryPath(categoryId: string): Promise<string | null> {
  try {
    const row = await prisma.channelCategoryMapping.findFirst({
      where: {
        provider: "ebay",
        matchType: "category_id",
        matchKey: categoryId,
        active: true,
      },
      select: { remoteLabel: true },
      orderBy: { priority: "desc" },
    });
    const label = row?.remoteLabel?.trim();
    return label && label.includes(">") ? label : null;
  } catch {
    return null;
  }
}

/** GetItem already returns CategoryName (often a full path). Do not spend Taxonomy quota on it. */
export function ebayGetItemCategoryLabelIsUsable(leafName?: string | null): boolean {
  return Boolean(leafName?.trim());
}

/**
 * Build the full eBay category breadcrumb for imports and category resolution.
 * Falls back to leafName when Taxonomy lookup fails.
 */
export async function getEbayCategoryPathFromId(
  categoryId: string | null | undefined,
  leafName?: string | null
): Promise<string | null> {
  const id = categoryId?.trim();
  const leaf = leafName?.trim() || null;
  if (!id) return leaf;

  const cached = await lookupCachedEbayCategoryPath(id);
  if (cached) return cached;

  if (ebayGetItemCategoryLabelIsUsable(leaf)) {
    return leaf;
  }

  await hydrateEbayTaxonomyCooldown();
  if (isEbayTaxonomyCoolingDown()) {
    return leaf;
  }

  try {
    const treeId = await getDefaultCategoryTreeId();
    const path = await withEbayApplicationTokenRetry(async (accessToken) => {
      const segments: string[] = [];
      let href = `${EBAY_TAXONOMY_BASE}/category_tree/${encodeURIComponent(
        treeId
      )}/get_category_subtree?category_id=${encodeURIComponent(id)}`;

      for (let depth = 0; depth < 12 && href; depth++) {
        let res: { categorySubtreeNode?: TaxonomySubtreeNode };
        try {
          res = await ebayGet<{ categorySubtreeNode?: TaxonomySubtreeNode }>(
            accessToken,
            href
          );
        } catch (e) {
          if (isEbayTaxonomyRootCategoryError(e) || (e instanceof EbayApiError && e.status === 400)) {
            break;
          }
          throw e;
        }
        const node = res.categorySubtreeNode;
        const name = node?.category?.categoryName?.trim();
        if (name) segments.unshift(name);

        const parentHref = node?.parentCategoryTreeNodeHref?.trim();
        href = parentHref ? normalizeTaxonomyHref(parentHref) : "";
      }

      return segments.length > 0 ? segments.join(" > ") : null;
    });
    if (path) return path;
  } catch (e) {
    if (isEbayRateLimitError(e)) markEbayTaxonomyRateLimited();
    console.warn("[ebay] getEbayCategoryPathFromId failed", {
      categoryId: id,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return leaf;
}
