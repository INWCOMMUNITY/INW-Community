import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * DELETE: Disconnect Stripe Connect for a member (admin only).
 * Sets stripeConnectAccountId to null so the member can re-run Stripe Connect onboarding.
 * For testing or support only.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await prisma.member.update({
    where: { id },
    data: { stripeConnectAccountId: null },
  });
  return NextResponse.json({ ok: true });
}
