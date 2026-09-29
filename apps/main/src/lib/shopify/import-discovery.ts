import { prisma } from "database";
import {
  assertShopifyInventoryItemGid,
  assertShopifyProductGid,
  assertShopifyProductVariantGid,
  shopifyCentsFromMoneyString,
  shopifyTopologyToInwMatrix,
  validateShopifyImportTopology,
  SHOPIFY_MAX_OPTION_DIMENSIONS,
  SHOPIFY_MAX_VARIANTS,
} from "database";
import type { ShopifyOptionAxis, ShopifyRemoteVariantSnap } from "database";
import { executeShopifyAdminGraphql, type ShopifyFetch } from "./admin-graphql";

export type ShopifyImportCandidateVariant = {
  shopifyVariantId: string;
  shopifyInventoryItemId: string;
  priceCents: number;
  sku: string | null;
  inventoryTracked: boolean;
  requiresShipping: boolean | null;
  primaryLocationAvailable: number | null;
  selectedOptions: Array<{ name: string; value: string }>;
  mediaIds: string[];
};

export type ShopifyImportCandidate = {
  shopifyProductId: string;
  title: string;
  descriptionHtml: string;
  status: string;
  supported: boolean;
  unsupportedReason: string | null;
  /** Backward-compat: first variant price (or null). */
  priceCents: number | null;
  sku: string | null;
  shopifyVariantId: string | null;
  shopifyInventoryItemId: string | null;
  inventoryTracked: boolean | null;
  requiresShipping: boolean | null;
  primaryLocationAvailable: number | null;
  recommendedStockMode: "PHYSICAL" | "MADE_TO_ORDER" | null;
  imageUrl: string | null;
  /** Durable Product media nodes when available (import detail re-fetch). */
  productMedia: Array<{ shopifyMediaId: string; sourceUrl: string | null }>;
  /** Multi-variant topology: present when axes.length > 0 or variantCount > 1. */
  variants: ShopifyImportCandidateVariant[];
  axes: ShopifyOptionAxis[];
  matrix: ReturnType<typeof import("database").shopifyTopologyToInwMatrix> | null;
};

export type DiscoverShopifyImportCandidatesResult =
  | {
      status: "OK";
      connectionId: string;
      shopDomain: string;
      generation: number;
      primaryLocationId: string;
      candidates: ShopifyImportCandidate[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    }
  | {
      status: "ERROR";
      code:
        | "CONNECTION_REQUIRED"
        | "LOCATION_REQUIRED"
        | "PROVIDER_ERROR"
        | "UNAUTHORIZED";
      message: string;
    };

type GraphqlProductNode = {
  id: string;
  title: string | null;
  descriptionHtml: string | null;
  status: string | null;
  hasOnlyDefaultVariant: boolean | null;
  totalVariants: number | null;
  featuredImage: { url: string | null } | null;
  media?: {
    nodes: Array<{
      id: string;
      preview?: { image?: { url: string | null } | null } | null;
    }>;
  } | null;
  options?: Array<{ name: string; position: number; values: string[] }> | null;
  variants: {
    nodes: Array<{
      id: string;
      price: string | null;
      sku: string | null;
      selectedOptions?: Array<{ name: string; value: string }> | null;
      media?: { nodes: Array<{ id: string }> } | null;
      inventoryItem: {
        id: string;
        tracked: boolean | null;
        requiresShipping: boolean | null;
        inventoryLevel: {
          quantities: Array<{ name: string; quantity: number | null }>;
        } | null;
      } | null;
    }>;
  } | null;
};

function unsupportedBase(
  node: GraphqlProductNode,
  productId: string | null
): ShopifyImportCandidate {
  return {
    shopifyProductId: productId ?? node.id,
    title: (node.title ?? "").trim() || "Untitled",
    descriptionHtml: typeof node.descriptionHtml === "string" ? node.descriptionHtml : "",
    status: (node.status ?? "UNKNOWN").toString(),
    supported: false,
    unsupportedReason: null,
    priceCents: null,
    sku: null,
    shopifyVariantId: null,
    shopifyInventoryItemId: null,
    inventoryTracked: null,
    requiresShipping: null,
    primaryLocationAvailable: null,
    recommendedStockMode: null,
    imageUrl: node.featuredImage?.url ?? null,
    productMedia: (node.media?.nodes ?? []).map((m) => ({
      shopifyMediaId: m.id,
      sourceUrl: m.preview?.image?.url ?? null,
    })),
    variants: [],
    axes: [],
    matrix: null,
  };
}

function extractAvailable(
  inventoryItem: {
    inventoryLevel: { quantities: Array<{ name: string; quantity: number | null }> } | null;
  } | null
): number | null {
  const available =
    inventoryItem?.inventoryLevel?.quantities?.find((q) => q.name === "available")?.quantity ??
    null;
  return typeof available === "number" && Number.isFinite(available)
    ? Math.trunc(available)
    : null;
}

function classifyCandidate(node: GraphqlProductNode): ShopifyImportCandidate {
  const productId = (() => {
    try {
      return assertShopifyProductGid(node.id);
    } catch {
      return null;
    }
  })();

  const base = unsupportedBase(node, productId);
  if (!productId) {
    return { ...base, unsupportedReason: "Shopify product identity is invalid." };
  }

  const variantCount =
    typeof node.totalVariants === "number"
      ? node.totalVariants
      : node.variants?.nodes?.length ?? 0;
  const onlyDefault = node.hasOnlyDefaultVariant === true;
  const variantNodes = node.variants?.nodes ?? [];

  // ── Simple single-variant path (backward compat) ──
  if (onlyDefault && variantCount === 1) {
    const variant = variantNodes[0] ?? null;
    if (!variant) {
      return { ...base, unsupportedReason: "Shopify product has no importable variant." };
    }

    let variantId: string;
    let inventoryItemId: string;
    try {
      variantId = assertShopifyProductVariantGid(variant.id);
      if (!variant.inventoryItem?.id) {
        return { ...base, unsupportedReason: "Shopify inventory item identity is missing." };
      }
      inventoryItemId = assertShopifyInventoryItemGid(variant.inventoryItem.id);
    } catch {
      return {
        ...base,
        unsupportedReason: "Shopify variant or inventory identity is invalid.",
      };
    }

    const priceCents = shopifyCentsFromMoneyString(variant.price ?? "");
    if (!Number.isFinite(priceCents) || priceCents < 1) {
      return {
        ...base,
        shopifyVariantId: variantId,
        shopifyInventoryItemId: inventoryItemId,
        unsupportedReason: "Price is missing or incompatible with INW money model.",
      };
    }

    const tracked = Boolean(variant.inventoryItem?.tracked);
    const availableQty = extractAvailable(variant.inventoryItem);

    if (tracked && availableQty == null) {
      return {
        ...base,
        shopifyVariantId: variantId,
        shopifyInventoryItemId: inventoryItemId,
        priceCents,
        sku: variant.sku?.trim() || null,
        inventoryTracked: tracked,
        requiresShipping: variant.inventoryItem?.requiresShipping ?? null,
        unsupportedReason: "Inventory unavailable at selected Shopify location.",
      };
    }

    return {
      ...base,
      supported: true,
      unsupportedReason: null,
      priceCents,
      sku: variant.sku?.trim() || null,
      shopifyVariantId: variantId,
      shopifyInventoryItemId: inventoryItemId,
      inventoryTracked: tracked,
      requiresShipping: variant.inventoryItem?.requiresShipping ?? null,
      primaryLocationAvailable: availableQty,
      recommendedStockMode: tracked ? "PHYSICAL" : "MADE_TO_ORDER",
    };
  }

  // ── Multi-variant path ──
  const options = node.options ?? [];
  if (options.length < 1 || options.length > SHOPIFY_MAX_OPTION_DIMENSIONS) {
    return {
      ...base,
      unsupportedReason: `Product has ${options.length} option dimensions; INW supports 1–${SHOPIFY_MAX_OPTION_DIMENSIONS}.`,
    };
  }
  if (variantCount < 1 || variantCount > SHOPIFY_MAX_VARIANTS) {
    return {
      ...base,
      unsupportedReason: `Product has ${variantCount} variants; INW supports 1–${SHOPIFY_MAX_VARIANTS}.`,
    };
  }
  if (variantNodes.length !== variantCount) {
    return {
      ...base,
      unsupportedReason: `Shopify returned partial variant data (${variantNodes.length}/${variantCount}); product too large for current query.`,
    };
  }

  const axes: ShopifyOptionAxis[] = options.map((o) => ({
    name: o.name,
    position: o.position,
    values: o.values,
  }));

  const snaps: ShopifyRemoteVariantSnap[] = [];
  const candidateVariants: ShopifyImportCandidateVariant[] = [];
  let allTracked = true;
  let anyTracked = false;

  for (const vn of variantNodes) {
    let variantId: string;
    let inventoryItemId: string;
    try {
      variantId = assertShopifyProductVariantGid(vn.id);
      if (!vn.inventoryItem?.id) {
        return { ...base, unsupportedReason: "A variant is missing inventory item identity." };
      }
      inventoryItemId = assertShopifyInventoryItemGid(vn.inventoryItem.id);
    } catch {
      return { ...base, unsupportedReason: "A variant has an invalid Shopify identity." };
    }

    const priceCents = shopifyCentsFromMoneyString(vn.price ?? "");
    if (!Number.isFinite(priceCents) || priceCents < 1) {
      return {
        ...base,
        unsupportedReason: `Variant ${variantId} has an invalid or missing price.`,
      };
    }

    const tracked = Boolean(vn.inventoryItem?.tracked);
    if (tracked) anyTracked = true;
    else allTracked = false;
    const available = extractAvailable(vn.inventoryItem);
    const selectedOptions = vn.selectedOptions ?? [];
    const mediaIds = (vn.media?.nodes ?? []).map((m) => m.id);

    snaps.push({
      shopifyVariantId: variantId,
      shopifyInventoryItemId: inventoryItemId,
      selectedOptions,
      priceCents,
      sku: vn.sku?.trim() || null,
      available,
      tracked,
      mediaIds,
    });

    candidateVariants.push({
      shopifyVariantId: variantId,
      shopifyInventoryItemId: inventoryItemId,
      priceCents,
      sku: vn.sku?.trim() || null,
      inventoryTracked: tracked,
      requiresShipping: vn.inventoryItem?.requiresShipping ?? null,
      primaryLocationAvailable: available,
      selectedOptions,
      mediaIds,
    });
  }

  const topo = validateShopifyImportTopology({ axes, variants: snaps });
  if (!topo.ok) {
    return { ...base, unsupportedReason: `${topo.code}: ${topo.message}` };
  }

  // Check if any tracked variant is missing availability
  if (anyTracked) {
    for (const cv of candidateVariants) {
      if (cv.inventoryTracked && cv.primaryLocationAvailable == null) {
        return {
          ...base,
          unsupportedReason:
            "Inventory unavailable at selected Shopify location for one or more variants.",
        };
      }
    }
  }

  const inventoryTracking = anyTracked ? ("tracked" as const) : ("made_to_order" as const);
  const matrix = shopifyTopologyToInwMatrix({
    axes: topo.axes,
    variants: topo.variants,
    inventoryTracking,
  });

  const firstVariant = candidateVariants[0] ?? null;
  return {
    ...base,
    supported: true,
    unsupportedReason: null,
    priceCents: firstVariant?.priceCents ?? null,
    sku: firstVariant?.sku ?? null,
    shopifyVariantId: firstVariant?.shopifyVariantId ?? null,
    shopifyInventoryItemId: firstVariant?.shopifyInventoryItemId ?? null,
    inventoryTracked: anyTracked,
    requiresShipping: firstVariant?.requiresShipping ?? null,
    primaryLocationAvailable: firstVariant?.primaryLocationAvailable ?? null,
    recommendedStockMode: anyTracked ? "PHYSICAL" : "MADE_TO_ORDER",
    productMedia: (node.media?.nodes ?? []).map((m) => ({
      shopifyMediaId: m.id,
      sourceUrl: m.preview?.image?.url ?? null,
    })),
    variants: candidateVariants,
    axes: topo.axes,
    matrix,
  };
}

/**
 * Discover unmapped Shopify products for import on the seller's ACTIVE connection generation.
 * Provider IDs only — never SKU/title/handle inference.
 */
export async function discoverShopifyImportCandidates(input: {
  memberId: string;
  cursor?: string | null;
  pageSize?: number;
  fetchImpl?: ShopifyFetch;
}): Promise<DiscoverShopifyImportCandidatesResult> {
  const connection = await prisma.shopifyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: {
      id: true,
      shopDomain: true,
      generation: true,
      primaryLocationId: true,
      status: true,
    },
  });
  if (!connection) {
    return {
      status: "ERROR",
      code: "CONNECTION_REQUIRED",
      message: "Connect Shopify before importing listings.",
    };
  }
  if (!connection.primaryLocationId) {
    return {
      status: "ERROR",
      code: "LOCATION_REQUIRED",
      message: "Choose a primary Shopify location before importing listings.",
    };
  }

  const pageSize = Math.min(Math.max(input.pageSize ?? 25, 1), 50);
  const result = await executeShopifyAdminGraphql<{
    products: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: GraphqlProductNode[];
    } | null;
  }>({
    connectionId: connection.id,
    operationType: "query",
    operationName: "ShopifyImportProductDiscovery",
    document: `query ShopifyImportProductDiscovery($first: Int!, $after: String, $locationId: ID!) {
      products(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          title
          descriptionHtml
          status
          hasOnlyDefaultVariant
          totalVariants
          featuredImage { url }
          options { name position values }
          variants(first: 100) {
            nodes {
              id
              price
              sku
              selectedOptions { name value }
              media(first: 10) { nodes { id } }
              inventoryItem {
                id
                tracked
                requiresShipping
                inventoryLevel(locationId: $locationId) {
                  quantities(names: ["available"]) { name quantity }
                }
              }
            }
          }
        }
      }
    }`,
    variables: {
      first: pageSize,
      after: input.cursor ?? null,
      locationId: connection.primaryLocationId,
    },
    fetchImpl: input.fetchImpl,
  });

  if (!result.ok || !result.data?.products) {
    return {
      status: "ERROR",
      code: "PROVIDER_ERROR",
      message: result.message || "Could not load Shopify products.",
    };
  }

  const nodes = result.data.products.nodes ?? [];
  const productIds = nodes
    .map((n) => {
      try {
        return assertShopifyProductGid(n.id);
      } catch {
        return null;
      }
    })
    .filter((id): id is string => Boolean(id));

  const mapped = productIds.length
    ? await prisma.shopifyListingLink.findMany({
        where: {
          shopifyConnectionId: connection.id,
          memberId: input.memberId,
          shopifyProductId: { in: productIds },
        },
        select: { shopifyProductId: true },
      })
    : [];
  const mappedSet = new Set(mapped.map((row) => row.shopifyProductId));

  const candidates = nodes
    .filter((node) => {
      try {
        return !mappedSet.has(assertShopifyProductGid(node.id));
      } catch {
        return true;
      }
    })
    .map((node) => classifyCandidate(node));

  return {
    status: "OK",
    connectionId: connection.id,
    shopDomain: connection.shopDomain,
    generation: connection.generation,
    primaryLocationId: connection.primaryLocationId,
    candidates,
    pageInfo: {
      hasNextPage: Boolean(result.data.products.pageInfo?.hasNextPage),
      endCursor: result.data.products.pageInfo?.endCursor ?? null,
    },
  };
}

/** Fetch one product for import review / final import. */
export async function fetchShopifyImportProductDetail(input: {
  memberId: string;
  shopifyProductId: string;
  fetchImpl?: ShopifyFetch;
}): Promise<
  | { status: "OK"; connectionId: string; primaryLocationId: string; candidate: ShopifyImportCandidate }
  | { status: "ERROR"; code: string; message: string }
> {
  const connection = await prisma.shopifyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true, primaryLocationId: true },
  });
  if (!connection) {
    return { status: "ERROR", code: "CONNECTION_REQUIRED", message: "Connect Shopify first." };
  }
  if (!connection.primaryLocationId) {
    return {
      status: "ERROR",
      code: "LOCATION_REQUIRED",
      message: "Choose a primary Shopify location first.",
    };
  }

  let productId: string;
  try {
    productId = assertShopifyProductGid(input.shopifyProductId.trim());
  } catch {
    return { status: "ERROR", code: "INVALID_PRODUCT", message: "Invalid Shopify product id." };
  }

  const mapped = await prisma.shopifyListingLink.findFirst({
    where: {
      shopifyConnectionId: connection.id,
      memberId: input.memberId,
      shopifyProductId: productId,
    },
    select: { storeItemId: true },
  });
  if (mapped) {
    return {
      status: "ERROR",
      code: "ALREADY_MAPPED",
      message: "This Shopify product is already synced.",
    };
  }

  const result = await executeShopifyAdminGraphql<{
    product: GraphqlProductNode | null;
  }>({
    connectionId: connection.id,
    operationType: "query",
    operationName: "ShopifyImportProductDetail",
    document: `query ShopifyImportProductDetail($id: ID!, $locationId: ID!) {
      product(id: $id) {
        id
        title
        descriptionHtml
        status
        hasOnlyDefaultVariant
        totalVariants
        featuredImage { url }
        media(first: 50) {
          nodes {
            id
            preview { image { url } }
          }
        }
        options { name position values }
        variants(first: 100) {
          nodes {
            id
            price
            sku
            selectedOptions { name value }
            media(first: 10) { nodes { id } }
            inventoryItem {
              id
              tracked
              requiresShipping
              inventoryLevel(locationId: $locationId) {
                quantities(names: ["available"]) { name quantity }
              }
            }
          }
        }
      }
    }`,
    variables: { id: productId, locationId: connection.primaryLocationId },
    fetchImpl: input.fetchImpl,
  });

  if (!result.ok) {
    return { status: "ERROR", code: "PROVIDER_ERROR", message: result.message };
  }
  if (!result.data?.product) {
    return { status: "ERROR", code: "NOT_FOUND", message: "Shopify product was not found." };
  }

  return {
    status: "OK",
    connectionId: connection.id,
    primaryLocationId: connection.primaryLocationId,
    candidate: classifyCandidate(result.data.product),
  };
}
