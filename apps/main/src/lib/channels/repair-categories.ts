import { prisma } from "database";
import { STORE_CATEGORIES } from "@/lib/store-categories";
import { resolveImportCategory } from "./import-listing";
import { applyRemoteQuantityToStoreItem } from "./apply-remote-listing";
import { ensureChannelCategoryMappingsSeeded } from "./channel-category-mapping";
import { getMemberConnectionContext } from "./connection";
import { findEbayRemoteListing } from "./ebay/mapping";
import { getAdapter } from "./registry";
import { shouldBlockSoldOutQtyRecovery } from "./sold-out-guard";
import { fetchEbayItemDetails } from "./ebay/trading";
import { splitEbayCategoryPath } from "./ebay-category-aliases";
import type { ChannelProvider, RemoteListingSummary } from "./types";

export function isValidPresetSubcategory(
  category: string | null | undefined,
  subcategory: string | null | undefined
): boolean {
  const cat = category?.trim();
  const sub = subcategory?.trim();
  if (!cat || !sub) return false;
  const preset = STORE_CATEGORIES.find((c) => c.label === cat);
  if (!preset) return false;
  return preset.subcategories.includes(sub);
}

export function needsCategoryRepair(item: {
  category: string | null;
  subcategory: string | null;
}): boolean {
  if (!item.category?.trim()) return true;
  if (!item.subcategory?.trim()) return true;
  return !isValidPresetSubcategory(item.category, item.subcategory);
}

export type CategoryRepairResult = {
  repaired: Array<{
    storeItemId: string;
    category: string;
    subcategory: string | null;
    qtyRecovered: boolean;
  }>;
  skipped: Array<{ storeItemId: string; reason: string }>;
  checked: number;
};

export const LEGACY_PRESET_CATEGORY_REMAPS = [
  {
    fromCategory: "Books, Movies & Music",
    fromSubcategory: "Video Games",
    toCategory: "Video Games & Consoles",
    toSubcategory: "Games (physical)",
  },
  {
    fromCategory: "Toys & Games",
    fromSubcategory: "Video Games (physical)",
    toCategory: "Video Games & Consoles",
    toSubcategory: "Games (physical)",
  },
  {
    fromCategory: "Home & Kitchen",
    fromSubcategory: "Food & Drink",
    toCategory: "Food & Drink",
    toSubcategory: "Pantry & Packaged",
  },
  {
    fromCategory: "Home & Living",
    fromSubcategory: "Food & Drink (home)",
    toCategory: "Food & Drink",
    toSubcategory: "Other Food & Drink",
  },
] as const;

export function applyLegacyPresetRemap(
  category: string | null | undefined,
  subcategory: string | null | undefined
): { category: string; subcategory: string } | null {
  const cat = category?.trim() ?? "";
  const sub = subcategory?.trim() ?? "";
  if (!cat || !sub) return null;
  const hit = LEGACY_PRESET_CATEGORY_REMAPS.find(
    (r) => r.fromCategory === cat && r.fromSubcategory === sub
  );
  return hit ? { category: hit.toCategory, subcategory: hit.toSubcategory } : null;
}

type RemoteListCache = Map<ChannelProvider, RemoteListingSummary[]>;

async function remapLegacyPresetCategories(
  memberId: string
): Promise<CategoryRepairResult["repaired"]> {
  const repaired: CategoryRepairResult["repaired"] = [];
  for (const remap of LEGACY_PRESET_CATEGORY_REMAPS) {
    const items = await prisma.storeItem.findMany({
      where: {
        memberId,
        category: remap.fromCategory,
        subcategory: remap.fromSubcategory,
      },
      select: { id: true },
    });
    if (items.length === 0) continue;
    await prisma.storeItem.updateMany({
      where: { id: { in: items.map((i) => i.id) } },
      data: { category: remap.toCategory, subcategory: remap.toSubcategory },
    });
    for (const item of items) {
      repaired.push({
        storeItemId: item.id,
        category: remap.toCategory,
        subcategory: remap.toSubcategory,
        qtyRecovered: false,
      });
    }
  }
  return repaired;
}

async function loadRemoteListingsCached(
  cache: RemoteListCache,
  memberId: string,
  provider: ChannelProvider
): Promise<RemoteListingSummary[]> {
  const hit = cache.get(provider);
  if (hit) return hit;
  const ctx = await getMemberConnectionContext(memberId, provider);
  if (!ctx) {
    cache.set(provider, []);
    return [];
  }
  try {
    const list = await getAdapter(provider).listRemoteListings(ctx);
    cache.set(provider, list);
    return list;
  } catch (e) {
    console.warn("[repair-categories] listRemoteListings failed", { provider, error: e });
    cache.set(provider, []);
    return [];
  }
}

async function resolveRemoteCategoryForLink(args: {
  memberId: string;
  provider: ChannelProvider;
  externalListingId: string;
  remoteCategoryLabel: string | null;
  remoteCategorySubLabel: string | null;
  remoteCache: RemoteListCache;
}): Promise<{ remoteLabel: string | null; remoteSubLabel: string | null }> {
  let remoteLabel = args.remoteCategoryLabel?.trim() || null;
  let remoteSubLabel = args.remoteCategorySubLabel?.trim() || null;

  if (!remoteLabel) {
    try {
      const remoteList = await loadRemoteListingsCached(args.remoteCache, args.memberId, args.provider);
      const remote =
        args.provider === "ebay"
          ? findEbayRemoteListing(remoteList, args.externalListingId)
          : remoteList.find((r) => r.externalListingId === args.externalListingId);
      if (remote?.category?.trim()) {
        remoteLabel = remote.category.trim();
        remoteSubLabel = remote.subcategory?.trim() || remoteSubLabel;
      }
    } catch (e) {
      console.warn("[repair-categories] live listing category lookup failed", {
        provider: args.provider,
        externalListingId: args.externalListingId,
        error: e,
      });
    }
  }

  if (remoteLabel || args.provider !== "ebay") {
    return { remoteLabel, remoteSubLabel };
  }

  try {
    const ctx = await getMemberConnectionContext(args.memberId, "ebay");
    if (!ctx) return { remoteLabel, remoteSubLabel };

    const inwMatch = args.externalListingId.match(/^inw(\d+)$/i);
    const legacyId = inwMatch ? inwMatch[1]! : args.externalListingId;
    const details = await fetchEbayItemDetails(ctx.accessToken, legacyId);
    remoteLabel = details.categoryName?.trim() || null;
    remoteSubLabel = splitEbayCategoryPath(remoteLabel).subcategory;
  } catch (e) {
    console.warn("[repair-categories] failed to fetch eBay category", {
      externalListingId: args.externalListingId,
      error: e,
    });
  }

  return { remoteLabel, remoteSubLabel };
}

/**
 * Re-run import category resolution for linked items with missing or invalid subcategories.
 * Optionally recovers quantity when the channel still shows stock but INW is sold out.
 */
export async function repairMemberImportedCategories(
  memberId: string,
  options?: { storeItemIds?: string[] }
): Promise<CategoryRepairResult> {
  await ensureChannelCategoryMappingsSeeded();

  const remapped = await remapLegacyPresetCategories(memberId);
  const remappedIds = new Set(remapped.map((r) => r.storeItemId));

  const links = await prisma.channelListingLink.findMany({
    where: {
      storeItem: { memberId },
      ...(options?.storeItemIds?.length ? { storeItemId: { in: options.storeItemIds } } : {}),
    },
    include: {
      storeItem: {
        select: {
          id: true,
          title: true,
          description: true,
          category: true,
          subcategory: true,
          quantity: true,
          status: true,
        },
      },
    },
  });

  const repaired: CategoryRepairResult["repaired"] = remapped.filter(
    (r) => !options?.storeItemIds?.length || options.storeItemIds.includes(r.storeItemId)
  );
  const skipped: CategoryRepairResult["skipped"] = [];
  const remoteCache: RemoteListCache = new Map();

  for (const link of links) {
    const item = link.storeItem;
    if (!item || remappedIds.has(item.id) || !needsCategoryRepair(item)) continue;

    const provider = link.provider as ChannelProvider;
    const { remoteLabel, remoteSubLabel } = await resolveRemoteCategoryForLink({
      memberId,
      provider,
      externalListingId: link.externalListingId,
      remoteCategoryLabel: link.remoteCategoryLabel,
      remoteCategorySubLabel: link.remoteCategorySubLabel,
      remoteCache,
    });

    const assignment = await resolveImportCategory({
      provider,
      remoteLabel,
      remoteSubLabel,
      title: item.title,
      description: item.description,
    });

    if (!assignment?.category) {
      skipped.push({ storeItemId: item.id, reason: "no_category_resolved" });
      continue;
    }
    if (!assignment.subcategory) {
      skipped.push({ storeItemId: item.id, reason: "no_subcategory_resolved" });
      continue;
    }

    await prisma.storeItem.update({
      where: { id: item.id },
      data: {
        category: assignment.category,
        subcategory: assignment.subcategory,
      },
    });

    if (remoteLabel && remoteLabel !== link.remoteCategoryLabel) {
      await prisma.channelListingLink
        .update({
          where: { id: link.id },
          data: {
            remoteCategoryLabel: remoteLabel.slice(0, 500),
            remoteCategorySubLabel: remoteSubLabel?.slice(0, 200) ?? null,
          },
        })
        .catch(() => {});
    }

    let qtyRecovered = false;
    if (item.quantity === 0 && item.status === "sold_out") {
      const blockRecovery = await shouldBlockSoldOutQtyRecovery(item.id);
      if (!blockRecovery) {
        try {
          const remoteList = await loadRemoteListingsCached(remoteCache, memberId, provider);
          const remote =
            provider === "ebay"
              ? findEbayRemoteListing(remoteList, link.externalListingId)
              : remoteList.find((r) => r.externalListingId === link.externalListingId);
          if (remote && remote.quantityKnown !== false && remote.quantity > 0) {
            qtyRecovered = await applyRemoteQuantityToStoreItem(item.id, remote.quantity, {
              provider,
              memberId,
            });
          }
        } catch (e) {
          console.warn("[repair-categories] qty recovery failed", { storeItemId: item.id, error: e });
        }
      }
    }

    repaired.push({
      storeItemId: item.id,
      category: assignment.category,
      subcategory: assignment.subcategory,
      qtyRecovered,
    });
  }

  return { repaired, skipped, checked: links.length };
}
