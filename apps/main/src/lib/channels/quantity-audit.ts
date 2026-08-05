/**
 * Quantity Audit Log - tracks all quantity changes across platforms.
 * Provides full audit trail for inventory changes from sales, syncs, manual edits, etc.
 */

import { prisma, Prisma } from "database";
import type { ChannelProvider } from "./types";

export type QuantityChangeReason =
  | "sale"
  | "restock"
  | "sync_pull"
  | "manual_edit"
  | "refund"
  | "bulk_edit"
  | "import"
  | "sync_push";

export type QuantityChangeProvider = ChannelProvider | "inwc";

export interface LogQuantityChangeParams {
  storeItemId: string;
  memberId: string;
  provider: QuantityChangeProvider;
  previousQty: number;
  newQty: number;
  reason: QuantityChangeReason;
  externalEventId?: string;
  orderId?: string;
  variantValue?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Fire-and-forget insert into QuantityAuditLog. Never throws — operations
 * must not fail because of a logging issue.
 */
export function logQuantityChange(params: LogQuantityChangeParams): void {
  const {
    storeItemId,
    memberId,
    provider,
    previousQty,
    newQty,
    reason,
    externalEventId,
    orderId,
    variantValue,
    metadata,
  } = params;

  // Don't log if quantity didn't actually change
  if (previousQty === newQty) {
    return;
  }

  const delta = newQty - previousQty;

  prisma.quantityAuditLog
    .create({
      data: {
        storeItemId,
        memberId,
        provider,
        previousQty,
        newQty,
        delta,
        reason,
        externalEventId: externalEventId ?? null,
        orderId: orderId ?? null,
        variantValue: variantValue ?? null,
        metadata:
          metadata != null ? (metadata as Prisma.InputJsonValue) : undefined,
      },
    })
    .catch((e) => {
      console.warn("[quantity-audit] failed to write", {
        storeItemId,
        reason,
        error: String(e).slice(0, 200),
      });
    });
}

/**
 * Async version that waits for the log to be written.
 * Use sparingly - prefer fire-and-forget logQuantityChange for most cases.
 */
export async function logQuantityChangeAsync(
  params: LogQuantityChangeParams
): Promise<void> {
  const {
    storeItemId,
    memberId,
    provider,
    previousQty,
    newQty,
    reason,
    externalEventId,
    orderId,
    variantValue,
    metadata,
  } = params;

  // Don't log if quantity didn't actually change
  if (previousQty === newQty) {
    return;
  }

  const delta = newQty - previousQty;

  try {
    await prisma.quantityAuditLog.create({
      data: {
        storeItemId,
        memberId,
        provider,
        previousQty,
        newQty,
        delta,
        reason,
        externalEventId: externalEventId ?? null,
        orderId: orderId ?? null,
        variantValue: variantValue ?? null,
        metadata:
          metadata != null ? (metadata as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch (e) {
    console.warn("[quantity-audit] failed to write", {
      storeItemId,
      reason,
      error: String(e).slice(0, 200),
    });
  }
}

/**
 * Log quantity change for a sale (convenience wrapper).
 */
export function logSaleQuantityChange(params: {
  storeItemId: string;
  memberId: string;
  provider: QuantityChangeProvider;
  previousQty: number;
  newQty: number;
  orderId?: string;
  externalEventId?: string;
  variantValue?: string;
}): void {
  logQuantityChange({
    ...params,
    reason: "sale",
  });
}

/**
 * Log quantity change from channel sync pull (convenience wrapper).
 */
export function logSyncPullQuantityChange(params: {
  storeItemId: string;
  memberId: string;
  provider: ChannelProvider;
  previousQty: number;
  newQty: number;
  externalEventId?: string;
}): void {
  logQuantityChange({
    ...params,
    reason: "sync_pull",
  });
}

/**
 * Log quantity change from manual edit (convenience wrapper).
 */
export function logManualEditQuantityChange(params: {
  storeItemId: string;
  memberId: string;
  previousQty: number;
  newQty: number;
  variantValue?: string;
}): void {
  logQuantityChange({
    ...params,
    provider: "inwc",
    reason: "manual_edit",
  });
}

/**
 * Log quantity change from bulk edit (convenience wrapper).
 */
export function logBulkEditQuantityChange(params: {
  storeItemId: string;
  memberId: string;
  previousQty: number;
  newQty: number;
  metadata?: Record<string, unknown>;
}): void {
  logQuantityChange({
    ...params,
    provider: "inwc",
    reason: "bulk_edit",
  });
}

/**
 * Log quantity change from refund/cancel (convenience wrapper).
 */
export function logRefundQuantityChange(params: {
  storeItemId: string;
  memberId: string;
  previousQty: number;
  newQty: number;
  orderId?: string;
}): void {
  logQuantityChange({
    ...params,
    provider: "inwc",
    reason: "refund",
  });
}

/**
 * Get paginated audit log for a store item.
 */
export async function getQuantityAuditLog(params: {
  storeItemId?: string;
  memberId?: string;
  provider?: string;
  reason?: QuantityChangeReason;
  limit?: number;
  offset?: number;
}): Promise<{
  logs: Array<{
    id: string;
    storeItemId: string;
    memberId: string;
    provider: string;
    previousQty: number;
    newQty: number;
    delta: number;
    reason: string;
    externalEventId: string | null;
    orderId: string | null;
    variantValue: string | null;
    metadata: unknown;
    createdAt: Date;
  }>;
  total: number;
}> {
  const { storeItemId, memberId, provider, reason, limit = 50, offset = 0 } = params;

  const where: Record<string, unknown> = {};
  if (storeItemId) where.storeItemId = storeItemId;
  if (memberId) where.memberId = memberId;
  if (provider) where.provider = provider;
  if (reason) where.reason = reason;

  const [logs, total] = await Promise.all([
    prisma.quantityAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.quantityAuditLog.count({ where }),
  ]);

  return { logs, total };
}
