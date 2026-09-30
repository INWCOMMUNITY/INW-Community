import { NextRequest, NextResponse } from "next/server";
import { prisma, resetFoundationSellerReturnEntitlementForRetry } from "database";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/store-orders/[orderId]/return-entitlement/reset
 * Admin-only FAILED → PENDING for SellerReturnEntitlementOperation.
 * Does not call Stripe or executeSellerReturnEntitlement.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { orderId: string } }
) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orderId = params.orderId?.trim();
  if (!orderId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const result = await resetFoundationSellerReturnEntitlementForRetry(prisma, {
      storeOrderId: orderId,
    });

    if (result.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    if (result.kind === "REPLAY_WINDOW_EXPIRED") {
      return NextResponse.json(
        {
          error: "replay_window_expired",
          status: result.operation.status,
          retryCount: result.operation.retryCount,
        },
        { status: 409 }
      );
    }

    if (result.kind === "SNAPSHOT_MISSING") {
      return NextResponse.json(
        {
          error: "snapshot_missing",
          status: result.operation.status,
          retryCount: result.operation.retryCount,
        },
        { status: 409 }
      );
    }

    if (result.kind === "NOT_FAILED") {
      return NextResponse.json(
        {
          error: "not_failed",
          reason: result.reason,
          status: result.operation.status,
          retryCount: result.operation.retryCount,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      ok: true,
      storeOrderId: orderId,
      operationId: result.operation.id,
      status: result.operation.status,
      retryCount: result.operation.retryCount,
      providerIdempotencyKey: result.operation.providerIdempotencyKey,
      lastError: result.operation.lastError,
    });
  } catch (err) {
    console.error("[admin] return-entitlement reset", orderId, err);
    return NextResponse.json({ error: "reset_failed" }, { status: 500 });
  }
}
