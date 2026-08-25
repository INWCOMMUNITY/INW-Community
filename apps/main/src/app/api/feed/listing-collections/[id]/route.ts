import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const collection = await prisma.listingFeedCollection.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      createdAt: true,
      items: {
        orderBy: { sortOrder: "asc" },
        select: {
          storeItem: {
            select: {
              id: true,
              title: true,
              slug: true,
              photos: true,
              priceCents: true,
              status: true,
              quantity: true,
            },
          },
        },
      },
    },
  });
  if (!collection) {
    return NextResponse.json({ error: "Collection not found." }, { status: 404 });
  }

  const items = collection.items
    .map((row) => row.storeItem)
    .filter((item) => item != null)
    .map((item) => ({
      id: item.id,
      title: item.title,
      slug: item.slug,
      photos: item.photos,
      priceCents: item.priceCents,
      status: item.status,
      quantity: item.quantity,
    }));

  return NextResponse.json({
    id: collection.id,
    title: collection.title,
    createdAt: collection.createdAt.toISOString(),
    items,
  });
}
