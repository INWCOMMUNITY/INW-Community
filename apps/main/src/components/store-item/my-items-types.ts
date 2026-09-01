import { isEbayConditionSyncError } from "@/lib/channels/ebay/conditions";
import type { ItemChannelLink } from "@/components/store-item/ItemChannelSyncBadges";
import { buildProductHref } from "@/lib/product-referrer";

export type ItemsTab = "active" | "attention" | "ended" | "sold";

export function itemRemoteDeletedProvider(item: Pick<MyStoreItem, "channelLinks">): string | null {
  return item.channelLinks?.find((l) => l.remoteDeletedProvider)?.remoteDeletedProvider ?? null;
}

export function itemOtherLiveProviders(
  item: Pick<MyStoreItem, "channelLinks">,
  deletedProvider: string
): string[] {
  const seen = new Set<string>();
  for (const link of item.channelLinks ?? []) {
    if (link.provider === deletedProvider) continue;
    if (!link.syncEnabled) continue;
    if (link.remoteDeletedProvider) continue;
    seen.add(link.provider);
  }
  return [...seen];
}

export type MyStoreItem = {
  id: string;
  title: string;
  slug: string;
  priceCents: number;
  quantity: number;
  status: string;
  photos: string[];
  soldOrderId?: string;
  soldAt?: string;
  etsyTaxonomyId?: number | null;
  ebayCategoryId?: number | null;
  etsyWhoMade?: string | null;
  etsyWhenMade?: string | null;
  aspects?: { name: string; value: string }[] | unknown;
  channelLinks?: ItemChannelLink[];
};

export function itemStatusLabel(item: MyStoreItem, tab: ItemsTab): string {
  if (tab === "sold" || item.status === "sold_out") return "Sold";
  if (item.status === "inactive") return "Ended";
  if (item.quantity <= 0) return "Out of stock";
  return "Active";
}

export function itemEditHref(item: MyStoreItem): string {
  const needsConditionFix = item.channelLinks?.some(
    (l) => l.provider === "ebay" && l.syncStatus === "error" && isEbayConditionSyncError(l.syncError)
  );
  return needsConditionFix
    ? `/seller-hub/store/${item.id}?fixEbayCondition=1`
    : `/seller-hub/store/${item.id}`;
}

export function itemListingHref(item: Pick<MyStoreItem, "slug">): string {
  return buildProductHref(item.slug, { type: "my-items" });
}
