import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prisma, type SavedItemType } from "database";
import { z } from "zod";

const bodySchema = z.object({
  type: z.enum(["event", "business", "coupon", "store_item", "blog", "post"]),
  referenceId: z.string().min(1).max(100),
});

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const { type, referenceId } = bodySchema.parse(body);
    await prisma.savedItem.upsert({
      where: {
        memberId_type_referenceId: {
          memberId: session.user.id,
          type,
          referenceId,
        },
      },
      create: {
        memberId: session.user.id,
        type,
        referenceId,
      },
      update: {},
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json([]);
  }
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const validTypes: SavedItemType[] = ["event", "business", "coupon", "store_item", "blog", "post"];
  const where: { memberId: string; type?: SavedItemType } = { memberId: session.user.id };
  if (type && validTypes.includes(type as SavedItemType)) where.type = type as SavedItemType;
  const items = await prisma.savedItem.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(items);
}

export async function DELETE(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const referenceId = searchParams.get("referenceId");
  const validTypes = ["event", "business", "coupon", "store_item", "blog", "post"];
  if (!type || !validTypes.includes(type) || !referenceId || referenceId.length > 100) {
    return NextResponse.json({ error: "Missing or invalid type/referenceId" }, { status: 400 });
  }
  await prisma.savedItem.deleteMany({
    where: {
      memberId: session.user.id,
      type: type as SavedItemType,
      referenceId,
    },
  });
  return NextResponse.json({ ok: true });
}
