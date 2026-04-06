import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    await prisma.tag.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Tag not found or could not be deleted" }, { status: 404 });
  }
}
