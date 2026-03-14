import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getSellerShippoApiKey } from "@/lib/shippo-seller";

export const dynamic = "force-dynamic";

const SHIPPO_EMBEDDED_AUTHZ = "https://api.goshippo.com/embedded/authz/";

/**
 * GET: Returns a short-lived JWT for Shippo Shipping Elements.
 * Requires authenticated seller with connected Shippo API key.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sub = await prisma.subscription.findFirst({
    where: { memberId: userId, plan: "seller", status: "active" },
  });
  if (!sub) {
    return NextResponse.json({ error: "Seller plan required" }, { status: 403 });
  }

  const apiKey = await getSellerShippoApiKey(userId);
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "Connect your shipping account to use the label widget.",
        code: "SHIPPING_ACCOUNT_REQUIRED",
      },
      { status: 403 }
    );
  }

  const res = await fetch(SHIPPO_EMBEDDED_AUTHZ, {
    method: "POST",
    headers: {
      Authorization: `ShippoToken ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ scope: "embedded:carriers" }),
  });

  const data = (await res.json().catch(() => null)) as { token?: string; expires_in?: string } | null;
  if (!res.ok || !data?.token) {
    const msg =
      typeof (data as { detail?: string })?.detail === "string"
        ? (data as { detail: string }).detail
        : res.status === 401
          ? "Invalid Shippo API key"
          : "Failed to get widget token";
    return NextResponse.json({ error: msg }, { status: res.status >= 400 ? res.status : 500 });
  }

  return NextResponse.json({ token: data.token, expires_in: data.expires_in });
}
