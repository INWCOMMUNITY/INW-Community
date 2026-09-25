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
  | { status: "FAILED"; factId: string; code: string; message: string };

export type ApplyShopifyPaidOrderResult = {
  status: "PROCESSED";
  lines: ApplyShopifyPaidOrderLineResult[];
};

function lineLockKey(connectionId: string, orderId: string, lineItemId: string): string {
  return `shopify-order-line-sale:${connectionId}:${orderId}:${lineItemId}`;
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
    if (existing?.applyState === "APPLIED") {
      return {
        status: "ALREADY_APPLIED" as const,
        factId: existing.id,
        appliedQuantity: existing.appliedQuantity,
      };
    }

    let fact: ShopifyOrderLineSaleFact;
    if (existing) {
      fact = await tx.shopifyOrderLineSaleFact.update({
        where: { id: existing.id },
        data: {
          evidenceId: input.evidenceId,
          shopifyVariantId: input.line.shopifyVariantId ?? existing.shopifyVariantId,
          paidQuantity: input.line.paidQuantity,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
    } else {
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
    }

    if (!input.line.shopifyVariantId) {
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
        shopifyVariantId: input.line.shopifyVariantId,
      },
    });
    if (!variantMap || variantMap.memberId !== input.memberId) {
      const unmapped = await tx.shopifyOrderLineSaleFact.update({
        where: { id: fact.id },
        data: {
          applyState: "UNMAPPED",
          shopifyVariantId: input.line.shopifyVariantId,
          storeVariantId: null,
          storeItemId: null,
          lastErrorCode: "UNMAPPED_VARIANT",
          lastErrorMessage: "No StoreVariant mapping for this Shopify ProductVariant on this connection generation",
        },
      });
      return { status: "UNMAPPED" as const, factId: unmapped.id };
    }

    try {
      const sale = await applyTrackedMarketplaceSale(tx, {
        variantId: variantMap.storeVariantId,
        memberId: input.memberId,
        qty: input.line.paidQuantity,
        sourceScope: input.connectionId,
        sourceFactId: `${input.line.shopifyOrderId}:${input.line.shopifyLineItemId}`,
        metadata: {
          shopifyOrderId: input.line.shopifyOrderId,
          shopifyLineItemId: input.line.shopifyLineItemId,
          shopifyVariantId: input.line.shopifyVariantId,
          evidenceId: input.evidenceId,
        },
      });

      const applied = await tx.shopifyOrderLineSaleFact.update({
        where: { id: fact.id },
        data: {
          applyState: "APPLIED",
          appliedQuantity: input.line.paidQuantity,
          storeVariantId: variantMap.storeVariantId,
          storeItemId: variantMap.storeItemId,
          shopifyVariantId: input.line.shopifyVariantId,
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
          storeVariantId: variantMap.storeVariantId,
          storeItemId: variantMap.storeItemId,
          shopifyVariantId: input.line.shopifyVariantId,
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
