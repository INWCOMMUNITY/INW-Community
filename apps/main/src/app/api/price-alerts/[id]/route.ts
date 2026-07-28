import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prisma } from "database";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const alert = await prisma.priceDropAlert.findUnique({ where: { id } });
  if (!alert || alert.memberId !== session.user.id) {
    return NextResponse.json({ error: "Alert not found" }, { status: 404 });
  }

  await prisma.priceDropAlert.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
