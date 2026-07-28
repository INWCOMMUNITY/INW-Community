import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prisma } from "database";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const collections = await prisma.collection.findMany({
    where: { memberId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { items: true } },
      items: {
        take: 4,
        orderBy: { addedAt: "desc" },
        include: {
          storeItem: {
            select: { id: true, photos: true, title: true },
          },
        },
      },
    },
  });

  return NextResponse.json(
    collections.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      isPublic: c.isPublic,
      itemCount: c._count.items,
      previewItems: c.items.map((i) => ({
        id: i.storeItem.id,
        photo: i.storeItem.photos[0] ?? null,
        title: i.storeItem.title,
      })),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }))
  );
}

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, description, isPublic } = createSchema.parse(body);

    const collection = await prisma.collection.create({
      data: {
        memberId: session.user.id,
        name,
        description: description ?? null,
        isPublic: isPublic ?? false,
      },
    });

    return NextResponse.json({
      id: collection.id,
      name: collection.name,
      description: collection.description,
      isPublic: collection.isPublic,
      itemCount: 0,
      previewItems: [],
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    console.error("[collections POST]", e);
    return NextResponse.json({ error: "Failed to create collection" }, { status: 500 });
  }
}
