import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { hasBusinessHubAccess } from "@/lib/business-hub-access";

/** List rewards for businesses owned by the member (Business Hub). */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const allowed = await hasBusinessHubAccess(session.user.id);
  if (!allowed) {
    return NextResponse.json({ error: "Business Hub access required" }, { status: 403 });
  }

  const rewards = await prisma.reward.findMany({
    where: { business: { memberId: session.user.id } },
    include: { business: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return NextResponse.json({ rewards });
}
