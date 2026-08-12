import { prisma } from "database";
import { STORE_CATEGORIES } from "@/lib/store-categories";
import { resolveImportCategory } from "./import-listing";
import { applyRemoteQuantityToStoreItem } from "./apply-remote-listing";
import { ensureChannelCategoryMappingsSeeded } from "./channel-category-mapping";
import { getMemberConnectionContext } from "./connection";
import { findEbayRemoteListing } from "./ebay/mapping";
import { getAdapter } from "./registry";
import { fetchEbayItemDetails } from "./ebay/trading";
import { splitEbayCategoryPath } from "./ebay-category-aliases";
import type { ChannelProvider } from "./types";

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

async function resolveRemoteCategoryForLink(args: {
  memberId: string;
  provider: ChannelProvider;
  externalListingId: string;
  remoteCategoryLabel: string | null;
  remoteCategorySubLabel: string | null;
}): Promise<{ remoteLabel: string | null; remoteSubLabel: string | null }> {
  let remoteLabel = args.remoteCategoryLabel?.trim() || null;
  let remoteSubLabel = args.remoteCategorySubLabel?.trim() || null;

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

  const repaired: CategoryRepairResult["repaired"] = [];
  const skipped: CategoryRepairResult["skipped"] = [];
  const remoteCache = new Map<
    ChannelProvider,
    Awaited<ReturnType<ReturnType<typeof getAdapter>["listRemoteListings"]>>
  >();

  for (const link of links) {
    const item = link.storeItem;
    if (!item || !needsCategoryRepair(item)) continue;

    const provider = link.provider as ChannelProvider;
    const { remoteLabel, remoteSubLabel } = await resolveRemoteCategoryForLink({
      memberId,
      provider,
      externalListingId: link.externalListingId,
      remoteCategoryLabel: link.remoteCategoryLabel,
      remoteCategorySubLabel: link.remoteCategorySubLabel,
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
      try {
        let remoteList = remoteCache.get(provider);
        if (!remoteList) {
          const ctx = await getMemberConnectionContext(memberId, provider);
          if (ctx) {
            remoteList = await getAdapter(provider).listRemoteListings(ctx);
            remoteCache.set(provider, remoteList);
          }
        }
        const remote =
          provider === "ebay"
            ? findEbayRemoteListing(remoteList ?? [], link.externalListingId)
            : remoteList?.find((r) => r.externalListingId === link.externalListingId);
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

    repaired.push({
      storeItemId: item.id,
      category: assignment.category,
      subcategory: assignment.subcategory,
      qtyRecovered,
    });
  }

  return { repaired, skipped, checked: links.length };
}
