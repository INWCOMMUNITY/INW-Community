import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prisma } from "database";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  isPublic: z.boolean().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;

  const collection = await prisma.collection.findUnique({
    where: { id },
    include: {
      member: { select: { firstName: true, lastName: true } },
      items: {
        orderBy: { addedAt: "desc" },
        include: {
          storeItem: {
            select: {
              id: true,
              title: true,
              slug: true,
              photos: true,
              priceCents: true,
              quantity: true,
              status: true,
              category: true,
              business: { select: { id: true, name: true, slug: true, logoUrl: true } },
            },
          },
        },
      },
    },
  });

  if (!collection) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  const isOwner = userId && collection.memberId === userId;
  if (!collection.isPublic && !isOwner) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: collection.id,
    name: collection.name,
    description: collection.description,
    isPublic: collection.isPublic,
    isOwner,
    ownerName: `${collection.member.firstName} ${collection.member.lastName}`.trim() || "Member",
    items: collection.items.map((i) => ({
      collectionItemId: i.id,
      id: i.storeItem.id,
      title: i.storeItem.title,
      slug: i.storeItem.slug,
      photos: i.storeItem.photos,
      priceCents: i.storeItem.priceCents,
      quantity: i.storeItem.quantity,
      status: i.storeItem.status,
      category: i.storeItem.category,
      business: i.storeItem.business,
      addedAt: i.addedAt,
    })),
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const collection = await prisma.collection.findUnique({ where: { id } });
  if (!collection || collection.memberId !== session.user.id) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  try {
    const body = await req.json();
    const { name, description, isPublic } = updateSchema.parse(body);

    const updated = await prisma.collection.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(isPublic !== undefined && { isPublic }),
      },
    });

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      description: updated.description,
      isPublic: updated.isPublic,
      updatedAt: updated.updatedAt,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    console.error("[collections PATCH]", e);
    return NextResponse.json({ error: "Failed to update collection" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const collection = await prisma.collection.findUnique({ where: { id } });
  if (!collection || collection.memberId !== session.user.id) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  await prisma.collection.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
