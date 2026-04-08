import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";

export async function GET(req: NextRequest) {
  const session =
    (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  const follows = await prisma.followTag.findMany({
    where: { memberId: session.user.id },
    include: { tag: true },
  });

  return NextResponse.json({
    tags: follows.map((f) => f.tag),
  });
}
