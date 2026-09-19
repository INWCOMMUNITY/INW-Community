import { NextRequest, NextResponse } from "next/server";
import {
  commerceInventoryWriterRoute,
  FoundationInventoryError,
  getCommerceFoundationCutoverState,
  prisma,
  Prisma,
  relistFoundationListing,
} from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { logSellerActivity } from "@/lib/seller-activity-log";
import { gateInteractiveOrFoundationWriter } from "@/lib/commerce-foundation-cutover-http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  storeItemIds: z.array(z.string()).min(1, "Select at least one item to relist."),
  quantity: z.number().int().positive().optional(),
});

/**
 * POST /api/store-items/bulk-relist
 *
 * Relist sold-out or ended items (set status back to "active").
 * Optionally set a new quantity.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const blocked = await gateInteractiveOrFoundationWriter();
  if (blocked) return blocked;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  const { storeItemIds, quantity } = body;

  // Get items owned by this user that are in a relistable state
  const items = await prisma.storeItem.findMany({
    where: {
      id: { in: storeItemIds },
      memberId: userId,
      status: { in: ["sold_out", "inactive", "ended", "draft"] },
    },
    select: {
      id: true,
      title: true,
      status: true,
      quantity: true,
    },
  });

  if (items.length === 0) {
    return NextResponse.json({
      error: "No eligible items found. Items must be sold out, ended (inactive), or draft.",
    }, { status: 400 });
  }

  const itemIds = items.map((i) => i.id);
  const newQuantity = quantity ?? 1;

  // Create snapshot for undo
  const changes: Record<string, { before: object; after: object }> = {};
  for (const item of items) {
    changes[item.id] = {
      before: { status: item.status, quantity: item.quantity },
      after: { status: "active", quantity: newQuantity },
    };
  }

  const snapshot = await prisma.bulkEditSnapshot.create({
    data: {
      memberId: userId,
      operation: "bulk_relist",
      itemCount: items.length,
      changes: changes as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  const cutover = await getCommerceFoundationCutoverState(prisma);
  if (commerceInventoryWriterRoute(cutover.mode) === "foundation") {
    let relisted = 0;
    const foundationErrors: { itemId: string; error: string }[] = [];
    for (const item of items) {
      try {
        await prisma.$transaction(async (tx) => {
          const variants = await tx.storeVariant.findMany({ where: { storeItemId: item.id } });
          if (variants.length === 0) {
            throw new FoundationInventoryError(
              "foundation_state_missing",
              `StoreItem ${item.id} has no Variants`
            );
          }
          if (variants.length !== 1) {
            throw new FoundationInventoryError(
              "ambiguous_bulk_quantity",
              "FOUNDATION matrix bulk relist requires per-Variant quantities"
            );
          }
          await relistFoundationListing(tx, {
            storeItemId: item.id,
            memberId: userId,
            commandId: `bulk-relist-${snapshot.id}:${item.id}`,
            simpleTarget: newQuantity,
          });
        });
        relisted += 1;
      } catch (e) {
        foundationErrors.push({
          itemId: item.id,
          error: e instanceof Error ? e.message : "Failed to relist",
        });
      }
    }
    await logSellerActivity(userId, "bulk_relist", "store_item", null, {
      itemIds,
      itemCount: relisted,
      newQuantity,
    });
    if (relisted === 0) {
      return NextResponse.json(
        {
          error: foundationErrors[0]?.error ?? "FOUNDATION bulk relist failed",
          errors: foundationErrors,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({
      ok: true,
      relisted,
      notEligible: storeItemIds.length - items.length,
      snapshotId: snapshot.id,
      errors: foundationErrors.length > 0 ? foundationErrors : undefined,
    });
  }

  // Update all items to active with new quantity
  await prisma.storeItem.updateMany({
    where: { id: { in: itemIds } },
    data: {
      status: "active",
      quantity: newQuantity,
      endedAt: null,
    },
  });

  // Log activity
  await logSellerActivity(userId, "bulk_relist", "store_item", null, {
    itemIds,
    itemCount: items.length,
    newQuantity,
  });

  return NextResponse.json({
    ok: true,
    relisted: items.length,
    notEligible: storeItemIds.length - items.length,
    snapshotId: snapshot.id,
  });
}
