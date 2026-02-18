import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const posts = await prisma.post.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      author: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    },
  });
  return NextResponse.json(posts);
}
