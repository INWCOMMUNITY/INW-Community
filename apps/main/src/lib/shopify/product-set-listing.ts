import {
  assertShopifyInventoryItemGid,
  assertShopifyProductGid,
  assertShopifyProductVariantGid,
  normalizeShopifyAspects,
  normalizeShopifyTags,
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
import { shopifyProductSetFileInputs } from "./listing-media-urls";

export const SHOPIFY_ASPECTS_METAFIELD_NAMESPACE = "inw";
export const SHOPIFY_ASPECTS_METAFIELD_KEY = "aspects_json";

export type ShopifyProductSetVariantInput = {
  storeVariantId: string;
  priceCents: number;
  sku: string | null;
  barcode?: string | null;
  compareAtPriceCents?: number | null;
  /** Option map e.g. { Size: "M", Color: "Red" }. Empty/default → Title/Default Title. */
  options?: Record<string, string>;
};

export type ShopifyProductSetListingInput = {
  connectionId: string;
  storeItemId: string;
  title: string;
  descriptionHtml: string | null;
  photos?: string[] | null;
  vendor?: string | null;
  tags?: string[] | null;
  aspects?: unknown;
  variants: ShopifyProductSetVariantInput[];
  fetchImpl?: ShopifyFetch;
  now?: Date;
};

export type ShopifyProductSetListingSuccess = {
  ok: true;
  customId: string;
  productId: string;
  variants: Array<{
    storeVariantId: string;
    variantId: string;
    inventoryItemId: string;
  }>;
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
      variants(first: 100) {
        nodes {
          id
          sku
          selectedOptions { name value }
          inventoryItem { id }
        }
      }
    }
    userErrors { field message code }
  }
}`;

function optionEntries(options: Record<string, string> | undefined): Array<[string, string]> {
  if (!options || typeof options !== "object") return [];
  return Object.entries(options)
    .map(([name, value]) => [String(name).trim(), String(value).trim()] as [string, string])
    .filter(([name, value]) => name && value)
    .sort(([a], [b]) => a.localeCompare(b));
}

function buildProductOptionsAndVariants(variants: ShopifyProductSetVariantInput[]): {
  productOptions: Array<{ name: string; values: Array<{ name: string }> }>;
  variantInputs: Array<Record<string, unknown>>;
  /** Position-aligned to variantInputs for response matching. */
  storeVariantIds: string[];
} {
  if (variants.length === 0) {
    throw new Error("At least one variant is required");
  }

  const axisNames = new Set<string>();
  for (const row of variants) {
    for (const [name] of optionEntries(row.options)) axisNames.add(name);
  }

  if (axisNames.size === 0 || variants.length === 1) {
    // Simple / single-variant listing.
    return {
      productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
      variantInputs: variants.map((row) => ({
        optionValues: [{ optionName: "Title", name: "Default Title" }],
        price: centsToShopifyMoney(row.priceCents),
        ...(row.sku ? { sku: row.sku } : {}),
        ...(row.barcode ? { barcode: row.barcode } : {}),
        ...(typeof row.compareAtPriceCents === "number"
          ? { compareAtPrice: centsToShopifyMoney(row.compareAtPriceCents) }
          : {}),
      })),
      storeVariantIds: variants.map((row) => row.storeVariantId),
    };
  }

  const axes = Array.from(axisNames).sort((a, b) => a.localeCompare(b));
  const valuesByAxis = new Map<string, Set<string>>();
  for (const axis of axes) valuesByAxis.set(axis, new Set());
  for (const row of variants) {
    const entries = Object.fromEntries(optionEntries(row.options));
    for (const axis of axes) {
      const value = entries[axis];
      if (!value) {
        throw new Error(`Variant ${row.storeVariantId} missing option ${axis}`);
      }
      valuesByAxis.get(axis)!.add(value);
    }
  }

  return {
    productOptions: axes.map((name) => ({
      name,
      values: Array.from(valuesByAxis.get(name)!)
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ name: value })),
    })),
    variantInputs: variants.map((row) => {
      const entries = Object.fromEntries(optionEntries(row.options));
      return {
        optionValues: axes.map((name) => ({
          optionName: name,
          name: entries[name]!,
        })),
        price: centsToShopifyMoney(row.priceCents),
        ...(row.sku ? { sku: row.sku } : {}),
        ...(row.barcode ? { barcode: row.barcode } : {}),
        ...(typeof row.compareAtPriceCents === "number"
          ? { compareAtPrice: centsToShopifyMoney(row.compareAtPriceCents) }
          : {}),
      };
    }),
    storeVariantIds: variants.map((row) => row.storeVariantId),
  };
}

function matchRemoteVariants(
  nodes: Array<{
    id: string;
    sku: string | null;
    selectedOptions: Array<{ name: string; value: string }>;
    inventoryItem: { id: string } | null;
  }>,
  requested: ShopifyProductSetVariantInput[]
): Array<{ storeVariantId: string; variantId: string; inventoryItemId: string }> | null {
  if (nodes.length !== requested.length) return null;
  const remaining = [...nodes];
  const matched: Array<{ storeVariantId: string; variantId: string; inventoryItemId: string }> = [];

  for (const req of requested) {
    const reqOptions = Object.fromEntries(optionEntries(req.options));
    const idx = remaining.findIndex((node) => {
      if (!node.inventoryItem?.id) return false;
      if (req.sku && node.sku && node.sku.trim() === req.sku.trim()) return true;
      if (Object.keys(reqOptions).length === 0) return remaining.length === 1;
      const nodeOpts = Object.fromEntries(
        (node.selectedOptions ?? []).map((o) => [o.name.trim(), o.value.trim()])
      );
      return Object.entries(reqOptions).every(([name, value]) => nodeOpts[name] === value);
    });
    if (idx < 0) return null;
    const [node] = remaining.splice(idx, 1);
    matched.push({
      storeVariantId: req.storeVariantId,
      variantId: node!.id,
      inventoryItemId: node!.inventoryItem!.id,
    });
  }
  return matched;
}

/**
 * Synchronous productSet upsert by generation-scoped custom ID.
 * Creates the remote product as DRAFT so it is not purchasable until inventory
 * is initialized and PUBLISH_LISTING activates + publishes to Online Store.
 * Does not set inventory quantities or publish to sales channels.
 */
export async function productSetShopifyDraftListing(
  input: ShopifyProductSetListingInput
): Promise<ShopifyProductSetListingSuccess | ShopifyProductSetListingFailure> {
  const customId = shopifyListingExportCustomId(input.connectionId, input.storeItemId);
  if (!input.variants.length) {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "INVALID_VARIANTS",
      errorMessage: "At least one variant is required for Shopify export",
      customId,
    };
  }

  let built: ReturnType<typeof buildProductOptionsAndVariants>;
  try {
    built = buildProductOptionsAndVariants(input.variants);
  } catch (error) {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "INVALID_VARIANT_OPTIONS",
      errorMessage: error instanceof Error ? error.message : "Invalid variant options",
      customId,
    };
  }

  const files = shopifyProductSetFileInputs(input.photos);
  const tags = normalizeShopifyTags(input.tags);
  const aspects = normalizeShopifyAspects(input.aspects);
  const vendor = typeof input.vendor === "string" ? input.vendor.trim() : "";

  const result = await executeShopifyAdminGraphql<{
    productSet: {
      product: {
        id: string;
        status: string;
        variants: {
          nodes: Array<{
            id: string;
            sku: string | null;
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
      // Do not send input.metafields when identifying by customId except aspects
      // under a different namespace (customId lives in $app).
      input: {
        title: input.title,
        descriptionHtml: input.descriptionHtml ?? undefined,
        status: "DRAFT",
        ...(vendor ? { vendor } : {}),
        ...(tags.length ? { tags } : {}),
        ...(files.length ? { files } : {}),
        ...(aspects.length
          ? {
              metafields: [
                {
                  namespace: SHOPIFY_ASPECTS_METAFIELD_NAMESPACE,
                  key: SHOPIFY_ASPECTS_METAFIELD_KEY,
                  type: "json",
                  value: JSON.stringify(aspects),
                },
              ],
            }
          : {}),
        productOptions: built.productOptions,
        variants: built.variantInputs,
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
    const message = userErrors[0]?.message ?? "Shopify productSet user error";
    const mediaFailure = /media|file|image|original.?source/i.test(`${code} ${message}`);
    const retryable = /throttl|timeout|unavailable|try again/i.test(`${code} ${message}`);
    return {
      ok: false,
      class: retryable ? "RETRY" : "DEAD",
      errorClass: retryable ? "THROTTLED" : "GRAPHQL_PERMANENT",
      errorCode: (mediaFailure ? "MEDIA_PRODUCT_SET_USER_ERROR" : code).slice(0, 64),
      errorMessage: message.slice(0, 500),
      customId,
    };
  }

  const product = result.data?.productSet.product;
  const nodes = product?.variants.nodes ?? [];
  if (!product || nodes.length === 0) {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "PRODUCT_SET_IDENTITY",
      errorMessage: "Shopify productSet did not return variants",
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

  const matched = matchRemoteVariants(nodes, input.variants);
  if (!matched) {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "PRODUCT_SET_VARIANT_MATCH",
      errorMessage: "Shopify productSet variants could not be matched to INW variants",
      customId,
    };
  }

  try {
    return {
      ok: true,
      customId,
      productId: assertShopifyProductGid(product.id),
      variants: matched.map((row) => ({
        storeVariantId: row.storeVariantId,
        variantId: assertShopifyProductVariantGid(row.variantId),
        inventoryItemId: assertShopifyInventoryItemGid(row.inventoryItemId),
      })),
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
