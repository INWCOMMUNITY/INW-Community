import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const reward = await prisma.reward.findUnique({ where: { id } });
  if (!reward) {
    return NextResponse.json({ error: "Reward not found" }, { status: 404 });
  }

  const post = await prisma.post.create({
    data: {
      type: "shared_reward",
      authorId: session.user.id,
      sourceRewardId: reward.id,
      photos: [],
    },
    include: {
      author: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
    },
  });
  return NextResponse.json(post);
}
