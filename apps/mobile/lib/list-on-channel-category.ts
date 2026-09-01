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
  aspects?: { name: string; value: string }[] | unknown;
  channelLinks?: { provider: string }[];
};

export type ListOnCategoryStep = {
  item: ListOnCategoryItem;
  provider: ListOnCategoryProvider;
  /** Names eBay already asked for (Needs Attention / publish error). Used if taxonomy fails. */
  requiredAspectNames?: string[];
};

export type ListOnCategoryAssignment = {
  storeItemId: string;
  etsyTaxonomyId?: number;
  ebayCategoryId?: number;
  etsyWhoMade?: string;
  etsyWhenMade?: string;
  aspects?: { name: string; value: string }[];
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

export function itemHasEbayAspectValue(item: ListOnCategoryItem, name: string): boolean {
  const rows = Array.isArray(item.aspects) ? item.aspects : [];
  const want = name.trim().toLowerCase();
  return rows.some(
    (row) =>
      row &&
      typeof row === "object" &&
      "name" in row &&
      "value" in row &&
      String((row as { name?: unknown }).name ?? "").trim().toLowerCase() === want &&
      String((row as { value?: unknown }).value ?? "").trim().length > 0
  );
}

/** Type/Brand are often required at eBay publish even when a category is already saved. */
export function itemNeedsEbayListingDetails(item: ListOnCategoryItem): boolean {
  const hasType = itemHasEbayAspectValue(item, "Type");
  const hasBrand = itemHasEbayAspectValue(item, "Brand") || itemHasEbayAspectValue(item, "Brand Name");
  return !hasType || !hasBrand;
}

export function itemNeedsListOnCategoryStep(
  item: ListOnCategoryItem,
  provider: ListOnCategoryProvider
): boolean {
  if (provider === "etsy") {
    return itemNeedsEtsyCategory(item) || itemNeedsEtsyListingDetails(item);
  }
  return itemNeedsEbayCategory(item) || itemNeedsEbayListingDetails(item);
}

export function isMissingEbayItemSpecificsError(message: string | null | undefined): boolean {
  return /Missing required eBay item specifics/i.test(message ?? "");
}

export function isEbayRateLimitError(message: string | null | undefined): boolean {
  return /#2001\b|HTTP 429|request limit has been reached|temporarily limiting requests|busy right now/i.test(
    message ?? ""
  );
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

/** Per-item desired stores (Manage Listings). Queues adds that still need a category or eBay specifics. */
export function buildListOnCategoryQueueFromDesired(
  items: ListOnCategoryItem[],
  desiredProvidersByItemId: Record<string, string[]>
): ListOnCategoryStep[] {
  const steps: ListOnCategoryStep[] = [];
  for (const item of items) {
    const desired = (desiredProvidersByItemId[item.id] ?? []).filter(isListOnCategoryProvider);
    const linked = new Set((item.channelLinks ?? []).map((l) => l.provider));
    for (const provider of desired) {
      if (linked.has(provider)) {
        if (provider === "ebay" && itemNeedsEbayListingDetails(item)) {
          steps.push({ item, provider });
        }
        continue;
      }
      if (itemNeedsListOnCategoryStep(item, provider)) {
        steps.push({ item, provider });
      }
    }
  }
  return steps;
}

/** After eBay rejects missing item specifics, always open the picker for those items. */
export function buildListOnCategoryQueueFromFailedSpecifics(
  items: ListOnCategoryItem[],
  failedItemIds: Iterable<string>
): ListOnCategoryStep[] {
  const failed = new Set(failedItemIds);
  return items.filter((item) => failed.has(item.id)).map((item) => ({ item, provider: "ebay" as const }));
}

export function isEbaySpecificsAttentionItem(item: {
  provider: string;
  storeItemId: string | null;
  action?: string;
  fields?: { key: string }[];
  syncError?: string | null;
  summary?: string;
}): boolean {
  if (item.provider !== "ebay" || !item.storeItemId) return false;
  if (item.fields?.some((field) => field.key.startsWith("aspect:"))) return true;
  return isMissingEbayItemSpecificsError(`${item.syncError ?? ""} ${item.summary ?? ""}`);
}

export function listOnStepFromEbayAttentionItem(item: {
  storeItemId: string;
  title: string;
  photo?: string | null;
  photos?: string[];
  ebayCategoryId?: number | null;
  aspects?: unknown;
  fields?: { key: string }[];
}): ListOnCategoryStep {
  const requiredAspectNames = (item.fields ?? [])
    .filter((field) => field.key.startsWith("aspect:"))
    .map((field) => field.key.slice("aspect:".length))
    .filter(Boolean);
  return {
    item: {
      id: item.storeItemId,
      title: item.title,
      photos: item.photos?.length ? item.photos : item.photo ? [item.photo] : [],
      ebayCategoryId: item.ebayCategoryId ?? null,
      aspects: item.aspects,
    },
    provider: "ebay",
    requiredAspectNames: requiredAspectNames.length > 0 ? requiredAspectNames : ["Type", "Brand"],
  };
}

export function mergeListOnCategoryAssignment(
  current: ListOnCategoryAssignment | undefined,
  patch: ListOnCategoryAssignment
): ListOnCategoryAssignment {
  return { ...current, ...patch, storeItemId: patch.storeItemId };
}
