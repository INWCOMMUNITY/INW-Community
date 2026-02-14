import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { encrypt } from "@/lib/encrypt";

export const dynamic = "force-dynamic";

const EASYPOST_API_BASE = "https://api.easypost.com/v2";

/**
 * POST: Save seller's EasyPost API key (paste-from-their-account flow).
 * Body: { apiKey: string }
 * Validates the key with EasyPost, encrypts and stores it. Labels are paid with the seller's EasyPost account (their card).
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

  // Validate key by calling EasyPost. GET /users with no id returns the authenticated user.
  // EasyPost uses Basic auth: API key as username, empty password.
  const basicAuth = Buffer.from(`${rawKey}:`, "utf8").toString("base64");
  const userRes = await fetch(`${EASYPOST_API_BASE}/users`, {
    headers: { Authorization: `Basic ${basicAuth}` },
  });
  if (!userRes.ok) {
    const errText = await userRes.text();
    const msg =
      userRes.status === 401
        ? "Invalid API key. Check that you copied the full key from EasyPost."
        : errText && errText.length < 200
          ? errText
          : "This API key could not be verified.";
    return NextResponse.json(
      { error: msg, code: "INVALID_API_KEY" },
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
    data: {
      easypostApiKeyEncrypted: encryptedKey,
      // Own-key flow: no Referral Customer id; leave null so we don't show portal
      easypostReferralCustomerId: null,
    },
  });

  return NextResponse.json({
    connected: true,
    message: "EasyPost account connected. You can get rates and buy labels; your card will be charged for labels.",
  });
}
