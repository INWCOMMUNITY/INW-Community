import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

/**
 * POST: Get EasyPost Customer Portal link for the seller to add/manage payment method.
 * Body: { returnUrl?: string, refreshUrl?: string }
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const member = await prisma.member.findUnique({
    where: { id: userId },
    select: { easypostReferralCustomerId: true },
  });

  if (!member?.easypostReferralCustomerId) {
    return NextResponse.json(
      { error: "Connect shipping account first", code: "NOT_CONNECTED" },
      { status: 400 }
    );
  }

  const partnerKey =
    process.env.EASYPOST_PARTNER_API_KEY ?? process.env.EASYPOST_API_KEY ?? "";
  if (!partnerKey) {
    return NextResponse.json(
      { error: "Shipping not configured" },
      { status: 503 }
    );
  }

  let body: { returnUrl?: string; refreshUrl?: string } = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    // ignore
  }

  const base =
    process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const returnUrl =
    body.returnUrl ?? `${base}/seller-hub/ship?portal=return`;
  const refreshUrl =
    body.refreshUrl ?? `${base}/seller-hub/ship?portal=refresh`;

  const res = await fetch("https://api.easypost.com/v2/customer_portal/account_link", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${partnerKey}`,
    },
    body: JSON.stringify({
      session_type: "account_management",
      user_id: member.easypostReferralCustomerId,
      return_url: returnUrl,
      refresh_url: refreshUrl,
      metadata: { target: "wallet" },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json(
      { error: err && err.length < 200 ? err : "Failed to get portal link" },
      { status: res.status >= 500 ? 502 : 400 }
    );
  }

  const data = (await res.json()) as { url?: string };
  return NextResponse.json({ url: data.url ?? null });
}
