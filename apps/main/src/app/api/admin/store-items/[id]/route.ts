import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";
import { endStoreItemListing } from "@/lib/end-store-item-listing";
import { gateInteractiveOrFoundationWriter, jsonIfCutoverBlocked } from "@/lib/commerce-foundation-cutover-http";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = await gateInteractiveOrFoundationWriter();
  if (blocked) return blocked;
  const { id } = await params;
  const existing = await prisma.storeItem.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ ok: true });
  }
  try {
    await endStoreItemListing(existing);
  } catch (e) {
    const cutover = jsonIfCutoverBlocked(e);
    if (cutover) return cutover;
    throw e;
  }
  return NextResponse.json({ ok: true });
}
