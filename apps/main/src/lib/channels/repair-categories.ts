import { prisma } from "database";
import { STORE_CATEGORIES } from "@/lib/store-categories";
import { resolveImportCategory } from "./import-listing";
import { applyRemoteQuantityToStoreItem } from "./apply-remote-listing";
import { getMemberConnectionContext } from "./connection";
import { getAdapter } from "./registry";
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

/**
 * Re-run import category resolution for linked items with missing or invalid subcategories.
 * Optionally recovers quantity when the channel still shows stock but INW is sold out.
 */
export async function repairMemberImportedCategories(
  memberId: string,
  options?: { storeItemIds?: string[] }
): Promise<CategoryRepairResult> {
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
  const remoteCache = new Map<ChannelProvider, Awaited<ReturnType<ReturnType<typeof getAdapter>["listRemoteListings"]>>>();

  for (const link of links) {
    const item = link.storeItem;
    if (!item || !needsCategoryRepair(item)) continue;

    const provider = link.provider as ChannelProvider;
    const assignment = await resolveImportCategory({
      provider,
      remoteLabel: link.remoteCategoryLabel,
      remoteSubLabel: link.remoteCategorySubLabel,
      title: item.title,
      description: item.description,
    });

    if (!assignment?.category) {
      skipped.push({ storeItemId: item.id, reason: "no_category_resolved" });
      continue;
    }

    await prisma.storeItem.update({
      where: { id: item.id },
      data: {
        category: assignment.category,
        subcategory: assignment.subcategory,
      },
    });

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
        const remote = remoteList?.find((r) => r.externalListingId === link.externalListingId);
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
