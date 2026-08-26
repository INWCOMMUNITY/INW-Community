export type StorefrontSearchTier = "title" | "category" | "description" | "none";

export type StorefrontSearchableItem = {
  title: string;
  description?: string | null;
  category?: string | null;
  secondaryCategory?: string | null;
  subcategory?: string | null;
  priceCents?: number;
  createdAt?: Date | string;
};

const TIER_RANK: Record<StorefrontSearchTier, number> = {
  title: 0,
  category: 1,
  description: 2,
  none: 3,
};

export function normalizeStorefrontSearch(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function fieldContains(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack || !needle) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function storefrontSearchTier(
  item: StorefrontSearchableItem,
  query: string
): StorefrontSearchTier {
  const needle = normalizeStorefrontSearch(query);
  if (!needle) return "none";
  if (fieldContains(item.title, needle)) return "title";
  if (
    fieldContains(item.category, needle) ||
    fieldContains(item.secondaryCategory, needle) ||
    fieldContains(item.subcategory, needle)
  ) {
    return "category";
  }
  if (fieldContains(item.description, needle)) return "description";
  return "none";
}

export function hasExactTitleMatch(
  items: Array<{ title: string }>,
  query: string
): boolean {
  const needle = normalizeStorefrontSearch(query);
  if (!needle) return false;
  return items.some((item) => fieldContains(item.title, needle));
}

export function sortByStorefrontSearchRelevance<T extends StorefrontSearchableItem>(
  items: T[],
  query: string,
  sort?: string | null
): T[] {
  const needle = normalizeStorefrontSearch(query);
  if (!needle) return items;
  return [...items].sort((a, b) => {
    const tierDiff = TIER_RANK[storefrontSearchTier(a, needle)] - TIER_RANK[storefrontSearchTier(b, needle)];
    if (tierDiff !== 0) return tierDiff;
    if (sort === "price_asc") return (a.priceCents ?? 0) - (b.priceCents ?? 0);
    if (sort === "price_desc") return (b.priceCents ?? 0) - (a.priceCents ?? 0);
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
}

export function storefrontCloseMatchNote(
  query: string,
  items: Array<{ title: string }>
): string | null {
  const needle = normalizeStorefrontSearch(query);
  if (!needle || items.length === 0) return null;
  if (hasExactTitleMatch(items, needle)) return null;
  return `No exact matches for "${needle}", these might be close!`;
}
