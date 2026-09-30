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
    document: `mutation ShopifyProductOptionsCreate($productId: ID!, $options: [OptionCreateInput!]!) {
      productOptionsCreate(productId: $productId, options: $options) {
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
  });

  if (plan.kind === "NOOP") {
    // Still refresh seller-facing matrix (fixes string-encoded Json + stale SKU qtys).
    await rebuildStoreItemVariantsFromRemote({
      memberId: input.memberId,
      storeItemId: input.storeItemId,
      listingLinkId: input.listingLinkId,
      connectionId: input.connectionId,
      topology: remoteRead.topology,
    });
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

  // Ensure new option values exist before bulk create (new axes AND values on existing axes).
  if (plan.createOptionValues.length > 0) {
    const remoteByName = new Map(
      remoteRead.topology.options.map((o) => [o.name.trim(), o] as const)
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

  // Pull remote option labels onto mapped StoreVariants (inbound). Do not push to Shopify.
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

  if (plan.reorderOptionNames && plan.reorderOptionNames.length > 0) {
    const byName = new Map(remoteRead.topology.options.map((o) => [o.name.trim(), o]));
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

  const importedStoreVariantIds: string[] = [];
  const storeItem = await prisma.storeItem.findFirst({
    where: { id: input.storeItemId, memberId: input.memberId },
    select: { inventoryTracking: true },
  });
  const inventoryMode =
    storeItem?.inventoryTracking === "made_to_order" ? "MADE_TO_ORDER" : "TRACKED_FINITE";

  for (const rem of plan.importRemoteVariants) {
    let storeVariantId = rem.storeVariantId;
    if (!storeVariantId) {
      // Create one immutable INW variant for a newly observed Shopify variant.
      const options = shopifySelectedOptionsToInwOptions(rem.selectedOptions);
      const openingQty =
        inventoryMode === "TRACKED_FINITE" ? Math.max(0, rem.available ?? 0) : null;
      const createdVariant = await prisma.storeVariant.create({
        data: {
          memberId: input.memberId,
          storeItemId: input.storeItemId,
          options,
          priceCents: Math.max(1, rem.priceCents || 1),
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

  // Keep StoreItem.variants matrix in sync with observed Shopify topology after mutate.
  if (
    plan.renameOptionValues.length > 0 ||
    plan.importRemoteVariants.length > 0 ||
    plan.createVariants.length > 0 ||
    plan.retireMappings.length > 0
  ) {
    // Re-read remote after outbound creates so new GIDs are present.
    const refreshed =
      plan.createVariants.length > 0
        ? await readShopifyProductTopology({
            connectionId: input.connectionId,
            productId: input.productId,
            fetchImpl: input.fetchImpl,
            now: input.now,
          })
        : remoteRead;
    if (refreshed.ok) {
      await rebuildStoreItemVariantsFromRemote({
        memberId: input.memberId,
        storeItemId: input.storeItemId,
        listingLinkId: input.listingLinkId,
        connectionId: input.connectionId,
        topology: refreshed.topology,
      });
    }
  }

  await clearResolvedTopologyConflict(input.listingLinkId);
  return { ok: true, plan, importedStoreVariantIds };
}
