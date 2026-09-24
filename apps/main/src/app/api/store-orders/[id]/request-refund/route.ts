import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSessionForApi } from "@/lib/mobile-auth";
import { createBuyerRequestedStoreReturn } from "@/lib/store-return-request";
import { notifySellerReturnRequested } from "@/lib/store-return-notify";
import { prisma } from "database";

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

  const result = await createBuyerRequestedStoreReturn(prisma, {
    orderId: id,
    buyerId: session.user.id,
    reason,
    note,
  });

  if (!result.ok) {
    if (result.error === "not_found") {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (result.error === "already_refunded") {
      return NextResponse.json({ error: "Order already refunded" }, { status: 400 });
    }
    if (result.error === "already_in_progress") {
      return NextResponse.json({ error: "A return is already in progress" }, { status: 400 });
    }
    if (result.error === "seller_no_returns") {
      return NextResponse.json(
        { error: "This seller does not accept returns." },
        { status: 400 }
      );
    }
    if (result.error === "no_card_payment") {
      return NextResponse.json(
        { error: "This order has no card payment to refund." },
        { status: 400 }
      );
    }
    if (result.error === "window_ended") {
      return NextResponse.json(
        { error: "This seller’s return window has ended." },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "You can request a return after the order has shipped or been delivered." },
      { status: 400 }
    );
  }

  const order = await prisma.storeOrder.findUnique({
    where: { id },
    select: {
      sellerId: true,
      buyer: { select: { firstName: true, lastName: true } },
    },
  });
  if (order) {
    const buyerName =
      `${order.buyer.firstName} ${order.buyer.lastName}`.trim() || "A buyer";
    notifySellerReturnRequested(order.sellerId, id, buyerName);
  }

  return NextResponse.json({
    ok: true,
    storeReturn: result.storeReturn,
    message: "Refund request submitted. The seller will review.",
  });
}
