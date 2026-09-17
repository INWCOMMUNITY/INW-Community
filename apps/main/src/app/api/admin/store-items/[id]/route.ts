import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";
import { endStoreItemListing } from "@/lib/end-store-item-listing";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.storeItem.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ ok: true });
  }
  await endStoreItemListing(existing);
  return NextResponse.json({ ok: true });
}
