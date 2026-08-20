import { isEtsyWhoMade, normalizeEtsyWhenMade } from "@/lib/etsy-listing-options";

export type ListOnCategoryProvider = "etsy" | "ebay";

export type ListOnCategoryItem = {
  id: string;
  title: string;
  photos: string[];
  etsyTaxonomyId?: number | null;
  ebayCategoryId?: number | null;
  etsyWhoMade?: string | null;
  etsyWhenMade?: string | null;
  channelLinks?: { provider: string }[];
};

export type ListOnCategoryStep = {
  item: ListOnCategoryItem;
  provider: ListOnCategoryProvider;
};

export type ListOnCategoryAssignment = {
  storeItemId: string;
  etsyTaxonomyId?: number;
  ebayCategoryId?: number;
  etsyWhoMade?: string;
  etsyWhenMade?: string;
};

export function isListOnCategoryProvider(value: string): value is ListOnCategoryProvider {
  return value === "etsy" || value === "ebay";
}

export function itemNeedsEtsyCategory(item: ListOnCategoryItem): boolean {
  return item.etsyTaxonomyId == null || item.etsyTaxonomyId <= 0;
}

export function itemNeedsEbayCategory(item: ListOnCategoryItem): boolean {
  return item.ebayCategoryId == null || item.ebayCategoryId <= 0;
}

export function itemNeedsEtsyListingDetails(item: ListOnCategoryItem): boolean {
  return !isEtsyWhoMade(item.etsyWhoMade) || normalizeEtsyWhenMade(item.etsyWhenMade) == null;
}

export function itemNeedsListOnCategoryStep(
  item: ListOnCategoryItem,
  provider: ListOnCategoryProvider
): boolean {
  if (provider === "etsy") {
    return itemNeedsEtsyCategory(item) || itemNeedsEtsyListingDetails(item);
  }
  return itemNeedsEbayCategory(item);
}

/** Steps to collect missing Etsy/eBay categories (and Etsy who/when) before listing. */
export function buildListOnCategoryQueue(
  items: ListOnCategoryItem[],
  providers: string[]
): ListOnCategoryStep[] {
  const wanted = providers.filter(isListOnCategoryProvider);
  const steps: ListOnCategoryStep[] = [];
  for (const provider of wanted) {
    for (const item of items) {
      const linked = new Set((item.channelLinks ?? []).map((l) => l.provider));
      if (linked.has(provider)) continue;
      if (itemNeedsListOnCategoryStep(item, provider)) {
        steps.push({ item, provider });
      }
    }
  }
  return steps;
}

export function mergeListOnCategoryAssignment(
  current: ListOnCategoryAssignment | undefined,
  patch: ListOnCategoryAssignment
): ListOnCategoryAssignment {
  return { ...current, ...patch, storeItemId: patch.storeItemId };
}
