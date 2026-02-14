import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const coupon = await prisma.coupon.findUnique({ where: { id } });
  if (!coupon) {
    return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
  }

  const post = await prisma.post.create({
    data: {
      type: "shared_coupon",
      authorId: session.user.id,
      sourceCouponId: coupon.id,
      photos: [],
    },
    include: {
      author: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
    },
  });
  return NextResponse.json(post);
}
