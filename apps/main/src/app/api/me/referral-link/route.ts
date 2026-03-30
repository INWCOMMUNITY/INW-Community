import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getBaseUrl } from "@/lib/get-base-url";
import {
  getAndroidPlayStoreUrl,
  getIosAppStoreUrl,
} from "@/lib/app-store-urls";

const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * GET /api/me/referral-link
 * Returns or creates the user's referral link. Use for "Invite friends" flow.
 */
export async function GET(req: NextRequest) {
  const session =
    (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let link = await prisma.referralLink.findFirst({
    where: { memberId: userId },
  });

  if (!link) {
    let code = generateCode();
    while (await prisma.referralLink.findUnique({ where: { code } })) {
      code = generateCode();
    }
    link = await prisma.referralLink.create({
      data: { memberId: userId, code },
    });
  }

  const base = getBaseUrl();
  const signupUrl = `${base}/signup?ref=${link.code}`;
  const appStoreUrl = getIosAppStoreUrl();
  const playStoreUrl = getAndroidPlayStoreUrl() ?? "";

  const lines = [
    "Join me on INW Community — if you're a resident of the Eastern Washington or North Idaho, this app is quite literally made for you! It's a community page where you connect with people in our area, support our locally owned businesses, and earn points for fun prizes, check it out!",
    "",
    `Download the app: ${appStoreUrl}`,
  ];
  if (playStoreUrl) {
    lines.push(`Google Play: ${playStoreUrl}`);
  }
  const shareMessage = lines.join("\n");

  return NextResponse.json({
    code: link.code,
    /** Optional invite URL for analytics; not required for Community Badges (use in-app Share). */
    url: signupUrl,
    signupUrl,
    appStoreUrl,
    ...(playStoreUrl ? { playStoreUrl } : {}),
    shareMessage,
  });
}
