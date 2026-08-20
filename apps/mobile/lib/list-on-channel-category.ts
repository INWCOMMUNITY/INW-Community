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

export function mergeListOnCategoryAssignment(
  current: ListOnCategoryAssignment | undefined,
  patch: ListOnCategoryAssignment
): ListOnCategoryAssignment {
  return { ...current, ...patch, storeItemId: patch.storeItemId };
}
