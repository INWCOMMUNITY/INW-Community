import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import { getGroupAdminContext } from "@/lib/group-admin-context";

type ReportJoinRow = {
  id: string;
  content_id: string;
  reason: string;
  details: string | null;
  created_at: Date;
  reporter_id: string;
  post_content: string | null;
  post_created_at: Date;
  author_id: string;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slugOrId: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  const { slugOrId } = await params;
  const ctx = await getGroupAdminContext(slugOrId, session.user.id);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const rows = await prisma.$queryRaw<ReportJoinRow[]>(
    Prisma.sql`
      SELECT r.id, r.content_id, r.reason, r.details, r.created_at, r.reporter_id,
             p.content AS post_content, p.created_at AS post_created_at, p.author_id
      FROM report r
      INNER JOIN "Post" p ON p.id = r.content_id
      WHERE r.content_type = 'post'
        AND r.status = 'pending'
        AND p.group_id = ${ctx.group.id}
      ORDER BY r.created_at DESC
      LIMIT 100
    `
  );

  const memberIds = [...new Set(rows.flatMap((r) => [r.reporter_id, r.author_id]))];
  const members =
    memberIds.length > 0
      ? await prisma.member.findMany({
          where: { id: { in: memberIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
  const memberById = Object.fromEntries(members.map((m) => [m.id, m]));

  return NextResponse.json({
    reports: rows.map((r) => ({
      id: r.id,
      contentId: r.content_id,
      reason: r.reason,
      details: r.details,
      createdAt: r.created_at,
      reporter: memberById[r.reporter_id] ?? { id: r.reporter_id, firstName: "", lastName: "" },
      post: {
        id: r.content_id,
        content: r.post_content,
        createdAt: r.post_created_at,
        authorId: r.author_id,
        author: memberById[r.author_id] ?? { id: r.author_id, firstName: "", lastName: "" },
      },
    })),
  });
}
