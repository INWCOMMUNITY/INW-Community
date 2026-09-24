import {
  assertShopifyInventoryItemGid,
  assertShopifyProductGid,
  assertShopifyProductVariantGid,
  ShopifyGidValidationError,
} from "database";
import type { ShopifyFetch } from "./admin-graphql";
import { executeShopifyAdminGraphql } from "./admin-graphql";
import {
  SHOPIFY_LISTING_EXPORT_METAFIELD_KEY,
  SHOPIFY_LISTING_EXPORT_METAFIELD_NAMESPACE,
  shopifyListingExportCustomId,
} from "./listing-export-id";

export type ShopifyListingProductLookupSuccess = {
  ok: true;
  customId: string;
  /** null means provider confirmed no product for this custom ID. */
  product: null | {
    productId: string;
    variantId: string;
    inventoryItemId: string;
  };
};

export type ShopifyListingProductLookupFailure = {
  ok: false;
  class: "RETRY" | "DEAD";
  errorClass: string;
  errorCode: string;
  errorMessage: string;
  customId: string;
};

type ProductByIdentifierNode = {
  id: string;
  status: string;
  listingExportId: { value: string } | null;
  variantsCount: { count: number } | null;
  variants: {
    nodes: Array<{ id: string; inventoryItem: { id: string } | null }>;
    pageInfo: { hasNextPage: boolean };
  };
};

const PRODUCT_BY_CUSTOM_ID_QUERY = `query ShopifyCreateListingProductByCustomId(
  $identifier: ProductIdentifierInput!
  $namespace: String!
  $key: String!
) {
  productByIdentifier(identifier: $identifier) {
    id
    status
    listingExportId: metafield(namespace: $namespace, key: $key) { value }
    variantsCount { count }
    variants(first: 2) {
      nodes {
        id
        inventoryItem { id }
      }
      pageInfo { hasNextPage }
    }
  }
}`;

/**
 * Discover an existing Shopify product by the generation-scoped S4 custom ID.
 * Read-only. Never mutates list fields.
 */
export async function lookupShopifyListingProductByCustomId(input: {
  connectionId: string;
  storeItemId: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<ShopifyListingProductLookupSuccess | ShopifyListingProductLookupFailure> {
  const customId = shopifyListingExportCustomId(input.connectionId, input.storeItemId);
  const result = await executeShopifyAdminGraphql<{
    productByIdentifier: ProductByIdentifierNode | null;
  }>({
    connectionId: input.connectionId,
    operationType: "query",
    operationName: "ShopifyCreateListingProductByCustomId",
    document: PRODUCT_BY_CUSTOM_ID_QUERY,
    variables: {
      identifier: {
        customId: {
          namespace: SHOPIFY_LISTING_EXPORT_METAFIELD_NAMESPACE,
          key: SHOPIFY_LISTING_EXPORT_METAFIELD_KEY,
          value: customId,
        },
      },
      namespace: SHOPIFY_LISTING_EXPORT_METAFIELD_NAMESPACE,
      key: SHOPIFY_LISTING_EXPORT_METAFIELD_KEY,
    },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });

  if (!result.ok) {
    if (
      result.class === "THROTTLED" ||
      result.class === "TRANSIENT_PROVIDER" ||
      result.class === "NETWORK_UNKNOWN"
    ) {
      return {
        ok: false,
        class: "RETRY",
        errorClass: result.class,
        errorCode: "PRODUCT_LOOKUP",
        errorMessage: result.message,
        customId,
      };
    }
    return {
      ok: false,
      class: "DEAD",
      errorClass: result.class,
      errorCode: "PRODUCT_LOOKUP",
      errorMessage: result.message,
      customId,
    };
  }

  const product = result.data?.productByIdentifier ?? null;
  if (!product) {
    return { ok: true, customId, product: null };
  }

  if (String(product.status).toUpperCase() !== "DRAFT") {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "RECOVERY_CONFLICT",
      errorCode: "RECOVERY_NOT_DRAFT",
      errorMessage: "Recovered Shopify product is not DRAFT",
      customId,
    };
  }

  const metafieldValue = product.listingExportId?.value ?? "";
  if (metafieldValue !== customId) {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "RECOVERY_CONFLICT",
      errorCode: "RECOVERY_CUSTOM_ID_MISMATCH",
      errorMessage: "Recovered Shopify product custom ID does not match expected export identity",
      customId,
    };
  }

  const nodes = product.variants?.nodes ?? [];
  const variantCount =
    typeof product.variantsCount?.count === "number" ? product.variantsCount.count : nodes.length;
  const hasMore = Boolean(product.variants?.pageInfo?.hasNextPage);
  if (variantCount !== 1 || nodes.length !== 1 || hasMore) {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "RECOVERY_CONFLICT",
      errorCode: "RECOVERY_VARIANT_CARDINALITY",
      errorMessage: "Recovered Shopify product does not have exactly one variant",
      customId,
    };
  }
  if (!nodes[0]?.inventoryItem?.id) {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "RECOVERY_CONFLICT",
      errorCode: "RECOVERY_INVENTORY_ITEM",
      errorMessage: "Recovered Shopify variant is missing InventoryItem identity",
      customId,
    };
  }

  try {
    return {
      ok: true,
      customId,
      product: {
        productId: assertShopifyProductGid(product.id),
        variantId: assertShopifyProductVariantGid(nodes[0].id),
        inventoryItemId: assertShopifyInventoryItemGid(nodes[0].inventoryItem.id),
      },
    };
  } catch (error) {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "RECOVERY_CONFLICT",
      errorCode: error instanceof ShopifyGidValidationError ? "INVALID_SHOPIFY_GID" : "RECOVERY_IDENTITY",
      errorMessage: error instanceof Error ? error.message : "Invalid recovered Shopify GIDs",
      customId,
    };
  }
}
