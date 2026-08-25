import { isEbayConditionSyncError } from "@/lib/channels/ebay/conditions";
import type { ItemChannelLink } from "@/components/store-item/ItemChannelSyncBadges";
import { buildProductHref } from "@/lib/product-referrer";

export type ItemsTab = "active" | "ended" | "sold";

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
