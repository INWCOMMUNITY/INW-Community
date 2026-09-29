import type { ShopifyFetch } from "./admin-graphql";
import { executeShopifyAdminGraphql } from "./admin-graphql";
import { toShopifyMediaSourceUrls } from "./listing-media-urls";

export type SyncShopifyListingMediaResult =
  | { ok: true; replaced: boolean; mediaCount: number }
  | {
      ok: false;
      class: "RETRY" | "DEAD";
      errorClass: string;
      errorCode: string;
      errorMessage: string;
    };

/**
 * Replace product media with ordered INW photo URLs.
 * Does not touch product status or sales-channel publication.
 */
export async function syncShopifyListingMedia(input: {
  connectionId: string;
  shopifyProductId: string;
  photos: string[] | null | undefined;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<SyncShopifyListingMediaResult> {
  const desired = toShopifyMediaSourceUrls(input.photos);

  const read = await executeShopifyAdminGraphql<{
    product: {
      id: string;
      media: { nodes: Array<{ id: string }> };
    } | null;
  }>({
    connectionId: input.connectionId,
    operationType: "query",
    operationName: "ShopifyListingMediaRead",
    document: `query ShopifyListingMediaRead($id: ID!) {
      product(id: $id) {
        id
        media(first: 50) {
          nodes { id }
        }
      }
    }`,
    variables: { id: input.shopifyProductId },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });

  if (!read.ok) {
    if (
      read.class === "THROTTLED" ||
      read.class === "TRANSIENT_PROVIDER" ||
      read.class === "NETWORK_UNKNOWN"
    ) {
      return {
        ok: false,
        class: "RETRY",
        errorClass: read.class,
        errorCode: "MEDIA_READ",
        errorMessage: read.message,
      };
    }
    return {
      ok: false,
      class: "DEAD",
      errorClass: read.class,
      errorCode: "MEDIA_READ",
      errorMessage: read.message,
    };
  }

  if (!read.data?.product) {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "PRODUCT_MISSING",
      errorMessage: "Shopify product was not found while syncing media",
    };
  }

  const existingIds = (read.data.product.media?.nodes ?? []).map((row) => row.id);
  if (existingIds.length > 0) {
    const del = await executeShopifyAdminGraphql<{
      productDeleteMedia: {
        deletedMediaIds: string[] | null;
        userErrors: Array<{ field?: string[] | null; message: string }>;
      } | null;
    }>({
      connectionId: input.connectionId,
      operationType: "mutation",
      operationName: "ShopifyListingMediaDelete",
      document: `mutation ShopifyListingMediaDelete($productId: ID!, $mediaIds: [ID!]!) {
        productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
          deletedMediaIds
          userErrors { field message }
        }
      }`,
      variables: {
        productId: input.shopifyProductId,
        mediaIds: existingIds,
      },
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
          class: "RETRY",
          errorClass: del.class,
          errorCode: del.outcomeUnknown ? "MEDIA_DELETE_UNKNOWN" : "MEDIA_DELETE",
          errorMessage: del.message,
        };
      }
      return {
        ok: false,
        class: "DEAD",
        errorClass: del.class,
        errorCode: "MEDIA_DELETE",
        errorMessage: del.message,
      };
    }
    const delErrors = del.data?.productDeleteMedia?.userErrors ?? [];
    if (delErrors.length > 0) {
      return {
        ok: false,
        class: "DEAD",
        errorClass: "GRAPHQL_PERMANENT",
        errorCode: "MEDIA_DELETE_USER_ERROR",
        errorMessage: (delErrors[0]?.message ?? "productDeleteMedia failed").slice(0, 500),
      };
    }
  }

  if (desired.length === 0) {
    return { ok: true, replaced: existingIds.length > 0, mediaCount: 0 };
  }

  const create = await executeShopifyAdminGraphql<{
    productCreateMedia: {
      media: Array<{ id: string }> | null;
      userErrors: Array<{ field?: string[] | null; message: string }>;
    } | null;
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyListingMediaCreate",
    document: `mutation ShopifyListingMediaCreate($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id }
        userErrors { field message }
      }
    }`,
    variables: {
      productId: input.shopifyProductId,
      media: desired.map((url, index) => ({
        originalSource: url,
        mediaContentType: "IMAGE",
        alt: `Photo ${index + 1}`,
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
        class: "RETRY",
        errorClass: create.class,
        errorCode: create.outcomeUnknown ? "MEDIA_CREATE_UNKNOWN" : "MEDIA_CREATE",
        errorMessage: create.message,
      };
    }
    return {
      ok: false,
      class: "DEAD",
      errorClass: create.class,
      errorCode: "MEDIA_CREATE",
      errorMessage: create.message,
    };
  }

  const createErrors = create.data?.productCreateMedia?.userErrors ?? [];
  if (createErrors.length > 0) {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "MEDIA_CREATE_USER_ERROR",
      errorMessage: (createErrors[0]?.message ?? "productCreateMedia failed").slice(0, 500),
    };
  }

  return {
    ok: true,
    replaced: true,
    mediaCount: create.data?.productCreateMedia?.media?.length ?? desired.length,
  };
}
