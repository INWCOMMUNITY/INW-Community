import { cache } from "react";
import { prisma, Prisma } from "database";
import { listingDisplayPhotos } from "@/lib/listing-display-photo";
import { listingDescriptionPreview } from "@/lib/channels/rich-description";

export const BROWSE_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
};

export const META_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
};

type VariantEntry = { name?: string; options?: string[] | { value: string; quantity: number }[] };

export function getSizesFromVariants(variants: unknown): string[] {
  if (!variants || !Array.isArray(variants)) return [];
  const sizes: string[] = [];
  for (const v of variants as VariantEntry[]) {
    const name = (v?.name ?? "").trim().toLowerCase();
    if (name !== "size" || !Array.isArray(v?.options)) continue;
    for (const opt of v.options) {
      if (opt == null) continue;
      const val = typeof opt === "object" && "value" in opt ? (opt as { value: string }).value : opt;
      if (String(val).trim()) sizes.push(String(val).trim());
    }
  }
  return sizes;
}

export function itemHasSize(item: { id?: string; variants?: unknown }, size: string): boolean {
  const sizes = getSizesFromVariants(item.variants);
  return sizes.some((s) => s.toLowerCase() === size.toLowerCase());
}

export function passesPublicStorefrontSlugFilter(item: { slug: string }): boolean {
  const s = item.slug.toLowerCase();
  return !s.includes("trial") && !s.includes("test-resale");
}

export const publicBrowseCategoryWhere: Prisma.StoreItemWhereInput = {
  AND: [
    { OR: [{ category: null }, { category: { not: "Test" } }] },
    { OR: [{ secondaryCategory: null }, { secondaryCategory: { not: "Test" } }] },
  ],
};

const publicBrowseCardSelect = {
  id: true,
  title: true,
  slug: true,
  description: true,
  photos: true,
  category: true,
  subcategory: true,
  priceCents: true,
  quantity: true,
  member: { select: { sellerTimeAway: true } },
  business: { select: { name: true, slug: true } },
} satisfies Prisma.StoreItemSelect;

const publicBrowseSelectWithVariants = {
  ...publicBrowseCardSelect,
  variants: true,
} satisfies Prisma.StoreItemSelect;

export function toPublicBrowseCard(item: {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  photos: string[];
  category: string | null;
  subcategory: string | null;
  priceCents: number;
  quantity: number;
  business: { name: string; slug: string } | null;
}) {
  const preview = listingDescriptionPreview(item.description);
  return {
    id: item.id,
    title: item.title,
    slug: item.slug,
    description: preview && preview.length > 160 ? `${preview.slice(0, 157)}…` : preview,
    photos: listingDisplayPhotos(item.photos, "card", 2),
    category: item.category,
    subcategory: item.subcategory,
    priceCents: item.priceCents,
    quantity: item.quantity,
    business: item.business,
  };
}

export type PublicBrowseCard = ReturnType<typeof toPublicBrowseCard>;

export function passesSellerTimeAwayForPurchases(item: {
  member?: { sellerTimeAway?: { startAt: Date; endAt: Date } | null } | null;
}): boolean {
  const now = new Date();
  const ta = item.member?.sellerTimeAway;
  if (!ta) return true;
  const start = new Date(ta.startAt);
  const end = new Date(ta.endAt);
  if (now < start || now > end) return true;
  return false;
}

export type BrowseCategoryRow = { label: string; subcategories: string[] };

export function buildBrowseCategoriesFromItems(
  items: { category: string | null; subcategory: string | null; secondaryCategory: string | null }[]
): BrowseCategoryRow[] {
  const byCat = new Map<string, Set<string>>();
  for (const item of items) {
    const cat = item.category?.trim();
    if (cat) {
      if (!byCat.has(cat)) byCat.set(cat, new Set());
      const sub = item.subcategory?.trim();
      if (sub) byCat.get(cat)!.add(sub);
    }
    const sec = item.secondaryCategory?.trim();
    if (sec && sec !== cat) {
      if (!byCat.has(sec)) byCat.set(sec, new Set());
    }
  }
  return Array.from(byCat.entries())
    .map(([label, subs]) => ({
      label,
      subcategories: Array.from(subs).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

const sellerCanReceivePayment = { member: { stripeConnectAccountId: { not: null } } };

export type BrowseMeta = {
  categories: string[];
  browseByCategories: BrowseCategoryRow[];
  sizes: string[];
};

export type SpotlightSeller = {
  memberId: string;
  name: string;
  logoUrl: string | null;
  businessSlug: string | null;
  itemCount: number;
  memberSince: number;
};

const BROWSE_TTL_MS = 30_000;
const BROWSE_META_TTL_MS = 5 * 60 * 1000;

let browseMetaCache: { at: number; value: BrowseMeta } | null = null;
const featuredCardsCache = new Map<number, { at: number; value: PublicBrowseCard[] }>();
const spotlightCache = new Map<number, { at: number; value: SpotlightSeller[] }>();
const publicBrowseCache = new Map<string, { at: number; value: PublicBrowseCard[] }>();

function ttlGet<T>(entry: { at: number; value: T } | undefined, ttlMs: number): T | undefined {
  if (!entry || Date.now() - entry.at >= ttlMs) return undefined;
  return entry.value;
}

function ttlSet<K extends string | number, T>(
  map: Map<K, { at: number; value: T }>,
  key: K,
  value: T,
  max = 80
) {
  if (map.size >= max) {
    const first = map.keys().next().value;
    if (first !== undefined) map.delete(first);
  }
  map.set(key, { at: Date.now(), value });
}

export async function getStorefrontBrowseMeta(condition?: "new" | "used" | null): Promise<BrowseMeta> {
  const listingWhere = condition ? ({ condition } as const) : ({} as const);
  const cacheOk = !condition && browseMetaCache && Date.now() - browseMetaCache.at < BROWSE_META_TTL_MS;
  if (cacheOk && browseMetaCache) return browseMetaCache.value;

  const [browseItems, variantItems] = await Promise.all([
    prisma.storeItem.findMany({
      where: {
        status: "active",
        quantity: { gt: 0 },
        ...listingWhere,
        ...sellerCanReceivePayment,
        AND: [publicBrowseCategoryWhere],
      },
      select: {
        category: true,
        subcategory: true,
        secondaryCategory: true,
        slug: true,
        member: { select: { sellerTimeAway: true } },
      },
    }),
    prisma.storeItem.findMany({
      where: {
        status: "active",
        quantity: { gt: 0 },
        variants: { not: Prisma.JsonNull },
        ...listingWhere,
        AND: [publicBrowseCategoryWhere],
        ...sellerCanReceivePayment,
      },
      select: { variants: true, slug: true, member: { select: { sellerTimeAway: true } } },
    }),
  ]);
  const visibleForBrowse = browseItems.filter(
    (i) => passesPublicStorefrontSlugFilter(i) && passesSellerTimeAwayForPurchases(i)
  );
  const browseByCategories = buildBrowseCategoriesFromItems(visibleForBrowse);
  const visibleForSizes = variantItems.filter(
    (i) => passesPublicStorefrontSlugFilter(i) && passesSellerTimeAwayForPurchases(i)
  );
  const sizeSet = new Set<string>();
  for (const i of visibleForSizes) {
    getSizesFromVariants(i.variants).forEach((s) => sizeSet.add(s));
  }
  const value: BrowseMeta = {
    categories: browseByCategories.map((c) => c.label),
    browseByCategories,
    sizes: Array.from(sizeSet).sort(),
  };
  if (!condition) browseMetaCache = { at: Date.now(), value };
  return value;
}

export async function getFeaturedBrowseCards(limit = 20): Promise<PublicBrowseCard[]> {
  const cached = ttlGet(featuredCardsCache.get(limit), BROWSE_TTL_MS);
  if (cached) return cached;
  let items = await prisma.storeItem.findMany({
    where: {
      featured: true,
      status: "active",
      quantity: { gt: 0 },
      ...sellerCanReceivePayment,
      AND: [publicBrowseCategoryWhere],
    },
    select: publicBrowseCardSelect,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  items = items.filter(
    (item) => passesPublicStorefrontSlugFilter(item) && passesSellerTimeAwayForPurchases(item)
  );
  const cards = items.map(toPublicBrowseCard);
  ttlSet(featuredCardsCache, limit, cards);
  return cards;
}

export async function getRecentBrowseCards(limit = 10): Promise<PublicBrowseCard[]> {
  let items = await prisma.storeItem.findMany({
    where: {
      status: "active",
      quantity: { gt: 0 },
      ...sellerCanReceivePayment,
      AND: [publicBrowseCategoryWhere],
    },
    select: publicBrowseCardSelect,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  items = items.filter(
    (item) => passesPublicStorefrontSlugFilter(item) && passesSellerTimeAwayForPurchases(item)
  );
  return items.map(toPublicBrowseCard);
}

export async function getSellerSpotlight(limit = 12): Promise<SpotlightSeller[]> {
  const cached = ttlGet(spotlightCache.get(limit), BROWSE_TTL_MS);
  if (cached) return cached;
  const sellers = await prisma.member.findMany({
    where: {
      stripeConnectAccountId: { not: null },
      storeItemsSold: {
        some: {
          status: "active",
          quantity: { gt: 0 },
          AND: [publicBrowseCategoryWhere],
        },
      },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      createdAt: true,
      sellerTimeAway: true,
      businesses: {
        take: 1,
        select: { id: true, name: true, slug: true, logoUrl: true },
      },
      _count: {
        select: {
          storeItemsSold: {
            where: { status: "active", quantity: { gt: 0 } },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const now = new Date();
  const activeSellers = sellers.filter((s) => {
    const ta = s.sellerTimeAway;
    if (!ta) return true;
    const start = new Date(ta.startAt);
    const end = new Date(ta.endAt);
    return now < start || now > end;
  });
  const value = activeSellers.map((s) => ({
    memberId: s.id,
    name: s.businesses[0]?.name || `${s.firstName} ${s.lastName}`,
    logoUrl: s.businesses[0]?.logoUrl || null,
    businessSlug: s.businesses[0]?.slug || null,
    itemCount: s._count.storeItemsSold,
    memberSince: s.createdAt.getFullYear(),
  }));
  ttlSet(spotlightCache, limit, value);
  return value;
}

export type PublicBrowseQuery = {
  category?: string;
  subcategory?: string;
  size?: string;
  search?: string;
  condition?: "new" | "used" | null;
  memberId?: string;
  excludeId?: string;
  localDelivery?: boolean;
  shippingOnly?: boolean;
  minPriceCents?: number | null;
  maxPriceCents?: number | null;
  sort?: string | null;
  limit?: number;
  offset?: number;
};

export async function getPublicBrowseCards(query: PublicBrowseQuery): Promise<PublicBrowseCard[]> {
  const cacheKey = JSON.stringify({
    category: query.category ?? "",
    subcategory: query.subcategory ?? "",
    size: query.size ?? "",
    search: query.search ?? "",
    condition: query.condition ?? "",
    memberId: query.memberId ?? "",
    excludeId: query.excludeId ?? "",
    localDelivery: Boolean(query.localDelivery),
    shippingOnly: Boolean(query.shippingOnly),
    minPriceCents: query.minPriceCents ?? null,
    maxPriceCents: query.maxPriceCents ?? null,
    sort: query.sort ?? "",
    limit: query.limit ?? 48,
    offset: query.offset ?? 0,
  });
  const cached = ttlGet(publicBrowseCache.get(cacheKey), BROWSE_TTL_MS);
  if (cached) return cached;

  const categoryTrim = query.category?.trim() || "";
  const subcategoryTrim = query.subcategory?.trim() || "";
  const search = query.search?.trim();
  const size = query.size?.trim();
  const listingWhere = query.condition ? ({ condition: query.condition } as const) : ({} as const);
  const listLimit = Math.min(Math.max(query.limit ?? 48, 1), 100);
  const listOffset = Math.max(query.offset ?? 0, 0);

  const listAndConditions: Prisma.StoreItemWhereInput[] = [publicBrowseCategoryWhere];
  if (categoryTrim && !subcategoryTrim) {
    listAndConditions.push({
      OR: [{ category: categoryTrim }, { secondaryCategory: categoryTrim }],
    });
  }
  if (categoryTrim && subcategoryTrim) {
    listAndConditions.push({ category: categoryTrim, subcategory: subcategoryTrim });
  }
  if (search) {
    listAndConditions.push({
      OR: [
        { title: { contains: search } },
        { description: { contains: search } },
        { category: { contains: search } },
        { secondaryCategory: { contains: search } },
        { subcategory: { contains: search } },
      ],
    });
  }

  const orderBy: Prisma.StoreItemOrderByWithRelationInput =
    query.sort === "price_asc"
      ? { priceCents: "asc" }
      : query.sort === "price_desc"
        ? { priceCents: "desc" }
        : { createdAt: "desc" };

  const minPriceCents = query.minPriceCents ?? null;
  const maxPriceCents = query.maxPriceCents ?? null;

  let items = await prisma.storeItem.findMany({
    where: {
      status: "active",
      quantity: { gt: 0 },
      ...listingWhere,
      ...sellerCanReceivePayment,
      AND: listAndConditions,
      ...(query.memberId ? { memberId: query.memberId } : {}),
      ...(query.excludeId ? { id: { not: query.excludeId } } : {}),
      ...(query.localDelivery ? { localDeliveryAvailable: true } : {}),
      ...(query.shippingOnly
        ? { shippingDisabled: false, localDeliveryAvailable: false, inStorePickupAvailable: false }
        : {}),
      ...(minPriceCents !== null && !Number.isNaN(minPriceCents) ? { priceCents: { gte: minPriceCents } } : {}),
      ...(maxPriceCents !== null && !Number.isNaN(maxPriceCents)
        ? { priceCents: { ...(minPriceCents !== null ? { gte: minPriceCents } : {}), lte: maxPriceCents } }
        : {}),
    },
    select: size ? publicBrowseSelectWithVariants : publicBrowseCardSelect,
    orderBy,
    ...(size
      ? { take: Math.min(listOffset + listLimit + 80, 250) }
      : { skip: listOffset, take: listLimit }),
  });
  items = items.filter(
    (item) => passesPublicStorefrontSlugFilter(item) && passesSellerTimeAwayForPurchases(item)
  );
  if (size) {
    items = items.filter((item) => itemHasSize(item, size));
    items = items.slice(listOffset, listOffset + listLimit);
  }
  const cards = items.map(toPublicBrowseCard);
  ttlSet(publicBrowseCache, cacheKey, cards);
  return cards;
}

export async function getPublicBrowseCardsByIds(ids: string[]): Promise<PublicBrowseCard[]> {
  if (ids.length === 0) return [];
  const items = await prisma.storeItem.findMany({
    where: {
      id: { in: ids },
      status: "active",
      quantity: { gt: 0 },
      ...sellerCanReceivePayment,
    },
    select: publicBrowseCardSelect,
    orderBy: { createdAt: "desc" },
  });
  return items
    .filter((item) => passesSellerTimeAwayForPurchases(item))
    .map(toPublicBrowseCard);
}

/** Deduped storefront home payload for the server page. */
export const getStorefrontHomeData = cache(async function getStorefrontHomeData(
  query: PublicBrowseQuery
) {
  const [featured, items, meta, spotlight] = await Promise.all([
    getFeaturedBrowseCards(20),
    getPublicBrowseCards({ ...query, limit: query.limit ?? 48, offset: query.offset ?? 0 }),
    getStorefrontBrowseMeta(query.condition),
    getSellerSpotlight(12),
  ]);
  return { featured, items, meta, spotlight };
});
