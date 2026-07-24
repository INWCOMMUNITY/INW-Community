import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { logSellerActivity } from "@/lib/seller-activity-log";

export const dynamic = "force-dynamic";

/**
 * POST /api/seller-hub/bulk-undo/[id]
 * 
 * Undo a bulk edit operation by restoring items to their before state.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Fetch the snapshot
  const snapshot = await prisma.bulkEditSnapshot.findUnique({
    where: { id },
  });

  if (!snapshot) {
    return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
  }

  // Verify ownership
  if (snapshot.memberId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Check if can be undone
  if (!snapshot.canUndo) {
    return NextResponse.json(
      { error: "This operation cannot be undone" },
      { status: 400 }
    );
  }

  if (snapshot.undoneAt) {
    return NextResponse.json(
      { error: "This operation has already been undone" },
      { status: 400 }
    );
  }

  const now = new Date();
  if (snapshot.expiresAt < now) {
    return NextResponse.json(
      { error: "Undo window has expired (24 hours)" },
      { status: 400 }
    );
  }

  // Perform the undo based on operation type
  const changes = snapshot.changes as Record<string, { before: Record<string, unknown>; after: Record<string, unknown> | null }>;
  const itemIds = Object.keys(changes);

  let restored = 0;
  let failed = 0;
  const errors: { itemId: string; error: string }[] = [];

  if (snapshot.operation === "bulk_edit") {
    // Restore each item to its before state
    for (const [itemId, change] of Object.entries(changes)) {
      try {
        const before = change.before;
        
        // Filter out non-updatable fields
        const updateData: Record<string, unknown> = {};
        const allowedFields = [
          "title",
          "priceCents",
          "quantity",
          "category",
          "subcategory",
          "condition",
          "status",
          "shippingCostCents",
          "shippingDisabled",
          "localDeliveryAvailable",
          "inStorePickupAvailable",
        ];
        
        for (const field of allowedFields) {
          if (before[field] !== undefined) {
            updateData[field] = before[field];
          }
        }
        
        // Verify item still exists and is owned by user
        const item = await prisma.storeItem.findFirst({
          where: { id: itemId, memberId: session.user.id },
        });
        
        if (!item) {
          errors.push({ itemId, error: "Item not found or not owned" });
          failed++;
          continue;
        }
        
        await prisma.storeItem.update({
          where: { id: itemId },
          data: updateData,
        });
        
        restored++;
      } catch (e) {
        failed++;
        errors.push({
          itemId,
          error: e instanceof Error ? e.message : "Failed to restore",
        });
      }
    }
  } else if (snapshot.operation === "bulk_publish" || snapshot.operation === "bulk_unpublish") {
    // Channel operations are more complex and may not be fully reversible
    // For now, we log the attempt but don't actually reverse channel state
    return NextResponse.json(
      {
        error: "Channel publish/unpublish operations cannot be automatically undone. Please manually republish or unpublish the affected items.",
        itemIds,
      },
      { status: 400 }
    );
  } else if (snapshot.operation === "bulk_delete") {
    return NextResponse.json(
      {
        error: "Deleted items cannot be recovered. Please recreate the listings if needed.",
        itemIds,
      },
      { status: 400 }
    );
  }

  // Mark snapshot as undone
  await prisma.bulkEditSnapshot.update({
    where: { id },
    data: { undoneAt: now },
  });

  // Log the undo activity
  logSellerActivity(session.user.id, "bulk_edit", "bulk_operation", id, {
    action: "undo",
    originalOperation: snapshot.operation,
    restored,
    failed,
    itemIds,
  });

  return NextResponse.json({
    success: true,
    restored,
    failed,
    errors: errors.length > 0 ? errors : undefined,
  });
}

/**
 * GET /api/seller-hub/bulk-undo/[id]
 * 
 * Get details about a specific snapshot for undo preview.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const snapshot = await prisma.bulkEditSnapshot.findUnique({
    where: { id },
  });

  if (!snapshot) {
    return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
  }

  if (snapshot.memberId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const isExpired = snapshot.expiresAt < now;

  return NextResponse.json({
    id: snapshot.id,
    operation: snapshot.operation,
    itemCount: snapshot.itemCount,
    canUndo: snapshot.canUndo && !isExpired && !snapshot.undoneAt,
    undoneAt: snapshot.undoneAt?.toISOString() ?? null,
    expiresAt: snapshot.expiresAt.toISOString(),
    createdAt: snapshot.createdAt.toISOString(),
    isExpired,
    changes: snapshot.changes,
  });
}
