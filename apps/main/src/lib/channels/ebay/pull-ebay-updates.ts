import { prisma } from "database";
import { getConnectionContext } from "../connection";
import { fetchEbayItemDetails, enumerateEbayListings } from "./trading";
import { normalizeListingAspects } from "@/lib/listing-limits";
import { normalizeEbayPhotoUrl } from "./photos";
import { storeListingDescription } from "../import-listing";
import { resolveInwCategoryFromEbayPath } from "../category-resolver";
import { syncContentHash, syncMetaHash } from "../sync-baseline";
import { variantsFingerprint } from "../variant-sync";
import { applyRemoteListingRemoved } from "../apply-remote-listing";
import { syncInventoryToChannels } from "../sync-inventory";

type ConnectionRow = {
  id: string;
  memberId: string;
  provider: string;
  externalShopId: string | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: Date | null;
  status: string;
  etsyShippingProfileId: string | null;
  config?: unknown;
};

export type PullResult = {
  storeItemId: string;
  title: string;
  updated: boolean;
  changes: string[];
  ended?: boolean;
};

function photosEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((url, i) => url === b[i]);
}

/**
 * Pull latest data from eBay for a single listing by legacy item ID.
 * Used by webhook handler and manual refresh.
 */
export async function refreshEbayListingByItemId(
  accessToken: string,
  legacyItemId: string,
  opts?: { activeListingIds?: Set<string>; skipQuantity?: boolean }
): Promise<PullResult | null> {
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
          condition: true,
          status: true,
        },
      },
    },
  });

  if (!link || !link.storeItem) {
    console.log("[ebay] refreshEbayListingByItemId: no link found", { legacyItemId });
    return null;
  }

  const storeItem = link.storeItem;
  const details = await fetchEbayItemDetails(accessToken, legacyItemId);

  const stillActive =
    opts?.activeListingIds != null
      ? opts.activeListingIds.has(legacyItemId)
      : !details.listingEnded;

  if (!stillActive || details.listingEnded) {
    await applyRemoteListingRemoved(storeItem.id);
    await syncInventoryToChannels(storeItem.id, { skipProviders: ["ebay"] });
    await prisma.channelListingLink.update({
      where: { id: link.id },
      data: {
        lastInboundAt: new Date(),
        syncStatus: "synced",
        syncError: null,
        syncBaselineQty: 0,
        syncBaselineAt: new Date(),
      },
    });
    return {
      storeItemId: storeItem.id,
      title: storeItem.title,
      updated: true,
      changes: ["ended → sold_out"],
      ended: true,
    };
  }

  const normalizedAspects = normalizeListingAspects(details.aspects);
  const photos = details.photos
    .map((u) => normalizeEbayPhotoUrl(u))
    .filter((u): u is string => Boolean(u));
  const description = storeListingDescription(details.description) ?? storeItem.description;
  const resolvedCat = await resolveInwCategoryFromEbayPath(details.categoryName ?? null);
  const remoteTitle = (details.title ?? storeItem.title).slice(0, 200);
  const remoteQty = details.quantity ?? storeItem.quantity;
  const remotePrice =
    details.priceCents != null && details.priceCents > 0
      ? details.priceCents
      : storeItem.priceCents;

  const changes: string[] = [];
  const updateData: Record<string, unknown> = {};

  if (remoteTitle && remoteTitle !== storeItem.title) {
    updateData.title = remoteTitle;
    changes.push("title");
  }

  if (details.condition && details.condition !== storeItem.condition) {
    updateData.condition = details.condition;
    changes.push(`condition (${details.condition})`);
  }

  if (normalizedAspects.length > 0) {
    updateData.aspects = normalizedAspects as object;
    changes.push(`aspects (${normalizedAspects.length} fields)`);
  }

  // Authoritative photo set from GetItem (may shrink when seller removes images).
  if (photos.length > 0 && !photosEqual(photos, storeItem.photos)) {
    updateData.photos = photos;
    changes.push(`photos (${photos.length})`);
  }

  if (description && description !== storeItem.description) {
    updateData.description = description;
    changes.push("description");
  }

  if (remotePrice !== storeItem.priceCents) {
    updateData.priceCents = remotePrice;
    changes.push(`price ($${(remotePrice / 100).toFixed(2)})`);
  }

  if (!opts?.skipQuantity && remoteQty !== storeItem.quantity) {
    updateData.quantity = remoteQty;
    updateData.status = remoteQty > 0 ? "active" : "sold_out";
    changes.push(`quantity (${remoteQty})`);
  }

  if (details.variants && details.variants.length > 0) {
    updateData.variants = details.variants as object;
    const sum = details.variants.reduce(
      (acc, axis) => acc + axis.options.reduce((s, o) => s + o.quantity, 0),
      0
    );
    // Prefer summed variant qty when variations are present (unless sale path skipped qty).
    if (!opts?.skipQuantity && sum !== storeItem.quantity) {
      updateData.quantity = sum;
      updateData.status = sum > 0 ? "active" : "sold_out";
    }
    changes.push("variants");
  }

  if (resolvedCat && resolvedCat.category !== storeItem.category) {
    updateData.category = resolvedCat.category;
    updateData.subcategory = resolvedCat.subcategory;
    changes.push(`category (${resolvedCat.category})`);
  }

  if (details.remoteCategoryId) {
    const catId = Number(details.remoteCategoryId);
    if (Number.isInteger(catId) && catId > 0) {
      updateData.ebayCategoryId = catId;
    }
  }

  if (Object.keys(updateData).length > 0) {
    const updatedItem = await prisma.storeItem.update({
      where: { id: storeItem.id },
      data: updateData,
    });

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
        syncBaselineAt: details.remoteUpdatedAt ?? new Date(),
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
      title: updatedItem.title,
      updated: true,
      changes,
    };
  }

  await prisma.channelListingLink
    .update({
      where: { id: link.id },
      data: { lastInboundAt: new Date() },
    })
    .catch(() => {});

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

  const ebayListings = await enumerateEbayListings(ctx.accessToken);
  const activeIds = new Set(ebayListings.map((l) => l.listingId));
  const results: PullResult[] = [];

  for (const link of links) {
    let legacyId = link.externalListingId;
    const inwMatch = legacyId.match(/^inw(\d+)$/);
    if (inwMatch) {
      legacyId = inwMatch[1];
    }

    try {
      const result = await refreshEbayListingByItemId(ctx.accessToken, legacyId, {
        activeListingIds: activeIds,
      });
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
