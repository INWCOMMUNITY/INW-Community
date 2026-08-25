import type { PrismaClient } from "database";
import {
  ConcurrentModificationError,
  InsufficientStockError,
} from "@/lib/store-item-inventory-errors";
import {
  decrementOptionQuantity,
  decrementSingleAxisOptionQuantities,
  hasMeaningfulVariantSelection,
  hasOptionQuantities,
  sumOptionQuantities,
} from "@/lib/store-item-variants";

export { ConcurrentModificationError, InsufficientStockError };

type StoreItemRow = { id: string; variants: unknown; quantity: number; updatedAt: Date };

const MAX_RETRIES = 3;

/**
 * Decrement listing inventory after a confirmed sale (webhook, cash checkout, etc.).
 * Uses optimistic locking via updatedAt to detect concurrent modifications.
 * - Option-quantity listings: update variant JSON and set `quantity` to the sum of options (stays in sync with seller hub).
 * - Re-read the row before each line when an order has multiple rows for the same `storeItemId`.
 * - Retries up to MAX_RETRIES times on concurrent modification conflicts.
 */
export async function applyStoreItemDecrementAfterSale(
  prisma: Pick<PrismaClient, "storeItem">,
  storeItem: StoreItemRow,
  line: { quantity: number; variant: unknown }
): Promise<void> {
  const sold = line.quantity;
  if (sold < 1) return;

  let currentItem = storeItem;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    attempt++;
    const { variants, quantity: priorQty, updatedAt } = currentItem;

    try {
      if (!hasOptionQuantities(variants)) {
        const result = await prisma.storeItem.updateMany({
          where: {
            id: storeItem.id,
            updatedAt: updatedAt,
            quantity: { gte: sold },
          },
          data: { quantity: { decrement: sold } },
        });

        if (result.count === 0) {
          const fresh = await prisma.storeItem.findUnique({
            where: { id: storeItem.id },
            select: { quantity: true, updatedAt: true },
          });
          if (!fresh || fresh.quantity < sold) {
            throw new InsufficientStockError(storeItem.id, sold, fresh?.quantity ?? 0);
          }
          throw new ConcurrentModificationError(storeItem.id);
        }
        return;
      }

      let res = hasMeaningfulVariantSelection(line.variant)
        ? decrementOptionQuantity(variants, line.variant, sold)
        : null;
      if (!res) {
        res = decrementSingleAxisOptionQuantities(variants, sold);
      }

      if (res) {
        const nextSum = sumOptionQuantities(res.variants);
        const result = await prisma.storeItem.updateMany({
          where: {
            id: storeItem.id,
            updatedAt: updatedAt,
            quantity: { gte: sold },
          },
          data: {
            variants: res.variants as object,
            quantity: nextSum,
          },
        });

        if (result.count === 0) {
          const fresh = await prisma.storeItem.findUnique({
            where: { id: storeItem.id },
            select: { quantity: true, updatedAt: true },
          });
          if (!fresh || fresh.quantity < sold) {
            throw new InsufficientStockError(storeItem.id, sold, fresh?.quantity ?? 0);
          }
          throw new ConcurrentModificationError(storeItem.id);
        }
        return;
      }

      console.error("[inventory] Option listing: could not decrement variant rows; using aggregate only", {
        storeItemId: storeItem.id,
        sold,
        priorQty,
      });
      const result = await prisma.storeItem.updateMany({
        where: {
          id: storeItem.id,
          updatedAt: updatedAt,
          quantity: { gte: sold },
        },
        data: { quantity: { decrement: sold } },
      });

      if (result.count === 0) {
        const fresh = await prisma.storeItem.findUnique({
          where: { id: storeItem.id },
          select: { quantity: true, updatedAt: true },
        });
        if (!fresh || fresh.quantity < sold) {
          throw new InsufficientStockError(storeItem.id, sold, fresh?.quantity ?? 0);
        }
        throw new ConcurrentModificationError(storeItem.id);
      }
      return;
    } catch (e) {
      if (e instanceof ConcurrentModificationError && attempt < MAX_RETRIES) {
        console.warn("[inventory] Concurrent modification detected, retrying", {
          storeItemId: storeItem.id,
          attempt,
          maxRetries: MAX_RETRIES,
        });
        const freshItem = await prisma.storeItem.findUnique({
          where: { id: storeItem.id },
          select: { id: true, variants: true, quantity: true, updatedAt: true },
        });
        if (!freshItem) {
          throw new Error(`StoreItem ${storeItem.id} not found during retry`);
        }
        currentItem = freshItem;
        continue;
      }
      throw e;
    }
  }

  throw new ConcurrentModificationError(storeItem.id);
}
