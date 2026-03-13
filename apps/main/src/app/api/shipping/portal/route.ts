import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

/**
 * POST: Previously returned EasyPost Customer Portal link.
 * With Shippo, billing and payment are managed in the Shippo dashboard. No portal link.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    {
      error: "Billing and payment are managed in your Shippo account. Go to apps.goshippo.com to add a payment method.",
      code: "SHIPPO_BILLING_IN_DASHBOARD",
    },
    { status: 400 }
  );
}
