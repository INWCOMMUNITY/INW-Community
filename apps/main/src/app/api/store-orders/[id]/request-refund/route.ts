import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSessionForApi } from "@/lib/mobile-auth";
import { buyerCanRequestRefund, isActiveStoreReturnStatus } from "@/lib/store-return";
import { notifySellerReturnRequested } from "@/lib/store-return-notify";

export const dynamic = "force-dynamic";

const REFUND_REASONS = [
  "Changed my mind",
  "Didn't mean to order",
  "Order Arrived Damaged",
  "Wrong Item Delivered",
  "Other",
] as const;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session =
    (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const order = await prisma.storeOrder.findFirst({
    where: { id, buyerId: session.user.id },
    include: {
      buyer: { select: { firstName: true, lastName: true } },
      storeReturns: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.status === "refunded") {
    return NextResponse.json({ error: "Order already refunded" }, { status: 400 });
  }
  const latest = order.storeReturns[0] ?? null;
  if (!buyerCanRequestRefund({
    status: order.status,
    isCashOrder: !order.stripePaymentIntentId,
    stripePaymentIntentId: order.stripePaymentIntentId,
    storeReturn: latest,
    refundRequestedAt: latest ? null : order.refundRequestedAt,
  })) {
    if (!order.stripePaymentIntentId) {
      return NextResponse.json(
        { error: "Cash orders cannot request a refund. You can cancel the order instead." },
        { status: 400 }
      );
    }
    if (latest && isActiveStoreReturnStatus(latest.status)) {
      return NextResponse.json({ error: "A return is already in progress" }, { status: 400 });
    }
    return NextResponse.json(
      { error: "You can request a return after the order has shipped or been delivered." },
      { status: 400 }
    );
  }

  let body: { reason?: string; otherReason?: string; note?: string } = {};
  try {
    body = await req.json();
  } catch {
    // optional body
  }
  const reasonVal = typeof body.reason === "string" ? body.reason : null;
  const otherReason = typeof body.otherReason === "string" ? body.otherReason.trim() : null;
  const note = typeof body.note === "string" ? body.note.trim() || null : null;
  const reason =
    reasonVal && REFUND_REASONS.includes(reasonVal as (typeof REFUND_REASONS)[number])
      ? reasonVal === "Other" && otherReason
        ? `Other: ${otherReason}`
        : reasonVal === "Other"
          ? "Other"
          : reasonVal
      : null;
  const refundReason = [reason, note].filter(Boolean).join(note ? " | Note: " : "") || undefined;

  const now = new Date();
  const storeReturn = await prisma.$transaction(async (tx) => {
    const created = await tx.storeReturn.create({
      data: {
        orderId: order.id,
        status: "requested",
        reason: refundReason ?? reason ?? null,
        note,
        requestedAt: now,
      },
    });
    await tx.storeOrder.update({
      where: { id: order.id },
      data: { refundRequestedAt: now, refundReason: refundReason || undefined },
    });
    return created;
  });

  const buyerName = `${order.buyer.firstName} ${order.buyer.lastName}`.trim() || "A buyer";
  notifySellerReturnRequested(order.sellerId, order.id, buyerName);

  return NextResponse.json({
    ok: true,
    storeReturn,
    message: "Refund request submitted. The seller will review.",
  });
}
