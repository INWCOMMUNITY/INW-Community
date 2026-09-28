import { prisma } from "database";
import {
  assertShopifyInventoryItemGid,
  assertShopifyProductGid,
  assertShopifyProductVariantGid,
  shopifyCentsFromMoneyString,
} from "database";
import { executeShopifyAdminGraphql, type ShopifyFetch } from "./admin-graphql";

export type ShopifyImportCandidate = {
  shopifyProductId: string;
  title: string;
  descriptionHtml: string;
  status: string;
  supported: boolean;
  unsupportedReason: string | null;
  priceCents: number | null;
  sku: string | null;
  shopifyVariantId: string | null;
  shopifyInventoryItemId: string | null;
  inventoryTracked: boolean | null;
  requiresShipping: boolean | null;
  primaryLocationAvailable: number | null;
  recommendedStockMode: "PHYSICAL" | "MADE_TO_ORDER" | null;
  imageUrl: string | null;
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
  variants: {
    nodes: Array<{
      id: string;
      price: string | null;
      sku: string | null;
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

function classifyCandidate(node: GraphqlProductNode): ShopifyImportCandidate {
  const productId = (() => {
    try {
      return assertShopifyProductGid(node.id);
    } catch {
      return null;
    }
  })();

  const base: ShopifyImportCandidate = {
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
  };

  if (!productId) {
    return { ...base, unsupportedReason: "Shopify product identity is invalid." };
  }

  const variantCount =
    typeof node.totalVariants === "number"
      ? node.totalVariants
      : node.variants?.nodes?.length ?? 0;
  const onlyDefault = node.hasOnlyDefaultVariant === true;
  if (!onlyDefault || variantCount !== 1) {
    return {
      ...base,
      unsupportedReason: "Multiple variants are not supported yet.",
    };
  }

  const variant = node.variants?.nodes?.[0] ?? null;
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
    return { ...base, unsupportedReason: "Shopify variant or inventory identity is invalid." };
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
  const available =
    variant.inventoryItem?.inventoryLevel?.quantities?.find((q) => q.name === "available")
      ?.quantity ?? null;
  const availableQty =
    typeof available === "number" && Number.isFinite(available) ? Math.trunc(available) : null;

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
          variants(first: 2) {
            nodes {
              id
              price
              sku
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
        variants(first: 2) {
          nodes {
            id
            price
            sku
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
