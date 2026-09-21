import { NextRequest, NextResponse } from "next/server";
import { FoundationTransferResetError, prisma, resetFoundationTransferForOperatorRetry } from "database";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/facilitator-payouts/[orderId]/retry
 * Reset an operator-retryable FAILED TransferOperation to PENDING.
 * Does not call Stripe.
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
    const operation = await resetFoundationTransferForOperatorRetry(prisma, { storeOrderId: orderId });
    return NextResponse.json({
      ok: true,
      storeOrderId: orderId,
      transferOperationId: operation.id,
      status: operation.status,
      retryCount: operation.retryCount,
      providerIdempotencyKey: operation.providerIdempotencyKey,
    });
  } catch (err) {
    if (err instanceof FoundationTransferResetError) {
      const status =
        err.resetCode === "not_found" ? 404 : 409;
      return NextResponse.json({ error: err.resetCode, message: err.message }, { status });
    }
    console.error("[admin] facilitator-payout retry", orderId, err);
    return NextResponse.json({ error: "retry_failed" }, { status: 500 });
  }
}
