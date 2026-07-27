import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const report = await prisma.report.findUnique({ where: { id } });
  if (!report)
    return NextResponse.json({ error: "Report not found" }, { status: 404 });

  if (report.contentType === "post") {
    const post = await prisma.post.findUnique({
      where: { id: report.contentId },
      include: { author: { select: { firstName: true, lastName: true } } },
    });
    if (!post)
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    return NextResponse.json({
      type: "post",
      content: post.content,
      author: { firstName: post.author.firstName, lastName: post.author.lastName },
      photo: post.photos[0] ?? null,
    });
  }

  if (report.contentType === "comment") {
    const comment = await prisma.postComment.findUnique({
      where: { id: report.contentId },
      include: { member: { select: { firstName: true, lastName: true } } },
    });
    if (!comment)
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    return NextResponse.json({
      type: "comment",
      content: comment.content,
      author: { firstName: comment.member.firstName, lastName: comment.member.lastName },
    });
  }

  return NextResponse.json({ error: "Unsupported content type" }, { status: 400 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const report = await prisma.report.findUnique({ where: { id } });
  if (!report)
    return NextResponse.json({ error: "Report not found" }, { status: 404 });

  if (report.contentType === "post") {
    await prisma.post.delete({ where: { id: report.contentId } }).catch(() => null);
  } else if (report.contentType === "comment") {
    await prisma.postComment.delete({ where: { id: report.contentId } }).catch(() => null);
  } else {
    return NextResponse.json({ error: "Unsupported content type" }, { status: 400 });
  }

  await prisma.report.update({
    where: { id },
    data: { status: "resolved" },
  });

  return NextResponse.json({ ok: true });
}
