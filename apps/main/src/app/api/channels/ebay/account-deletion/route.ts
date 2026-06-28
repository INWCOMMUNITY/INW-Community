import { NextRequest, NextResponse } from "next/server";
import {
  computeEbayAccountDeletionChallengeResponse,
  getEbayAccountDeletionVerificationToken,
  purgeEbayAccountData,
  resolveEbayAccountDeletionEndpoint,
} from "@/lib/channels/ebay/account-deletion";

export const dynamic = "force-dynamic";

type DeletionNotification = {
  metadata?: { topic?: string };
  notification?: {
    notificationId?: string;
    data?: { username?: string; userId?: string; eiasToken?: string };
  };
};

/**
 * eBay Marketplace Account Deletion compliance endpoint.
 * GET: respond to eBay's challenge during portal setup.
 * POST: acknowledge deletion notices and purge stored eBay seller data.
 */
export async function GET(req: NextRequest) {
  const challengeCode = new URL(req.url).searchParams.get("challenge_code");
  if (!challengeCode) {
    return NextResponse.json({ error: "Missing challenge_code" }, { status: 400 });
  }

  const verificationToken = getEbayAccountDeletionVerificationToken();
  if (!verificationToken) {
    return NextResponse.json(
      { error: "EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN is not configured" },
      { status: 503 }
    );
  }

  const endpoint = resolveEbayAccountDeletionEndpoint(req.url);
  const challengeResponse = computeEbayAccountDeletionChallengeResponse({
    challengeCode,
    verificationToken,
    endpoint,
  });

  return NextResponse.json({ challengeResponse });
}

export async function POST(req: NextRequest) {
  let payload: DeletionNotification | null = null;
  try {
    payload = (await req.json()) as DeletionNotification;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const username = payload?.notification?.data?.username ?? null;
  const userId = payload?.notification?.data?.userId ?? null;

  try {
    const result = await purgeEbayAccountData({ username, userId });
    console.info("[ebay] marketplace account deletion", {
      notificationId: payload?.notification?.notificationId ?? null,
      username,
      userId,
      ...result,
    });
  } catch (e) {
    console.error("[ebay] marketplace account deletion purge failed", {
      username,
      userId,
      error: String(e),
    });
  }

  return NextResponse.json({ ok: true });
}
