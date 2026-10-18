import { cache } from "react";
import { prisma } from "database";
import { publicBuyerFieldsFromRows } from "database/src/public-buyer-fields";
import { listingDisplayPhoto } from "@/lib/listing-display-photo";
import { listingDescriptionPreview } from "@/lib/listing-description-preview";
import { includeUnavailableVisibleToViewer, withPublicStockWhere } from "@/lib/store-item-public-access";
import { freeShippingBannerForStore, type FreeShippingBanner } from "@/lib/free-shipping-banner";

const storeItemPublicSelect = {
  id: true,
  memberId: true,
  title: true,
  slug: true,
  status: true,
  description: true,
  aspects: true,
  photos: true,
  category: true,
  condition: true,
  priceCents: true,
  quantity: true,
  inventoryTracking: true,
  variants: true,
  shippingCostCents: true,
  shippingPolicy: true,
  localDeliveryAvailable: true,
  localDeliveryFeeCents: true,
  inStorePickupAvailable: true,
  shippingDisabled: true,
  localDeliveryTerms: true,
  pickupTerms: true,
  buyerFields: {
    orderBy: { position: "asc" },
    select: {
      id: true,
      position: true,
      kind: true,
      title: true,
      instructions: true,
      required: true,
      maxCharacters: true,
      maxFiles: true,
      labelEachFile: true,
      options: {
        orderBy: { position: "asc" },
        select: { id: true, label: true, position: true, required: true },
      },
    },
  },
  member: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      sellerShippingPolicy: true,
      sellerLocalDeliveryPolicy: true,
      offerLocalDelivery: true,
      sellerPickupPolicy: true,
      sellerReturnPolicy: true,
      acceptReturns: true,
      acceptReturnsDays: true,
      freeShippingMinimumCents: true,
      offerFreeShippingOnInw: true,
    },
  },
  business: {
    select: {
      id: true,
      name: true,
      slug: true,
      phone: true,
      email: true,
      website: true,
      address: true,
      logoUrl: true,
      fullDescription: true,
    },
  },
} as const;

export type StoreItemPublicPayload = {
  id: string;
  memberId: string;
  title: string;
  slug: string;
  status?: string;
  description: string | null;
  aspects?: unknown;
  photos: string[];
  category: string | null;
  condition?: "new" | "used";
  priceCents: number;
  quantity: number;
  inventoryTracking?: string | null;
  variants?: unknown;
  shippingCostCents: number | null;
  shippingPolicy: string | null;
  localDeliveryAvailable: boolean;
  localDeliveryFeeCents?: number | null;
  inStorePickupAvailable?: boolean;
  shippingDisabled?: boolean;
  localDeliveryTerms?: string | null;
  pickupTerms?: string | null;
  member?: {
    id: string;
    firstName: string;
    lastName: string;
    sellerShippingPolicy?: string | null;
    sellerLocalDeliveryPolicy?: string | null;
    offerLocalDelivery?: boolean | null;
    sellerPickupPolicy?: string | null;
    sellerReturnPolicy?: string | null;
    acceptReturns?: boolean | null;
    acceptReturnsDays?: number | null;
    freeShippingMinimumCents?: number | null;
    offerFreeShippingOnInw?: boolean | null;
  } | null;
  freeShippingBanner?: FreeShippingBanner | null;
  business?: {
    id: string;
    name: string;
    slug: string;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    address?: string | null;
    logoUrl?: string | null;
    fullDescription?: string | null;
  } | null;
  saveCount?: number;
  unavailable?: boolean;
  soldAt?: string;
  buyerFields?: ReturnType<typeof publicBuyerFieldsFromRows>;
};

async function resolveBusiness(
  business: StoreItemPublicPayload["business"],
  memberId: string | null
) {
  if (business || !memberId) return business ?? null;
  return prisma.business.findFirst({
    where: { memberId },
    select: {
      id: true,
      name: true,
      slug: true,
      phone: true,
      email: true,
      website: true,
      address: true,
      logoUrl: true,
      fullDescription: true,
    },
  });
}

export async function getStoreItemPublicPayload(
  slug: string,
  opts?: { includeUnavailable?: boolean; viewerId?: string | null }
): Promise<StoreItemPublicPayload | null> {
  const includeUnavailable = opts?.includeUnavailable === true;
  const slugWhere = withPublicStockWhere({
    slug,
    status: "active" as const,
    member: { stripeConnectAccountId: { not: null } },
  });
  const item = await prisma.storeItem.findFirst({
    where: slugWhere,
    select: storeItemPublicSelect,
  });
  let resolvedItem = item;
  if (!resolvedItem && includeUnavailable) {
    resolvedItem = await prisma.storeItem.findFirst({
      where: { slug },
      select: storeItemPublicSelect,
    });
    if (
      resolvedItem &&
      !includeUnavailableVisibleToViewer({
        status: resolvedItem.status,
        memberId: resolvedItem.memberId,
        viewerId: opts?.viewerId,
      })
    ) {
      return null;
    }
  }
  if (!resolvedItem) return null;

  const isUnavailable = includeUnavailable && !item;
  const soldAtPromise =
    isUnavailable && resolvedItem.status === "sold_out"
      ? prisma.orderItem.findFirst({
          where: {
            storeItemId: resolvedItem.id,
            order: { status: { in: ["paid", "shipped", "delivered"] } },
          },
          include: { order: { select: { updatedAt: true } } },
          orderBy: { order: { updatedAt: "desc" } },
        })
      : Promise.resolve(null);

  const [business, saveCount, lastOrderItem, shippingRows] = await Promise.all([
    resolveBusiness(resolvedItem.business, resolvedItem.memberId),
    prisma.savedItem.count({
      where: { type: "store_item", referenceId: resolvedItem.id },
    }),
    soldAtPromise,
    prisma.storeItem.findMany({
      where: withPublicStockWhere({
        memberId: resolvedItem.memberId,
        status: "active",
      }),
      select: { shippingCostCents: true, shippingDisabled: true },
    }),
  ]);
  const soldAt = lastOrderItem?.order.updatedAt.toISOString();

  return {
    id: resolvedItem.id,
    memberId: resolvedItem.memberId,
    title: resolvedItem.title,
    slug: resolvedItem.slug,
    status: resolvedItem.status,
    description: resolvedItem.description,
    aspects: resolvedItem.aspects,
    photos: resolvedItem.photos,
    category: resolvedItem.category,
    condition: resolvedItem.condition as "new" | "used",
    priceCents: resolvedItem.priceCents,
    quantity: resolvedItem.quantity,
    inventoryTracking: resolvedItem.inventoryTracking,
    variants: resolvedItem.variants,
    shippingCostCents: resolvedItem.shippingCostCents,
    shippingPolicy: resolvedItem.shippingPolicy,
    localDeliveryAvailable: resolvedItem.localDeliveryAvailable,
    localDeliveryFeeCents: resolvedItem.localDeliveryFeeCents,
    inStorePickupAvailable: resolvedItem.inStorePickupAvailable,
    shippingDisabled: resolvedItem.shippingDisabled,
    localDeliveryTerms: resolvedItem.localDeliveryTerms,
    pickupTerms: resolvedItem.pickupTerms,
    buyerFields: publicBuyerFieldsFromRows(resolvedItem.buyerFields ?? []),
    member: resolvedItem.member,
    freeShippingBanner: freeShippingBannerForStore({
      freeShippingMinimumCents: resolvedItem.member?.freeShippingMinimumCents,
      offerFreeShippingOnInw: resolvedItem.member?.offerFreeShippingOnInw,
      items: shippingRows,
    }),
    business,
    saveCount,
    ...(isUnavailable ? { unavailable: true } : {}),
    ...(soldAt ? { soldAt } : {}),
  };
}

export const getCachedStoreItemPublicPayload = cache(async (slug: string) => {
  const active = await getStoreItemPublicPayload(slug);
  if (active) return active;
  return getStoreItemPublicPayload(slug, { includeUnavailable: true });
});

export function storeItemOgImage(photos: string[] | null | undefined, title: string) {
  const raw = photos?.find(Boolean) ?? null;
  const url = listingDisplayPhoto(raw, "hero") ?? raw;
  return url ? [{ url, width: 1200, height: 630, alt: title }] : undefined;
}

export function storeItemOgDescription(description: string | null | undefined, title: string) {
  return listingDescriptionPreview(description) ?? title;
}
