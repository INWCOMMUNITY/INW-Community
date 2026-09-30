import {
  appendShopifyVariantMaps,
  correlateVariantsByOptionCombination,
  planShopifyTopologyDiff,
  prisma,
  shopifyCentsFromMoneyString,
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

type RemoteTopology = {
  options: Array<{
    id: string;
    name: string;
    position: number;
    optionValues: Array<{ id: string; name: string; position?: number }>;
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
        optionValues: Array<{ id: string; name: string; position: number }>;
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
    document: `query ShopifyProductTopologyRead($id: ID!) {
      product(id: $id) {
        options {
          id
          name
          position
          optionValues { id name position }
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

async function productVariantsBulkUpdateOptionValues(input: {
  connectionId: string;
  productId: string;
  variants: Array<{
    id: string;
    optionValues: Array<{ optionName: string; name: string }>;
  }>;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<{ ok: true } | ({ ok: false } & HandlerFailure)> {
  if (input.variants.length < 1) return { ok: true };
  const result = await executeShopifyAdminGraphql<{
    productVariantsBulkUpdate: {
      userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyProductVariantsBulkRename",
    document: `mutation ShopifyProductVariantsBulkRename($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $allowPartialUpdates: Boolean) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: $allowPartialUpdates) {
        userErrors { field message code }
      }
    }`,
    variables: {
      productId: input.productId,
      variants: input.variants,
      allowPartialUpdates: false,
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
      errorCode: "VARIANTS_BULK_RENAME",
      errorMessage: result.message,
    };
  }
  const errors = result.data?.productVariantsBulkUpdate.userErrors ?? [];
  if (errors.length > 0) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: (errors[0]?.code ?? "VARIANTS_BULK_RENAME_USER_ERROR").slice(0, 64),
      errorMessage: (errors[0]?.message ?? "productVariantsBulkUpdate rename user error").slice(
        0,
        500
      ),
    };
  }
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
      values: o.optionValues.map((v) => ({ id: v.id, name: v.name, position: v.position })),
    })),
    desiredOptionOrder: input.desiredOptionOrder,
  });

  if (plan.kind === "NOOP") {
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

  // Ensure new option values exist before bulk create.
  if (plan.createOptionValues.length > 0) {
    const existingNames = new Set(remoteRead.topology.options.map((o) => o.name.trim()));
    const newAxes = plan.createOptionValues
      .filter((row) => !existingNames.has(row.optionName))
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
  }

  if (plan.renameOptionValues.length > 0) {
    const renamed = await productVariantsBulkUpdateOptionValues({
      connectionId: input.connectionId,
      productId: input.productId,
      variants: plan.renameOptionValues.map((row) => ({
        id: row.shopifyVariantId,
        optionValues: row.optionValues,
      })),
      fetchImpl: input.fetchImpl,
      now: input.now,
    });
    if (!renamed.ok) return renamed;
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
  for (const rem of plan.importRemoteVariants) {
    let storeVariantId = rem.storeVariantId;
    if (!storeVariantId) {
      // Create one immutable INW variant for a newly observed Shopify variant.
      const options: Record<string, string> = {};
      for (const opt of rem.selectedOptions) options[opt.name] = opt.value;
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

  // Retire mappings for provider-deleted variants without destroying canonical StoreVariant.
  for (const row of plan.retireMappings) {
    await prisma.shopifyVariantMap.deleteMany({
      where: {
        shopifyListingLinkId: input.listingLinkId,
        shopifyConnectionId: input.connectionId,
        shopifyVariantId: row.shopifyVariantId,
        storeVariantId: row.storeVariantId,
      },
    });
  }

  return { ok: true, plan, importedStoreVariantIds };
}
