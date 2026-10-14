import {
  assertShopifyInventoryItemGid,
  assertShopifyProductGid,
  assertShopifyProductVariantGid,
  prisma,
  ShopifyGidValidationError,
  trackedAvailable,
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
  /** Primary-location sellable. Omitted for made-to-order variants. */
  inventory?: { locationId: string; available: number };
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
    inventoryItem?: { tracked: true };
    inventoryQuantities?: Array<{ locationId: string; name: "available"; quantity: number }>;
  }>;
  /**
   * First create stays DRAFT until inventory is set and PUBLISH_LISTING goes live.
   * Option updates on an existing product omit status so a live listing is not sent back to draft.
   */
  preserveStatus?: boolean;
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

export function listingSharesOnePrice(variants: unknown): boolean {
  if (!variants || typeof variants !== "object" || Array.isArray(variants)) return false;
  return (variants as { pricesVary?: unknown }).pricesVary === false;
}

export function listingSharesOneSku(variants: unknown): boolean {
  if (!variants || typeof variants !== "object" || Array.isArray(variants)) return false;
  return (variants as { skusVary?: unknown }).skusVary === false;
}

function listingSharesOneQuantity(variants: unknown): boolean {
  if (!variants || typeof variants !== "object" || Array.isArray(variants)) return false;
  return (variants as { sharedQuantity?: unknown }).sharedQuantity === true;
}

/** One Shopify price when the listing price does not vary by combination. */
export function shopifyVariantPriceCents(input: {
  variantPriceCents: number;
  listingPriceCents: number;
  pricesVary: boolean | undefined;
}): number {
  if (input.pricesVary === false && input.listingPriceCents > 0) return input.listingPriceCents;
  return input.variantPriceCents;
}

/**
 * Shared-quantity listings keep one pool. Shopify still has a quantity on each
 * combination, so every combination receives that same pool instead of a sum.
 */
export function applySharedShopifyAvailability(
  availableByVariantId: Map<string, number>,
  rows: Array<{ variantId: string; storeItemId: string; shared: boolean }>
): void {
  const poolByItem = new Map<string, number>();
  for (const row of rows) {
    if (!row.shared) continue;
    const qty = availableByVariantId.get(row.variantId);
    if (qty == null) continue;
    const prev = poolByItem.get(row.storeItemId);
    poolByItem.set(row.storeItemId, prev == null ? qty : Math.min(prev, qty));
  }
  for (const row of rows) {
    const pool = poolByItem.get(row.storeItemId);
    if (pool == null || !availableByVariantId.has(row.variantId)) continue;
    availableByVariantId.set(row.variantId, pool);
  }
}

/** Sellable quantity at the connection's primary location, for productSet and bulk create. */
export async function loadShopifyCreateInventory(input: {
  connectionId: string;
  storeVariantIds: string[];
}): Promise<{ locationId: string | null; availableByVariantId: Map<string, number> }> {
  const connection = await prisma.shopifyConnection.findUnique({
    where: { id: input.connectionId },
    select: { primaryLocationId: true },
  });
  const locationId = connection?.primaryLocationId ?? null;
  const availableByVariantId = new Map<string, number>();
  if (!locationId || input.storeVariantIds.length < 1) {
    return { locationId, availableByVariantId };
  }
  const states = await prisma.inventoryState.findMany({
    where: { variantId: { in: input.storeVariantIds } },
    select: { variantId: true, storeItemId: true, mode: true, onHand: true, reserved: true },
  });
  for (const state of states) {
    if (state.mode !== "TRACKED_FINITE" || state.onHand == null || state.reserved == null) continue;
    try {
      availableByVariantId.set(
        state.variantId,
        Math.max(0, trackedAvailable(state.onHand, state.reserved))
      );
    } catch {
      continue;
    }
  }
  const itemIds = [...new Set(states.map((state) => state.storeItemId))];
  if (itemIds.length > 0) {
    const items = await prisma.storeItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, variants: true },
    });
    const shared = new Set(items.filter((item) => listingSharesOneQuantity(item.variants)).map((item) => item.id));
    applySharedShopifyAvailability(
      availableByVariantId,
      states.map((state) => ({
        variantId: state.variantId,
        storeItemId: state.storeItemId,
        shared: shared.has(state.storeItemId),
      }))
    );
  }
  return { locationId, availableByVariantId };
}

/** productSet shows a quantity only when the inventory item is tracked. */
export function productSetVariantInventory(locationId: string, available: number) {
  return {
    inventoryItem: { tracked: true as const },
    inventoryQuantities: [{ locationId, name: "available" as const, quantity: available }],
  };
}

/** productVariantsBulkCreate accepts InventoryLevelInput, not the productSet quantity shape. */
export function bulkCreateVariantInventory(locationId: string, available: number) {
  return {
    trackInventory: true as const,
    inventoryQuantities: [{ locationId, availableQuantity: available }],
  };
}

type ShopifyInventoryWriteFailure = {
  ok: false;
  class: "RETRY" | "DEAD";
  errorClass: string;
  errorCode: string;
  errorMessage: string;
};

function inventoryWriteFailure(result: {
  ok: boolean;
  class: string;
  message: string;
  outcomeUnknown: boolean;
}, code: string): ShopifyInventoryWriteFailure | null {
  if (result.ok) return null;
  const retryable =
    result.class === "THROTTLED" ||
    result.class === "TRANSIENT_PROVIDER" ||
    result.class === "NETWORK_UNKNOWN" ||
    result.outcomeUnknown;
  return {
    ok: false,
    class: retryable ? "RETRY" : "DEAD",
    errorClass: retryable ? result.class : result.class,
    errorCode: result.outcomeUnknown ? `${code}_UNKNOWN` : code,
    errorMessage: result.message,
  };
}

/**
 * An existing Shopify product can already have the right variants and still be
 * "inventory not tracked" because an earlier productSet omitted inventoryItem.tracked.
 * Turn tracking on and write the INW sellable quantity without recreating variants.
 */
export async function restoreShopifyTrackedQuantities(input: {
  connectionId: string;
  locationId: string;
  variants: Array<{ inventoryItemId: string; available: number }>;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<{ ok: true } | ShopifyInventoryWriteFailure> {
  for (const variant of input.variants) {
    const enabled = await executeShopifyAdminGraphql<{
      inventoryItemUpdate: {
        inventoryItem: { id: string; tracked: boolean } | null;
        userErrors: Array<{ field?: string[] | null; message: string }>;
      };
    }>({
      connectionId: input.connectionId,
      operationType: "mutation",
      operationName: "ShopifyInventoryItemEnableTracked",
      document: `mutation ShopifyInventoryItemEnableTracked($id: ID!, $input: InventoryItemInput!) {
        inventoryItemUpdate(id: $id, input: $input) {
          inventoryItem { id tracked }
          userErrors { field message }
        }
      }`,
      variables: { id: variant.inventoryItemId, input: { tracked: true } },
      fetchImpl: input.fetchImpl,
      now: input.now,
    });
    const enableFailure = inventoryWriteFailure(enabled, "TRACKED_UPDATE");
    if (enableFailure) return enableFailure;
    const enableErrors = enabled.data?.inventoryItemUpdate.userErrors ?? [];
    if (enableErrors.length > 0 || !enabled.data?.inventoryItemUpdate.inventoryItem?.tracked) {
      return {
        ok: false,
        class: "DEAD",
        errorClass: "GRAPHQL_PERMANENT",
        errorCode: "TRACKED_UPDATE",
        errorMessage: (enableErrors[0]?.message ?? "inventoryItemUpdate did not enable tracked").slice(0, 500),
      };
    }

    const idempotencyKey = `inw-relist-${variant.inventoryItemId.replace(/[^a-zA-Z0-9]/g, "")}-${variant.available}`.slice(0, 255);
    const activated = await executeShopifyAdminGraphql<{
      inventoryActivate: {
        inventoryLevel: { id: string; quantities: Array<{ name: string; quantity: number }> } | null;
        userErrors: Array<{ field?: string[] | null; message: string }>;
      };
    }>({
      connectionId: input.connectionId,
      operationType: "mutation",
      operationName: "ShopifyInventoryActivateOnRelist",
      document: `mutation ShopifyInventoryActivateOnRelist($inventoryItemId: ID!, $locationId: ID!, $available: Int, $idempotencyKey: String!) {
        inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) @idempotent(key: $idempotencyKey) {
          inventoryLevel { id quantities(names: ["available"]) { name quantity } }
          userErrors { field message }
        }
      }`,
      variables: {
        inventoryItemId: variant.inventoryItemId,
        locationId: input.locationId,
        available: variant.available,
        idempotencyKey,
      },
      fetchImpl: input.fetchImpl,
      now: input.now,
    });
    const activateFailure = inventoryWriteFailure(activated, "ACTIVATE");
    if (activateFailure) return activateFailure;
    const activateErrors = activated.data?.inventoryActivate.userErrors ?? [];
    if (activateErrors.length === 0) continue;
    const alreadyStocked = activateErrors.some((row) => /already/i.test(row.message));
    if (!alreadyStocked) {
      return {
        ok: false,
        class: "DEAD",
        errorClass: "GRAPHQL_PERMANENT",
        errorCode: "ACTIVATE_USER_ERROR",
        errorMessage: activateErrors.map((row) => row.message).join("; ").slice(0, 500),
      };
    }

    const level = await executeShopifyAdminGraphql<{
      inventoryItem: {
        inventoryLevel: { quantities: Array<{ name: string; quantity: number }> } | null;
      } | null;
    }>({
      connectionId: input.connectionId,
      operationType: "query",
      operationName: "ShopifyRelistInventoryLevel",
      document: `query ShopifyRelistInventoryLevel($id: ID!, $locationId: ID!) {
        inventoryItem(id: $id) {
          inventoryLevel(locationId: $locationId) {
            quantities(names: ["available"]) { name quantity }
          }
        }
      }`,
      variables: { id: variant.inventoryItemId, locationId: input.locationId },
      fetchImpl: input.fetchImpl,
      now: input.now,
    });
    const levelFailure = inventoryWriteFailure(level, "INVENTORY_LEVEL");
    if (levelFailure) return levelFailure;
    const current = level.data?.inventoryItem?.inventoryLevel?.quantities?.find(
      (row) => row.name === "available"
    )?.quantity;
    if (typeof current !== "number") {
      return {
        ok: false,
        class: "DEAD",
        errorClass: "GRAPHQL_PERMANENT",
        errorCode: "INVENTORY_LEVEL_MISSING",
        errorMessage: "Shopify inventory is already stocked but the location quantity was not readable",
      };
    }
    if (current === variant.available) continue;
    const setKey = `inw-relist-set-${variant.inventoryItemId.replace(/[^a-zA-Z0-9]/g, "")}-${current}-${variant.available}`.slice(0, 255);
    const set = await executeShopifyAdminGraphql<{
      inventorySetQuantities: {
        userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
      };
    }>({
      connectionId: input.connectionId,
      operationType: "mutation",
      operationName: "ShopifyInventorySetQuantitiesOnRelist",
      document: `mutation ShopifyInventorySetQuantitiesOnRelist($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
        inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
          userErrors { field message code }
        }
      }`,
      variables: {
        idempotencyKey: setKey,
        input: {
          name: "available",
          reason: "correction",
          quantities: [
            {
              inventoryItemId: variant.inventoryItemId,
              locationId: input.locationId,
              quantity: variant.available,
              changeFromQuantity: current,
            },
          ],
        },
      },
      fetchImpl: input.fetchImpl,
      now: input.now,
    });
    const setFailure = inventoryWriteFailure(set, "SET_QUANTITY");
    if (setFailure) return setFailure;
    const setErrors = set.data?.inventorySetQuantities.userErrors ?? [];
    if (setErrors.length > 0) {
      return {
        ok: false,
        class: "DEAD",
        errorClass: "GRAPHQL_PERMANENT",
        errorCode: (setErrors[0]?.code ?? "SET_QUANTITY").slice(0, 64),
        errorMessage: (setErrors[0]?.message ?? "inventorySetQuantities user error").slice(0, 500),
      };
    }
  }
  return { ok: true };
}

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
            ...(input.inventory
              ? productSetVariantInventory(input.inventory.locationId, input.inventory.available)
              : {}),
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
        ...(input.preserveStatus ? {} : { status: "DRAFT" }),
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
  if (!input.preserveStatus && String(product.status).toUpperCase() !== "DRAFT") {
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
