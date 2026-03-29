import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { z } from "zod";

const bodySchema = z.object({
  businessId: z.string(),
  name: z.string().min(1),
  discount: z.string().min(1),
  code: z.string().min(1),
  imageUrl: z.string().nullable().optional(),
  secretKey: z.string().optional().default(""),
  maxMonthlyUses: z.number().int().min(1).optional(),
  /** ISO-8601 end of validity; null/omit = no expiration (stays in coupon book until removed). */
  expiresAt: z.union([z.string().min(1), z.null()]).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const data = bodySchema.parse({ ...body, imageUrl: body.imageUrl || null });
    let expiresAt: Date | null = null;
    if (data.expiresAt !== undefined && data.expiresAt !== null) {
      const d = new Date(data.expiresAt);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid expiresAt date" }, { status: 400 });
      }
      expiresAt = d;
    }
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
        secretKey: data.secretKey || null,
        maxMonthlyUses: data.maxMonthlyUses ?? 1,
        expiresAt,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msgs = e.errors.map((err) => err.message).join(", ");
      return NextResponse.json({ error: msgs || "Validation failed" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
