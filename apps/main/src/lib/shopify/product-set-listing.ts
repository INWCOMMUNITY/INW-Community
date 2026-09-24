import {
  assertShopifyInventoryItemGid,
  assertShopifyProductGid,
  assertShopifyProductVariantGid,
  ShopifyGidValidationError,
} from "database";
import type { ShopifyFetch } from "./admin-graphql";
import { executeShopifyAdminGraphql } from "./admin-graphql";
import {
  centsToShopifyMoney,
  SHOPIFY_LISTING_EXPORT_METAFIELD_KEY,
  SHOPIFY_LISTING_EXPORT_METAFIELD_NAMESPACE,
  shopifyListingExportCustomId,
} from "./listing-export-id";

export type ShopifyProductSetListingInput = {
  connectionId: string;
  storeItemId: string;
  title: string;
  descriptionHtml: string | null;
  priceCents: number;
  sku: string | null;
  fetchImpl?: ShopifyFetch;
  now?: Date;
};

export type ShopifyProductSetListingSuccess = {
  ok: true;
  customId: string;
  productId: string;
  variantId: string;
  inventoryItemId: string;
};

export type ShopifyProductSetListingFailure = {
  ok: false;
  class: "RETRY" | "DEAD";
  errorClass: string;
  errorCode: string;
  errorMessage: string;
  customId: string;
  outcomeUnknown?: boolean;
};

const PRODUCT_SET_MUTATION = `mutation ShopifyCreateListingProductSet($input: ProductSetInput!, $identifier: ProductSetIdentifiers, $synchronous: Boolean!) {
  productSet(input: $input, identifier: $identifier, synchronous: $synchronous) {
    product {
      id
      status
      variants(first: 5) {
        nodes {
          id
          inventoryItem { id }
        }
      }
    }
    userErrors { field message code }
  }
}`;

/**
 * Synchronous productSet upsert by generation-scoped custom ID.
 * Creates/updates a DRAFT product only. Does not set inventory quantities or publish.
 */
export async function productSetShopifyDraftListing(
  input: ShopifyProductSetListingInput
): Promise<ShopifyProductSetListingSuccess | ShopifyProductSetListingFailure> {
  const customId = shopifyListingExportCustomId(input.connectionId, input.storeItemId);
  const result = await executeShopifyAdminGraphql<{
    productSet: {
      product: {
        id: string;
        status: string;
        variants: { nodes: Array<{ id: string; inventoryItem: { id: string } | null }> };
      } | null;
      userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyCreateListingProductSet",
    document: PRODUCT_SET_MUTATION,
    variables: {
      synchronous: true,
      identifier: {
        customId: {
          namespace: SHOPIFY_LISTING_EXPORT_METAFIELD_NAMESPACE,
          key: SHOPIFY_LISTING_EXPORT_METAFIELD_KEY,
          value: customId,
        },
      },
      input: {
        title: input.title,
        descriptionHtml: input.descriptionHtml ?? undefined,
        status: "DRAFT",
        metafields: [
          {
            namespace: SHOPIFY_LISTING_EXPORT_METAFIELD_NAMESPACE,
            key: SHOPIFY_LISTING_EXPORT_METAFIELD_KEY,
            type: "id",
            value: customId,
          },
        ],
        productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
        variants: [
          {
            optionValues: [{ optionName: "Title", name: "Default Title" }],
            price: centsToShopifyMoney(input.priceCents),
            ...(input.sku ? { sku: input.sku } : {}),
          },
        ],
      },
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
        class: "RETRY",
        errorClass: result.class,
        errorCode: result.outcomeUnknown ? "PRODUCT_SET_UNKNOWN" : result.class,
        errorMessage: result.message,
        customId,
        outcomeUnknown: result.outcomeUnknown,
      };
    }
    return {
      ok: false,
      class: "DEAD",
      errorClass: result.class,
      errorCode: result.class,
      errorMessage: result.message,
      customId,
    };
  }

  const userErrors = result.data?.productSet.userErrors ?? [];
  if (userErrors.length > 0) {
    const code = userErrors[0]?.code ?? "PRODUCT_SET_USER_ERROR";
    const retryable = /throttl|timeout|unavailable|try again/i.test(
      `${code} ${userErrors[0]?.message ?? ""}`
    );
    return {
      ok: false,
      class: retryable ? "RETRY" : "DEAD",
      errorClass: retryable ? "THROTTLED" : "GRAPHQL_PERMANENT",
      errorCode: code.slice(0, 64),
      errorMessage: (userErrors[0]?.message ?? "Shopify productSet user error").slice(0, 500),
      customId,
    };
  }

  const product = result.data?.productSet.product;
  const variants = product?.variants.nodes ?? [];
  if (!product || variants.length !== 1 || !variants[0]?.inventoryItem?.id) {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "PRODUCT_SET_IDENTITY",
      errorMessage: "Shopify productSet did not return exactly one variant with inventory item",
      customId,
    };
  }
  if (String(product.status).toUpperCase() !== "DRAFT") {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "PRODUCT_NOT_DRAFT",
      errorMessage: "Shopify productSet returned a non-DRAFT product",
      customId,
    };
  }

  try {
    return {
      ok: true,
      customId,
      productId: assertShopifyProductGid(product.id),
      variantId: assertShopifyProductVariantGid(variants[0].id),
      inventoryItemId: assertShopifyInventoryItemGid(variants[0].inventoryItem.id),
    };
  } catch (error) {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: error instanceof ShopifyGidValidationError ? "INVALID_SHOPIFY_GID" : "PRODUCT_SET_IDENTITY",
      errorMessage: error instanceof Error ? error.message : "Invalid Shopify GIDs",
      customId,
    };
  }
}
