import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prisma } from "database";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id: collectionId, itemId } = await params;
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const collection = await prisma.collection.findUnique({ where: { id: collectionId } });
  if (!collection || collection.memberId !== session.user.id) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  const item = await prisma.collectionItem.findFirst({
    where: { id: itemId, collectionId },
  });
  if (!item) {
    return NextResponse.json({ error: "Item not found in collection" }, { status: 404 });
  }

  await prisma.collectionItem.delete({ where: { id: itemId } });
  return NextResponse.json({ ok: true });
}
