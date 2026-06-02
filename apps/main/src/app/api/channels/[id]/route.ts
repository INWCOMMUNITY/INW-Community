import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

/**
 * DELETE: disconnect a channel. Removes the connection and its listing links so the seller
 * manages those items only on INW going forward. External listings are left in place on the
 * channel (we do not delete the seller's Etsy listings on disconnect).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const conn = await prisma.channelConnection.findUnique({ where: { id } });
  if (!conn || conn.memberId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Cascade removes the listing links via the FK relation.
  await prisma.channelConnection.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
