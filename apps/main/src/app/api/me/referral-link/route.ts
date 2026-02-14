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
  return NextResponse.json({ code: link.code, url: signupUrl });
}
