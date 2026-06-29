import { prisma } from "database";
import { getConnectionContext } from "../connection";
import { fetchEbayItemDetails, enumerateEbayListings } from "./trading";
import { normalizeListingAspects } from "@/lib/listing-limits";
import { normalizeEbayPhotoUrl } from "./photos";
import { plainListingDescription } from "../import-listing";
import { resolveInwCategoryFromRemote } from "../category-resolver";
import { syncContentHash, syncMetaHash } from "../sync-baseline";
import { variantsFingerprint } from "../variant-sync";

type ConnectionRow = {
  id: string;
  memberId: string;
  provider: string;
  externalShopId: string | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: Date | null;
  status: string;
  config?: unknown;
};

export type PullResult = {
  storeItemId: string;
  title: string;
  updated: boolean;
  changes: string[];
};

/**
 * Pull latest data from eBay for a single listing by legacy item ID.
 * Used by webhook handler and manual refresh.
 */
export async function refreshEbayListingByItemId(
  accessToken: string,
  legacyItemId: string
): Promise<PullResult | null> {
  // Find the channelListingLink for this eBay item
  // The externalListingId might be the legacyId or inw{legacyId}
  const link = await prisma.channelListingLink.findFirst({
    where: {
      provider: "ebay",
      OR: [
        { externalListingId: legacyItemId },
        { externalListingId: `inw${legacyItemId}` },
      ],
    },
    include: {
      storeItem: {
        select: {
          id: true,
          memberId: true,
          title: true,
          description: true,
          photos: true,
          priceCents: true,
          quantity: true,
          category: true,
          subcategory: true,
          secondaryCategory: true,
          shippingCostCents: true,
          aspects: true,
          variants: true,
        },
      },
    },
  });

  if (!link || !link.storeItem) {
    console.log("[ebay] refreshEbayListingByItemId: no link found", { legacyItemId });
    return null;
  }

  const storeItem = link.storeItem;

  // Fetch details from eBay
  const details = await fetchEbayItemDetails(accessToken, legacyItemId);

  // Get listing info for price/quantity
  const listings = await enumerateEbayListings(accessToken);
  const listing = listings.find((l) => l.listingId === legacyItemId);

  if (!listing) {
    console.log("[ebay] refreshEbayListingByItemId: listing not found on eBay", { legacyItemId });
    return null;
  }

  // Process the data
  const normalizedAspects = normalizeListingAspects(details.aspects);
  const photos = details.photos
    .map((u) => normalizeEbayPhotoUrl(u))
    .filter((u): u is string => Boolean(u));
  const description = plainListingDescription(details.description) ?? storeItem.description;
  const resolvedCat = resolveInwCategoryFromRemote(details.categoryName ?? null, null);

  // Track what changed
  const changes: string[] = [];
  const updateData: Record<string, unknown> = {};

  // Always update aspects (item specifics)
  if (normalizedAspects.length > 0) {
    updateData.aspects = normalizedAspects as object;
    changes.push(`aspects (${normalizedAspects.length} fields)`);
  }

  // Update photos if eBay has more or different photos
  if (photos.length > 0 && photos.length >= storeItem.photos.length) {
    updateData.photos = photos;
    changes.push(`photos (${photos.length})`);
  }

  // Update description if different
  if (description && description !== storeItem.description) {
    updateData.description = description;
    changes.push("description");
  }

  // Update price if different
  if (listing.priceCents !== storeItem.priceCents) {
    updateData.priceCents = listing.priceCents;
    changes.push(`price ($${(listing.priceCents / 100).toFixed(2)})`);
  }

  // Update quantity if different
  if (listing.quantity !== storeItem.quantity) {
    updateData.quantity = listing.quantity;
    updateData.status = listing.quantity > 0 ? "active" : "sold_out";
    changes.push(`quantity (${listing.quantity})`);
  }

  // Update category if resolved and different
  if (resolvedCat && resolvedCat.category !== storeItem.category) {
    updateData.category = resolvedCat.category;
    updateData.subcategory = resolvedCat.subcategory;
    changes.push(`category (${resolvedCat.category})`);
  }

  // Update eBay category ID
  if (details.remoteCategoryId) {
    const catId = Number(details.remoteCategoryId);
    if (Number.isInteger(catId) && catId > 0) {
      updateData.ebayCategoryId = catId;
    }
  }

  // Apply updates if there are any
  if (Object.keys(updateData).length > 0) {
    const updatedItem = await prisma.storeItem.update({
      where: { id: storeItem.id },
      data: updateData,
    });

    // Update sync baselines
    const contentHash = syncContentHash(updatedItem);
    const metaHash = syncMetaHash({
      category: updatedItem.category,
      subcategory: updatedItem.subcategory,
      secondaryCategory: updatedItem.secondaryCategory,
      shippingCostCents: updatedItem.shippingCostCents,
      variants: updatedItem.variants,
    });

    await prisma.channelListingLink.update({
      where: { id: link.id },
      data: {
        syncBaselineHash: contentHash,
        syncBaselineMetaHash: metaHash,
        syncBaselineVariantsHash: variantsFingerprint(updatedItem.variants),
        syncBaselineQty: updatedItem.quantity,
        syncBaselineAt: new Date(),
        lastInboundAt: new Date(),
        syncStatus: "synced",
        syncError: null,
      },
    });

    console.log("[ebay] refreshEbayListingByItemId: updated", {
      storeItemId: storeItem.id,
      legacyItemId,
      changes,
    });

    return {
      storeItemId: storeItem.id,
      title: storeItem.title,
      updated: true,
      changes,
    };
  }

  return {
    storeItemId: storeItem.id,
    title: storeItem.title,
    updated: false,
    changes: [],
  };
}

/**
 * Pull updates from eBay for all linked listings for a connection.
 * Returns a list of items that were updated.
 */
export async function pullEbayUpdatesForConnection(
  connection: ConnectionRow
): Promise<{ updated: PullResult[]; checked: number }> {
  if (connection.provider !== "ebay") {
    return { updated: [], checked: 0 };
  }

  const ctx = await getConnectionContext(connection);
  if (!ctx) {
    return { updated: [], checked: 0 };
  }

  // Get all linked eBay listings for this connection
  const links = await prisma.channelListingLink.findMany({
    where: {
      connectionId: connection.id,
      provider: "ebay",
      syncEnabled: true,
    },
    select: {
      externalListingId: true,
    },
  });

  if (links.length === 0) {
    return { updated: [], checked: 0 };
  }

  // Enumerate current eBay listings
  const ebayListings = await enumerateEbayListings(ctx.accessToken);

  const results: PullResult[] = [];

  for (const link of links) {
    // Extract legacy ID
    let legacyId = link.externalListingId;
    const inwMatch = legacyId.match(/^inw(\d+)$/);
    if (inwMatch) {
      legacyId = inwMatch[1];
    }

    // Check if this listing still exists on eBay
    const ebayListing = ebayListings.find((l) => l.listingId === legacyId);
    if (!ebayListing) {
      continue; // Listing might have ended
    }

    try {
      const result = await refreshEbayListingByItemId(ctx.accessToken, legacyId);
      if (result && result.updated) {
        results.push(result);
      }
    } catch (e) {
      console.error("[ebay] pullEbayUpdatesForConnection: failed to refresh", {
        legacyId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    updated: results,
    checked: links.length,
  };
}
