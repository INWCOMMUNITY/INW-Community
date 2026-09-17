import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";
import { closeOrDeleteMemberAccountWithBilling } from "@/lib/close-or-delete-member-with-billing";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const body = await req.json();
    const status = body?.status as string;
    if (status !== "active" && status !== "suspended") {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const existing = await prisma.member.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (existing.status === "closed") {
      return NextResponse.json(
        { error: "Closed accounts cannot be reopened via suspend or unsuspend." },
        { status: 409 }
      );
    }
    await prisma.member.update({
      where: { id },
      data: { status },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const result = await closeOrDeleteMemberAccountWithBilling(id);
    if (!result.ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      outcome: result.outcome,
      billingCleanupPending: result.billingCleanupPending,
    });
  } catch (e) {
    console.error("[admin] member delete", id, e);
    return NextResponse.json({ error: "Could not delete member" }, { status: 500 });
  }
}
