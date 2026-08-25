import { prisma } from "database";
import { applyStoreItemDecrementAfterSale } from "@/lib/store-item-inventory-sale";
import { InsufficientStockError } from "@/lib/store-item-inventory-errors";
import { shouldMarkStoreItemSoldOut } from "@/lib/store-item-variants";
import { deleteFeedPostsForSoldItem } from "@/lib/delete-posts-for-sold-item";
import { syncInventoryToChannels } from "./sync-inventory";
import { logSaleQuantityChange } from "./quantity-audit";
import { logSyncEvent } from "./sync-log";
import { matchSaleToVariantOption } from "./variant-sync";
import type { ChannelProvider, RemoteSale } from "./types";

function isUniqueViolation(e: unknown): boolean {
  return Boolean(e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002");
}

export type ApplyInboundSaleResult =
  | "applied"
  | "duplicate"
  | "insufficient"
  | "claimed_unapplied"
  | "in_flight";

/** Fresh unapplied claims belong to another in-flight worker (webhook ∥ cron). */
export const UNAPPLIED_CLAIM_STALE_MS = 2 * 60 * 1000;

export type InboundSaleClaimDecision = "missing" | "duplicate" | "in_flight" | "retry_unapplied";

export function inboundSaleClaimDecision(
  event: { appliedAt: Date | null; type: string; processedAt: Date } | null,
  now = Date.now()
): InboundSaleClaimDecision {
  if (!event) return "missing";
  if (event.appliedAt) return "duplicate";
  if (event.type === "sale_ack_absolute") return "duplicate";
  if (now - event.processedAt.getTime() < UNAPPLIED_CLAIM_STALE_MS) return "in_flight";
  return "retry_unapplied";
}

/**
 * Crash-safe inbound sale: unique-claim the event, decrement, then set appliedAt.
 * A crash between claim and decrement leaves appliedAt null so the next cron retries.
 * Unique constraint is no longer a permanent burn on decrement failure.
 */
export async function applyInboundChannelSale(args: {
  provider: ChannelProvider;
  memberId: string;
  sale: RemoteSale;
  storeItem: { id: string; quantity: number; variants: unknown; updatedAt: Date };
  linkId: string;
}): Promise<ApplyInboundSaleResult> {
  const { provider, memberId, sale, storeItem, linkId } = args;
  const existing = await prisma.channelSyncEvent.findUnique({
    where: {
      provider_externalEventId: { provider, externalEventId: sale.externalEventId },
    },
  });
  const decision = inboundSaleClaimDecision(existing);
  if (decision === "duplicate") return "duplicate";
  if (decision === "in_flight") return "in_flight";

  if (decision === "missing") {
    try {
      await prisma.channelSyncEvent.create({
        data: {
          provider,
          externalEventId: sale.externalEventId,
          type: "sale",
          storeItemId: storeItem.id,
          payload: { quantitySold: sale.quantitySold, applied: false },
          appliedAt: null,
        },
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const raced = await prisma.channelSyncEvent.findUnique({
        where: {
          provider_externalEventId: { provider, externalEventId: sale.externalEventId },
        },
      });
      const racedDecision = inboundSaleClaimDecision(raced);
      if (racedDecision === "duplicate" || racedDecision === "in_flight" || racedDecision === "missing") {
        return racedDecision === "missing" ? "in_flight" : racedDecision;
      }
    }
  }

  const saleVariant = sale.variant
    ? matchSaleToVariantOption(sale.variant, storeItem.variants) ?? sale.variant
    : null;

  const previousQty = storeItem.quantity;
  try {
    await applyStoreItemDecrementAfterSale(prisma, storeItem, {
      quantity: sale.quantitySold,
      variant: saleVariant,
    });
  } catch (e) {
    if (e instanceof InsufficientStockError) {
      await prisma.channelSyncEvent
        .update({
          where: {
            provider_externalEventId: { provider, externalEventId: sale.externalEventId },
          },
          data: {
            appliedAt: new Date(),
            processedAt: new Date(),
            payload: {
              quantitySold: sale.quantitySold,
              applied: true,
              skipped: "insufficient_stock",
              available: e.available,
            },
          },
        })
        .catch(() => {});
      logSyncEvent(
        memberId,
        provider,
        "sale_insufficient",
        `Sale ${sale.externalEventId}: requested ${sale.quantitySold}, available ${e.available}`,
        storeItem.id
      );
      return "insufficient";
    }
    console.error("[channels] sale decrement failed; event left unapplied for retry", {
      provider,
      externalEventId: sale.externalEventId,
      storeItemId: storeItem.id,
      error: e instanceof Error ? e.message : String(e),
    });
    return "claimed_unapplied";
  }

  const appliedAt = new Date();
  await prisma.channelSyncEvent
    .update({
      where: {
        provider_externalEventId: { provider, externalEventId: sale.externalEventId },
      },
      data: {
        storeItemId: storeItem.id,
        appliedAt,
        processedAt: appliedAt,
        payload: { quantitySold: sale.quantitySold, applied: true },
      },
    })
    .catch(() => {});

  const updated = await prisma.storeItem.findUnique({
    where: { id: storeItem.id },
    select: { quantity: true, variants: true },
  });

  logSaleQuantityChange({
    storeItemId: storeItem.id,
    memberId,
    provider,
    previousQty,
    newQty: updated?.quantity ?? previousQty - sale.quantitySold,
    externalEventId: sale.externalEventId,
    variantValue: saleVariant ? JSON.stringify(saleVariant) : undefined,
  });

  if (updated && shouldMarkStoreItemSoldOut(updated)) {
    await prisma.storeItem.update({
      where: { id: storeItem.id },
      data: { status: "sold_out" },
    });
    deleteFeedPostsForSoldItem(storeItem.id).catch(() => {});
  }

  await prisma.channelListingLink
    .update({ where: { id: linkId }, data: { lastInboundAt: new Date() } })
    .catch(() => {});

  await syncInventoryToChannels(storeItem.id);
  logSyncEvent(
    memberId,
    provider,
    "sale_applied",
    `Sale ${sale.externalEventId}: qty -${sale.quantitySold}`,
    storeItem.id
  );

  if (updated) {
    const { checkLowStock } = await import("@/lib/low-stock-alerts");
    const itemForCheck = await prisma.storeItem.findUnique({
      where: { id: storeItem.id },
      select: { id: true, memberId: true, title: true, quantity: true, lowStockThreshold: true },
    });
    if (itemForCheck) {
      checkLowStock(itemForCheck, previousQty).catch(() => {});
    }
  }

  return "applied";
}
