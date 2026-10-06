import type { Prisma, PrismaClient, WixOrderLineSaleFact } from "@prisma/client";
import {
  applyTrackedMarketplaceSale,
  FoundationInsufficientAvailabilityError,
  FoundationInventoryError,
  restockTrackedVariant,
} from "../commerce-foundation-inventory";

export type WixOrderSaleDb = PrismaClient | Prisma.TransactionClient;

export const WIX_SOURCE_SYSTEM = "wix";

function choiceValuesKey(raw: unknown): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  return Object.values(raw as Record<string, unknown>)
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
}

export type WixPaidOrderLineObservation = {
  wixOrderId: string;
  wixLineItemId: string;
  wixProductId: string | null;
  wixVariantId: string | null;
  /** Choice values from the order when variant id is absent. */
  choices?: Record<string, string> | null;
  paidQuantity: number;
  /** When set, sales at/before this cutoff ack without deducting (import opening stock). */
  importBootstrapStartedAt?: Date | null;
  triggeredAt?: Date | null;
};

export type ApplyWixPaidOrderLineResult =
  | { status: "APPLIED"; factId: string; appliedQuantity: number; inventoryEventId: string | null }
  | { status: "ALREADY_APPLIED"; factId: string; appliedQuantity: number }
  | { status: "PRE_BOOTSTRAP_ACKED"; factId: string }
  | { status: "UNMAPPED"; factId: string }
  | { status: "FAILED"; factId: string; code: string; message: string }
  | {
      status: "CAUSAL_FACT_CONFLICT";
      factId: string;
      code: string;
      message: string;
      appliedQuantity: number;
      applyState: WixOrderLineSaleFact["applyState"];
    };

function lineLockKey(connectionId: string, orderId: string, lineItemId: string): string {
  return `wix-order-line-sale:${connectionId}:${orderId}:${lineItemId}`;
}

type FactEquivalence =
  | { status: "EXACT" }
  | { status: "CONFLICT"; code: string; message: string };

export function classifyWixSaleFactEquivalence(
  existing: Pick<
    WixOrderLineSaleFact,
    "paidQuantity" | "wixProductId" | "wixVariantId" | "storeVariantId"
  >,
  incoming: WixPaidOrderLineObservation,
  resolvedStoreVariantId?: string | null
): FactEquivalence {
  if (existing.paidQuantity !== incoming.paidQuantity) {
    return {
      status: "CONFLICT",
      code: "PAID_QUANTITY_CONFLICT",
      message: `Conflicting paidQuantity for sale fact: stored ${existing.paidQuantity}, incoming ${incoming.paidQuantity}`,
    };
  }
  if (existing.wixVariantId != null && incoming.wixVariantId != null) {
    if (existing.wixVariantId !== incoming.wixVariantId) {
      return {
        status: "CONFLICT",
        code: "VARIANT_IDENTITY_CONFLICT",
        message: `Conflicting Wix variant id: stored ${existing.wixVariantId}, incoming ${incoming.wixVariantId}`,
      };
    }
  }
  if (existing.wixProductId != null && incoming.wixProductId != null) {
    if (existing.wixProductId !== incoming.wixProductId) {
      return {
        status: "CONFLICT",
        code: "PRODUCT_IDENTITY_CONFLICT",
        message: `Conflicting Wix product id: stored ${existing.wixProductId}, incoming ${incoming.wixProductId}`,
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
  fact: WixOrderLineSaleFact,
  input: { evidenceId: string; code: string; message: string }
): Promise<ApplyWixPaidOrderLineResult> {
  const updated = await tx.wixOrderLineSaleFact.update({
    where: { id: fact.id },
    data: {
      causalConflict: true,
      causalConflictCode: input.code.slice(0, 64),
      causalConflictEvidenceId: input.evidenceId,
      causalConflictDetectedAt: new Date(),
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

function isPreBootstrap(line: WixPaidOrderLineObservation): boolean {
  if (!(line.importBootstrapStartedAt instanceof Date) || !(line.triggeredAt instanceof Date)) {
    return false;
  }
  return line.triggeredAt.getTime() <= line.importBootstrapStartedAt.getTime();
}

/**
 * Apply one paid Wix order line as an exactly-once Foundation SALE (when mapped + tracked).
 * Idempotent on (connection, orderId, lineItemId). Conflicting causal replays fail closed.
 */
export async function applyWixPaidOrderLineSale(
  db: PrismaClient,
  input: {
    connectionId: string;
    memberId: string;
    evidenceId: string;
    line: WixPaidOrderLineObservation;
  }
): Promise<ApplyWixPaidOrderLineResult> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lineLockKey(
      input.connectionId,
      input.line.wixOrderId,
      input.line.wixLineItemId
    )}))`;

    const existing = await tx.wixOrderLineSaleFact.findUnique({
      where: {
        wixConnectionId_wixOrderId_wixLineItemId: {
          wixConnectionId: input.connectionId,
          wixOrderId: input.line.wixOrderId,
          wixLineItemId: input.line.wixLineItemId,
        },
      },
    });

    if (existing) {
      const equiv = classifyWixSaleFactEquivalence(existing, input.line);
      if (equiv.status === "CONFLICT") {
        return recordCausalFactConflict(tx, existing, {
          evidenceId: input.evidenceId,
          code: equiv.code,
          message: equiv.message,
        });
      }
      if (
        existing.applyState === "APPLIED" ||
        existing.applyState === "PRE_BOOTSTRAP_ACKED"
      ) {
        return {
          status: "ALREADY_APPLIED" as const,
          factId: existing.id,
          appliedQuantity: existing.appliedQuantity,
        };
      }
    }

    let fact: WixOrderLineSaleFact;
    if (existing) {
      fact = existing;
    } else {
      try {
        fact = await tx.wixOrderLineSaleFact.create({
          data: {
            wixConnectionId: input.connectionId,
            memberId: input.memberId,
            wixOrderId: input.line.wixOrderId,
            wixLineItemId: input.line.wixLineItemId,
            wixProductId: input.line.wixProductId,
            wixVariantId: input.line.wixVariantId,
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
        const raced = await tx.wixOrderLineSaleFact.findUnique({
          where: {
            wixConnectionId_wixOrderId_wixLineItemId: {
              wixConnectionId: input.connectionId,
              wixOrderId: input.line.wixOrderId,
              wixLineItemId: input.line.wixLineItemId,
            },
          },
        });
        if (!raced) throw error;
        const racedEquiv = classifyWixSaleFactEquivalence(raced, input.line);
        if (racedEquiv.status === "CONFLICT") {
          return recordCausalFactConflict(tx, raced, {
            evidenceId: input.evidenceId,
            code: racedEquiv.code,
            message: racedEquiv.message,
          });
        }
        if (raced.applyState === "APPLIED" || raced.applyState === "PRE_BOOTSTRAP_ACKED") {
          return {
            status: "ALREADY_APPLIED" as const,
            factId: raced.id,
            appliedQuantity: raced.appliedQuantity,
          };
        }
        fact = raced;
      }
    }

    if (isPreBootstrap(input.line)) {
      const acked = await tx.wixOrderLineSaleFact.update({
        where: { id: fact.id },
        data: {
          applyState: "PRE_BOOTSTRAP_ACKED",
          appliedQuantity: 0,
          appliedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      return { status: "PRE_BOOTSTRAP_ACKED" as const, factId: acked.id };
    }

    // Find variant map by wixVariantId first
    let variantMap =
      input.line.wixVariantId != null
        ? await tx.wixVariantMap.findFirst({
            where: {
              wixConnectionId: input.connectionId,
              wixVariantId: input.line.wixVariantId,
            },
          })
        : null;

    // Try by product ID for simple products
    if (!variantMap && input.line.wixProductId != null) {
      variantMap = await tx.wixVariantMap.findFirst({
        where: {
          wixConnectionId: input.connectionId,
          wixVariantId: input.line.wixProductId, // Simple products use product ID as variant ID
        },
      });
    }

    // Try matching by choice values
    if (!variantMap && input.line.wixProductId != null && input.line.choices) {
      const valueKey = choiceValuesKey(input.line.choices);
      if (valueKey) {
        const link = await tx.wixListingLink.findFirst({
          where: {
            wixConnectionId: input.connectionId,
            wixProductId: input.line.wixProductId,
          },
          include: { variantMaps: true },
        });
        const maps = link?.variantMaps ?? [];
        const variants = await tx.storeVariant.findMany({
          where: { id: { in: maps.map((map) => map.storeVariantId) }, status: "ACTIVE" },
          select: { id: true, options: true },
        });
        const variantById = new Map(variants.map((row) => [row.id, row] as const));
        const matched = maps.filter((map) => {
          const variant = variantById.get(map.storeVariantId);
          return variant != null && choiceValuesKey(variant.options) === valueKey;
        });
        if (matched.length === 1) variantMap = matched[0]!;
      }
    }

    // Fallback: single-variant listing
    if (!variantMap && input.line.wixProductId != null) {
      const link = await tx.wixListingLink.findFirst({
        where: {
          wixConnectionId: input.connectionId,
          wixProductId: input.line.wixProductId,
        },
        include: { variantMaps: { orderBy: { createdAt: "asc" }, take: 1 } },
      });
      if (link?.variantMaps.length === 1) {
        variantMap = link.variantMaps[0]!;
      }
    }

    if (!variantMap || variantMap.memberId !== input.memberId) {
      const unmapped = await tx.wixOrderLineSaleFact.update({
        where: { id: fact.id },
        data: {
          applyState: "UNMAPPED",
          lastErrorCode: "UNMAPPED_VARIANT",
          lastErrorMessage: "No StoreVariant mapping for this Wix order line on this connection generation",
        },
      });
      return { status: "UNMAPPED" as const, factId: unmapped.id };
    }

    const mapEquiv = classifyWixSaleFactEquivalence(fact, input.line, variantMap.storeVariantId);
    if (mapEquiv.status === "CONFLICT") {
      return recordCausalFactConflict(tx, fact, {
        evidenceId: input.evidenceId,
        code: mapEquiv.code,
        message: mapEquiv.message,
      });
    }

    // Check import bootstrap from listing link
    if (!input.line.importBootstrapStartedAt && input.line.triggeredAt) {
      const link = await tx.wixListingLink.findFirst({
        where: {
          wixConnectionId: input.connectionId,
          storeItemId: variantMap.storeItemId,
        },
        select: { importBootstrapStartedAt: true },
      });
      if (
        link?.importBootstrapStartedAt &&
        input.line.triggeredAt.getTime() <= link.importBootstrapStartedAt.getTime()
      ) {
        const acked = await tx.wixOrderLineSaleFact.update({
          where: { id: fact.id },
          data: {
            applyState: "PRE_BOOTSTRAP_ACKED",
            storeVariantId: variantMap.storeVariantId,
            storeItemId: variantMap.storeItemId,
            appliedQuantity: 0,
            appliedAt: new Date(),
          },
        });
        return { status: "PRE_BOOTSTRAP_ACKED" as const, factId: acked.id };
      }
    }

    try {
      const sale = await applyTrackedMarketplaceSale(tx, {
        variantId: variantMap.storeVariantId,
        memberId: input.memberId,
        qty: fact.paidQuantity,
        sourceScope: input.connectionId,
        sourceFactId: `${fact.wixOrderId}:${fact.wixLineItemId}`,
        sourceSystem: WIX_SOURCE_SYSTEM,
        metadata: {
          wixOrderId: fact.wixOrderId,
          wixLineItemId: fact.wixLineItemId,
          wixProductId: input.line.wixProductId,
          wixVariantId: input.line.wixVariantId,
          evidenceId: input.evidenceId,
        },
      });

      const applied = await tx.wixOrderLineSaleFact.update({
        where: { id: fact.id },
        data: {
          applyState: "APPLIED",
          appliedQuantity: fact.paidQuantity,
          storeVariantId: variantMap.storeVariantId,
          storeItemId: variantMap.storeItemId,
          wixProductId: input.line.wixProductId ?? fact.wixProductId,
          wixVariantId: input.line.wixVariantId ?? fact.wixVariantId,
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
      const message = error instanceof Error ? error.message.slice(0, 500) : "Sale apply failed";
      const failed = await tx.wixOrderLineSaleFact.update({
        where: { id: fact.id },
        data: {
          applyState: "FAILED",
          storeVariantId: variantMap.storeVariantId,
          storeItemId: variantMap.storeItemId,
          lastErrorCode: code.slice(0, 64),
          lastErrorMessage: message,
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

export async function applyWixPaidOrderObservation(
  db: PrismaClient,
  input: {
    connectionId: string;
    memberId: string;
    evidenceId: string;
    lines: WixPaidOrderLineObservation[];
  }
): Promise<{ status: "PROCESSED"; lines: ApplyWixPaidOrderLineResult[] }> {
  const lines: ApplyWixPaidOrderLineResult[] = [];
  for (const line of input.lines) {
    lines.push(
      await applyWixPaidOrderLineSale(db, {
        connectionId: input.connectionId,
        memberId: input.memberId,
        evidenceId: input.evidenceId,
        line,
      })
    );
  }
  return { status: "PROCESSED", lines };
}

/**
 * Undo APPLIED Wix sale facts for a canceled order. Idempotent via restock sourceFactId.
 */
export async function restockWixCanceledOrder(
  db: PrismaClient,
  input: { connectionId: string; wixOrderId: string },
  deps?: { restock?: typeof restockTrackedVariant }
): Promise<{ restocked: number }> {
  const restock = deps?.restock ?? restockTrackedVariant;
  const facts = await db.wixOrderLineSaleFact.findMany({
    where: {
      wixConnectionId: input.connectionId,
      wixOrderId: input.wixOrderId,
      applyState: "APPLIED",
      appliedQuantity: { gt: 0 },
      storeVariantId: { not: null },
    },
  });
  let restocked = 0;
  for (const fact of facts) {
    if (!fact.storeVariantId) continue;
    try {
      await db.$transaction(async (tx) => {
        await restock(tx, {
          variantId: fact.storeVariantId!,
          qty: fact.appliedQuantity,
          kind: "UNDO_CONSUMPTION",
          sourceFactId: `wix-cancel:${fact.wixOrderId}:${fact.wixLineItemId}`,
          cause: "REFUND",
        });
        await tx.wixOrderLineSaleFact.update({
          where: { id: fact.id },
          data: { applyState: "RESTOCKED" },
        });
      });
      restocked += 1;
    } catch {
      // Made-to-order or missing inventory state cannot restock; leave the sale fact applied.
    }
  }
  return { restocked };
}
