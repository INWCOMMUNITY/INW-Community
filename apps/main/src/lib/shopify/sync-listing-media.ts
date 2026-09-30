import {
  markShopifyFieldsApplied,
  persistShopifyFieldPlans,
  planShopifyMediaDesireFromPhotos,
  planVariantMediaAssociations,
  prisma,
  shopifyMediaIdentityFingerprint,
  upsertShopifyMediaDesireMaps,
} from "database";
import type { ShopifyFetch } from "./admin-graphql";
import { executeShopifyAdminGraphql } from "./admin-graphql";

type HandlerFailure = {
  outcome: "RETRY" | "DEAD";
  errorClass: string;
  errorCode: string;
  errorMessage: string;
};

/**
 * Incremental media sync for a mapped listing.
 * Uses durable ShopifyMediaMap identities — never productSet media replace.
 * Creates/deletes/reorders only mapped media owned by this listing.
 */
export async function syncShopifyListingMedia(input: {
  connectionId: string;
  listingLinkId: string;
  memberId: string;
  storeItemId: string;
  productId: string;
  photos: string[] | null | undefined;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<{ ok: true; added: number; removed: number } | ({ ok: false } & HandlerFailure)> {
  const existing = await prisma.shopifyMediaMap.findMany({
    where: { shopifyListingLinkId: input.listingLinkId },
    select: {
      inwMediaId: true,
      sourceUrl: true,
      status: true,
      position: true,
      shopifyMediaId: true,
    },
  });

  const plan = planShopifyMediaDesireFromPhotos(input.photos, existing);
  await upsertShopifyMediaDesireMaps(prisma, {
    connectionId: input.connectionId,
    listingLinkId: input.listingLinkId,
    memberId: input.memberId,
    storeItemId: input.storeItemId,
    desired: plan.desired,
    removeInwMediaIds: plan.toRemove,
  });

  // Delete remote media only when we have a Shopify GID for that durable map.
  const removeGids = existing
    .filter(
      (row) =>
        plan.toRemove.includes(row.inwMediaId) &&
        typeof row.shopifyMediaId === "string" &&
        row.shopifyMediaId.length > 0
    )
    .map((row) => row.shopifyMediaId!);

  if (removeGids.length > 0) {
    const del = await executeShopifyAdminGraphql<{
      productDeleteMedia: {
        deletedMediaIds: string[] | null;
        mediaUserErrors: Array<{ field?: string[] | null; message: string }>;
      };
    }>({
      connectionId: input.connectionId,
      operationType: "mutation",
      operationName: "ShopifyListingMediaDelete",
      document: `mutation ShopifyListingMediaDelete($productId: ID!, $mediaIds: [ID!]!) {
        productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
          deletedMediaIds
          mediaUserErrors { field message }
        }
      }`,
      variables: { productId: input.productId, mediaIds: removeGids },
      fetchImpl: input.fetchImpl,
      now: input.now,
    });
    if (!del.ok) {
      if (
        del.class === "THROTTLED" ||
        del.class === "TRANSIENT_PROVIDER" ||
        del.class === "NETWORK_UNKNOWN" ||
        del.outcomeUnknown
      ) {
        return {
          ok: false,
          outcome: "RETRY",
          errorClass: del.class,
          errorCode: "MEDIA_DELETE",
          errorMessage: del.message,
        };
      }
      return {
        ok: false,
        outcome: "DEAD",
        errorClass: del.class,
        errorCode: "MEDIA_DELETE",
        errorMessage: del.message,
      };
    }
    const delErrors = del.data?.productDeleteMedia.mediaUserErrors ?? [];
    if (delErrors.length > 0) {
      return {
        ok: false,
        outcome: "DEAD",
        errorClass: "GRAPHQL_PERMANENT",
        errorCode: "MEDIA_DELETE_USER_ERROR",
        errorMessage: (delErrors[0]?.message ?? "productDeleteMedia user error").slice(0, 500),
      };
    }
  }

  if (plan.toAdd.length > 0) {
    const create = await executeShopifyAdminGraphql<{
      productCreateMedia: {
        media: Array<{ id: string; status?: string }> | null;
        mediaUserErrors: Array<{ field?: string[] | null; message: string }>;
      };
    }>({
      connectionId: input.connectionId,
      operationType: "mutation",
      operationName: "ShopifyListingMediaCreate",
      document: `mutation ShopifyListingMediaCreate($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media { ... on MediaImage { id status } }
          mediaUserErrors { field message }
        }
      }`,
      variables: {
        productId: input.productId,
        media: plan.toAdd.map((row) => ({
          originalSource: row.sourceUrl,
          mediaContentType: "IMAGE",
        })),
      },
      fetchImpl: input.fetchImpl,
      now: input.now,
    });
    if (!create.ok) {
      if (
        create.class === "THROTTLED" ||
        create.class === "TRANSIENT_PROVIDER" ||
        create.class === "NETWORK_UNKNOWN" ||
        create.outcomeUnknown
      ) {
        return {
          ok: false,
          outcome: "RETRY",
          errorClass: create.class,
          errorCode: "MEDIA_CREATE",
          errorMessage: create.message,
        };
      }
      return {
        ok: false,
        outcome: "DEAD",
        errorClass: create.class,
        errorCode: "MEDIA_CREATE",
        errorMessage: create.message,
      };
    }
    const createErrors = create.data?.productCreateMedia.mediaUserErrors ?? [];
    if (createErrors.length > 0) {
      return {
        ok: false,
        outcome: "DEAD",
        errorClass: "GRAPHQL_PERMANENT",
        errorCode: "MEDIA_CREATE_USER_ERROR",
        errorMessage: (createErrors[0]?.message ?? "productCreateMedia user error").slice(0, 500),
      };
    }
    const created = create.data?.productCreateMedia.media ?? [];
    for (let i = 0; i < plan.toAdd.length; i += 1) {
      const mediaId = created[i]?.id;
      if (!mediaId) continue;
      await prisma.shopifyMediaMap.updateMany({
        where: {
          shopifyListingLinkId: input.listingLinkId,
          inwMediaId: plan.toAdd[i].inwMediaId,
        },
        data: {
          shopifyMediaId: mediaId,
          status: "ACTIVE",
        },
      });
    }
  }

  // Reorder when positions changed and all desired rows have remote GIDs.
  if (plan.toReorder.length > 0) {
    const maps = await prisma.shopifyMediaMap.findMany({
      where: {
        shopifyListingLinkId: input.listingLinkId,
        status: "ACTIVE",
        inwMediaId: { in: plan.desired.map((r) => r.inwMediaId) },
      },
      select: { inwMediaId: true, shopifyMediaId: true },
    });
    const gidByInw = new Map(
      maps
        .filter((m) => m.shopifyMediaId)
        .map((m) => [m.inwMediaId, m.shopifyMediaId!] as const)
    );
    const moves = plan.desired
      .map((row) => {
        const id = gidByInw.get(row.inwMediaId);
        if (!id) return null;
        return { id, newPosition: row.position };
      })
      .filter((row): row is { id: string; newPosition: number } => row != null);

    if (moves.length === plan.desired.length && moves.length > 1) {
      const reorder = await executeShopifyAdminGraphql<{
        productReorderMedia: {
          job: { id: string } | null;
          mediaUserErrors: Array<{ field?: string[] | null; message: string }>;
        };
      }>({
        connectionId: input.connectionId,
        operationType: "mutation",
        operationName: "ShopifyListingMediaReorder",
        document: `mutation ShopifyListingMediaReorder($id: ID!, $moves: [MoveInput!]!) {
          productReorderMedia(id: $id, moves: $moves) {
            job { id }
            mediaUserErrors { field message }
          }
        }`,
        variables: { id: input.productId, moves },
        fetchImpl: input.fetchImpl,
        now: input.now,
      });
      if (!reorder.ok) {
        if (
          reorder.class === "THROTTLED" ||
          reorder.class === "TRANSIENT_PROVIDER" ||
          reorder.class === "NETWORK_UNKNOWN" ||
          reorder.outcomeUnknown
        ) {
          return {
            ok: false,
            outcome: "RETRY",
            errorClass: reorder.class,
            errorCode: "MEDIA_REORDER",
            errorMessage: reorder.message,
          };
        }
        // Non-fatal for reorder: maps already reflect desired order locally.
      }
    }
  }

  return { ok: true, added: plan.toAdd.length, removed: plan.toRemove.length };
}

/**
 * Associate existing product media with mapped variants via productVariantsBulkUpdate.mediaId.
 * Never re-uploads media merely to associate. Uses durable ShopifyMediaMap GIDs.
 */
export async function syncShopifyVariantMediaAssociations(input: {
  connectionId: string;
  listingLinkId: string;
  productId: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<{ ok: true; associated: number } | ({ ok: false } & HandlerFailure)> {
  const listing = await prisma.shopifyListingLink.findFirst({
    where: { id: input.listingLinkId, shopifyConnectionId: input.connectionId },
    select: { id: true, memberId: true, storeItemId: true },
  });
  if (!listing) return { ok: true, associated: 0 };

  const variantMaps = await prisma.shopifyVariantMap.findMany({
    where: {
      shopifyListingLinkId: input.listingLinkId,
      shopifyConnectionId: input.connectionId,
    },
    select: { storeVariantId: true, shopifyVariantId: true },
  });
  if (variantMaps.length < 1) return { ok: true, associated: 0 };

  const storeVariants = await prisma.storeVariant.findMany({
    where: { id: { in: variantMaps.map((m) => m.storeVariantId) } },
    select: { id: true, photos: true },
  });
  const mediaMaps = await prisma.shopifyMediaMap.findMany({
    where: { shopifyListingLinkId: input.listingLinkId, status: "ACTIVE" },
    select: {
      inwMediaId: true,
      sourceUrl: true,
      shopifyMediaId: true,
      status: true,
      storeVariantId: true,
    },
  });

  const fieldStates = await prisma.shopifyListingFieldState.findMany({
    where: {
      shopifyListingLinkId: input.listingLinkId,
      fieldKey: "MEDIA",
      storeVariantId: { in: variantMaps.map((m) => m.storeVariantId) },
    },
    select: { storeVariantId: true, baseFingerprint: true, localFingerprint: true },
  });
  const fieldByVariant = new Map(fieldStates.map((s) => [s.storeVariantId, s]));

  const plans = planVariantMediaAssociations({
    variants: storeVariants.map((v) => ({ storeVariantId: v.id, photos: v.photos ?? [] })),
    mediaMaps,
  });

  const byStoreVariant = new Map(variantMaps.map((m) => [m.storeVariantId, m.shopifyVariantId]));
  const bulk: Array<{ id: string; mediaId: string }> = [];
  const pushedPlans: typeof plans = [];
  for (const plan of plans) {
    const shopifyVariantId = byStoreVariant.get(plan.storeVariantId);
    const mediaId = plan.shopifyMediaIds[0];
    if (!shopifyVariantId || !mediaId) continue;
    const localFp = shopifyMediaIdentityFingerprint(plan.inwMediaIds);
    const field = fieldByVariant.get(plan.storeVariantId);
    // Skip when already converged (import seed / prior outbound) — avoids echo churn.
    if (field?.baseFingerprint && field.baseFingerprint === localFp) continue;
    bulk.push({ id: shopifyVariantId, mediaId });
    pushedPlans.push(plan);
    // Persist marketplace-neutral association hint on durable media maps.
    for (const inwMediaId of plan.inwMediaIds) {
      await prisma.shopifyMediaMap.updateMany({
        where: {
          shopifyListingLinkId: input.listingLinkId,
          inwMediaId,
        },
        data: { storeVariantId: plan.storeVariantId },
      });
    }
  }

  if (bulk.length < 1) return { ok: true, associated: 0 };

  const result = await executeShopifyAdminGraphql<{
    productVariantsBulkUpdate: {
      productVariants: Array<{ id: string }> | null;
      userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyVariantMediaAssociate",
    document: `mutation ShopifyVariantMediaAssociate($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $allowPartialUpdates: Boolean) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: $allowPartialUpdates) {
        productVariants { id }
        userErrors { field message code }
      }
    }`,
    variables: {
      productId: input.productId,
      variants: bulk,
      allowPartialUpdates: false,
    },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });

  if (!result.ok) {
    if (
      result.class === "THROTTLED" ||
      result.class === "TRANSIENT_PROVIDER" ||
      result.class === "NETWORK_UNKNOWN" ||
      result.outcomeUnknown
    ) {
      return {
        ok: false,
        outcome: "RETRY",
        errorClass: result.class,
        errorCode: "VARIANT_MEDIA_ASSOCIATE",
        errorMessage: result.message,
      };
    }
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: result.class,
      errorCode: "VARIANT_MEDIA_ASSOCIATE",
      errorMessage: result.message,
    };
  }
  const userErrors = result.data?.productVariantsBulkUpdate.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: (userErrors[0]?.code ?? "VARIANT_MEDIA_USER_ERROR").slice(0, 64),
      errorMessage: (userErrors[0]?.message ?? "variant media associate user error").slice(0, 500),
    };
  }

  // Narrow baseline: mark MEDIA BASE=LOCAL=REMOTE so PRODUCTS_UPDATE echo is confirmation-only.
  for (const plan of pushedPlans) {
    const fp = shopifyMediaIdentityFingerprint(plan.inwMediaIds);
    await persistShopifyFieldPlans(prisma, {
      connectionId: input.connectionId,
      listingLinkId: input.listingLinkId,
      memberId: listing.memberId,
      storeItemId: listing.storeItemId,
      plans: [
        {
          field: "MEDIA",
          storeVariantId: plan.storeVariantId,
          class: "UNCHANGED",
          action: "UNCHANGED",
          base: fp,
          local: fp,
          remote: fp,
        },
      ],
    });
    await markShopifyFieldsApplied(prisma, {
      listingLinkId: input.listingLinkId,
      fields: [{ field: "MEDIA", storeVariantId: plan.storeVariantId, fingerprint: fp }],
    });
  }

  return { ok: true, associated: bulk.length };
}
