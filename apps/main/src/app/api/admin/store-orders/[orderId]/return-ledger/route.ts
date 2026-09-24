import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getFoundationReturnLedgerAdminState } from "@/lib/foundation-return-ledger-admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/store-orders/[orderId]/return-ledger
 * Read-only dual ledger evidence (Path-A return + return_entitlement).
 * No mutation. No Stripe.
 */
export async function GET(
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
    const state = await getFoundationReturnLedgerAdminState({ storeOrderId: orderId });
    if (!state) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(state);
  } catch (err) {
    console.error("[admin] return-ledger read", orderId, err);
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }
}
