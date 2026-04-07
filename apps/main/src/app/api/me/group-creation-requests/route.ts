import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requests = await prisma.groupCreationRequest.findMany({
    where: { requesterMemberId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      coverImageUrl: true,
      rules: true,
      allowBusinessPosts: true,
      status: true,
      denialReason: true,
      reviewedAt: true,
      resultingGroupId: true,
      createdAt: true,
      resultingGroup: { select: { slug: true } },
    },
  });

  return NextResponse.json({
    requests: requests.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      resultingSlug: r.resultingGroup?.slug ?? null,
    })),
  });
}
