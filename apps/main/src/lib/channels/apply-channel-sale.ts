import { prisma } from "database";
import { applyStoreItemDecrementAfterSale } from "@/lib/store-item-inventory-sale";
import { InsufficientStockError } from "@/lib/store-item-inventory-errors";
import {
  hasOptionQuantities,
  shouldMarkStoreItemSoldOut,
  zeroAllVariantQuantities,
} from "@/lib/store-item-variants";
import { deleteFeedPostsForSoldItem } from "@/lib/delete-posts-for-sold-item";
import { syncInventoryToChannels } from "./sync-inventory";
import { logSaleQuantityChange } from "./quantity-audit";
import { logSyncEvent } from "./sync-log";
import { matchSaleToVariantOption } from "./variant-sync";
import { CHANNEL_PROVIDER_LABELS } from "./provider-ui";
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

/**
 * Seller-facing copy for an oversell (a channel sold more than INW had in stock). Surfaced as a
 * Needs Attention card so the seller can reconcile physical stock instead of it being silent.
 */
export function oversellAlertMessage(args: {
  provider: ChannelProvider;
  requested: number;
  available: number;
}): string {
  const label = CHANNEL_PROVIDER_LABELS[args.provider] ?? args.provider;
  return (
    `Oversold on ${label}: a buyer purchased ${args.requested} but only ${args.available} ` +
    `were in stock. INW marked this item sold out on every connected shop to stop further ` +
    `overselling. Restock and update the quantity to relist it.`
  );
}

/**
 * Clamp a listing to sold-out after an oversell: zero the aggregate quantity (and every
 * per-option/SKU quantity) and mark it sold_out so the sell-out fans out to all channels.
 */
async function clampStoreItemToSoldOut(storeItemId: string): Promise<void> {
  const item = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: { variants: true },
  });
  const data: { quantity: number; status: string; variants?: object } = {
    quantity: 0,
    status: "sold_out",
  };
  if (item && hasOptionQuantities(item.variants)) {
    data.variants = zeroAllVariantQuantities(item.variants) as object;
  }
  await prisma.storeItem.update({ where: { id: storeItemId }, data }).catch(() => {});
}

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
      // Oversell: the channel sold more than INW had. Never silently burn it.
      // Clamp INW to sold-out, fan the sell-out to every channel, and raise a
      // seller-visible alert so they can reconcile physical stock. The event is
      // terminally recorded (payload.oversell) so it can't loop and re-alert.
      await clampStoreItemToSoldOut(storeItem.id);

      const oversellAt = new Date();
      await prisma.channelSyncEvent
        .update({
          where: {
            provider_externalEventId: { provider, externalEventId: sale.externalEventId },
          },
          data: {
            appliedAt: oversellAt,
            processedAt: oversellAt,
            payload: {
              quantitySold: sale.quantitySold,
              applied: true,
              oversell: true,
              requested: sale.quantitySold,
              available: e.available,
            },
          },
        })
        .catch(() => {});

      logSaleQuantityChange({
        storeItemId: storeItem.id,
        memberId,
        provider,
        previousQty,
        newQty: 0,
        externalEventId: sale.externalEventId,
        variantValue: saleVariant ? JSON.stringify(saleVariant) : undefined,
      });

      // Take the sibling listings down (absolute qty 0 / sold-out).
      await syncInventoryToChannels(storeItem.id);
      deleteFeedPostsForSoldItem(storeItem.id).catch(() => {});

      // Raise the alert AFTER fan-out (which resets the link to synced) so it sticks.
      const message = oversellAlertMessage({
        provider,
        requested: sale.quantitySold,
        available: e.available,
      });
      await prisma.channelListingLink
        .update({
          where: { id: linkId },
          data: { syncStatus: "error", syncError: message },
        })
        .catch(() => {});

      logSyncEvent(
        memberId,
        provider,
        "sale_insufficient",
        `Sale ${sale.externalEventId}: requested ${sale.quantitySold}, available ${e.available}; clamped to sold-out`,
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
