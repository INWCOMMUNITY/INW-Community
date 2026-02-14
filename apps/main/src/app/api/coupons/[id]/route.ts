import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

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
        },
      },
    },
  });
  if (!coupon) {
    return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
  }

  const session = await getSessionForApi(req);
  const hasAccess = session?.user?.id
    ? !!(await prisma.subscription.findFirst({
        where: {
          memberId: session.user.id,
          plan: { in: ["subscribe", "sponsor", "seller"] },
          status: "active",
        },
      }))
    : false;

  return NextResponse.json({
    id: coupon.id,
    name: coupon.name,
    discount: coupon.discount,
    code: hasAccess ? coupon.code : null,
    imageUrl: coupon.imageUrl,
    business: coupon.business,
    hasAccess,
  });
}
