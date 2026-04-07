import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";
import { sendGroupRequestDeniedEmail } from "@/lib/send-group-request-denied-email";
import { z } from "zod";

const denyBodySchema = z.object({
  reason: z.string().min(20).max(2000),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const adminEmail = process.env.ADMIN_EMAIL?.trim() ?? null;

  let body: z.infer<typeof denyBodySchema>;
  try {
    body = denyBodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "Provide a denial reason between 20 and 2000 characters." },
      { status: 400 }
    );
  }

  const row = await prisma.groupCreationRequest.findUnique({
    where: { id },
    include: { requester: { select: { email: true } } },
  });

  if (!row || row.status !== "pending") {
    return NextResponse.json({ error: "Request not found or already reviewed" }, { status: 404 });
  }

  await prisma.groupCreationRequest.update({
    where: { id },
    data: {
      status: "denied",
      denialReason: body.reason,
      reviewedAt: new Date(),
      reviewedByAdminEmail: adminEmail,
    },
  });

  void sendGroupRequestDeniedEmail({
    to: row.requester.email,
    proposedGroupName: row.name,
    reason: body.reason,
  }).catch((err) => console.error("[admin deny group request] email", id, err));

  return NextResponse.json({ ok: true });
}
