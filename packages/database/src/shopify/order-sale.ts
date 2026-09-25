import type { Prisma, PrismaClient, ShopifyOrderLineSaleFact } from "@prisma/client";
import {
  applyTrackedMarketplaceSale,
  FoundationInsufficientAvailabilityError,
  FoundationInventoryError,
} from "../commerce-foundation-inventory";
import {
  assertShopifyLineItemGid,
  assertShopifyOrderGid,
  assertShopifyProductVariantGid,
  ShopifyGidValidationError,
  shopifyLineItemGidFromNumericId,
  shopifyOrderGidFromNumericId,
  shopifyProductVariantGidFromNumericId,
} from "./gids";

export type ShopifyOrderSaleDb = PrismaClient | Prisma.TransactionClient;

export type ShopifyPaidOrderLineObservation = {
  shopifyOrderId: string;
  shopifyLineItemId: string;
  shopifyVariantId: string | null;
  /** Quantity from the verified orders/paid evidence (not refund-adjusted current). */
  paidQuantity: number;
};

export type ApplyShopifyPaidOrderLineResult =
  | { status: "APPLIED"; factId: string; appliedQuantity: number; inventoryEventId: string | null }
  | { status: "ALREADY_APPLIED"; factId: string; appliedQuantity: number }
  | { status: "UNMAPPED"; factId: string }
  | { status: "FAILED"; factId: string; code: string; message: string }
  | {
      status: "CAUSAL_FACT_CONFLICT";
      factId: string;
      code: string;
      message: string;
      appliedQuantity: number;
      applyState: ShopifyOrderLineSaleFact["applyState"];
    };

export type ApplyShopifyPaidOrderResult = {
  status: "PROCESSED";
  lines: ApplyShopifyPaidOrderLineResult[];
};

function lineLockKey(connectionId: string, orderId: string, lineItemId: string): string {
  return `shopify-order-line-sale:${connectionId}:${orderId}:${lineItemId}`;
}

type FactEquivalence =
  | { status: "EXACT" }
  | { status: "CONFLICT"; code: string; message: string };

/**
 * Immutable provider causal fields once the sale-fact identity exists:
 * paidQuantity + shopifyVariantId (when already established).
 * Evidence/webhook delivery IDs are intentionally excluded.
 */
export function classifyShopifySaleFactEquivalence(
  existing: Pick<ShopifyOrderLineSaleFact, "paidQuantity" | "shopifyVariantId" | "storeVariantId">,
  incoming: ShopifyPaidOrderLineObservation,
  resolvedStoreVariantId?: string | null
): FactEquivalence {
  if (existing.paidQuantity !== incoming.paidQuantity) {
    return {
      status: "CONFLICT",
      code: "PAID_QUANTITY_CONFLICT",
      message: `Conflicting paidQuantity for sale fact: stored ${existing.paidQuantity}, incoming ${incoming.paidQuantity}`,
    };
  }
  if (existing.shopifyVariantId != null) {
    if (incoming.shopifyVariantId == null) {
      return {
        status: "CONFLICT",
        code: "VARIANT_IDENTITY_CONFLICT",
        message: `Incoming replay missing Shopify Variant GID; stored ${existing.shopifyVariantId}`,
      };
    }
    if (incoming.shopifyVariantId !== existing.shopifyVariantId) {
      return {
        status: "CONFLICT",
        code: "VARIANT_IDENTITY_CONFLICT",
        message: `Conflicting Shopify Variant GID: stored ${existing.shopifyVariantId}, incoming ${incoming.shopifyVariantId}`,
      };
    }
  }
  if (
    existing.storeVariantId != null &&
    resolvedStoreVariantId != null &&
    existing.storeVariantId !== resolvedStoreVariantId
  ) {
    return {
      status: "CONFLICT",
      code: "STORE_VARIANT_MAPPING_CONFLICT",
      message: `Conflicting StoreVariant mapping: stored ${existing.storeVariantId}, resolved ${resolvedStoreVariantId}`,
    };
  }
  return { status: "EXACT" };
}

async function recordCausalFactConflict(
  tx: Prisma.TransactionClient,
  fact: ShopifyOrderLineSaleFact,
  input: {
    evidenceId: string;
    code: string;
    message: string;
  }
): Promise<ApplyShopifyPaidOrderLineResult> {
  const updated = await tx.shopifyOrderLineSaleFact.update({
    where: { id: fact.id },
    data: {
      causalConflict: true,
      causalConflictCode: input.code.slice(0, 64),
      causalConflictEvidenceId: input.evidenceId,
      causalConflictDetectedAt: new Date(),
      // Preserve applyState / paidQuantity / shopifyVariantId / storeVariantId / appliedQuantity.
    },
  });
  return {
    status: "CAUSAL_FACT_CONFLICT",
    factId: updated.id,
    code: input.code,
    message: input.message,
    appliedQuantity: updated.appliedQuantity,
    applyState: updated.applyState,
  };
}

/**
 * Parse durable order/line/variant identities + paid quantities from orders/paid webhook JSON.
 * Uses `quantity` (paid-sale fact), never `current_quantity` (may reflect later removals).
 */
export function parseShopifyOrdersPaidWebhookBody(rawBody: string): {
  shopifyOrderId: string;
  lines: ShopifyPaidOrderLineObservation[];
} | null {
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    let shopifyOrderId: string | null = null;
    if (typeof parsed.admin_graphql_api_id === "string" && parsed.admin_graphql_api_id.trim()) {
      shopifyOrderId = assertShopifyOrderGid(parsed.admin_graphql_api_id.trim());
    } else if (typeof parsed.id === "number" || typeof parsed.id === "string") {
      shopifyOrderId = shopifyOrderGidFromNumericId(parsed.id as number | string);
    }
    if (!shopifyOrderId) return null;

    const rawLines = Array.isArray(parsed.line_items) ? parsed.line_items : [];
    const lines: ShopifyPaidOrderLineObservation[] = [];
    for (const row of rawLines) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      let lineItemId: string | null = null;
      if (typeof item.admin_graphql_api_id === "string" && item.admin_graphql_api_id.trim()) {
        lineItemId = assertShopifyLineItemGid(item.admin_graphql_api_id.trim());
      } else if (typeof item.id === "number" || typeof item.id === "string") {
        lineItemId = shopifyLineItemGidFromNumericId(item.id as number | string);
      }
      if (!lineItemId) continue;

      const paidQuantity =
        typeof item.quantity === "number"
          ? Math.trunc(item.quantity)
          : typeof item.quantity === "string" && /^\d+$/.test(item.quantity.trim())
            ? Number.parseInt(item.quantity.trim(), 10)
            : NaN;
      if (!Number.isFinite(paidQuantity) || paidQuantity < 1) continue;

      let shopifyVariantId: string | null = null;
      if (typeof item.variant_id === "number" || typeof item.variant_id === "string") {
        try {
          shopifyVariantId = shopifyProductVariantGidFromNumericId(item.variant_id as number | string);
        } catch {
          shopifyVariantId = null;
        }
      }

      lines.push({
        shopifyOrderId,
        shopifyLineItemId: lineItemId,
        shopifyVariantId,
        paidQuantity,
      });
    }
    return { shopifyOrderId, lines };
  } catch (error) {
    if (error instanceof ShopifyGidValidationError) return null;
    return null;
  }
}

/**
 * Merge webhook lines with optional GraphQL identity resolution (variant GIDs only).
 * Paid quantity always remains the webhook quantity for matched line item IDs.
 */
export function mergePaidOrderLineIdentities(
  webhookLines: ShopifyPaidOrderLineObservation[],
  resolved: Array<{ shopifyLineItemId: string; shopifyVariantId: string | null }>
): ShopifyPaidOrderLineObservation[] {
  const byLine = new Map(resolved.map((row) => [row.shopifyLineItemId, row.shopifyVariantId]));
  return webhookLines.map((line) => {
    if (line.shopifyVariantId) return line;
    const resolvedVariant = byLine.get(line.shopifyLineItemId) ?? null;
    return { ...line, shopifyVariantId: resolvedVariant };
  });
}

/**
 * Apply one paid Shopify order line as an exactly-once Foundation SALE (when mapped + tracked).
 * Network must NOT be open during this call. Idempotent on (connection, order, lineItem).
 * Conflicting causal replays fail closed without mutating immutable fact fields or inventory.
 */
export async function applyShopifyPaidOrderLineSale(
  db: PrismaClient,
  input: {
    connectionId: string;
    memberId: string;
    evidenceId: string;
    line: ShopifyPaidOrderLineObservation;
  }
): Promise<ApplyShopifyPaidOrderLineResult> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lineLockKey(
      input.connectionId,
      input.line.shopifyOrderId,
      input.line.shopifyLineItemId
    )}))`;

    const existing = await tx.shopifyOrderLineSaleFact.findUnique({
      where: {
        shopifyConnectionId_shopifyOrderId_shopifyLineItemId: {
          shopifyConnectionId: input.connectionId,
          shopifyOrderId: input.line.shopifyOrderId,
          shopifyLineItemId: input.line.shopifyLineItemId,
        },
      },
    });

    if (existing) {
      // Equivalence BEFORE any causal-field mutation or inventory effect.
      const equiv = classifyShopifySaleFactEquivalence(existing, input.line);
      if (equiv.status === "CONFLICT") {
        return recordCausalFactConflict(tx, existing, {
          evidenceId: input.evidenceId,
          code: equiv.code,
          message: equiv.message,
        });
      }

      if (existing.applyState === "APPLIED") {
        // Exact provider replay: still fail closed if resolved StoreVariant drifted.
        const appliedProviderVariant =
          existing.shopifyVariantId ?? input.line.shopifyVariantId;
        if (appliedProviderVariant && existing.storeVariantId) {
          const appliedMap = await tx.shopifyVariantMap.findFirst({
            where: {
              shopifyConnectionId: input.connectionId,
              shopifyVariantId: appliedProviderVariant,
            },
          });
          if (
            appliedMap &&
            appliedMap.memberId === input.memberId &&
            appliedMap.storeVariantId !== existing.storeVariantId
          ) {
            return recordCausalFactConflict(tx, existing, {
              evidenceId: input.evidenceId,
              code: "STORE_VARIANT_MAPPING_CONFLICT",
              message: `Conflicting StoreVariant mapping: stored ${existing.storeVariantId}, resolved ${appliedMap.storeVariantId}`,
            });
          }
        }
        return {
          status: "ALREADY_APPLIED" as const,
          factId: existing.id,
          appliedQuantity: existing.appliedQuantity,
        };
      }
    }

    let fact: ShopifyOrderLineSaleFact;
    if (existing) {
      // Exact equivalent non-APPLIED: never rewrite paidQuantity / established variant / storeVariant.
      // May fill previously-null Shopify Variant GID when paidQuantity already matches.
      const fillVariant =
        existing.shopifyVariantId == null && input.line.shopifyVariantId
          ? input.line.shopifyVariantId
          : undefined;
      fact =
        fillVariant != null
          ? await tx.shopifyOrderLineSaleFact.update({
              where: { id: existing.id },
              data: { shopifyVariantId: fillVariant },
            })
          : existing;
    } else {
      try {
        fact = await tx.shopifyOrderLineSaleFact.create({
          data: {
            shopifyConnectionId: input.connectionId,
            memberId: input.memberId,
            shopifyOrderId: input.line.shopifyOrderId,
            shopifyLineItemId: input.line.shopifyLineItemId,
            shopifyVariantId: input.line.shopifyVariantId,
            paidQuantity: input.line.paidQuantity,
            evidenceId: input.evidenceId,
            applyState: "PENDING",
          },
        });
      } catch (error) {
        if (
          !(
            error &&
            typeof error === "object" &&
            "code" in error &&
            (error as { code?: string }).code === "P2002"
          )
        ) {
          throw error;
        }
        const raced = await tx.shopifyOrderLineSaleFact.findUnique({
          where: {
            shopifyConnectionId_shopifyOrderId_shopifyLineItemId: {
              shopifyConnectionId: input.connectionId,
              shopifyOrderId: input.line.shopifyOrderId,
              shopifyLineItemId: input.line.shopifyLineItemId,
            },
          },
        });
        if (!raced) throw error;
        const racedEquiv = classifyShopifySaleFactEquivalence(raced, input.line);
        if (racedEquiv.status === "CONFLICT") {
          return recordCausalFactConflict(tx, raced, {
            evidenceId: input.evidenceId,
            code: racedEquiv.code,
            message: racedEquiv.message,
          });
        }
        if (raced.applyState === "APPLIED") {
          const racedProviderVariant = raced.shopifyVariantId ?? input.line.shopifyVariantId;
          if (racedProviderVariant && raced.storeVariantId) {
            const racedMap = await tx.shopifyVariantMap.findFirst({
              where: {
                shopifyConnectionId: input.connectionId,
                shopifyVariantId: racedProviderVariant,
              },
            });
            if (
              racedMap &&
              racedMap.memberId === input.memberId &&
              racedMap.storeVariantId !== raced.storeVariantId
            ) {
              return recordCausalFactConflict(tx, raced, {
                evidenceId: input.evidenceId,
                code: "STORE_VARIANT_MAPPING_CONFLICT",
                message: `Conflicting StoreVariant mapping: stored ${raced.storeVariantId}, resolved ${racedMap.storeVariantId}`,
              });
            }
          }
          return {
            status: "ALREADY_APPLIED" as const,
            factId: raced.id,
            appliedQuantity: raced.appliedQuantity,
          };
        }
        fact = raced;
      }
    }

    const providerVariantId = fact.shopifyVariantId ?? input.line.shopifyVariantId;
    if (!providerVariantId) {
      const failed = await tx.shopifyOrderLineSaleFact.update({
        where: { id: fact.id },
        data: {
          applyState: "UNMAPPED",
          lastErrorCode: "VARIANT_IDENTITY_MISSING",
          lastErrorMessage: "Paid order line lacks a durable ProductVariant identity",
        },
      });
      return { status: "UNMAPPED" as const, factId: failed.id };
    }

    // Exact generation-bound mapping — no ACTIVE gate (delayed gen-1 evidence stays on gen-1).
    const variantMap = await tx.shopifyVariantMap.findFirst({
      where: {
        shopifyConnectionId: input.connectionId,
        shopifyVariantId: providerVariantId,
      },
    });
    if (!variantMap || variantMap.memberId !== input.memberId) {
      const unmapped = await tx.shopifyOrderLineSaleFact.update({
        where: { id: fact.id },
        data: {
          applyState: fact.applyState === "APPLIED" ? fact.applyState : "UNMAPPED",
          shopifyVariantId: providerVariantId,
          // Do not clear an already-established storeVariantId on conflict paths; here it's unmapped.
          storeVariantId: fact.storeVariantId,
          storeItemId: fact.storeItemId,
          lastErrorCode: "UNMAPPED_VARIANT",
          lastErrorMessage: "No StoreVariant mapping for this Shopify ProductVariant on this connection generation",
        },
      });
      return { status: "UNMAPPED" as const, factId: unmapped.id };
    }

    // StoreVariant consistency when fact already tied to a mapped variant.
    const mapEquiv = classifyShopifySaleFactEquivalence(fact, input.line, variantMap.storeVariantId);
    if (mapEquiv.status === "CONFLICT") {
      return recordCausalFactConflict(tx, fact, {
        evidenceId: input.evidenceId,
        code: mapEquiv.code,
        message: mapEquiv.message,
      });
    }

    try {
      const sale = await applyTrackedMarketplaceSale(tx, {
        variantId: variantMap.storeVariantId,
        memberId: input.memberId,
        qty: fact.paidQuantity,
        sourceScope: input.connectionId,
        sourceFactId: `${fact.shopifyOrderId}:${fact.shopifyLineItemId}`,
        metadata: {
          shopifyOrderId: fact.shopifyOrderId,
          shopifyLineItemId: fact.shopifyLineItemId,
          shopifyVariantId: providerVariantId,
          evidenceId: input.evidenceId,
        },
      });

      const applied = await tx.shopifyOrderLineSaleFact.update({
        where: { id: fact.id },
        data: {
          applyState: "APPLIED",
          appliedQuantity: fact.paidQuantity,
          storeVariantId: variantMap.storeVariantId,
          storeItemId: variantMap.storeItemId,
          shopifyVariantId: providerVariantId,
          inventoryEventId: sale.inventoryEventId,
          appliedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      return {
        status: "APPLIED" as const,
        factId: applied.id,
        appliedQuantity: applied.appliedQuantity,
        inventoryEventId: sale.inventoryEventId,
      };
    } catch (error) {
      const code =
        error instanceof FoundationInsufficientAvailabilityError
          ? "INSUFFICIENT_AVAILABILITY"
          : error instanceof FoundationInventoryError
            ? error.code
            : "SALE_APPLY_FAILED";
      const message = error instanceof Error ? error.message : "Marketplace SALE apply failed";
      const failed = await tx.shopifyOrderLineSaleFact.update({
        where: { id: fact.id },
        data: {
          applyState: "FAILED",
          storeVariantId: fact.storeVariantId ?? variantMap.storeVariantId,
          storeItemId: fact.storeItemId ?? variantMap.storeItemId,
          shopifyVariantId: providerVariantId,
          lastErrorCode: code.slice(0, 64),
          lastErrorMessage: message.slice(0, 500),
        },
      });
      return {
        status: "FAILED" as const,
        factId: failed.id,
        code,
        message,
      };
    }
  });
}

/**
 * Apply all paid lines from one orders/paid evidence. Per-line independence.
 */
export async function applyShopifyPaidOrderObservation(
  db: PrismaClient,
  input: {
    connectionId: string;
    memberId: string;
    evidenceId: string;
    lines: ShopifyPaidOrderLineObservation[];
  }
): Promise<ApplyShopifyPaidOrderResult> {
  const lines: ApplyShopifyPaidOrderLineResult[] = [];
  for (const line of input.lines) {
    const result = await applyShopifyPaidOrderLineSale(db, {
      connectionId: input.connectionId,
      memberId: input.memberId,
      evidenceId: input.evidenceId,
      line,
    });
    lines.push(result);
  }
  return { status: "PROCESSED", lines };
}

export type { ShopifyOrderLineSaleFact };
