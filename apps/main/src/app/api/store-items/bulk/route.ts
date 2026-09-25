import { NextRequest, NextResponse } from "next/server";
import { applyFoundationSellerQuantitySets, prisma, Prisma, recordShopifyListingContentDesire } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { storeItemStatusWrite } from "@/lib/store-item-ended-status";
import { endStoreItemListing } from "@/lib/end-store-item-listing";
import { hasOptionQuantities } from "@/lib/store-item-variants";
import {
  gateInteractiveOrFoundationWriter,
  jsonIfCutoverBlocked,
  resolveCommerceInventoryWriter,
} from "@/lib/commerce-foundation-cutover-http";

export const dynamic = "force-dynamic";

const bulkUpdateSchema = z.object({
  storeItemIds: z.array(z.string()).min(1).max(100),
  updates: z.object({
    priceCents: z.number().positive().optional(),
    priceChangePercent: z.number().min(-99).max(1000).optional(),
    quantity: z.number().min(0).optional(),
    quantityAdjust: z.number().optional(),
    category: z.string().nullable().optional(),
    subcategory: z.string().nullable().optional(),
    condition: z.enum(["new", "used"]).optional(),
    status: z.enum(["active", "inactive", "draft"]).optional(),
    shippingCostCents: z.number().min(0).nullable().optional(),
    shippingDisabled: z.boolean().optional(),
    localDeliveryAvailable: z.boolean().optional(),
    inStorePickupAvailable: z.boolean().optional(),
  }),
  syncToChannels: z.boolean().optional().default(false),
});

type BulkUpdateResult = {
  updated: number;
  failed: number;
  errors: { itemId: string; error: string }[];
  synced?: Record<string, number>;
};

function isEndedAtWriteError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /endedAt|ended_at/i.test(msg);
}

async function updateManyStoreItems(ids: string[], data: Record<string, unknown>) {
  try {
    return await prisma.storeItem.updateMany({
      where: { id: { in: ids } },
      data,
    });
  } catch (e) {
    if (!isEndedAtWriteError(e) || data.endedAt === undefined) throw e;
    const { endedAt: _endedAt, ...rest } = data;
    return prisma.storeItem.updateMany({
      where: { id: { in: ids } },
      data: rest,
    });
  }
}

async function updateOneStoreItem(id: string, data: Record<string, unknown>) {
  try {
    await prisma.storeItem.update({ where: { id }, data });
  } catch (e) {
    if (!isEndedAtWriteError(e) || data.endedAt === undefined) throw e;
    const { endedAt: _endedAt, ...rest } = data;
    await prisma.storeItem.update({ where: { id }, data: rest });
  }
}

/** Canonical price update + S5 desire/job capture in one DB transaction. */
async function updateStoreItemWithShopifyDesire(input: {
  itemId: string;
  memberId: string;
  before: { title: string; description: string | null; priceCents: number; sku: string | null };
  data: Record<string, unknown>;
}) {
  await prisma.$transaction(async (tx) => {
    let updated;
    try {
      updated = await tx.storeItem.update({
        where: { id: input.itemId },
        data: input.data,
      });
    } catch (e) {
      if (!isEndedAtWriteError(e) || input.data.endedAt === undefined) throw e;
      const { endedAt: _endedAt, ...rest } = input.data;
      updated = await tx.storeItem.update({
        where: { id: input.itemId },
        data: rest,
      });
    }
    await recordShopifyListingContentDesire(tx, {
      memberId: input.memberId,
      storeItemId: input.itemId,
      before: input.before,
      after: {
        title: updated.title,
        description: updated.description,
        priceCents: updated.priceCents,
        sku: updated.sku,
      },
    });
  });
}

/**
 * PATCH /api/store-items/bulk
 *
 * Update multiple store items at once.
 *
 * Request body:
 * {
 *   storeItemIds: ["id1", "id2", ...],
 *   updates: {
 *     priceCents?: number,
 *     priceChangePercent?: number,  // -10 = decrease by 10%, 20 = increase by 20%
 *     quantity?: number,            // Absolute quantity
 *     quantityAdjust?: number,      // Relative adjustment (+5 or -3)
 *     category?: string | null,
 *     subcategory?: string | null,
 *     condition?: "new" | "used",
 *     status?: "active" | "inactive" | "draft",
 *     shippingCostCents?: number | null,
 *     shippingDisabled?: boolean,
 *     localDeliveryAvailable?: boolean,
 *     inStorePickupAvailable?: boolean
 *   },
 *   syncToChannels?: boolean  // If true, sync changes to connected channels
 * }
 *
 * Response:
 * {
 *   updated: number,
 *   failed: number,
 *   errors: [{ itemId, error }, ...],
 *   synced?: { ebay: 2, etsy: 1 }
 * }
 */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const writer = await resolveCommerceInventoryWriter();
    if (!writer.ok) return writer.response;
    const isFoundation = writer.route === "foundation";

    const body = await req.json();
    const parsed = bulkUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { storeItemIds, updates, syncToChannels } = parsed.data;

    // Verify ownership of all items and capture before state for undo
    const ownedItems = await prisma.storeItem.findMany({
      where: {
        id: { in: storeItemIds },
        memberId: userId,
      },
      select: {
        id: true,
        title: true,
        description: true,
        sku: true,
        priceCents: true,
        quantity: true,
        variants: true,
        category: true,
        subcategory: true,
        condition: true,
        status: true,
        shippingCostCents: true,
        shippingDisabled: true,
        localDeliveryAvailable: true,
        inStorePickupAvailable: true,
      },
    });

    // Capture before state for snapshot
    const beforeState: Record<string, Record<string, unknown>> = {};
    for (const item of ownedItems) {
      beforeState[item.id] = { ...item };
    }

    const ownedIds = new Set(ownedItems.map((item) => item.id));
    const notOwned = storeItemIds.filter((id) => !ownedIds.has(id));

    const result: BulkUpdateResult = {
      updated: 0,
      failed: notOwned.length,
      errors: notOwned.map((id) => ({ itemId: id, error: "Item not found or not owned" })),
    };

    if (ownedItems.length === 0) {
      return NextResponse.json(result);
    }

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (updates.category !== undefined) {
      updateData.category = updates.category;
    }
    if (updates.subcategory !== undefined) {
      updateData.subcategory = updates.subcategory;
    }
    if (updates.condition !== undefined) {
      updateData.condition = updates.condition;
    }
    if (updates.status !== undefined) {
      Object.assign(updateData, storeItemStatusWrite(updates.status));
    }
    if (updates.shippingCostCents !== undefined) {
      updateData.shippingCostCents = updates.shippingCostCents;
    }
    if (updates.shippingDisabled !== undefined) {
      updateData.shippingDisabled = updates.shippingDisabled;
    }
    if (updates.localDeliveryAvailable !== undefined) {
      updateData.localDeliveryAvailable = updates.localDeliveryAvailable;
    }
    if (updates.inStorePickupAvailable !== undefined) {
      updateData.inStorePickupAvailable = updates.inStorePickupAvailable;
    }

    const quantityRequested = updates.quantity !== undefined || updates.quantityAdjust !== undefined;
    if (isFoundation && quantityRequested) {
      for (const item of ownedItems) {
        if (hasOptionQuantities(item.variants)) {
          result.failed++;
          result.errors.push({
            itemId: item.id,
            error: "FOUNDATION bulk quantity is not supported for matrix listings",
          });
          continue;
        }
        const target =
          updates.quantityAdjust !== undefined
            ? Math.max(0, item.quantity + updates.quantityAdjust)
            : updates.quantity!;
        try {
          await prisma.$transaction((tx) =>
            applyFoundationSellerQuantitySets(tx, {
              storeItemId: item.id,
              memberId: userId,
              commandId: `bulk-set-${item.id}`,
              simpleTarget: target,
            })
          );
          result.updated++;
        } catch (e) {
          result.failed++;
          result.errors.push({
            itemId: item.id,
            error: e instanceof Error ? e.message : "Foundation quantity update failed",
          });
        }
      }
    }

    // Handle price and quantity updates per-item (may need calculation)
    const priceRequested =
      updates.priceCents !== undefined || updates.priceChangePercent !== undefined;
    const itemsNeedingIndividualUpdate =
      priceRequested ||
      updates.priceChangePercent !== undefined ||
      (!isFoundation && updates.quantityAdjust !== undefined);

    if (itemsNeedingIndividualUpdate || priceRequested) {
      // Update each item individually so S5 desire/job capture stays in the same TX.
      for (const item of ownedItems) {
        try {
          const itemUpdate: Record<string, unknown> = { ...updateData };

          if (updates.priceChangePercent !== undefined) {
            const newPrice = Math.round(
              item.priceCents * (1 + updates.priceChangePercent / 100)
            );
            itemUpdate.priceCents = Math.max(1, newPrice);
          } else if (updates.priceCents !== undefined) {
            itemUpdate.priceCents = updates.priceCents;
          }

          if (!isFoundation && updates.quantityAdjust !== undefined) {
            const newQty = Math.max(0, item.quantity + updates.quantityAdjust);
            itemUpdate.quantity = newQty;
          } else if (!isFoundation && updates.quantity !== undefined) {
            itemUpdate.quantity = updates.quantity;
          }

          if (Object.keys(itemUpdate).length === 0) continue;

          if (priceRequested) {
            await updateStoreItemWithShopifyDesire({
              itemId: item.id,
              memberId: userId,
              before: {
                title: item.title,
                description: item.description,
                priceCents: item.priceCents,
                sku: item.sku,
              },
              data: itemUpdate,
            });
          } else {
            await updateOneStoreItem(item.id, itemUpdate);
          }
          if (!isFoundation || !quantityRequested) result.updated++;
        } catch (e) {
          result.failed++;
          result.errors.push({
            itemId: item.id,
            error: e instanceof Error ? e.message : "Update failed",
          });
        }
      }
    } else {
      // Batch update all items at once (non-S5 fields only; price uses per-item path above)
      if (!isFoundation && updates.quantity !== undefined) {
        updateData.quantity = updates.quantity;
      }

      if (Object.keys(updateData).length > 0) {
        const batchResult = await updateManyStoreItems(Array.from(ownedIds), updateData);
        result.updated = isFoundation && quantityRequested ? result.updated : batchResult.count;
      } else if (!(isFoundation && quantityRequested)) {
        result.updated = ownedItems.length;
      }
    }

    // Create snapshot for undo capability
    if (result.updated > 0) {
      try {
        // Fetch after state
        const afterItems = await prisma.storeItem.findMany({
          where: { id: { in: Array.from(ownedIds) } },
          select: {
            id: true,
            title: true,
            priceCents: true,
            quantity: true,
            category: true,
            subcategory: true,
            condition: true,
            status: true,
            shippingCostCents: true,
            shippingDisabled: true,
            localDeliveryAvailable: true,
            inStorePickupAvailable: true,
          },
        });

        const changes: Record<string, { before: Record<string, unknown>; after: Record<string, unknown> }> = {};
        for (const item of afterItems) {
          if (beforeState[item.id]) {
            changes[item.id] = {
              before: beforeState[item.id],
              after: { ...item },
            };
          }
        }

        const snapshot = await prisma.bulkEditSnapshot.create({
          data: {
            memberId: userId,
            operation: "bulk_edit",
            itemCount: result.updated,
            changes: changes as Prisma.InputJsonValue,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
          },
        });

        // Log activity
        const { logSellerActivity } = await import("@/lib/seller-activity-log");
        logSellerActivity(userId, "bulk_edit", "bulk_operation", snapshot.id, {
          itemIds: Array.from(ownedIds),
          itemCount: result.updated,
          changedFields: Object.keys(updates).filter((k) => updates[k as keyof typeof updates] !== undefined),
        });

        // Check low stock for updated items
        const { checkLowStockBatch } = await import("@/lib/low-stock-alerts");
        const itemsToCheck = afterItems.map((item) => ({
          id: item.id,
          previousQuantity: (beforeState[item.id]?.quantity as number) ?? undefined,
        }));
        checkLowStockBatch(itemsToCheck).catch(() => {});

        // Add snapshotId to result
        (result as Record<string, unknown>).snapshotId = snapshot.id;
      } catch (e) {
        console.warn("[bulk-update] snapshot creation failed:", e);
      }
    }

    return NextResponse.json(result);
  } catch (e) {
    console.error("[bulk-update] error:", e);
    return NextResponse.json(
      { error: "Bulk update failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/store-items/bulk
 *
 * Logically ends owned listings (inactive + endedAt). Does not physically delete StoreItems.
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const blocked = await gateInteractiveOrFoundationWriter();
    if (blocked) return blocked;

    const body = await req.json();
    const storeItemIds = z.array(z.string()).min(1).max(100).parse(body.storeItemIds);

    const ownedItems = await prisma.storeItem.findMany({
      where: {
        id: { in: storeItemIds },
        memberId: userId,
      },
      select: {
        id: true,
        title: true,
        priceCents: true,
        quantity: true,
        category: true,
        subcategory: true,
        description: true,
        photos: true,
        condition: true,
        status: true,
        shippingCostCents: true,
        shippingDisabled: true,
        localDeliveryAvailable: true,
        inStorePickupAvailable: true,
      },
    });

    const ownedIds = ownedItems.map((item) => item.id);

    if (ownedIds.length === 0) {
      return NextResponse.json({ deleted: 0, errors: [] });
    }

    let snapshotId: string | undefined;
    try {
      const changes: Record<string, { before: Record<string, unknown>; after: { status: "inactive" } }> = {};
      for (const item of ownedItems) {
        changes[item.id] = { before: { ...item }, after: { status: "inactive" } };
      }

      const snapshot = await prisma.bulkEditSnapshot.create({
        data: {
          memberId: userId,
          operation: "bulk_delete",
          itemCount: ownedItems.length,
          changes: changes as Prisma.InputJsonValue,
          canUndo: false,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      snapshotId = snapshot.id;

      const { logSellerActivity } = await import("@/lib/seller-activity-log");
      logSellerActivity(userId, "bulk_delete", "bulk_operation", snapshot.id, {
        itemIds: ownedIds,
        itemTitles: ownedItems.map((i) => i.title),
        itemCount: ownedItems.length,
      });
    } catch (e) {
      console.warn("[bulk-delete] snapshot creation failed:", e);
    }

    for (const item of ownedItems) {
      await endStoreItemListing(item);
    }

    return NextResponse.json({
      deleted: ownedItems.length,
      notFound: storeItemIds.length - ownedIds.length,
      snapshotId,
    });
  } catch (e) {
    const cutover = jsonIfCutoverBlocked(e);
    if (cutover) return cutover;
    console.error("[bulk-delete] error:", e);
    return NextResponse.json(
      { error: "Bulk delete failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
