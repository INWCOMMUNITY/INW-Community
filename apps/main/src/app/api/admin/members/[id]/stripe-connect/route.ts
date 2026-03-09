import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { disconnectStripeAndDisableListings } from "@/lib/stripe-connect-disconnect";

/**
 * DELETE: Disconnect Stripe Connect for a member (admin only).
 * Clears stripeConnectAccountId and disables all active store listings so the
 * member can re-run Stripe Connect onboarding.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await disconnectStripeAndDisableListings(id);
  return NextResponse.json({ ok: true });
}
