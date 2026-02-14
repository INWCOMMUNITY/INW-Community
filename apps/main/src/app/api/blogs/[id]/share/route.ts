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

  const member = await prisma.member.findUnique({
    where: { id: session.user.id },
    select: { privacyLevel: true },
  });
  if (member?.privacyLevel === "completely_private") {
    return NextResponse.json({ error: "Cannot share with completely private account" }, { status: 403 });
  }

  const { id } = await params;
  const blog = await prisma.blog.findFirst({
    where: { OR: [{ id }, { slug: id }] },
  });
  if (!blog) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (blog.status !== "approved") {
    return NextResponse.json({ error: "Blog not published" }, { status: 400 });
  }

  const post = await prisma.post.create({
    data: {
      type: "shared_blog",
      authorId: session.user.id,
      sourceBlogId: blog.id,
      photos: [],
    },
    include: {
      author: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
    },
  });
  const { awardCommunityWriterBadge } = await import("@/lib/badge-award");
  awardCommunityWriterBadge(session.user.id).catch(() => {});
  return NextResponse.json(post);
}
