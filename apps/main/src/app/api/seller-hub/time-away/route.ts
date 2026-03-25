import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const sub = await prisma.subscription.findFirst({
      where: prismaWhereMemberSellerPlanAccess(userId),
    });
    if (!sub) {
      return NextResponse.json({ error: "Seller plan required" }, { status: 403 });
    }
    const timeAway = await prisma.sellerTimeAway.findUnique({
      where: { memberId: userId },
    });
    if (!timeAway) {
      return NextResponse.json({ timeAway: null });
    }
    const now = new Date();
    const startAt = new Date(timeAway.startAt);
    const endAt = new Date(timeAway.endAt);
    const inWindow = now >= startAt && now <= endAt;
    return NextResponse.json({
      timeAway: {
        id: timeAway.id,
        startAt: timeAway.startAt.toISOString(),
        endAt: timeAway.endAt.toISOString(),
        /** @deprecated storefront pauses for full window; equals startAt for clients that still read it */
        allowSalesThrough: timeAway.startAt.toISOString(),
        isActive: inWindow,
        itemsHidden: inWindow,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const sub = await prisma.subscription.findFirst({
      where: prismaWhereMemberSellerPlanAccess(userId),
    });
    if (!sub) {
      return NextResponse.json({ error: "Seller plan required" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const startAt = body.startAt ? new Date(body.startAt) : null;
    const endAt = body.endAt ? new Date(body.endAt) : null;
    if (!startAt || !endAt || endAt <= startAt) {
      return NextResponse.json(
        { error: "Start and end dates required; end must be after start." },
        { status: 400 }
      );
    }
    await prisma.sellerTimeAway.upsert({
      where: { memberId: userId },
      create: {
        memberId: userId,
        startAt,
        endAt,
      },
      update: { startAt, endAt },
    });
    return NextResponse.json({
      success: true,
      allowSalesThrough: startAt.toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await prisma.sellerTimeAway.deleteMany({
      where: { memberId: userId },
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
