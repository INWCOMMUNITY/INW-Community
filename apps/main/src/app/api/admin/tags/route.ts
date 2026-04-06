import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tags = await prisma.tag.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      _count: {
        select: {
          postTags: true,
          blogTags: true,
          followTag: true,
        },
      },
    },
  });
  return NextResponse.json(tags);
}
