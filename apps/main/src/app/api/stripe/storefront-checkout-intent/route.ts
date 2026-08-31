import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Retired. Storefront card checkout is `POST /api/stripe/storefront-checkout`
 * (platform Checkout + Stripe Tax, then a Connect Transfer of the seller share).
 * Charging on the seller Connect account skipped facilitator tax collection.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "This checkout path is no longer available. Use /api/stripe/storefront-checkout so sales tax stays on the platform and seller proceeds are transferred to Connect.",
    },
    { status: 410 }
  );
}
