import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { requireAdmin } from "@/lib/admin-auth";
import {
  assertStripeConfigured,
  pauseMemberSubscriptionRetainProfile,
  PauseMemberSubscriptionError,
} from "@/lib/pause-member-subscription-retain-profile";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    assertStripeConfigured();
  } catch (e) {
    if (e instanceof PauseMemberSubscriptionError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id: memberId } = await params;

  try {
    const result = await pauseMemberSubscriptionRetainProfile(memberId, stripe);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof PauseMemberSubscriptionError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[admin] pause-subscription", memberId, e);
    return NextResponse.json({ error: "Failed to pause subscription" }, { status: 500 });
  }
}
