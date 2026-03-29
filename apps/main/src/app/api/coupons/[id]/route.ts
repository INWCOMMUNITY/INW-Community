import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prismaWhereActivePaidNwcPlan } from "@/lib/nwc-paid-subscription";
import { isCouponActiveByExpiresAt } from "@/lib/coupon-expiration";
import { z } from "zod";

/** GET coupon by id. Returns full coupon + business; code only when user has subscriber access. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const coupon = await prisma.coupon.findUnique({
    where: { id },
    include: {
      business: {
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          phone: true,
          memberId: true,
        },
      },
    },
  });
  if (!coupon) {
    return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
  }

  const session = await getSessionForApi(req);
  const userId = session?.user?.id ?? null;
  const isOwner = userId ? coupon.business?.memberId === userId : false;
  if (!isOwner && !isCouponActiveByExpiresAt(coupon.expiresAt)) {
    return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
  }

  const hasPaidPlan = userId
    ? !!(await prisma.subscription.findFirst({
        where: prismaWhereActivePaidNwcPlan(userId),
      }))
    : false;

  /** Any paid NWC plan + business owners viewing their own listing */
  const hasAccess = hasPaidPlan || isOwner;

  let usedThisMonth = 0;
  let usedToday = false;
  if (userId && hasPaidPlan && coupon.secretKey) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    usedThisMonth = await prisma.couponRedeem.count({
      where: { couponId: id, memberId: userId, createdAt: { gte: monthStart } },
    });
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    const todayCount = await prisma.couponRedeem.count({
      where: { couponId: id, memberId: userId, createdAt: { gte: todayStart, lt: todayEnd } },
    });
    usedToday = todayCount > 0;
  }

  return NextResponse.json({
    id: coupon.id,
    name: coupon.name,
    discount: coupon.discount,
    code: hasAccess ? coupon.code : null,
    imageUrl: coupon.imageUrl,
    hasSecretKey: !!coupon.secretKey,
    secretKey: isOwner ? coupon.secretKey : undefined,
    maxMonthlyUses: coupon.maxMonthlyUses,
    expiresAt: coupon.expiresAt?.toISOString() ?? null,
    usedThisMonth,
    usedToday,
    business: coupon.business
      ? { id: coupon.business.id, name: coupon.business.name, address: coupon.business.address, city: coupon.business.city, phone: coupon.business.phone }
      : null,
    hasAccess,
    isOwner,
  });
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  discount: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  imageUrl: z.string().url().nullable().optional().or(z.literal("")),
  secretKey: z.string().nullable().optional(),
  maxMonthlyUses: z.number().int().min(1).optional(),
  expiresAt: z.union([z.string().min(1), z.null()]).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const coupon = await prisma.coupon.findUnique({
      where: { id },
      include: { business: { select: { memberId: true } } },
    });
    if (!coupon || coupon.business.memberId !== session.user.id) {
      return NextResponse.json({ error: "Not found or not yours" }, { status: 403 });
    }

    const body = await req.json();
    const data = patchSchema.parse(body);

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.discount !== undefined) updateData.discount = data.discount;
    if (data.code !== undefined) updateData.code = data.code;
    if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl || null;
    if (data.secretKey !== undefined) updateData.secretKey = data.secretKey || null;
    if (data.maxMonthlyUses !== undefined) updateData.maxMonthlyUses = data.maxMonthlyUses;
    if (data.expiresAt !== undefined) {
      if (data.expiresAt === null) {
        updateData.expiresAt = null;
      } else {
        const d = new Date(data.expiresAt);
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json({ error: "Invalid expiresAt date" }, { status: 400 });
        }
        updateData.expiresAt = d;
      }
    }

    await prisma.coupon.update({ where: { id }, data: updateData });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const coupon = await prisma.coupon.findUnique({
    where: { id },
    include: { business: { select: { memberId: true } } },
  });
  if (!coupon || coupon.business.memberId !== session.user.id) {
    return NextResponse.json({ error: "Not found or not yours" }, { status: 403 });
  }

  await prisma.coupon.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
