import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import { getGroupAdminContext } from "@/lib/group-admin-context";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slugOrId: string; reportId: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  const { slugOrId, reportId } = await params;
  const ctx = await getGroupAdminContext(slugOrId, session.user.id);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const report = await prisma.report.findUnique({
    where: { id: reportId },
  });
  if (!report || report.contentType !== "post" || report.status !== "pending") {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const post = await prisma.post.findUnique({
    where: { id: report.contentId },
    select: { groupId: true },
  });
  if (!post?.groupId || post.groupId !== ctx.group.id) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  await prisma.report.update({
    where: { id: reportId },
    data: { status: "reviewed" },
  });

  return NextResponse.json({ ok: true });
}
