import type { PrismaClient } from "database";
import {
  decrementOptionQuantity,
  decrementSingleAxisOptionQuantities,
  hasMeaningfulVariantSelection,
  hasOptionQuantities,
  sumOptionQuantities,
} from "@/lib/store-item-variants";

type StoreItemRow = { id: string; variants: unknown; quantity: number };

/**
 * Decrement listing inventory after a confirmed sale (webhook, cash checkout, etc.).
 * - Option-quantity listings: update variant JSON and set `quantity` to the sum of options (stays in sync with seller hub).
 * - Re-read the row before each line when an order has multiple rows for the same `storeItemId`.
 */
export async function applyStoreItemDecrementAfterSale(
  prisma: Pick<PrismaClient, "storeItem">,
  storeItem: StoreItemRow,
  line: { quantity: number; variant: unknown }
): Promise<void> {
  const { variants, quantity: priorQty } = storeItem;
  const sold = line.quantity;
  if (sold < 1) return;

  if (!hasOptionQuantities(variants)) {
    await prisma.storeItem.update({
      where: { id: storeItem.id },
      data: { quantity: { decrement: sold } },
    });
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
    await prisma.storeItem.update({
      where: { id: storeItem.id },
      data: {
        variants: res.variants as object,
        quantity: nextSum,
      },
    });
    return;
  }

  console.error("[inventory] Option listing: could not decrement variant rows; using aggregate only", {
    storeItemId: storeItem.id,
    sold,
    priorQty,
  });
  await prisma.storeItem.update({
    where: { id: storeItem.id },
    data: { quantity: { decrement: sold } },
  });
}
