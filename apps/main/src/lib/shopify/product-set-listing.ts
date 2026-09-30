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

export type ShopifyMultiVariantProductSetInput = {
  connectionId: string;
  storeItemId: string;
  title: string;
  descriptionHtml: string | null;
  productOptions: Array<{ name: string; values: Array<{ name: string }> }>;
  variants: Array<{
    optionValues: Array<{ optionName: string; name: string }>;
    price: string;
    sku?: string;
  }>;
  fetchImpl?: ShopifyFetch;
  now?: Date;
};

export type ShopifyMultiVariantProductSetSuccess = {
  ok: true;
  customId: string;
  productId: string;
  variants: Array<{
    variantId: string;
    inventoryItemId: string;
    selectedOptions: Array<{ name: string; value: string }>;
  }>;
};

export type ShopifyMultiVariantProductSetFailure = ShopifyProductSetListingFailure;

const PRODUCT_SET_MUTATION = `mutation ShopifyCreateListingProductSet($input: ProductSetInput!, $identifier: ProductSetIdentifiers, $synchronous: Boolean!) {
  productSet(input: $input, identifier: $identifier, synchronous: $synchronous) {
    product {
      id
      status
      variants(first: 100) {
        nodes {
          id
          selectedOptions { name value }
          inventoryItem { id }
        }
      }
    }
    userErrors { field message code }
  }
}`;

function classifyProductSetError(result: {
  ok: boolean;
  class: string;
  message: string;
  outcomeUnknown: boolean;
  data: {
    productSet: {
      userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
    };
  } | null;
}, customId: string): ShopifyProductSetListingFailure | null {
  if (!result.ok) {
    const retryable =
      result.class === "THROTTLED" ||
      result.class === "TRANSIENT_PROVIDER" ||
      result.class === "NETWORK_UNKNOWN" ||
      result.outcomeUnknown;
    return {
      ok: false,
      class: retryable ? "RETRY" : "DEAD",
      errorClass: result.class,
      errorCode: result.outcomeUnknown ? "PRODUCT_SET_UNKNOWN" : result.class,
      errorMessage: result.message,
      customId,
      outcomeUnknown: result.outcomeUnknown,
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
  return null;
}

/**
 * Synchronous productSet upsert by generation-scoped custom ID (single variant).
 * Creates the remote product as DRAFT so it is not purchasable until inventory
 * is initialized and PUBLISH_LISTING activates + publishes to Online Store.
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
        variants: { nodes: Array<{ id: string; selectedOptions: Array<{ name: string; value: string }>; inventoryItem: { id: string } | null }> };
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

  const err = classifyProductSetError(result as never, customId);
  if (err) return err;

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

/**
 * Synchronous productSet for multi-variant export. Sends complete options + all variants.
 * Creates the remote product as DRAFT. Returns all variant GIDs with selectedOptions for correlation.
 */
export async function productSetShopifyMultiVariantDraftListing(
  input: ShopifyMultiVariantProductSetInput
): Promise<ShopifyMultiVariantProductSetSuccess | ShopifyMultiVariantProductSetFailure> {
  const customId = shopifyListingExportCustomId(input.connectionId, input.storeItemId);
  const result = await executeShopifyAdminGraphql<{
    productSet: {
      product: {
        id: string;
        status: string;
        variants: {
          nodes: Array<{
            id: string;
            selectedOptions: Array<{ name: string; value: string }>;
            inventoryItem: { id: string } | null;
          }>;
        };
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
        productOptions: input.productOptions,
        variants: input.variants,
      },
    },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });

  const err = classifyProductSetError(result as never, customId);
  if (err) return err;

  const product = result.data?.productSet.product;
  const returnedVariants = product?.variants.nodes ?? [];
  if (!product || returnedVariants.length !== input.variants.length) {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "PRODUCT_SET_VARIANT_COUNT",
      errorMessage: `productSet returned ${returnedVariants.length} variants; expected ${input.variants.length}`,
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
    const productId = assertShopifyProductGid(product.id);
    const variants = returnedVariants.map((v) => {
      if (!v.inventoryItem?.id) {
        throw new ShopifyGidValidationError("InventoryItem", "");
      }
      return {
        variantId: assertShopifyProductVariantGid(v.id),
        inventoryItemId: assertShopifyInventoryItemGid(v.inventoryItem.id),
        selectedOptions: v.selectedOptions,
      };
    });
    return { ok: true, customId, productId, variants };
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
