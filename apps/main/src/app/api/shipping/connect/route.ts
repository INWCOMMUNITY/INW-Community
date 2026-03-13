import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { encrypt } from "@/lib/encrypt";

export const dynamic = "force-dynamic";

const SHIPPO_API = "https://api.goshippo.com";

/**
 * POST: Save seller's Shippo API key (paste-from-their-account flow).
 * Body: { apiKey: string }
 * Validates the key with Shippo, encrypts and stores it. Labels are paid with the seller's Shippo account (their card).
 */
export async function POST(req: NextRequest) {
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

  let body: { apiKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const rawKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!rawKey) {
    return NextResponse.json(
      { error: "API key is required", code: "MISSING_API_KEY" },
      { status: 400 }
    );
  }

  // Validate key by calling Shippo (e.g. list addresses or shipments).
  const res = await fetch(`${SHIPPO_API}/v2/addresses?limit=1`, {
    headers: { Authorization: `ShippoToken ${rawKey}` },
  });
  if (res.status === 401) {
    return NextResponse.json(
      { error: "Invalid API key. Check that you copied the full key from Shippo.", code: "INVALID_API_KEY" },
      { status: 400 }
    );
  }
  if (!res.ok) {
    const errText = await res.text();
    return NextResponse.json(
      { error: errText && errText.length < 200 ? errText : "This API key could not be verified.", code: "INVALID_API_KEY" },
      { status: 400 }
    );
  }

  let encryptedKey: string;
  try {
    encryptedKey = encrypt(rawKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Encryption failed";
    const isConfigError = msg.includes("ENCRYPTION_KEY");
    return NextResponse.json(
      {
        error: isConfigError
          ? "Server is missing ENCRYPTION_KEY. The site admin must add ENCRYPTION_KEY to the server .env file (e.g. run: openssl rand -base64 32, then add ENCRYPTION_KEY=\"...\" to .env) and restart the server."
          : msg,
        code: "ENCRYPTION_ERROR",
      },
      { status: isConfigError ? 503 : 500 }
    );
  }

  await prisma.member.update({
    where: { id: userId },
    data: { shippoApiKeyEncrypted: encryptedKey },
  });

  return NextResponse.json({
    connected: true,
    message: "Shippo account connected. You can get rates and buy labels; your card will be charged for labels.",
  });
}
