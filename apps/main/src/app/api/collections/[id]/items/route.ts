import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prisma } from "database";
import { z } from "zod";

export const dynamic = "force-dynamic";

const addItemSchema = z.object({
  storeItemId: z.string().min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: collectionId } = await params;
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const collection = await prisma.collection.findUnique({ where: { id: collectionId } });
  if (!collection || collection.memberId !== session.user.id) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  try {
    const body = await req.json();
    const { storeItemId } = addItemSchema.parse(body);

    const storeItem = await prisma.storeItem.findUnique({
      where: { id: storeItemId },
      select: { id: true },
    });
    if (!storeItem) {
      return NextResponse.json({ error: "Store item not found" }, { status: 404 });
    }

    const existing = await prisma.collectionItem.findUnique({
      where: {
        collectionId_storeItemId: { collectionId, storeItemId },
      },
    });
    if (existing) {
      return NextResponse.json({ error: "Item already in collection" }, { status: 409 });
    }

    const item = await prisma.collectionItem.create({
      data: {
        collectionId,
        storeItemId,
      },
    });

    return NextResponse.json({ id: item.id, storeItemId, addedAt: item.addedAt });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    console.error("[collections/items POST]", e);
    return NextResponse.json({ error: "Failed to add item" }, { status: 500 });
  }
}
