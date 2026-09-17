import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { cancelMemberActiveSubscriptions } from "@/lib/cancel-member-active-subscriptions";
import { STRIPE_NOT_CONFIGURED_MESSAGE } from "@/lib/stripe-secret-key";

/**
 * Cancel NWC membership subscriptions for this customer. Default: end immediately (Stripe
 * `subscriptions.cancel`). Optional `atPeriodEnd: true` only schedules cancellation.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let atPeriodEnd = false;
  try {
    const body = await req.json().catch(() => ({}));
    if (body && typeof body.atPeriodEnd === "boolean") atPeriodEnd = body.atPeriodEnd;
  } catch {
    // ignore
  }

  const result = await cancelMemberActiveSubscriptions(session.user.id, { atPeriodEnd });
  if (!result.configured) {
    return NextResponse.json({ error: STRIPE_NOT_CONFIGURED_MESSAGE }, { status: 503 });
  }
  if (result.noCustomer) {
    return NextResponse.json({ error: "No billing customer on file." }, { status: 400 });
  }
  if (!result.ok) {
    return NextResponse.json({ error: "Could not cancel subscription." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, canceled: result.canceled });
}
