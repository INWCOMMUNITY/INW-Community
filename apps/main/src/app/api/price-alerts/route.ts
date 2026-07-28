import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prisma } from "database";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  storeItemId: z.string().min(1),
  targetPrice: z.number().int().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { storeItemId, targetPrice } = createSchema.parse(body);

    const storeItem = await prisma.storeItem.findUnique({
      where: { id: storeItemId },
      select: { id: true, priceCents: true, status: true },
    });
    if (!storeItem) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    if (storeItem.status !== "active") {
      return NextResponse.json({ error: "Item is not available" }, { status: 400 });
    }

    const existing = await prisma.priceDropAlert.findUnique({
      where: {
        memberId_storeItemId: {
          memberId: session.user.id,
          storeItemId,
        },
      },
    });
    if (existing) {
      const updated = await prisma.priceDropAlert.update({
        where: { id: existing.id },
        data: {
          targetPrice: targetPrice ?? null,
          originalPrice: storeItem.priceCents,
          active: true,
          triggeredAt: null,
        },
      });
      return NextResponse.json({
        id: updated.id,
        storeItemId: updated.storeItemId,
        targetPrice: updated.targetPrice,
        originalPrice: updated.originalPrice,
        active: updated.active,
        createdAt: updated.createdAt,
      });
    }

    const alert = await prisma.priceDropAlert.create({
      data: {
        memberId: session.user.id,
        storeItemId,
        targetPrice: targetPrice ?? null,
        originalPrice: storeItem.priceCents,
      },
    });

    return NextResponse.json({
      id: alert.id,
      storeItemId: alert.storeItemId,
      targetPrice: alert.targetPrice,
      originalPrice: alert.originalPrice,
      active: alert.active,
      createdAt: alert.createdAt,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    console.error("[price-alerts POST]", e);
    return NextResponse.json({ error: "Failed to create alert" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const storeItemId = searchParams.get("storeItemId");

  if (storeItemId) {
    const alert = await prisma.priceDropAlert.findUnique({
      where: {
        memberId_storeItemId: {
          memberId: session.user.id,
          storeItemId,
        },
      },
    });
    return NextResponse.json(
      alert
        ? {
            id: alert.id,
            storeItemId: alert.storeItemId,
            targetPrice: alert.targetPrice,
            originalPrice: alert.originalPrice,
            active: alert.active,
            triggeredAt: alert.triggeredAt,
            createdAt: alert.createdAt,
          }
        : null
    );
  }

  const alerts = await prisma.priceDropAlert.findMany({
    where: { memberId: session.user.id, active: true },
    orderBy: { createdAt: "desc" },
    include: {
      storeItem: {
        select: {
          id: true,
          title: true,
          slug: true,
          photos: true,
          priceCents: true,
          status: true,
        },
      },
    },
  });

  return NextResponse.json(
    alerts.map((a) => ({
      id: a.id,
      targetPrice: a.targetPrice,
      originalPrice: a.originalPrice,
      active: a.active,
      triggeredAt: a.triggeredAt,
      createdAt: a.createdAt,
      storeItem: {
        id: a.storeItem.id,
        title: a.storeItem.title,
        slug: a.storeItem.slug,
        photo: a.storeItem.photos[0] ?? null,
        currentPrice: a.storeItem.priceCents,
        status: a.storeItem.status,
      },
    }))
  );
}
