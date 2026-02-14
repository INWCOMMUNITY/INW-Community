import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const blog = await prisma.blog.findFirst({
    where: { OR: [{ id }, { slug: id }] },
    include: {
      member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
      category: { select: { id: true, name: true, slug: true } },
      comments: {
        include: {
          member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!blog) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (blog.status !== "approved") {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || blog.memberId !== session.user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }
  return NextResponse.json(blog);
}
