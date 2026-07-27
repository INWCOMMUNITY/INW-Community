import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayOfWeek = now.getDay();
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfToday.getDate() - dayOfWeek);

  const [postsToday, likesToday, commentsToday, activePostersThisWeek] = await Promise.all([
    prisma.post.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.postLike.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.postComment.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.post
      .findMany({
        where: { createdAt: { gte: startOfWeek } },
        select: { authorId: true },
        distinct: ["authorId"],
      })
      .then((rows) => rows.length),
  ]);

  return NextResponse.json({
    postsToday,
    likesToday,
    commentsToday,
    activePostersThisWeek,
  });
}
