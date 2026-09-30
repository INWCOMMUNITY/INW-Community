import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { disconnectStripeAndDisableListings } from "@/lib/stripe-connect-disconnect";
import { jsonIfCutoverBlocked } from "@/lib/commerce-foundation-cutover-http";

/**
 * POST: Disconnect Stripe Connect for the current user.
 * Clears stripeConnectAccountId and disables all active store listings so they
 * no longer appear for sale. Allows Stripe Connect onboarding to be run again.
 */
export async function POST(req: NextRequest) {
  const session = (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await disconnectStripeAndDisableListings(session.user.id);
  } catch (e) {
    const cutover = jsonIfCutoverBlocked(e);
    if (cutover) return cutover;
    throw e;
  }
  return NextResponse.json({ ok: true });
}
