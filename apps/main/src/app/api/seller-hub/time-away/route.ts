import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

const MAX_ALLOW_SALES_DAYS = 14;

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const sub = await prisma.subscription.findFirst({
      where: { memberId: userId, plan: "seller", status: "active" },
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
    const allowSalesThrough = new Date(timeAway.startAt);
    allowSalesThrough.setDate(allowSalesThrough.getDate() + MAX_ALLOW_SALES_DAYS);
    const endAt = new Date(timeAway.endAt);
    const effectiveAllowSalesThrough = allowSalesThrough <= endAt ? allowSalesThrough : endAt;
    return NextResponse.json({
      timeAway: {
        id: timeAway.id,
        startAt: timeAway.startAt.toISOString(),
        endAt: timeAway.endAt.toISOString(),
        allowSalesThrough: effectiveAllowSalesThrough.toISOString(),
        isActive: now >= new Date(timeAway.startAt) && now <= endAt,
        itemsHidden: now > effectiveAllowSalesThrough && now <= endAt,
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
      where: { memberId: userId, plan: "seller", status: "active" },
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
    const allowSalesThrough = new Date(startAt);
    allowSalesThrough.setDate(allowSalesThrough.getDate() + MAX_ALLOW_SALES_DAYS);
    const effectiveEnd = endAt <= allowSalesThrough ? endAt : allowSalesThrough;
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
      allowSalesThrough: (endAt <= allowSalesThrough ? endAt : allowSalesThrough).toISOString(),
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
