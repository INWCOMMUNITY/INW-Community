import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";


export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const where: { status?: string } = {};
  if (status === "pending" || status === "approved") {
    where.status = status;
  }

  const blogs = await prisma.blog.findMany({
    where,
    include: {
      member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
      category: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json(blogs);
}
