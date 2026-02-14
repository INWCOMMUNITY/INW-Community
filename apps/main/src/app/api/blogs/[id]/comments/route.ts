import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

const bodySchema = z.object({
  content: z.string().min(1).max(2000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const member = await prisma.member.findUnique({
    where: { id: session.user.id },
    select: { privacyLevel: true },
  });
  if (member?.privacyLevel === "completely_private") {
    return NextResponse.json({ error: "Cannot comment with completely private account" }, { status: 403 });
  }

  const { id } = await params;
  const blog = await prisma.blog.findFirst({
    where: { OR: [{ id }, { slug: id }] },
  });
  if (!blog) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (blog.status !== "approved") {
    return NextResponse.json({ error: "Blog not published" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { content } = bodySchema.parse(body);
    const comment = await prisma.blogComment.create({
      data: { blogId: blog.id, memberId: session.user.id, content },
      include: {
        member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
      },
    });
    return NextResponse.json(comment);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
