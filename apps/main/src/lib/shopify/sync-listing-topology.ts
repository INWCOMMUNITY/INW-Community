import {
  appendShopifyVariantMaps,
  correlateVariantsByOptionCombination,
  isShopifyDefaultTitleOnly,
  planShopifyTopologyDiff,
  Prisma,
  prisma,
  projectStoreItemQuantity,
  shopifyCentsFromMoneyString,
  shopifySelectedOptionsToInwOptions,
  shopifyTopologyToInwMatrix,
  type ShopifyTopologyDiffPlan,
  type ShopifyTopologyLocalVariant,
  type ShopifyRemoteVariantSnap,
} from "database";
import type { ShopifyFetch } from "./admin-graphql";
import { executeShopifyAdminGraphql } from "./admin-graphql";
import { centsToShopifyMoney } from "./listing-export-id";
import { productSetShopifyMultiVariantDraftListing } from "./product-set-listing";

type HandlerFailure = {
  outcome: "RETRY" | "DEAD";
  errorClass: string;
  errorCode: string;
  errorMessage: string;
};

/** Clear stale topology conflict once inbound planning no longer conflicts. */
async function clearResolvedTopologyConflict(listingLinkId: string): Promise<void> {
  await prisma.shopifyListingLink.updateMany({
    where: {
      id: listingLinkId,
      issueCode: "TOPOLOGY_AXIS_CONFLICT",
    },
    data: {
      readiness: "SYNCING",
      contentHealth: "HEALTHY",
      issueCode: null,
      issueSeverity: null,
      issueMessage: null,
      issueFingerprint: null,
      issueLastSeenAt: null,
    },
  });
}

/**
 * After inbound option pull on a mapped GID, adopt Shopify available into INW
 * so matrix/onHand match remote and we do not immediately re-project a stale Color qty.
 */
async function adoptRemoteAvailableOntoMappedVariant(input: {
  storeVariantId: string;
  listingLinkId: string;
  connectionId: string;
  shopifyVariantId: string;
  available: number;
}): Promise<void> {
  const state = await prisma.inventoryState.findUnique({
    where: { variantId: input.storeVariantId },
    select: { mode: true, reserved: true },
  });
  if (!state || state.mode !== "TRACKED_FINITE") return;
  const reserved = state.reserved ?? 0;
  const onHand = Math.max(0, input.available + reserved);
  await prisma.inventoryState.update({
    where: { variantId: input.storeVariantId },
    data: { onHand, reserved },
  });
  const map = await prisma.shopifyVariantMap.findFirst({
    where: {
      shopifyListingLinkId: input.listingLinkId,
      shopifyConnectionId: input.connectionId,
      storeVariantId: input.storeVariantId,
      shopifyVariantId: input.shopifyVariantId,
    },
    select: {
      id: true,
      inventoryDesiredVersion: true,
      inventoryAppliedVersion: true,
    },
  });
  if (!map) return;
  const version = Math.max(map.inventoryDesiredVersion, map.inventoryAppliedVersion, 1);
  await prisma.shopifyVariantMap.update({
    where: { id: map.id },
    data: {
      inventoryDesiredAvailable: input.available,
      inventoryDesiredVersion: version,
      inventoryAppliedAvailable: input.available,
      inventoryAppliedVersion: version,
      inventoryInitState: "INITIALIZED",
      inventoryDriftState: "NONE",
      inventoryDriftCode: null,
      inventoryDriftMessage: null,
      inventoryDriftDetectedAt: null,
      inventoryPendingMutationKind: null,
      inventoryPendingIdempotencyKey: null,
      inventoryPendingChangeFrom: null,
      inventoryPendingTargetQty: null,
      inventoryPendingFingerprint: null,
      inventoryAppliedAt: new Date(),
    },
  });
}

type RemoteTopology = {
  options: Array<{
    id: string;
    name: string;
    position: number;
    /** Ordered as returned by Shopify Admin API 2026-07 (no ProductOptionValue.position). */
    optionValues: Array<{ id: string; name: string; hasVariants?: boolean }>;
  }>;
  variants: Array<{
    id: string;
    price: string;
    sku: string | null;
    selectedOptions: Array<{ name: string; value: string }>;
    inventoryItem: { id: string } | null;
    inventoryQuantity?: number | null;
  }>;
};

/**
 * Read complete option/variant topology for an existing mapped Shopify product.
 */
export async function readShopifyProductTopology(input: {
  connectionId: string;
  productId: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<{ ok: true; topology: RemoteTopology } | ({ ok: false } & HandlerFailure)> {
  const result = await executeShopifyAdminGraphql<{
    product: {
      options: Array<{
        id: string;
        name: string;
        position: number;
        optionValues: Array<{ id: string; name: string; hasVariants?: boolean }>;
      }>;
      variants: {
        nodes: Array<{
          id: string;
          price: string;
          sku: string | null;
          selectedOptions: Array<{ name: string; value: string }>;
          inventoryItem: { id: string } | null;
          inventoryQuantity: number | null;
        }>;
      };
    } | null;
  }>({
    connectionId: input.connectionId,
    operationType: "query",
    operationName: "ShopifyProductTopologyRead",
    // Admin API 2026-07: ProductOption.position exists; ProductOptionValue.position does not.
    document: `query ShopifyProductTopologyRead($id: ID!) {
      product(id: $id) {
        options {
          id
          name
          position
          optionValues { id name hasVariants }
        }
        variants(first: 100) {
          nodes {
            id
            price
            sku
            selectedOptions { name value }
            inventoryItem { id }
            inventoryQuantity
          }
        }
      }
    }`,
    variables: { id: input.productId },
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
        errorCode: "TOPOLOGY_READ",
        errorMessage: result.message,
      };
    }
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: result.class,
      errorCode: "TOPOLOGY_READ",
      errorMessage: result.message,
    };
  }
  if (!result.data?.product) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "PRODUCT_MISSING",
      errorMessage: "Shopify product missing during topology read",
    };
  }
  return {
    ok: true,
    topology: {
      options: result.data.product.options.map((o) => ({
        id: o.id,
        name: o.name,
        position: o.position,
        optionValues: o.optionValues,
      })),
      variants: result.data.product.variants.nodes,
    },
  };
}

function toRemoteSnaps(topology: RemoteTopology): ShopifyRemoteVariantSnap[] {
  return topology.variants
    .filter((v) => v.inventoryItem?.id)
    .map((v) => ({
      shopifyVariantId: v.id,
      shopifyInventoryItemId: v.inventoryItem!.id,
      selectedOptions: v.selectedOptions,
      priceCents: shopifyCentsFromMoneyString(v.price),
      sku: v.sku,
      available: typeof v.inventoryQuantity === "number" ? v.inventoryQuantity : null,
      tracked: true,
    }));
}

async function productOptionsCreate(input: {
  connectionId: string;
  productId: string;
  options: Array<{ name: string; values: Array<{ name: string }> }>;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<{ ok: true } | ({ ok: false } & HandlerFailure)> {
  if (input.options.length < 1) return { ok: true };
  const result = await executeShopifyAdminGraphql<{
    productOptionsCreate: {
      userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyProductOptionsCreate",
    // LEAVE_AS_IS: add axes without auto-creating the cartesian product; existing
    // variants receive the first new value until bulk create/update assigns the rest.
    document: `mutation ShopifyProductOptionsCreate($productId: ID!, $options: [OptionCreateInput!]!, $variantStrategy: ProductOptionCreateVariantStrategy) {
      productOptionsCreate(productId: $productId, options: $options, variantStrategy: $variantStrategy) {
        userErrors { field message code }
      }
    }`,
    variables: {
      productId: input.productId,
      options: input.options,
      variantStrategy: "LEAVE_AS_IS",
    },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!result.ok) {
    return {
      ok: false,
      outcome:
        result.class === "THROTTLED" ||
        result.class === "TRANSIENT_PROVIDER" ||
        result.class === "NETWORK_UNKNOWN"
          ? "RETRY"
          : "DEAD",
      errorClass: result.class,
      errorCode: "OPTIONS_CREATE",
      errorMessage: result.message,
    };
  }
  const errors = result.data?.productOptionsCreate.userErrors ?? [];
  if (errors.length > 0) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: (errors[0]?.code ?? "OPTIONS_CREATE_USER_ERROR").slice(0, 64),
      errorMessage: (errors[0]?.message ?? "productOptionsCreate user error").slice(0, 500),
    };
  }
  return { ok: true };
}

/** Add option values onto an existing ProductOption (INW→Shopify outbound). */
async function productOptionAddValues(input: {
  connectionId: string;
  productId: string;
  optionId: string;
  values: Array<{ name: string }>;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<{ ok: true } | ({ ok: false } & HandlerFailure)> {
  if (input.values.length < 1) return { ok: true };
  const result = await executeShopifyAdminGraphql<{
    productOptionUpdate: {
      userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyProductOptionAddValues",
    document: `mutation ShopifyProductOptionAddValues($productId: ID!, $option: OptionUpdateInput!, $optionValuesToAdd: [OptionValueCreateInput!]) {
      productOptionUpdate(productId: $productId, option: $option, optionValuesToAdd: $optionValuesToAdd) {
        userErrors { field message code }
      }
    }`,
    variables: {
      productId: input.productId,
      option: { id: input.optionId },
      optionValuesToAdd: input.values,
    },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!result.ok) {
    return {
      ok: false,
      outcome:
        result.class === "THROTTLED" ||
        result.class === "TRANSIENT_PROVIDER" ||
        result.class === "NETWORK_UNKNOWN"
          ? "RETRY"
          : "DEAD",
      errorClass: result.class,
      errorCode: "OPTION_VALUES_ADD",
      errorMessage: result.message,
    };
  }
  const errors = result.data?.productOptionUpdate.userErrors ?? [];
  if (errors.length > 0) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: (errors[0]?.code ?? "OPTION_VALUES_ADD_USER_ERROR").slice(0, 64),
      errorMessage: (errors[0]?.message ?? "productOptionUpdate user error").slice(0, 500),
    };
  }
  return { ok: true };
}

/**
 * Delete option values the seller no longer uses. MANAGE also deletes Shopify
 * variants that reference those values — safer than bulk-deleting variants then
 * leaving orphan option values that collapse the product UI.
 */
async function productOptionDeleteValues(input: {
  connectionId: string;
  productId: string;
  optionId: string;
  valueIds: string[];
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<{ ok: true } | ({ ok: false } & HandlerFailure)> {
  if (input.valueIds.length < 1) return { ok: true };
  const result = await executeShopifyAdminGraphql<{
    productOptionUpdate: {
      userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyProductOptionDeleteValues",
    document: `mutation ShopifyProductOptionDeleteValues($productId: ID!, $option: OptionUpdateInput!, $optionValuesToDelete: [ID!]!, $variantStrategy: ProductOptionUpdateVariantStrategy) {
      productOptionUpdate(
        productId: $productId
        option: $option
        optionValuesToDelete: $optionValuesToDelete
        variantStrategy: $variantStrategy
      ) {
        userErrors { field message code }
      }
    }`,
    variables: {
      productId: input.productId,
      option: { id: input.optionId },
      optionValuesToDelete: input.valueIds,
      variantStrategy: "MANAGE",
    },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!result.ok) {
    return {
      ok: false,
      outcome:
        result.class === "THROTTLED" ||
        result.class === "TRANSIENT_PROVIDER" ||
        result.class === "NETWORK_UNKNOWN"
          ? "RETRY"
          : "DEAD",
      errorClass: result.class,
      errorCode: "OPTION_VALUES_DELETE",
      errorMessage: result.message,
    };
  }
  const errors = result.data?.productOptionUpdate.userErrors ?? [];
  if (errors.length > 0) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: (errors[0]?.code ?? "OPTION_VALUES_DELETE_USER_ERROR").slice(0, 64),
      errorMessage: (errors[0]?.message ?? "productOptionUpdate delete values user error").slice(
        0,
        500
      ),
    };
  }
  return { ok: true };
}

async function productOptionsReorder(input: {
  connectionId: string;
  productId: string;
  options: Array<{ id: string; name?: string; values?: Array<{ id: string; name?: string }> }>;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<{ ok: true } | ({ ok: false } & HandlerFailure)> {
  const result = await executeShopifyAdminGraphql<{
    productOptionsReorder: {
      userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyProductOptionsReorder",
    document: `mutation ShopifyProductOptionsReorder($productId: ID!, $options: [OptionReorderInput!]!) {
      productOptionsReorder(productId: $productId, options: $options) {
        userErrors { field message code }
      }
    }`,
    variables: { productId: input.productId, options: input.options },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!result.ok) {
    return {
      ok: false,
      outcome:
        result.class === "THROTTLED" ||
        result.class === "TRANSIENT_PROVIDER" ||
        result.class === "NETWORK_UNKNOWN"
          ? "RETRY"
          : "DEAD",
      errorClass: result.class,
      errorCode: "OPTIONS_REORDER",
      errorMessage: result.message,
    };
  }
  const errors = result.data?.productOptionsReorder.userErrors ?? [];
  if (errors.length > 0) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: (errors[0]?.code ?? "OPTIONS_REORDER_USER_ERROR").slice(0, 64),
      errorMessage: (errors[0]?.message ?? "productOptionsReorder user error").slice(0, 500),
    };
  }
  return { ok: true };
}

async function productVariantsBulkCreate(input: {
  connectionId: string;
  productId: string;
  variants: Array<{
    optionValues: Array<{ optionName: string; name: string }>;
    price: string;
    sku?: string;
  }>;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<
  | {
      ok: true;
      created: Array<{
        shopifyVariantId: string;
        shopifyInventoryItemId: string;
        selectedOptions: Array<{ name: string; value: string }>;
      }>;
    }
  | ({ ok: false } & HandlerFailure)
> {
  if (input.variants.length < 1) return { ok: true, created: [] };
  const result = await executeShopifyAdminGraphql<{
    productVariantsBulkCreate: {
      productVariants: Array<{
        id: string;
        selectedOptions: Array<{ name: string; value: string }>;
        inventoryItem: { id: string } | null;
      }> | null;
      userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyProductVariantsBulkCreate",
    document: `mutation ShopifyProductVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        productVariants {
          id
          selectedOptions { name value }
          inventoryItem { id }
        }
        userErrors { field message code }
      }
    }`,
    variables: {
      productId: input.productId,
      variants: input.variants.map((v) => ({
        optionValues: v.optionValues,
        price: v.price,
        ...(v.sku ? { inventoryItem: { sku: v.sku } } : {}),
      })),
    },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!result.ok) {
    return {
      ok: false,
      outcome:
        result.class === "THROTTLED" ||
        result.class === "TRANSIENT_PROVIDER" ||
        result.class === "NETWORK_UNKNOWN" ||
        result.outcomeUnknown
          ? "RETRY"
          : "DEAD",
      errorClass: result.class,
      errorCode: "VARIANTS_BULK_CREATE",
      errorMessage: result.message,
    };
  }
  const errors = result.data?.productVariantsBulkCreate.userErrors ?? [];
  if (errors.length > 0) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: (errors[0]?.code ?? "VARIANTS_BULK_CREATE_USER_ERROR").slice(0, 64),
      errorMessage: (errors[0]?.message ?? "productVariantsBulkCreate user error").slice(0, 500),
    };
  }
  const created = (result.data?.productVariantsBulkCreate.productVariants ?? [])
    .filter((row) => row.inventoryItem?.id)
    .map((row) => ({
      shopifyVariantId: row.id,
      shopifyInventoryItemId: row.inventoryItem!.id,
      selectedOptions: row.selectedOptions,
    }));
  return { ok: true, created };
}

async function productVariantsBulkDelete(input: {
  connectionId: string;
  productId: string;
  variantIds: string[];
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<{ ok: true } | ({ ok: false } & HandlerFailure)> {
  if (input.variantIds.length < 1) return { ok: true };
  const result = await executeShopifyAdminGraphql<{
    productVariantsBulkDelete: {
      userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyProductVariantsBulkDelete",
    document: `mutation ShopifyProductVariantsBulkDelete($productId: ID!, $variantsIds: [ID!]!) {
      productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
        userErrors { field message code }
      }
    }`,
    variables: {
      productId: input.productId,
      variantsIds: input.variantIds,
    },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!result.ok) {
    return {
      ok: false,
      outcome:
        result.class === "THROTTLED" ||
        result.class === "TRANSIENT_PROVIDER" ||
        result.class === "NETWORK_UNKNOWN" ||
        result.outcomeUnknown
          ? "RETRY"
          : "DEAD",
      errorClass: result.class,
      errorCode: "VARIANTS_BULK_DELETE",
      errorMessage: result.message,
    };
  }
  const errors = result.data?.productVariantsBulkDelete.userErrors ?? [];
  if (errors.length > 0) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: (errors[0]?.code ?? "VARIANTS_BULK_DELETE_USER_ERROR").slice(0, 64),
      errorMessage: (errors[0]?.message ?? "productVariantsBulkDelete user error").slice(0, 500),
    };
  }
  return { ok: true };
}

async function rebuildStoreItemVariantsFromRemote(input: {
  memberId: string;
  storeItemId: string;
  listingLinkId: string;
  connectionId: string;
  topology: RemoteTopology;
}): Promise<void> {
  const remoteSnaps = toRemoteSnaps(input.topology);
  const item = await prisma.storeItem.findFirst({
    where: { id: input.storeItemId, memberId: input.memberId },
    select: { inventoryTracking: true },
  });
  if (!item) return;

  const inventoryTracking =
    item.inventoryTracking === "made_to_order" ? "made_to_order" : "tracked";

  const multiVariant =
    remoteSnaps.length > 1 ||
    remoteSnaps.some((row) => !isShopifyDefaultTitleOnly(row.selectedOptions));

  if (!multiVariant) {
    await prisma.$transaction(async (tx) => {
      await tx.storeItem.update({
        where: { id: input.storeItemId },
        data: { variants: Prisma.JsonNull },
      });
      await projectStoreItemQuantity(tx, input.storeItemId);
    });
    return;
  }

  const axes = input.topology.options
    .filter((o) => !(o.name.trim() === "Title" && o.optionValues.every((v) => v.name === "Default Title")))
    .map((o, index) => ({
      name: o.name,
      position: o.position > 0 ? o.position : index + 1,
      values: o.optionValues.map((v) => v.name),
    }))
    .filter((axis) => axis.name.length > 0 && axis.values.length > 0);

  if (axes.length < 1) {
    await prisma.$transaction(async (tx) => {
      await projectStoreItemQuantity(tx, input.storeItemId);
    });
    return;
  }

  const matrix = shopifyTopologyToInwMatrix({
    axes,
    variants: remoteSnaps,
    inventoryTracking,
  });

  const maps = await prisma.shopifyVariantMap.findMany({
    where: {
      shopifyListingLinkId: input.listingLinkId,
      shopifyConnectionId: input.connectionId,
    },
    select: { shopifyVariantId: true, storeVariantId: true },
  });
  const storeVariantByShopify = new Map(
    maps.map((row) => [row.shopifyVariantId, row.storeVariantId] as const)
  );

  const skus = matrix.skus.map((sku, index) => {
    const rem = remoteSnaps[index];
    const storeVariantId = rem ? storeVariantByShopify.get(rem.shopifyVariantId) : undefined;
    return storeVariantId ? { ...sku, storeVariantId } : sku;
  });

  await prisma.$transaction(async (tx) => {
    await tx.storeItem.update({
      where: { id: input.storeItemId },
      data: {
        // Persist Json object — never JSON.stringify (double-encodes; mobile falls to simple qty).
        variants: {
          ...matrix,
          skus,
        },
        ...(matrix.skus[0]?.priceCents != null && matrix.skus[0].priceCents > 0
          ? { priceCents: matrix.skus[0].priceCents }
          : {}),
      },
    });
    await projectStoreItemQuantity(tx, input.storeItemId);
  });
}

function realAxisNames(
  selectedOptions: Array<{ name: string; value: string }>
): Set<string> {
  const keys = selectedOptions
    .map((row) => row.name.trim().toLowerCase())
    .filter((name) => name.length > 0 && name !== "title");
  if (keys.length > 0) return new Set(keys);
  return new Set(
    selectedOptions.map((row) => row.name.trim().toLowerCase()).filter((name) => name.length > 0)
  );
}

function localVariantsHaveRealOptions(localVariants: ShopifyTopologyLocalVariant[]): boolean {
  return localVariants.some(
    (row) => row.selectedOptions.length > 0 && !isShopifyDefaultTitleOnly(row.selectedOptions)
  );
}

/**
 * A simple Shopify product is Title / Default Title. Adding color and size in INW
 * cannot be a partial variant create — replace the whole option set, and keep the
 * product live if it is already live.
 */
async function pushInwOptionsOntoDefaultShopifyProduct(input: {
  connectionId: string;
  memberId: string;
  listingLinkId: string;
  storeItemId: string;
  localVariants: ShopifyTopologyLocalVariant[];
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<{ ok: true } | ({ ok: false } & HandlerFailure)> {
  const rows = input.localVariants.filter(
    (row) => row.selectedOptions.length > 0 && !isShopifyDefaultTitleOnly(row.selectedOptions)
  );
  if (rows.length < 1) return { ok: true };

  const axisMap = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const opt of row.selectedOptions) {
      const name = opt.name.trim();
      const value = opt.value.trim();
      if (!name || !value) continue;
      if (!axisMap.has(name)) axisMap.set(name, new Set());
      axisMap.get(name)!.add(value);
    }
  }
  if (axisMap.size < 1) return { ok: true };

  const item = await prisma.storeItem.findFirst({
    where: { id: input.storeItemId, memberId: input.memberId },
    select: { title: true, description: true },
  });
  if (!item) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "STORE_ITEM_MISSING",
      errorMessage: "INW listing was not found",
    };
  }

  const remote = await productSetShopifyMultiVariantDraftListing({
    connectionId: input.connectionId,
    storeItemId: input.storeItemId,
    title: item.title,
    descriptionHtml: item.description,
    preserveStatus: true,
    productOptions: Array.from(axisMap.entries()).map(([name, values]) => ({
      name,
      values: Array.from(values).map((value) => ({ name: value })),
    })),
    variants: rows.map((row) => ({
      optionValues: row.selectedOptions.map((opt) => ({
        optionName: opt.name,
        name: opt.value,
      })),
      price: centsToShopifyMoney(row.priceCents),
      ...(row.sku ? { sku: row.sku } : {}),
    })),
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!remote.ok) {
    await prisma.shopifyListingLink.update({
      where: { id: input.listingLinkId },
      data: {
        readiness: "ACTION_REQUIRED",
        contentHealth: "PAUSED",
        issueCode: "OPTIONS_NOT_PUSHED",
        issueSeverity: "ACTION_REQUIRED",
        issueFingerprint: "options-not-pushed",
        issueMessage: `Color and size changes did not reach Shopify. ${remote.errorMessage}`.slice(0, 500),
      },
    });
    return {
      ok: false,
      outcome: remote.class === "RETRY" ? "RETRY" : "DEAD",
      errorClass: remote.errorClass,
      errorCode: remote.errorCode,
      errorMessage: remote.errorMessage,
    };
  }

  const correlation = correlateVariantsByOptionCombination({
    requested: rows.map((row) => ({
      storeVariantId: row.storeVariantId,
      selectedOptions: row.selectedOptions,
    })),
    remote: remote.variants.map((variant) => ({
      shopifyVariantId: variant.variantId,
      shopifyInventoryItemId: variant.inventoryItemId,
      selectedOptions: variant.selectedOptions,
    })),
  });
  if (!correlation.ok) {
    await prisma.shopifyListingLink.update({
      where: { id: input.listingLinkId },
      data: {
        readiness: "ACTION_REQUIRED",
        contentHealth: "PAUSED",
        issueCode: "OPTIONS_NOT_MATCHED",
        issueSeverity: "ACTION_REQUIRED",
        issueFingerprint: "options-not-matched",
        issueMessage:
          "Shopify received the options, but INW could not match each color and size. Use Reconnect listing.",
      },
    });
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: correlation.code,
      errorMessage: correlation.message,
    };
  }

  await prisma.shopifyVariantMap.deleteMany({
    where: {
      shopifyListingLinkId: input.listingLinkId,
      shopifyConnectionId: input.connectionId,
    },
  });
  await appendShopifyVariantMaps(prisma, {
    memberId: input.memberId,
    connectionId: input.connectionId,
    listingLinkId: input.listingLinkId,
    variants: correlation.pairs,
  });
  return { ok: true };
}

/**
 * Apply topology mutations for an existing mapped listing.
 * Never sends a partial variant list through productSet.
 */
export async function syncShopifyListingTopology(input: {
  connectionId: string;
  memberId: string;
  listingLinkId: string;
  productId: string;
  storeItemId: string;
  localVariants: ShopifyTopologyLocalVariant[];
  /** Mapped variants the seller already removed in INW. Deleted on Shopify, not re-imported. */
  removedVariants?: Array<{ storeVariantId: string; shopifyVariantId: string }>;
  desiredOptionOrder?: string[];
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<
  | { ok: true; plan: ShopifyTopologyDiffPlan; importedStoreVariantIds: string[] }
  | ({ ok: false } & HandlerFailure)
> {
  const remoteRead = await readShopifyProductTopology({
    connectionId: input.connectionId,
    productId: input.productId,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!remoteRead.ok) return remoteRead;

  const remoteSnaps = toRemoteSnaps(remoteRead.topology);
  const remoteIsDefaultTitle =
    remoteSnaps.length > 0 &&
    remoteSnaps.every((row) => isShopifyDefaultTitleOnly(row.selectedOptions));
  if (remoteIsDefaultTitle && localVariantsHaveRealOptions(input.localVariants)) {
    const pushed = await pushInwOptionsOntoDefaultShopifyProduct(input);
    if (!pushed.ok) return pushed;
    await clearResolvedTopologyConflict(input.listingLinkId);
    return { ok: true, plan: { kind: "NOOP" }, importedStoreVariantIds: [] };
  }

  const plan = planShopifyTopologyDiff({
    localVariants: input.localVariants,
    remoteVariants: toRemoteSnaps(remoteRead.topology),
    remoteOptions: remoteRead.topology.options.map((o) => ({
      id: o.id,
      name: o.name,
      position: o.position,
      // Preserve Shopify's returned optionValues list order (no provider value.position field).
      values: o.optionValues.map((v, index) => ({
        id: v.id,
        name: v.name,
        position: index + 1,
      })),
    })),
    desiredOptionOrder: input.desiredOptionOrder,
    removedVariants: input.removedVariants,
  });

  if (plan.kind === "NOOP") {
    // Refresh matrix from remote unless INW is a strict axis superset (do not clobber).
    const remoteAxisNames = new Set(
      toRemoteSnaps(remoteRead.topology).flatMap((v) =>
        v.selectedOptions.map((o) => o.name.trim().toLowerCase()).filter(Boolean)
      )
    );
    const localAxisNames = new Set(
      input.localVariants.flatMap((v) =>
        v.selectedOptions.map((o) => o.name.trim().toLowerCase()).filter(Boolean)
      )
    );
    const localStrictSuperset =
      localAxisNames.size > remoteAxisNames.size &&
      [...remoteAxisNames].every((n) => localAxisNames.has(n));
    if (!localStrictSuperset) {
      await rebuildStoreItemVariantsFromRemote({
        memberId: input.memberId,
        storeItemId: input.storeItemId,
        listingLinkId: input.listingLinkId,
        connectionId: input.connectionId,
        topology: remoteRead.topology,
      });
    }
    await clearResolvedTopologyConflict(input.listingLinkId);
    return { ok: true, plan, importedStoreVariantIds: [] };
  }
  if (plan.kind === "CONFLICT") {
    await prisma.shopifyListingLink.update({
      where: { id: input.listingLinkId },
      data: {
        readiness: "ACTION_REQUIRED",
        contentHealth: "PAUSED",
        issueCode: plan.code,
        issueSeverity: "ACTION_REQUIRED",
        issueMessage: plan.message.slice(0, 500),
      },
    });
    return { ok: true, plan, importedStoreVariantIds: [] };
  }

  // MUTATE — never productSet partial.
  void plan.forbidProductSetPartial;

  // Shopify added an option axis (Color+Size → +Material). Pull that in.
  // Do not push the old INW option set back out; that call fails and blocks the import.
  const remoteAxisNames = new Set(
    remoteSnaps.flatMap((row) => [...realAxisNames(row.selectedOptions)])
  );
  const localAxisNames = new Set(
    input.localVariants.flatMap((row) => [...realAxisNames(row.selectedOptions)])
  );
  const remoteAddedAxis =
    remoteAxisNames.size > localAxisNames.size &&
    [...localAxisNames].every((name) => remoteAxisNames.has(name));

  // Pull remote option labels onto mapped StoreVariants (inbound).
  // Keep the existing INW quantity. A new Shopify variant is added below with its own quantity.
  for (const row of plan.renameOptionValues) {
    const options = shopifySelectedOptionsToInwOptions(
      row.optionValues.map((ov) => ({ name: ov.optionName, value: ov.name }))
    );
    await prisma.storeVariant.updateMany({
      where: {
        id: row.storeVariantId,
        storeItemId: input.storeItemId,
        memberId: input.memberId,
      },
      data: { options },
    });
  }

  const reboundStoreVariantIds = new Set(
    plan.importRemoteVariants
      .map((row) => row.storeVariantId)
      .filter((id): id is string => Boolean(id))
  );
  for (const row of plan.retireMappings) {
    if (!reboundStoreVariantIds.has(row.storeVariantId)) continue;
    await prisma.shopifyVariantMap.deleteMany({
      where: {
        shopifyListingLinkId: input.listingLinkId,
        shopifyConnectionId: input.connectionId,
        shopifyVariantId: row.shopifyVariantId,
        storeVariantId: row.storeVariantId,
      },
    });
  }

  const importedStoreVariantIds: string[] = [];
  const storeItem = await prisma.storeItem.findFirst({
    where: { id: input.storeItemId, memberId: input.memberId },
    select: { inventoryTracking: true },
  });
  const inventoryMode =
    storeItem?.inventoryTracking === "made_to_order" ? "MADE_TO_ORDER" : "TRACKED_FINITE";

  for (const rem of plan.importRemoteVariants) {
    let storeVariantId = rem.storeVariantId;
    const options = shopifySelectedOptionsToInwOptions(rem.selectedOptions);
    const priceCents = Math.max(1, rem.priceCents || 1);
    if (!storeVariantId) {
      // Create one immutable INW variant for a newly observed Shopify variant.
      const openingQty =
        inventoryMode === "TRACKED_FINITE" ? Math.max(0, rem.available ?? 0) : null;
      const createdVariant = await prisma.storeVariant.create({
        data: {
          memberId: input.memberId,
          storeItemId: input.storeItemId,
          options,
          priceCents,
          sku: rem.sku,
          isDefault: false,
        },
        select: { id: true },
      });
      storeVariantId = createdVariant.id;
      importedStoreVariantIds.push(storeVariantId);
      await prisma.inventoryState.create({
        data: {
          variantId: storeVariantId,
          memberId: input.memberId,
          storeItemId: input.storeItemId,
          mode: inventoryMode,
          onHand: inventoryMode === "TRACKED_FINITE" ? openingQty : null,
          reserved: inventoryMode === "TRACKED_FINITE" ? 0 : null,
          availabilityVersion: 1,
        },
      });
    } else {
      // Rebind: local placeholder / unmapped row correlated to a new Shopify GID.
      // Take Shopify price (and qty below). Do not keep stale listing defaults.
      await prisma.storeVariant.updateMany({
        where: {
          id: storeVariantId,
          storeItemId: input.storeItemId,
          memberId: input.memberId,
        },
        data: {
          options,
          priceCents,
          sku: rem.sku,
        },
      });
      const existingState = await prisma.inventoryState.findUnique({
        where: { variantId: storeVariantId },
        select: { variantId: true },
      });
      if (!existingState && inventoryMode === "TRACKED_FINITE") {
        const openingQty = Math.max(0, rem.available ?? 0);
        await prisma.inventoryState.create({
          data: {
            variantId: storeVariantId,
            memberId: input.memberId,
            storeItemId: input.storeItemId,
            mode: inventoryMode,
            onHand: openingQty,
            reserved: 0,
            availabilityVersion: 1,
          },
        });
      }
    }
    await appendShopifyVariantMaps(prisma, {
      memberId: input.memberId,
      connectionId: input.connectionId,
      listingLinkId: input.listingLinkId,
      variants: [
        {
          storeVariantId,
          shopifyVariantId: rem.shopifyVariantId,
          shopifyInventoryItemId: rem.shopifyInventoryItemId,
        },
      ],
    });
    // importRemoteVariants are new Shopify GIDs (create or first correlation).
    // Always take Shopify available. Mapped-GID renames above keep preexisting INW qty.
    if (typeof rem.available === "number" && Number.isFinite(rem.available)) {
      await adoptRemoteAvailableOntoMappedVariant({
        storeVariantId,
        listingLinkId: input.listingLinkId,
        connectionId: input.connectionId,
        shopifyVariantId: rem.shopifyVariantId,
        available: Math.max(0, Math.trunc(rem.available)),
      });
    }
  }

  // Retire mappings for provider-deleted variants; mark StoreVariant RETIRED so qty projection drops it.
  for (const row of plan.retireMappings) {
    await prisma.shopifyVariantMap.deleteMany({
      where: {
        shopifyListingLinkId: input.listingLinkId,
        shopifyConnectionId: input.connectionId,
        shopifyVariantId: row.shopifyVariantId,
        storeVariantId: row.storeVariantId,
      },
    });
    if (reboundStoreVariantIds.has(row.storeVariantId)) continue;
    await prisma.storeVariant.updateMany({
      where: {
        id: row.storeVariantId,
        storeItemId: input.storeItemId,
        memberId: input.memberId,
        status: "ACTIVE",
      },
      data: { status: "RETIRED", retiredAt: input.now ?? new Date() },
    });
  }

  // Shopify added an axis (inbound import). Do not push the old INW option set back.
  // INW removing an axis looks the same on axis counts but has delete/create work — continue.
  if (
    remoteAddedAxis &&
    plan.deleteRemoteVariants.length === 0 &&
    plan.createVariants.length === 0
  ) {
    // Rebuild from the remote we just pulled (Material import, etc.).
    if (
      plan.renameOptionValues.length > 0 ||
      plan.importRemoteVariants.length > 0 ||
      plan.retireMappings.length > 0
    ) {
      await rebuildStoreItemVariantsFromRemote({
        memberId: input.memberId,
        storeItemId: input.storeItemId,
        listingLinkId: input.listingLinkId,
        connectionId: input.connectionId,
        topology: remoteRead.topology,
      });
    }
    await clearResolvedTopologyConflict(input.listingLinkId);
    return { ok: true, plan, importedStoreVariantIds };
  }

  // Deleting nearly every remote GID then bulk-creating replacements leaves one
  // orphan Shopify variant when create fails (axis mismatch). Same for removing
  // an option axis. Rewrite the whole option+variant set from INW instead.
  const activeLocalCount = input.localVariants.filter(
    (row) => row.selectedOptions.length > 0 && !isShopifyDefaultTitleOnly(row.selectedOptions)
  ).length;
  const localRemovedAxis =
    remoteAxisNames.size > localAxisNames.size &&
    localAxisNames.size > 0 &&
    [...localAxisNames].every((name) => remoteAxisNames.has(name));
  const needsFullRewrite =
    localRemovedAxis ||
    (plan.deleteRemoteVariants.length > 0 && plan.createVariants.length > 0) ||
    (plan.deleteRemoteVariants.length > 0 &&
      plan.deleteRemoteVariants.length >= Math.max(0, remoteSnaps.length - 1) &&
      activeLocalCount > 1);

  if (needsFullRewrite && activeLocalCount > 0) {
    const rewritten = await pushInwOptionsOntoDefaultShopifyProduct(input);
    if (!rewritten.ok) return rewritten;
    const refreshed = await readShopifyProductTopology({
      connectionId: input.connectionId,
      productId: input.productId,
      fetchImpl: input.fetchImpl,
      now: input.now,
    });
    if (refreshed.ok) {
      await rebuildStoreItemVariantsFromRemote({
        memberId: input.memberId,
        storeItemId: input.storeItemId,
        listingLinkId: input.listingLinkId,
        connectionId: input.connectionId,
        topology: refreshed.topology,
      });
    }
    await clearResolvedTopologyConflict(input.listingLinkId);
    return { ok: true, plan, importedStoreVariantIds };
  }

  // Drop option values the seller removed. MANAGE deletes their Shopify variants too.
  const localValuesByAxis = new Map<string, Set<string>>();
  for (const row of input.localVariants) {
    for (const opt of row.selectedOptions) {
      const axis = opt.name.trim().toLowerCase();
      const value = opt.value.trim().toLowerCase();
      if (!axis || axis === "title" || !value) continue;
      if (!localValuesByAxis.has(axis)) localValuesByAxis.set(axis, new Set());
      localValuesByAxis.get(axis)!.add(value);
    }
  }
  let deletedOptionValues = false;
  for (const option of remoteRead.topology.options) {
    const axis = option.name.trim().toLowerCase();
    if (!axis || axis === "title") continue;
    const wanted = localValuesByAxis.get(axis);
    if (!wanted || wanted.size < 1) continue;
    const toDelete = option.optionValues.filter(
      (v) => !wanted.has(v.name.trim().toLowerCase())
    );
    // Keep at least one value on the option; axis removal uses the rewrite path.
    if (toDelete.length < 1 || toDelete.length >= option.optionValues.length) continue;
    const removed = await productOptionDeleteValues({
      connectionId: input.connectionId,
      productId: input.productId,
      optionId: option.id,
      valueIds: toDelete.map((v) => v.id),
      fetchImpl: input.fetchImpl,
      now: input.now,
    });
    if (!removed.ok) return removed;
    deletedOptionValues = true;
  }

  // Re-read after option-value MANAGE deletes so bulkDelete skips already-gone GIDs.
  let topologyAfterDeletes = remoteRead.topology;
  if (deletedOptionValues || plan.deleteRemoteVariants.length > 0) {
    const afterValues = await readShopifyProductTopology({
      connectionId: input.connectionId,
      productId: input.productId,
      fetchImpl: input.fetchImpl,
      now: input.now,
    });
    if (!afterValues.ok) return afterValues;
    topologyAfterDeletes = afterValues.topology;
  }

  const remoteAfterSnaps = toRemoteSnaps(topologyAfterDeletes);
  const remoteAfterGids = new Set(remoteAfterSnaps.map((row) => row.shopifyVariantId));
  const stillPresentDeletes = plan.deleteRemoteVariants.filter((row) =>
    remoteAfterGids.has(row.shopifyVariantId)
  );
  if (stillPresentDeletes.length > 0) {
    // Shopify requires at least one variant on the product.
    const maxDelete = Math.max(0, remoteAfterSnaps.length - 1);
    const batch = stillPresentDeletes.slice(0, maxDelete);
    if (batch.length > 0) {
      const deleted = await productVariantsBulkDelete({
        connectionId: input.connectionId,
        productId: input.productId,
        variantIds: batch.map((row) => row.shopifyVariantId),
        fetchImpl: input.fetchImpl,
        now: input.now,
      });
      if (!deleted.ok) return deleted;
    }
  }
  // Drop maps for every seller-removed GID (MANAGE and bulkDelete).
  for (const row of plan.deleteRemoteVariants) {
    await prisma.shopifyVariantMap.deleteMany({
      where: {
        shopifyListingLinkId: input.listingLinkId,
        shopifyConnectionId: input.connectionId,
        shopifyVariantId: row.shopifyVariantId,
        storeVariantId: row.storeVariantId,
      },
    });
  }

  // Refresh option list before creates (values/axes may have changed above).
  let topologyForCreate = topologyAfterDeletes;
  if (stillPresentDeletes.length > 0 || deletedOptionValues) {
    const afterVariantDelete = await readShopifyProductTopology({
      connectionId: input.connectionId,
      productId: input.productId,
      fetchImpl: input.fetchImpl,
      now: input.now,
    });
    if (!afterVariantDelete.ok) return afterVariantDelete;
    topologyForCreate = afterVariantDelete.topology;
  }

  // Ensure new option values exist before bulk create (new axes AND values on existing axes).
  if (plan.createOptionValues.length > 0) {
    const remoteByName = new Map(
      topologyForCreate.options.map((o) => [o.name.trim(), o] as const)
    );
    const newAxes = plan.createOptionValues
      .filter((row) => !remoteByName.has(row.optionName))
      .map((row) => ({
        name: row.optionName,
        values: row.values.map((name) => ({ name })),
      }));
    if (newAxes.length > 0) {
      const created = await productOptionsCreate({
        connectionId: input.connectionId,
        productId: input.productId,
        options: newAxes,
        fetchImpl: input.fetchImpl,
        now: input.now,
      });
      if (!created.ok) return created;
    }
    for (const row of plan.createOptionValues) {
      const existing = remoteByName.get(row.optionName);
      if (!existing) continue;
      const have = new Set(existing.optionValues.map((v) => v.name.trim().toLowerCase()));
      const missing = row.values
        .map((name) => name.trim())
        .filter((name) => name && !have.has(name.toLowerCase()))
        .map((name) => ({ name }));
      if (missing.length < 1) continue;
      const added = await productOptionAddValues({
        connectionId: input.connectionId,
        productId: input.productId,
        optionId: existing.id,
        values: missing,
        fetchImpl: input.fetchImpl,
        now: input.now,
      });
      if (!added.ok) return added;
    }
  }

  if (plan.reorderOptionNames && plan.reorderOptionNames.length > 0) {
    const byName = new Map(topologyForCreate.options.map((o) => [o.name.trim(), o]));
    const reorderInput = plan.reorderOptionNames
      .map((name) => byName.get(name))
      .filter((o): o is NonNullable<typeof o> => Boolean(o))
      .map((o) => ({
        id: o.id,
        values: o.optionValues.map((v) => ({ id: v.id })),
      }));
    if (reorderInput.length === plan.reorderOptionNames.length) {
      const reordered = await productOptionsReorder({
        connectionId: input.connectionId,
        productId: input.productId,
        options: reorderInput,
        fetchImpl: input.fetchImpl,
        now: input.now,
      });
      if (!reordered.ok) return reordered;
    }
  }

  if (plan.createVariants.length > 0) {
    const created = await productVariantsBulkCreate({
      connectionId: input.connectionId,
      productId: input.productId,
      variants: plan.createVariants.map((v) => ({
        optionValues: v.optionValues,
        price: centsToShopifyMoney(v.priceCents),
        ...(v.sku ? { sku: v.sku } : {}),
      })),
      fetchImpl: input.fetchImpl,
      now: input.now,
    });
    if (!created.ok) return created;

    const correlation = correlateVariantsByOptionCombination({
      requested: plan.createVariants.map((v) => ({
        storeVariantId: v.storeVariantId,
        selectedOptions: v.optionValues.map((o) => ({ name: o.optionName, value: o.name })),
      })),
      remote: created.created,
    });
    if (!correlation.ok) {
      return {
        ok: false,
        outcome: "DEAD",
        errorClass: "GRAPHQL_PERMANENT",
        errorCode: correlation.code,
        errorMessage: correlation.message,
      };
    }
    await appendShopifyVariantMaps(prisma, {
      memberId: input.memberId,
      connectionId: input.connectionId,
      listingLinkId: input.listingLinkId,
      variants: correlation.pairs,
    });
  }

  const finalRead = await readShopifyProductTopology({
    connectionId: input.connectionId,
    productId: input.productId,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (finalRead.ok) {
    await rebuildStoreItemVariantsFromRemote({
      memberId: input.memberId,
      storeItemId: input.storeItemId,
      listingLinkId: input.listingLinkId,
      connectionId: input.connectionId,
      topology: finalRead.topology,
    });
  }

  await clearResolvedTopologyConflict(input.listingLinkId);
  return { ok: true, plan, importedStoreVariantIds };
}
