import type { SyncStoreItem } from "./types";

/** Fields selected from StoreItem for channel mapping (use with prisma select/include). */
export const syncStoreItemSelect = {
  id: true,
  title: true,
  description: true,
  photos: true,
  priceCents: true,
  quantity: true,
  variants: true,
  status: true,
  condition: true,
  shippingCostCents: true,
  etsyWhoMade: true,
  etsyWhenMade: true,
  etsyIsSupply: true,
  etsyTaxonomyId: true,
  ebayCategoryId: true,
} as const;

type StoreItemLike = {
  id: string;
  title: string;
  description: string | null;
  photos: string[];
  priceCents: number;
  quantity: number;
  variants: unknown;
  status: string;
  condition: string | null;
  shippingCostCents: number | null;
  etsyWhoMade: string | null;
  etsyWhenMade: string | null;
  etsyIsSupply: boolean | null;
  etsyTaxonomyId: number | null;
  ebayCategoryId: number | null;
};

export function toSyncStoreItem(item: StoreItemLike): SyncStoreItem {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    photos: Array.isArray(item.photos) ? item.photos : [],
    priceCents: item.priceCents,
    quantity: item.quantity,
    variants: item.variants,
    status: item.status,
    condition: item.condition,
    shippingCostCents: item.shippingCostCents,
    etsyWhoMade: item.etsyWhoMade,
    etsyWhenMade: item.etsyWhenMade,
    etsyIsSupply: item.etsyIsSupply,
    etsyTaxonomyId: item.etsyTaxonomyId,
    ebayCategoryId: item.ebayCategoryId,
  };
}
