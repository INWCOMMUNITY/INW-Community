import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * API key paste flow removed — sellers connect via Shippo OAuth only.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Connecting with a Shippo API key is no longer supported. Use Connect with Shippo (OAuth) in Seller Hub → Shipping.",
      code: "SHIPPO_API_KEY_DEPRECATED",
    },
    { status: 410 }
  );
}
