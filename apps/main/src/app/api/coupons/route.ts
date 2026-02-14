import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { z } from "zod";

const bodySchema = z.object({
  businessId: z.string(),
  name: z.string().min(1),
  discount: z.string().min(1),
  code: z.string().min(1),
  imageUrl: z.string().url().nullable().optional().or(z.literal("")),
});

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const data = bodySchema.parse({ ...body, imageUrl: body.imageUrl || null });
    const business = await prisma.business.findFirst({
      where: { id: data.businessId, memberId: session.user.id },
    });
    if (!business) {
      return NextResponse.json({ error: "Business not found or not yours" }, { status: 403 });
    }
    await prisma.coupon.create({
      data: {
        businessId: data.businessId,
        name: data.name,
        discount: data.discount,
        code: data.code,
        imageUrl: data.imageUrl ?? null,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
