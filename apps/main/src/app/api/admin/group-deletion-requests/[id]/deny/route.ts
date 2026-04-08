import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";
import { sendGroupDeletionRequestDeniedEmail } from "@/lib/send-group-deletion-denied-email";
import { z } from "zod";

const bodySchema = z.object({
  reason: z.string().min(20).max(2000),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const adminEmail = process.env.ADMIN_EMAIL?.trim() ?? null;

  const row = await prisma.groupDeletionRequest.findUnique({
    where: { id },
    include: {
      group: { select: { name: true } },
      requester: { select: { email: true } },
    },
  });
  if (!row || row.status !== "pending") {
    return NextResponse.json({ error: "Request not found or already reviewed" }, { status: 404 });
  }

  try {
    const body = await req.json();
    const { reason } = bodySchema.parse(body);
    const reasonTrim = reason.trim();
    await prisma.groupDeletionRequest.update({
      where: { id },
      data: {
        status: "denied",
        denialReason: reasonTrim,
        reviewedAt: new Date(),
        reviewedByAdminEmail: adminEmail,
      },
    });
    void sendGroupDeletionRequestDeniedEmail({
      to: row.requester.email,
      groupName: row.group.name,
      reason: reasonTrim,
    }).catch((err) => console.error("[admin deny group deletion] email", id, err));

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    console.error("[admin deny group deletion]", id, e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
