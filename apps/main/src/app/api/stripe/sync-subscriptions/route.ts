import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSessionForApi } from "@/lib/mobile-auth";
import { syncStripeSubscriptionsForMember } from "@/lib/sync-stripe-subscriptions-for-member";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

export const dynamic = "force-dynamic";

/**
 * Pull subscriptions from Stripe for the signed-in member and upsert local rows.
 * Uses metadata search (works across split customers) plus per-customer lists.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncStripeSubscriptionsForMember(session.user.id, stripe);
    return NextResponse.json({
      ok: true,
      synced: result.synced,
      fromMetadataSearch: result.fromMetadataSearch,
      fromCustomerLists: result.fromCustomerLists,
      ...(result.message ? { message: result.message } : {}),
    });
  } catch (e) {
    console.error("[sync-subscriptions]", e);
    const msg = e instanceof Error ? e.message : "Sync failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
