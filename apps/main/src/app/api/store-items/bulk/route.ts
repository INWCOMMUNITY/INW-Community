import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { syncInventoryToChannels } from "@/lib/channels/sync-inventory";

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
      updateData.status = updates.status;
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

    // Handle price and quantity updates per-item (may need calculation)
    const itemsNeedingIndividualUpdate =
      updates.priceChangePercent !== undefined ||
      updates.quantityAdjust !== undefined;

    if (itemsNeedingIndividualUpdate) {
      // Update each item individually
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

          if (updates.quantityAdjust !== undefined) {
            const newQty = Math.max(0, item.quantity + updates.quantityAdjust);
            itemUpdate.quantity = newQty;
          } else if (updates.quantity !== undefined) {
            itemUpdate.quantity = updates.quantity;
          }

          await prisma.storeItem.update({
            where: { id: item.id },
            data: itemUpdate,
          });
          result.updated++;
        } catch (e) {
          result.failed++;
          result.errors.push({
            itemId: item.id,
            error: e instanceof Error ? e.message : "Update failed",
          });
        }
      }
    } else {
      // Batch update all items at once
      if (updates.priceCents !== undefined) {
        updateData.priceCents = updates.priceCents;
      }
      if (updates.quantity !== undefined) {
        updateData.quantity = updates.quantity;
      }

      if (Object.keys(updateData).length > 0) {
        const batchResult = await prisma.storeItem.updateMany({
          where: {
            id: { in: Array.from(ownedIds) },
          },
          data: updateData,
        });
        result.updated = batchResult.count;
      } else {
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
    
    // Sync to channels if requested
    if (syncToChannels && result.updated > 0) {
      result.synced = {};

      // Get connections for syncing
      const connections = await prisma.channelConnection.findMany({
        where: { memberId: userId, status: "active" },
        select: { provider: true },
      });

      if (connections.length > 0) {
        // Get updated items with their channel links
        const updatedItems = await prisma.storeItem.findMany({
          where: { id: { in: Array.from(ownedIds) } },
          include: {
            channelLinks: {
              where: { syncEnabled: true },
            },
          },
        });

        for (const item of updatedItems) {
          if (item.channelLinks.length > 0) {
            try {
              const syncResults = await syncInventoryToChannels(item.id);
              for (const sr of syncResults) {
                if (sr.ok) {
                  result.synced[sr.provider] = (result.synced[sr.provider] || 0) + 1;
                }
              }
            } catch {
              // Sync errors are non-fatal for bulk operations
            }
          }
        }
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
 * Delete multiple store items. Only deletes items owned by the current user.
 * Items with active channel links will be unlinked first.
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const storeItemIds = z.array(z.string()).min(1).max(100).parse(body.storeItemIds);

    // Verify ownership and capture state for snapshot
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

    // Create snapshot for undo (bulk delete can't truly undo but we track it)
    let snapshotId: string | undefined;
    try {
      const changes: Record<string, { before: Record<string, unknown>; after: null }> = {};
      for (const item of ownedItems) {
        changes[item.id] = { before: { ...item }, after: null };
      }
      
      const snapshot = await prisma.bulkEditSnapshot.create({
        data: {
          memberId: userId,
          operation: "bulk_delete",
          itemCount: ownedItems.length,
          changes: changes as Prisma.InputJsonValue,
          canUndo: false, // Deletes can't be undone
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      snapshotId = snapshot.id;
      
      // Log activity
      const { logSellerActivity } = await import("@/lib/seller-activity-log");
      logSellerActivity(userId, "bulk_delete", "bulk_operation", snapshot.id, {
        itemIds: ownedIds,
        itemTitles: ownedItems.map((i) => i.title),
        itemCount: ownedItems.length,
      });
    } catch (e) {
      console.warn("[bulk-delete] snapshot creation failed:", e);
    }

    // Remove from remote channels first
    const { deleteStoreItemFromChannels } = await import("@/lib/channels/outbound");
    const channelResults: { itemId: string; provider: string; ok: boolean; error?: string }[] = [];
    
    for (const itemId of ownedIds) {
      try {
        const results = await deleteStoreItemFromChannels(itemId);
        for (const r of results) {
          channelResults.push({ itemId, provider: r.provider, ok: r.ok, error: r.error });
        }
      } catch (e) {
        console.warn(`[bulk-delete] channel unpublish failed for ${itemId}:`, e);
      }
    }

    // Delete the items locally
    const deleteResult = await prisma.storeItem.deleteMany({
      where: { id: { in: ownedIds } },
    });

    return NextResponse.json({
      deleted: deleteResult.count,
      notFound: storeItemIds.length - ownedIds.length,
      snapshotId,
      channelSync: channelResults.length > 0 ? channelResults : undefined,
    });
  } catch (e) {
    console.error("[bulk-delete] error:", e);
    return NextResponse.json(
      { error: "Bulk delete failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
