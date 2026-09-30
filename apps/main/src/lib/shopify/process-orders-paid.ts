import {
  applyShopifyPaidOrderObservation,
  assertShopifyLineItemGid,
  assertShopifyOrderGid,
  assertShopifyProductVariantGid,
  markShopifyEvidenceError,
  markShopifyEvidenceIgnored,
  mergePaidOrderLineIdentities,
  parseShopifyOrdersPaidWebhookBody,
  prisma,
  ShopifyGidValidationError,
} from "database";
import type { ShopifyJobHandlerResult, ShopifySyncJobClaim } from "database";
import type { ShopifyFetch } from "./admin-graphql";
import { executeShopifyAdminGraphql } from "./admin-graphql";

/**
 * Optional Admin GraphQL READ to resolve missing ProductVariant GIDs for paid lines.
 * Does not open a DB transaction. Never mutates Shopify.
 */
async function resolveOrderLineVariantIdentities(input: {
  connectionId: string;
  shopifyOrderId: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<
  | {
      ok: true;
      lines: Array<{ shopifyLineItemId: string; shopifyVariantId: string | null }>;
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
    order: {
      id: string;
      lineItems: {
        nodes: Array<{
          id: string;
          variant: { id: string } | null;
        }>;
      };
    } | null;
  }>({
    connectionId: input.connectionId,
    operationType: "query",
    operationName: "ShopifyPaidOrderLineIdentityRead",
    document: `query ShopifyPaidOrderLineIdentityRead($id: ID!) {
      order(id: $id) {
        id
        lineItems(first: 250) {
          nodes {
            id
            variant { id }
          }
        }
      }
    }`,
    variables: { id: input.shopifyOrderId },
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
        errorCode: "ORDER_IDENTITY_READ",
        errorMessage: result.message,
      };
    }
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: result.class,
      errorCode: "ORDER_IDENTITY_READ",
      errorMessage: result.message,
    };
  }

  const order = result.data?.order ?? null;
  if (!order) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "REMOTE_MISSING",
      errorCode: "REMOTE_ORDER_MISSING",
      errorMessage: "Paid Shopify order was not found for identity resolution",
      missing: true,
    };
  }
  try {
    assertShopifyOrderGid(order.id);
  } catch (error) {
    if (error instanceof ShopifyGidValidationError) {
      return {
        ok: false,
        outcome: "DEAD",
        errorClass: "GRAPHQL_PERMANENT",
        errorCode: "INVALID_ORDER_GID",
        errorMessage: "Remote order identity was invalid",
      };
    }
    throw error;
  }

  const lines: Array<{ shopifyLineItemId: string; shopifyVariantId: string | null }> = [];
  for (const node of order.lineItems?.nodes ?? []) {
    try {
      const shopifyLineItemId = assertShopifyLineItemGid(node.id);
      let shopifyVariantId: string | null = null;
      if (node.variant?.id) {
        shopifyVariantId = assertShopifyProductVariantGid(node.variant.id);
      }
      lines.push({ shopifyLineItemId, shopifyVariantId });
    } catch (error) {
      if (error instanceof ShopifyGidValidationError) continue;
      throw error;
    }
  }
  return { ok: true, lines };
}

/**
 * PROCESS_PROVIDER_EVIDENCE handler branch for topic orders/paid.
 */
export async function handleShopifyOrdersPaidEvidence(
  claim: ShopifySyncJobClaim,
  evidence: {
    id: string;
    shopifyConnectionId: string | null;
    topic: string;
    rawBody: string;
    processState: string;
  },
  deps: { fetchImpl?: ShopifyFetch; now?: Date } = {}
): Promise<ShopifyJobHandlerResult> {
  if (evidence.shopifyConnectionId !== claim.shopifyConnectionId) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "GENERATION_MISMATCH",
      errorMessage: "Evidence connection does not match job connection",
    };
  }

  const connection = await prisma.shopifyConnection.findUnique({
    where: { id: claim.shopifyConnectionId },
  });
  // Generation-bound: process under the evidence connection even if later disconnected,
  // so delayed gen-1 sales never use gen-2 mapping. Missing connection → ignore.
  if (!connection) {
    await markShopifyEvidenceIgnored(
      prisma,
      evidence.id,
      "CONNECTION_MISSING",
      "Shopify connection for this evidence generation was not found"
    );
    return { outcome: "SUCCESS" };
  }

  const parsed = parseShopifyOrdersPaidWebhookBody(evidence.rawBody);
  if (!parsed || parsed.lines.length === 0) {
    await markShopifyEvidenceError(
      prisma,
      evidence.id,
      "INVALID_PAID_ORDER_BODY",
      "orders/paid evidence lacked durable order/line identities or paid quantities"
    );
    return { outcome: "SUCCESS" };
  }

  let lines = parsed.lines;
  const needsIdentity = lines.some((line) => !line.shopifyVariantId);
  if (needsIdentity) {
    const resolved = await resolveOrderLineVariantIdentities({
      connectionId: connection.id,
      shopifyOrderId: parsed.shopifyOrderId,
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
    if (!resolved.ok) {
      if (resolved.outcome === "RETRY") {
        return {
          outcome: "RETRY",
          errorClass: resolved.errorClass,
          errorCode: resolved.errorCode,
          errorMessage: resolved.errorMessage,
        };
      }
      await markShopifyEvidenceError(
        prisma,
        evidence.id,
        resolved.errorCode,
        resolved.errorMessage
      );
      return { outcome: "SUCCESS" };
    }
    lines = mergePaidOrderLineIdentities(lines, resolved.lines);
  }

  // No network during inventory apply.
  await applyShopifyPaidOrderObservation(prisma, {
    connectionId: connection.id,
    memberId: connection.memberId,
    evidenceId: evidence.id,
    lines,
  });

  await prisma.shopifyProviderEvidence.update({
    where: { id: evidence.id },
    data: {
      processState: "PROCESSED",
      processedAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });
  return { outcome: "SUCCESS" };
}
