import type { ShopifyFetch } from "./admin-graphql";
import { executeShopifyAdminGraphql } from "./admin-graphql";

export type EnsureShopifyListingActiveResult =
  | { ok: true; status: string; updated: boolean }
  | {
      ok: false;
      class: "RETRY" | "DEAD";
      errorClass: string;
      errorCode: string;
      errorMessage: string;
    };

/**
 * Ensure a mapped Shopify product is ACTIVE (listed), not DRAFT.
 * Read-then-write; no-op when already ACTIVE. Sales-channel publication is
 * handled separately by ensureShopifyListingActiveAndPublishedToOnlineStore
 * (requires write_publications).
 */
export async function ensureShopifyListingProductActive(input: {
  connectionId: string;
  shopifyProductId: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<EnsureShopifyListingActiveResult> {
  const lookup = await executeShopifyAdminGraphql<{
    product: { id: string; status: string } | null;
  }>({
    connectionId: input.connectionId,
    operationType: "query",
    operationName: "ShopifyListingProductStatusLookup",
    document: `query ShopifyListingProductStatusLookup($id: ID!) {
      product(id: $id) { id status }
    }`,
    variables: { id: input.shopifyProductId },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });

  if (!lookup.ok) {
    if (
      lookup.class === "THROTTLED" ||
      lookup.class === "TRANSIENT_PROVIDER" ||
      lookup.class === "NETWORK_UNKNOWN"
    ) {
      return {
        ok: false,
        class: "RETRY",
        errorClass: lookup.class,
        errorCode: "PRODUCT_STATUS_LOOKUP",
        errorMessage: lookup.message,
      };
    }
    return {
      ok: false,
      class: "DEAD",
      errorClass: lookup.class,
      errorCode: "PRODUCT_STATUS_LOOKUP",
      errorMessage: lookup.message,
    };
  }

  const product = lookup.data?.product ?? null;
  if (!product) {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "PRODUCT_MISSING",
      errorMessage: "Shopify product was not found while activating listing",
    };
  }

  const status = String(product.status).toUpperCase();
  if (status === "ACTIVE") {
    return { ok: true, status, updated: false };
  }

  const update = await executeShopifyAdminGraphql<{
    productUpdate: {
      product: { id: string; status: string } | null;
      // productUpdate returns [UserError!]! (field+message only; no code).
      userErrors: Array<{ field?: string[] | null; message: string }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyListingProductActivate",
    // Selecting `code` yields GraphQL top-level errors on HTTP 200 and DEAD publication.
    document: `mutation ShopifyListingProductActivate($input: ProductInput!) {
      productUpdate(input: $input) {
        product { id status }
        userErrors { field message }
      }
    }`,
    variables: {
      input: {
        id: input.shopifyProductId,
        status: "ACTIVE",
      },
    },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });

  if (!update.ok) {
    if (
      update.class === "THROTTLED" ||
      update.class === "TRANSIENT_PROVIDER" ||
      update.class === "NETWORK_UNKNOWN" ||
      update.outcomeUnknown
    ) {
      return {
        ok: false,
        class: "RETRY",
        errorClass: update.class,
        errorCode: update.outcomeUnknown ? "PRODUCT_ACTIVATE_UNKNOWN" : update.class,
        errorMessage: update.message,
      };
    }
    return {
      ok: false,
      class: "DEAD",
      errorClass: update.class,
      errorCode: update.class,
      errorMessage: update.message,
    };
  }

  const userErrors = update.data?.productUpdate.userErrors ?? [];
  if (userErrors.length > 0) {
    const message = userErrors[0]?.message ?? "Shopify productUpdate user error";
    const retryable = /throttl|timeout|unavailable|try again/i.test(message);
    return {
      ok: false,
      class: retryable ? "RETRY" : "DEAD",
      errorClass: retryable ? "THROTTLED" : "GRAPHQL_PERMANENT",
      errorCode: retryable ? "THROTTLED" : "PRODUCT_ACTIVATE_USER_ERROR",
      errorMessage: message.slice(0, 500),
    };
  }

  const next = String(update.data?.productUpdate.product?.status ?? "").toUpperCase();
  if (next !== "ACTIVE") {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "PRODUCT_NOT_ACTIVE",
      errorMessage: "Shopify productUpdate did not return ACTIVE status",
    };
  }
  return { ok: true, status: next, updated: true };
}
