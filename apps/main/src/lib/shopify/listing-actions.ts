import {
  captureShopifyInventoryProjectionDesire,
  ensureShopifyPublishListingJob,
  ensureShopifyReconcileListingJob,
  prisma,
  recordShopifyDirtyMappedVariantContentDesires,
  shopifyPublishListingDedupeKey,
} from "database";
import type { ShopifyFetch } from "./admin-graphql";
import { executeShopifyAdminGraphql } from "./admin-graphql";
import {
  shopifyAdminProductUrl,
  shopifyStorefrontProductUrl,
} from "./apps-airport";
import { shopifyCreateListingDedupeKey } from "./listing-export-id";
import { resolveShopifyOnlineStorePublicationId } from "./publish-listing";

export type ShopifyListingAction = "retry" | "reconnect" | "unpublish" | "remove";

export type ShopifyListingActionResult =
  | { ok: true; message?: string }
  | { ok: false; status: number; error: string; code?: string };

async function loadMappedListing(input: {
  memberId: string;
  storeItemId: string;
}): Promise<
  | {
      connection: {
        id: string;
        shopDomain: string;
        primaryLocationId: string | null;
      };
      listing: {
        id: string;
        storeItemId: string;
        shopifyProductId: string;
        variantMaps: Array<{ storeVariantId: string }>;
      };
    }
  | { error: string; status: number }
> {
  const connection = await prisma.shopifyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true, shopDomain: true, primaryLocationId: true },
  });
  if (!connection) {
    return { error: "No active Shopify connection", status: 409 };
  }
  const listing = await prisma.shopifyListingLink.findFirst({
    where: {
      shopifyConnectionId: connection.id,
      memberId: input.memberId,
      storeItemId: input.storeItemId,
    },
    include: {
      variantMaps: { select: { storeVariantId: true } },
    },
  });
  if (!listing) {
    return { error: "Listing is not linked to Shopify", status: 404 };
  }
  return { connection, listing };
}

async function unpublishFromOnlineStore(input: {
  connectionId: string;
  shopifyProductId: string;
  fetchImpl?: ShopifyFetch;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const publication = await resolveShopifyOnlineStorePublicationId({
    connectionId: input.connectionId,
    fetchImpl: input.fetchImpl,
  });
  if (!publication.ok) {
    return { ok: false, error: publication.errorMessage };
  }

  const result = await executeShopifyAdminGraphql<{
    publishableUnpublish: {
      userErrors: Array<{ field?: string[] | null; message: string }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyListingPublishableUnpublish",
    document: `mutation ShopifyListingPublishableUnpublish($id: ID!, $input: [PublicationInput!]!) {
      publishableUnpublish(id: $id, input: $input) {
        userErrors { field message }
      }
    }`,
    variables: {
      id: input.shopifyProductId,
      input: [{ publicationId: publication.publicationId }],
    },
    fetchImpl: input.fetchImpl,
  });

  if (!result.ok) {
    return { ok: false, error: result.message };
  }
  const userErrors = result.data?.publishableUnpublish?.userErrors ?? [];
  if (userErrors.length > 0) {
    return { ok: false, error: userErrors.map((e) => e.message).join("; ") };
  }
  return { ok: true };
}

async function deleteShopifyProduct(input: {
  connectionId: string;
  shopifyProductId: string;
  fetchImpl?: ShopifyFetch;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await executeShopifyAdminGraphql<{
    productDelete: {
      deletedProductId: string | null;
      userErrors: Array<{ field?: string[] | null; message: string }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyListingProductDelete",
    document: `mutation ShopifyListingProductDelete($input: ProductDeleteInput!) {
      productDelete(input: $input) {
        deletedProductId
        userErrors { field message }
      }
    }`,
    variables: { input: { id: input.shopifyProductId } },
    fetchImpl: input.fetchImpl,
  });
  if (!result.ok) {
    return { ok: false, error: result.message };
  }
  const userErrors = result.data?.productDelete?.userErrors ?? [];
  if (userErrors.length > 0) {
    return { ok: false, error: userErrors.map((e) => e.message).join("; ") };
  }
  return { ok: true };
}

async function deleteListingMapping(input: {
  listingLinkId: string;
  connectionId: string;
  storeItemId: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.shopifyVariantMap.deleteMany({ where: { shopifyListingLinkId: input.listingLinkId } });
    await tx.shopifySyncJob.deleteMany({
      where: {
        shopifyConnectionId: input.connectionId,
        dedupeKey: {
          in: [
            shopifyCreateListingDedupeKey(input.connectionId, input.storeItemId),
            shopifyPublishListingDedupeKey(input.connectionId, input.storeItemId),
          ],
        },
        state: { not: "RUNNING" },
      },
    });
    await tx.shopifyListingLink.delete({ where: { id: input.listingLinkId } });
  });
}

export async function runShopifyListingAction(input: {
  memberId: string;
  storeItemId: string;
  action: ShopifyListingAction;
  confirmDelete?: boolean;
  fetchImpl?: ShopifyFetch;
}): Promise<ShopifyListingActionResult> {
  const loaded = await loadMappedListing({
    memberId: input.memberId,
    storeItemId: input.storeItemId,
  });
  if ("error" in loaded) {
    return { ok: false, status: loaded.status, error: loaded.error };
  }
  const { connection, listing } = loaded;

  if (input.action === "retry" || input.action === "reconnect") {
    await ensureShopifyReconcileListingJob(prisma, {
      connectionId: connection.id,
      listingLinkId: listing.id,
      storeItemId: listing.storeItemId,
      bucket: `on-demand-${Date.now()}`,
    });
    await recordShopifyDirtyMappedVariantContentDesires(prisma, {
      memberId: input.memberId,
      storeItemId: listing.storeItemId,
    });
    for (const map of listing.variantMaps) {
      await captureShopifyInventoryProjectionDesire(prisma, {
        memberId: input.memberId,
        storeVariantId: map.storeVariantId,
      });
    }
    if (input.action === "reconnect") {
      await ensureShopifyPublishListingJob(prisma, {
        connectionId: connection.id,
        storeItemId: listing.storeItemId,
        listingLinkId: listing.id,
      });
      return {
        ok: true,
        message: "Reconnect queued. INW will match this item to Shopify and publish it if it is still a draft.",
      };
    }
    return { ok: true, message: "Reload queued" };
  }

  if (input.action === "unpublish") {
    const unpublished = await unpublishFromOnlineStore({
      connectionId: connection.id,
      shopifyProductId: listing.shopifyProductId,
      fetchImpl: input.fetchImpl,
    });
    if (!unpublished.ok) {
      return { ok: false, status: 502, error: unpublished.error, code: "UNPUBLISH_FAILED" };
    }
    await prisma.shopifyListingLink.update({
      where: { id: listing.id },
      data: {
        issueCode: "UNPUBLISHED_ONLINE_STORE",
        issueMessage: "Removed from Online Store",
        issueSeverity: "warning",
        issueLastSeenAt: new Date(),
        readiness: "ACTION_REQUIRED",
      },
    });
    return { ok: true, message: "Removed from Online Store" };
  }

  // remove
  const unpublished = await unpublishFromOnlineStore({
    connectionId: connection.id,
    shopifyProductId: listing.shopifyProductId,
    fetchImpl: input.fetchImpl,
  });
  // Best-effort unpublish — still allow mapping removal if already unpublished.
  if (!unpublished.ok && !/not published|already|unpublished/i.test(unpublished.error)) {
    // Continue; mapping removal is the primary seller intent.
  }

  if (input.confirmDelete) {
    const deleted = await deleteShopifyProduct({
      connectionId: connection.id,
      shopifyProductId: listing.shopifyProductId,
      fetchImpl: input.fetchImpl,
    });
    if (!deleted.ok) {
      return {
        ok: false,
        status: 502,
        error: deleted.error,
        code: "PRODUCT_DELETE_FAILED",
      };
    }
  }

  await deleteListingMapping({
    listingLinkId: listing.id,
    connectionId: connection.id,
    storeItemId: listing.storeItemId,
  });
  return {
    ok: true,
    message: input.confirmDelete
      ? "Mapping removed and Shopify product deleted"
      : "Mapping removed",
  };
}

export async function getShopifyListingViewUrl(input: {
  memberId: string;
  storeItemId: string;
  fetchImpl?: ShopifyFetch;
}): Promise<
  | {
      ok: true;
      primaryUrl: string | null;
      adminUrl: string | null;
      storefrontUrl: string | null;
    }
  | { ok: false; status: number; error: string }
> {
  const loaded = await loadMappedListing({
    memberId: input.memberId,
    storeItemId: input.storeItemId,
  });
  if ("error" in loaded) {
    return { ok: false, status: loaded.status, error: loaded.error };
  }
  const { connection, listing } = loaded;
  const adminUrl = shopifyAdminProductUrl(connection.shopDomain, listing.shopifyProductId);

  let storefrontUrl: string | null = null;
  const lookup = await executeShopifyAdminGraphql<{
    product: { handle: string | null; onlineStoreUrl: string | null } | null;
  }>({
    connectionId: connection.id,
    operationType: "query",
    operationName: "ShopifyListingViewUrlLookup",
    document: `query ShopifyListingViewUrlLookup($id: ID!) {
      product(id: $id) { handle onlineStoreUrl }
    }`,
    variables: { id: listing.shopifyProductId },
    fetchImpl: input.fetchImpl,
  });
  if (lookup.ok && lookup.data?.product) {
    storefrontUrl =
      lookup.data.product.onlineStoreUrl?.trim() ||
      shopifyStorefrontProductUrl(connection.shopDomain, lookup.data.product.handle);
  }

  return {
    ok: true,
    primaryUrl: storefrontUrl || adminUrl,
    adminUrl,
    storefrontUrl,
  };
}
