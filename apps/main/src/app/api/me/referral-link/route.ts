import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

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

  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const signupUrl = `${base}/signup?ref=${link.code}`;
  const defaultIosAppStore =
    "https://apps.apple.com/us/app/inw-community/id6759624513";
  const appStoreUrl =
    process.env.REFERRAL_IOS_APP_STORE_URL?.trim() || defaultIosAppStore;
  const playStoreUrl = process.env.REFERRAL_ANDROID_PLAY_STORE_URL?.trim() || "";

  const lines = [
    "Join me on INW Community — local businesses, rewards, and more.",
    "",
    `Download the app: ${appStoreUrl}`,
  ];
  if (playStoreUrl) {
    lines.push(`Google Play: ${playStoreUrl}`);
  }
  lines.push(
    "",
    "After you install, create your account with my invite link so your signup counts toward community badges:",
    signupUrl
  );
  const shareMessage = lines.join("\n");

  return NextResponse.json({
    code: link.code,
    /** @deprecated use signupUrl — kept for older clients */
    url: signupUrl,
    signupUrl,
    appStoreUrl,
    ...(playStoreUrl ? { playStoreUrl } : {}),
    shareMessage,
  });
}
