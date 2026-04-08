import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const adminEmail = process.env.ADMIN_EMAIL?.trim() ?? null;

  const row = await prisma.groupDeletionRequest.findUnique({
    where: { id },
    include: { group: { select: { id: true } } },
  });

  if (!row || row.status !== "pending") {
    return NextResponse.json({ error: "Request not found or already reviewed" }, { status: 404 });
  }

  const groupId = row.groupId;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.groupDeletionRequest.update({
        where: { id },
        data: {
          status: "approved",
          reviewedAt: new Date(),
          reviewedByAdminEmail: adminEmail,
        },
      });
      await tx.post.deleteMany({ where: { groupId } });
      await tx.group.delete({ where: { id: groupId } });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[admin approve group deletion]", id, e);
    return NextResponse.json({ error: "Failed to delete group" }, { status: 500 });
  }
}
