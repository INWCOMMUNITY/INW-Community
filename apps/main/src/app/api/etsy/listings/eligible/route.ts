import { NextRequest, NextResponse } from "next/server";
import {
  prisma,
  resolveEtsyHowItsMadeForCreate,
} from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { listingDisplayPhotos } from "@/lib/listing-display-photo";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { resolveEtsyTaxonomyFallback, sanitizeEtsyTaxonomyId } from "@/lib/etsy/taxonomy-default";
import { etsyListingIsPubliclyViewable } from "@/lib/etsy/apps-airport";

export const dynamic = "force-dynamic";

/**
 * List INW store items eligible to publish to Etsy.
 * Live (`remoteListingState=active`) maps are excluded; drafts / failed activates stay
 * so sellers can finish List on Etsy until the remote listing is active.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const connection = await prisma.etsyConnection.findFirst({
    where: { memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: {
      id: true,
      status: true,
      shopName: true,
      shopId: true,
      defaultShippingProfileId: true,
      defaultTaxonomyId: true,
    },
  });
  if (!connection) {
    return NextResponse.json({
      connectionStatus: "DISCONNECTED",
      listings: [],
    });
  }

  const mapped = await prisma.etsyListingLink.findMany({
    where: { etsyConnectionId: connection.id, memberId },
    select: {
      storeItemId: true,
      etsyListingId: true,
      remoteListingState: true,
      readiness: true,
      issueCode: true,
      issueMessage: true,
    },
  });
  const liveMappedIds = new Set(
    mapped
      .filter((m) => etsyListingIsPubliclyViewable(m.remoteListingState))
      .map((m) => m.storeItemId)
  );
  const nonLiveByStoreItemId = new Map(
    mapped
      .filter((m) => !etsyListingIsPubliclyViewable(m.remoteListingState))
      .map((m) => [m.storeItemId, m] as const)
  );
  const taxonomyFallback = resolveEtsyTaxonomyFallback(connection.defaultTaxonomyId);

  const items = await prisma.storeItem.findMany({
    where: {
      memberId,
      status: { in: ["active", "sold_out"] },
      endedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      title: true,
      slug: true,
      sku: true,
      priceCents: true,
      quantity: true,
      status: true,
      inventoryTracking: true,
      photos: true,
      etsyWhoMade: true,
      etsyWhenMade: true,
      etsyIsSupply: true,
      etsyTaxonomyId: true,
      _count: { select: { storeVariants: { where: { status: "ACTIVE" } } } },
    },
  });

  const listings = items
    .filter((item) => !liveMappedIds.has(item.id))
    .map((item) => {
      const existing = nonLiveByStoreItemId.get(item.id) ?? null;
      const how = resolveEtsyHowItsMadeForCreate({
        etsyWhoMade: item.etsyWhoMade,
        etsyWhenMade: item.etsyWhenMade,
        etsyIsSupply: item.etsyIsSupply,
        etsyTaxonomyId: sanitizeEtsyTaxonomyId(item.etsyTaxonomyId),
        defaultTaxonomyId: taxonomyFallback,
        inventoryTracking: item.inventoryTracking,
      });
      const photoCount = Array.isArray(item.photos)
        ? item.photos.filter((p) => typeof p === "string" && p.trim().length > 0).length
        : 0;
      const photosReady = photoCount >= 1;
      let unsupportedReason: string | null = null;
      if (!how.ok) unsupportedReason = how.message;
      else if (item._count.storeVariants < 1)
        unsupportedReason = "Listing needs at least one active variant";
      else if (!photosReady) unsupportedReason = "Add at least one photo before listing on Etsy";
      return {
        storeItemId: item.id,
        title: item.title,
        photos: listingDisplayPhotos(item.photos, "thumb", 4),
        slug: item.slug,
        sku: item.sku,
        priceCents: item.priceCents,
        quantity: item.quantity,
        status: item.status,
        variantCount: item._count.storeVariants,
        photoCount,
        photosReady,
        inventoryTracking: item.inventoryTracking,
        etsyWhoMade: item.etsyWhoMade,
        etsyWhenMade: item.etsyWhenMade,
        etsyIsSupply: item.etsyIsSupply,
        etsyTaxonomyId: item.etsyTaxonomyId,
        howItsMadeReady: how.ok,
        howItsMadeMissing: how.ok ? [] : how.missing,
        supported: how.ok && item._count.storeVariants >= 1 && photosReady,
        unsupportedReason,
        linkedButNotLive: Boolean(existing),
        etsyListingId: existing?.etsyListingId ?? null,
        remoteListingState: existing?.remoteListingState ?? null,
        issueCode: existing?.issueCode ?? null,
        issueMessage: existing?.issueMessage ?? null,
      };
    });

  return NextResponse.json({
    connectionStatus: "ACTIVE",
    connection: {
      id: connection.id,
      shopId: connection.shopId,
      shopName: connection.shopName,
      defaultShippingProfileId: connection.defaultShippingProfileId,
      defaultTaxonomyId: taxonomyFallback,
      shippingProfileReady: Boolean(connection.defaultShippingProfileId),
    },
    listings,
  });
}
