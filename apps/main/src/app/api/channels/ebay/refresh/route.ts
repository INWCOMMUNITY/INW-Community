import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { fetchEbayItemDetails, enumerateEbayListings } from "@/lib/channels/ebay/trading";
import { normalizeListingAspects } from "@/lib/listing-limits";
import { normalizeEbayPhotoUrl } from "@/lib/channels/ebay/photos";
import { plainListingDescription } from "@/lib/channels/import-listing";
import { resolveInwCategoryFromRemote } from "@/lib/channels/category-resolver";
import { syncContentHash, syncMetaHash } from "@/lib/channels/sync-baseline";
import { variantsFingerprint } from "@/lib/channels/variant-sync";

export const dynamic = "force-dynamic";

const RefreshBodySchema = z.object({
  storeItemId: z.string().min(1),
});

/**
 * POST: Refresh a StoreItem from its linked eBay listing.
 * Pulls latest data from eBay's GetItem API and updates the StoreItem.
 *
 * Body: { storeItemId: string }
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof RefreshBodySchema>;
  try {
    body = RefreshBodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { storeItemId } = body;

  // Find the store item and verify ownership
  const storeItem = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
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
      aspects: true,
      variants: true,
      shippingCostCents: true,
      secondaryCategory: true,
    },
  });

  if (!storeItem) {
    return NextResponse.json({ error: "Store item not found" }, { status: 404 });
  }

  if (storeItem.memberId !== userId) {
    return NextResponse.json({ error: "You don't own this item" }, { status: 403 });
  }

  // Find the eBay link for this item
  const link = await prisma.channelListingLink.findFirst({
    where: {
      storeItemId,
      provider: "ebay",
    },
    select: {
      id: true,
      externalListingId: true,
      connectionId: true,
    },
  });

  if (!link) {
    return NextResponse.json({ error: "This item is not linked to eBay" }, { status: 404 });
  }

  // Get the eBay connection context
  const ctx = await getMemberConnectionContext(userId, "ebay");
  if (!ctx) {
    return NextResponse.json({ error: "eBay is not connected" }, { status: 400 });
  }

  // Extract the legacy eBay listing ID from the link's externalListingId
  // The externalListingId is typically the SKU (e.g. "inw123456789" or the storeItemId)
  // We need to find the actual eBay ItemID. The legacy ID may be in the SKU as "inw{legacyId}"
  let legacyItemId: string | null = null;

  // Try to extract from inw{legacyId} pattern
  const inwMatch = link.externalListingId.match(/^inw(\d+)$/);
  if (inwMatch) {
    legacyItemId = inwMatch[1];
  } else if (/^\d+$/.test(link.externalListingId)) {
    // It's already a numeric ID
    legacyItemId = link.externalListingId;
  }

  // If we couldn't extract the ID, try to find it by enumerating listings
  if (!legacyItemId) {
    // Search eBay listings to find a match by title or SKU
    const listings = await enumerateEbayListings(ctx.accessToken);
    const match = listings.find(
      (l) => l.title.toLowerCase() === storeItem.title.toLowerCase()
    );
    if (match) {
      legacyItemId = match.listingId;
    }
  }

  if (!legacyItemId) {
    return NextResponse.json(
      { error: "Could not find the eBay listing ID. The listing may have been removed from eBay." },
      { status: 404 }
    );
  }

  // Fetch full details from eBay
  const details = await fetchEbayItemDetails(ctx.accessToken, legacyItemId);

  // Also get the listing info for price/quantity
  const listings = await enumerateEbayListings(ctx.accessToken);
  const listing = listings.find((l) => l.listingId === legacyItemId);

  if (!listing) {
    return NextResponse.json(
      { error: "eBay listing not found. It may have ended or been removed." },
      { status: 404 }
    );
  }

  // Process the data
  const normalizedAspects = normalizeListingAspects(details.aspects);
  const photos = details.photos
    .map((u) => normalizeEbayPhotoUrl(u))
    .filter((u): u is string => Boolean(u));
  const description = plainListingDescription(details.description) ?? storeItem.description;
  const resolvedCat = resolveInwCategoryFromRemote(
    details.categoryName ?? null,
    null
  );

  // Track what changed
  const changes: string[] = [];

  // Build update data
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
      where: { id: storeItemId },
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

    console.log("[ebay] refresh completed", {
      userId,
      storeItemId,
      legacyItemId,
      changes,
    });

    return NextResponse.json({
      ok: true,
      updated: true,
      changes,
      message: `Refreshed from eBay: ${changes.join(", ")}`,
    });
  }

  // Nothing changed
  console.log("[ebay] refresh - no changes", {
    userId,
    storeItemId,
    legacyItemId,
  });

  return NextResponse.json({
    ok: true,
    updated: false,
    changes: [],
    message: "Already up to date with eBay",
  });
}
