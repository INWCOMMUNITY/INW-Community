/**
 * Etsy seller category tree from official help page:
 * https://www.etsy.com/help/categories/seller
 *
 * Bundled at build time (Vercel serverless has no runtime access to loose .md files).
 */

import etsySellerCategoriesMarkdown from "./data/etsy-seller-categories.md";

function loadEtsySellerCategoriesMarkdown(): string {
  return etsySellerCategoriesMarkdown;
}

/** Etsy marketplace top-level categories (seller help page). */
export const ETSY_SELLER_TOP_LEVELS = new Set([
  "Accessories",
  "Art & Collectibles",
  "Bags & Purses",
  "Bath & Beauty",
  "Books, Movies & Music",
  "Clothing",
  "Craft Supplies & Tools",
  "Electronics & Accessories",
  "Home & Living",
  "Jewelry",
  "Paper & Party Supplies",
  "Pet Supplies",
  "Shoes",
  "Toys & Games",
  "Weddings",
]);

export type EtsySellerCategoryPath = {
  path: string;
  segments: string[];
  depth: number;
};

function countLeadingDashGroups(line: string): number {
  const m = line.match(/^(-+\s)+/);
  if (!m) return 0;
  return (m[0].match(/- /g) ?? []).length;
}

/**
 * Parse the Etsy seller help markdown into hierarchical category paths.
 * Handles inconsistent single-dash nesting in the fetched markdown export.
 */
export function parseEtsySellerCategoryMarkdown(content: string): EtsySellerCategoryPath[] {
  const lines = content.split(/\r?\n/);
  let inFullList = false;
  const stack: string[] = [];
  const paths: EtsySellerCategoryPath[] = [];
  const seen = new Set<string>();
  let prevDashCount = 0;
  /** True after emitting a 3+ segment path (nested under a mid-level parent). */
  let nestedUnderSubParent = false;
  /** Mid-level parent that owns `- -` children (e.g. "Belts & Suspenders"). */
  let subParent: string | null = null;

  const emit = () => {
    if (stack.length === 0) return;
    const path = stack.join(" > ");
    if (seen.has(path)) return;
    seen.add(path);
    paths.push({ path, segments: [...stack], depth: stack.length - 1 });
    nestedUnderSubParent = stack.length >= 3;
  };

  for (const line of lines) {
    if (line.includes("## Full list of categories")) {
      inFullList = true;
      continue;
    }
    if (!inFullList) continue;
    if (line.startsWith("##")) break;

    const nameMatch = line.match(/^(-+\s)+(.+)$/);
    if (!nameMatch?.[2]) continue;
    const name = nameMatch[2].trim();
    if (!name) continue;

    let dashCount = countLeadingDashGroups(line);
    const rawDashCount = dashCount;
    const isTopLevel = ETSY_SELLER_TOP_LEVELS.has(name);

    if (dashCount <= 0) continue;

    if (isTopLevel) {
      stack.length = 0;
      stack.push(name);
      subParent = null;
      nestedUnderSubParent = false;
      prevDashCount = 1;
      emit();
      continue;
    }

    if (rawDashCount === 1 && stack.length > 0) {
      dashCount = 2;
      if (nestedUnderSubParent && subParent && stack[0] && stack.length >= 2 && stack[1] === subParent) {
        dashCount = 3;
      }
    }

    if (rawDashCount === 2 && stack.length >= 1) {
      dashCount = stack.length >= 2 ? 3 : 2;
    }

    const targetDepth = dashCount - 1;
    stack.length = Math.max(0, targetDepth);
    stack[targetDepth] = name;

    if (targetDepth === 1) {
      subParent = name;
    } else if (targetDepth === 0) {
      subParent = null;
    }

    prevDashCount = dashCount;
    emit();
  }

  return paths;
}

let cachedPaths: EtsySellerCategoryPath[] | null = null;

/** All category paths from the bundled Etsy seller help export. */
export function listEtsySellerCategoryPaths(): EtsySellerCategoryPath[] {
  if (!cachedPaths) {
    cachedPaths = parseEtsySellerCategoryMarkdown(loadEtsySellerCategoriesMarkdown());
  }
  return cachedPaths;
}
