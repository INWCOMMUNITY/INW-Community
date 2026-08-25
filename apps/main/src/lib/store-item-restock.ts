import type { Prisma } from "database";
import { hasOptionQuantities, incrementOptionQuantity, shouldMarkStoreItemSoldOut } from "@/lib/store-item-variants";

type Tx = {
  storeItem: {
    findUnique: (args: {
      where: { id: string };
      select?: { id?: true; variants?: true; quantity?: true; status?: true };
    }) => Promise<{ id: string; variants: unknown; quantity: number; status: string } | null>;
    update: (args: {
      where: { id: string };
      data: Prisma.StoreItemUpdateInput;
    }) => Promise<unknown>;
  };
};

/**
 * Restore inventory after refund/cancel. When qty becomes > 0, flip sold_out → active
 * so the listing is not stuck hidden on INW and sibling channels.
 */
export async function restockStoreItemAfterReturn(
  tx: Tx,
  line: { storeItemId: string; quantity: number; variant?: unknown }
): Promise<{ status: string; quantity: number }> {
  const storeItem = await tx.storeItem.findUnique({
    where: { id: line.storeItemId },
    select: { id: true, variants: true, quantity: true, status: true },
  });
  if (!storeItem) {
    return { status: "missing", quantity: 0 };
  }

  if (hasOptionQuantities(storeItem.variants) && line.variant) {
    const res = incrementOptionQuantity(storeItem.variants, line.variant, line.quantity);
    if (res) {
      await tx.storeItem.update({
        where: { id: line.storeItemId },
        data: { variants: res.variants as object, quantity: { increment: res.quantityDelta } },
      });
    } else {
      await tx.storeItem.update({
        where: { id: line.storeItemId },
        data: { quantity: { increment: line.quantity } },
      });
    }
  } else {
    await tx.storeItem.update({
      where: { id: line.storeItemId },
      data: { quantity: { increment: line.quantity } },
    });
  }

  const updated = await tx.storeItem.findUnique({
    where: { id: line.storeItemId },
    select: { id: true, variants: true, quantity: true, status: true },
  });
  if (!updated) return { status: storeItem.status, quantity: storeItem.quantity };

  const stillSoldOut = shouldMarkStoreItemSoldOut(updated);
  let nextStatus = updated.status;
  if (!stillSoldOut && updated.quantity > 0 && updated.status === "sold_out") {
    nextStatus = "active";
    await tx.storeItem.update({
      where: { id: line.storeItemId },
      data: { status: "active" },
    });
  }
  return { status: nextStatus, quantity: updated.quantity };
}

export async function restockOrderLinesAfterReturn(
  tx: Tx,
  items: Array<{ storeItemId: string; quantity: number; variant?: unknown }>
): Promise<string[]> {
  const restockedIds: string[] = [];
  for (const oi of items) {
    await restockStoreItemAfterReturn(tx, oi);
    restockedIds.push(oi.storeItemId);
  }
  return restockedIds;
}
