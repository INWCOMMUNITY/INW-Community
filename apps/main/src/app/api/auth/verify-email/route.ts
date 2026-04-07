import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { hashEmailVerificationToken } from "@/lib/email-verification";
import { getPublicSiteOrigin } from "@/lib/public-site-url";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim();
  const origin = getPublicSiteOrigin();
  const redirect = (path: string) =>
    NextResponse.redirect(new URL(path, origin), { status: 302 });

  if (!token) {
    return redirect("/login?verifyError=missing");
  }

  const hash = hashEmailVerificationToken(token);
  const member = await prisma.member.findFirst({
    where: { emailVerificationTokenHash: hash },
    select: { id: true, emailVerificationExpiresAt: true },
  });

  if (!member?.emailVerificationExpiresAt || member.emailVerificationExpiresAt < new Date()) {
    return redirect("/login?verifyError=expired");
  }

  await prisma.member.update({
    where: { id: member.id },
    data: {
      emailVerifiedAt: new Date(),
      emailVerificationTokenHash: null,
      emailVerificationCodeHash: null,
      emailVerificationExpiresAt: null,
    },
  });

  return redirect("/login?emailVerified=1");
}
