import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { verifiedMemberWhere } from "@/lib/member-public-visibility";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const since = new URL(req.url).searchParams.get("since");

  if (!since) {
    return NextResponse.json({ error: "Missing 'since' parameter" }, { status: 400 });
  }

  const sinceDate = new Date(since);
  if (isNaN(sinceDate.getTime())) {
    return NextResponse.json({ error: "Invalid 'since' timestamp" }, { status: 400 });
  }

  const where: Record<string, unknown> = {
    createdAt: { gt: sinceDate },
    author: verifiedMemberWhere,
  };

  if (!session || !session.user.id) {
    where.groupId = null;
  }

  const count = await prisma.post.count({ where: where as any });

  return NextResponse.json({ count }, {
    headers: { "Cache-Control": "no-store" },
  });
}
