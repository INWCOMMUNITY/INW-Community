import {
  applyShopifyProductsUpdateObservation,
  assertShopifyProductGid,
  markShopifyEvidenceError,
  markShopifyEvidenceIgnored,
  prisma,
  ShopifyGidValidationError,
} from "database";
import type { ShopifyJobHandlerResult, ShopifySyncJobClaim } from "database";
import type { ShopifyFetch } from "./admin-graphql";
import { executeShopifyAdminGraphql } from "./admin-graphql";

function parseProductGidFromEvidenceBody(rawBody: string): string | null {
  try {
    const parsed = JSON.parse(rawBody) as { admin_graphql_api_id?: unknown; id?: unknown };
    if (typeof parsed.admin_graphql_api_id === "string" && parsed.admin_graphql_api_id.trim()) {
      return assertShopifyProductGid(parsed.admin_graphql_api_id.trim());
    }
    if (typeof parsed.id === "number" && Number.isFinite(parsed.id) && parsed.id > 0) {
      return assertShopifyProductGid(`gid://shopify/Product/${Math.trunc(parsed.id)}`);
    }
    if (typeof parsed.id === "string" && /^\d+$/.test(parsed.id.trim())) {
      return assertShopifyProductGid(`gid://shopify/Product/${parsed.id.trim()}`);
    }
  } catch (error) {
    if (error instanceof ShopifyGidValidationError) return null;
  }
  return null;
}

async function readRemoteProductForInbound(input: {
  connectionId: string;
  productId: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<
  | {
      ok: true;
      product: {
        id: string;
        status: string;
        title: string;
        descriptionHtml: string | null;
        updatedAt: Date;
        variants: Array<{
          id: string;
          price: string;
          sku: string | null;
          updatedAt: Date;
          inventoryItemId: string | null;
        }>;
      };
    }
  | {
      ok: false;
      outcome: "RETRY" | "DEAD";
      errorClass: string;
      errorCode: string;
      errorMessage: string;
      missing?: boolean;
    }
> {
  const result = await executeShopifyAdminGraphql<{
    product: {
      id: string;
      status: string;
      title: string;
      descriptionHtml: string | null;
      updatedAt: string;
      variants: {
        nodes: Array<{
          id: string;
          price: string;
          sku: string | null;
          updatedAt: string;
          inventoryItem: { id: string } | null;
        }>;
      };
    } | null;
  }>({
    connectionId: input.connectionId,
    operationType: "query",
    operationName: "ShopifyInboundListingContentRead",
    document: `query ShopifyInboundListingContentRead($id: ID!) {
      product(id: $id) {
        id
        status
        title
        descriptionHtml
        updatedAt
        variants(first: 10) {
          nodes {
            id
            price
            sku
            updatedAt
            inventoryItem { id }
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
      result.class === "NETWORK_UNKNOWN"
    ) {
      return {
        ok: false,
        outcome: "RETRY",
        errorClass: result.class,
        errorCode: "INBOUND_CONTENT_READ",
        errorMessage: result.message,
      };
    }
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: result.class,
      errorCode: "INBOUND_CONTENT_READ",
      errorMessage: result.message,
    };
  }

  const product = result.data?.product ?? null;
  if (!product) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "REMOTE_MISSING",
      errorCode: "REMOTE_PRODUCT_MISSING",
      errorMessage: "Mapped Shopify product was not found",
      missing: true,
    };
  }

  const updatedAt = new Date(product.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "REMOTE_UPDATED_AT_INVALID",
      errorMessage: "Remote product updatedAt was invalid",
    };
  }

  const variants = (product.variants?.nodes ?? []).map((row) => {
    const variantUpdatedAt = new Date(row.updatedAt);
    return {
      id: row.id,
      price: row.price,
      sku: row.sku,
      updatedAt: Number.isNaN(variantUpdatedAt.getTime()) ? updatedAt : variantUpdatedAt,
      inventoryItemId: row.inventoryItem?.id ?? null,
    };
  });

  return {
    ok: true,
    product: {
      id: product.id,
      status: product.status,
      title: product.title,
      descriptionHtml: product.descriptionHtml,
      updatedAt,
      variants,
    },
  };
}

/**
 * PROCESS_PROVIDER_EVIDENCE handler for products/update (S6).
 * Webhook body is identity only; current remote state is re-read via Admin GraphQL.
 */
export async function handleShopifyProcessProviderEvidenceJob(
  claim: ShopifySyncJobClaim,
  deps: { fetchImpl?: ShopifyFetch; now?: Date } = {}
): Promise<ShopifyJobHandlerResult> {
  if (!claim.evidenceId) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "MISSING_EVIDENCE",
      errorMessage: "Evidence id missing on job",
    };
  }

  const evidence = await prisma.shopifyProviderEvidence.findUnique({
    where: { id: claim.evidenceId },
  });
  if (!evidence) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "EVIDENCE_NOT_FOUND",
      errorMessage: "Provider evidence was not found",
    };
  }
  if (evidence.shopifyConnectionId !== claim.shopifyConnectionId) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "GENERATION_MISMATCH",
      errorMessage: "Evidence connection does not match job connection",
    };
  }

  if (
    evidence.processState === "PROCESSED" ||
    evidence.processState === "IGNORED" ||
    evidence.processState === "ERROR"
  ) {
    return { outcome: "SUCCESS" };
  }

  const topic = evidence.topic.trim().toLowerCase();
  if (topic !== "products/update") {
    // Other topics remain deferred until their owned processors exist.
    return { outcome: "SUCCESS" };
  }

  const connection = await prisma.shopifyConnection.findUnique({
    where: { id: claim.shopifyConnectionId },
  });
  if (!connection || connection.status !== "ACTIVE") {
    await markShopifyEvidenceIgnored(
      prisma,
      evidence.id,
      "CONNECTION_INACTIVE",
      "Evidence generation is not an active Shopify connection"
    );
    return { outcome: "SUCCESS" };
  }

  const productGid = parseProductGidFromEvidenceBody(evidence.rawBody);
  if (!productGid) {
    await markShopifyEvidenceError(
      prisma,
      evidence.id,
      "INVALID_PRODUCT_GID",
      "products/update evidence lacked a valid Product GID"
    );
    return { outcome: "SUCCESS" };
  }

  const listing = await prisma.shopifyListingLink.findUnique({
    where: {
      shopifyConnectionId_shopifyProductId: {
        shopifyConnectionId: connection.id,
        shopifyProductId: productGid,
      },
    },
  });
  if (!listing) {
    await markShopifyEvidenceIgnored(
      prisma,
      evidence.id,
      "UNMAPPED",
      "No current-generation mapping for this Shopify product"
    );
    return { outcome: "SUCCESS" };
  }

  const variantMaps = await prisma.shopifyVariantMap.findMany({
    where: { shopifyListingLinkId: listing.id, shopifyConnectionId: connection.id },
    orderBy: { createdAt: "asc" },
  });
  if (variantMaps.length !== 1) {
    await markShopifyEvidenceError(
      prisma,
      evidence.id,
      "UNSUPPORTED_VARIANTS",
      "Mapped listing does not have exactly one StoreVariant mapping"
    );
    return { outcome: "SUCCESS" };
  }
  const variantMap = variantMaps[0];

  const remote = await readRemoteProductForInbound({
    connectionId: connection.id,
    productId: listing.shopifyProductId,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });
  if (!remote.ok) {
    if (remote.missing) {
      await markShopifyEvidenceError(prisma, evidence.id, remote.errorCode, remote.errorMessage);
      return { outcome: "SUCCESS" };
    }
    if (remote.outcome === "RETRY") {
      return {
        outcome: "RETRY",
        errorClass: remote.errorClass,
        errorCode: remote.errorCode,
        errorMessage: remote.errorMessage,
      };
    }
    await markShopifyEvidenceError(prisma, evidence.id, remote.errorCode, remote.errorMessage);
    return { outcome: "SUCCESS" };
  }

  if (remote.product.id !== listing.shopifyProductId) {
    await markShopifyEvidenceError(
      prisma,
      evidence.id,
      "PRODUCT_GID_MISMATCH",
      "Remote product identity does not match mapping"
    );
    return { outcome: "SUCCESS" };
  }

  const applied = await applyShopifyProductsUpdateObservation(prisma, {
    evidenceId: evidence.id,
    connectionId: connection.id,
    listingLinkId: listing.id,
    mappedVariantId: variantMap.shopifyVariantId,
    mappedStoreVariantId: variantMap.storeVariantId,
    remote: {
      productId: remote.product.id,
      status: remote.product.status,
      title: remote.product.title,
      descriptionHtml: remote.product.descriptionHtml,
      updatedAt: remote.product.updatedAt,
      variants: remote.product.variants,
    },
  });

  // PROCESSED / IGNORED / ERROR are terminal evidence outcomes for this delivery.
  void applied;
  return { outcome: "SUCCESS" };
}
