import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session =
    (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const order = await prisma.storeOrder.findFirst({
    where: { id: params.id, buyerId: session.user.id },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.status === "refunded") {
    return NextResponse.json({ error: "Order already refunded" }, { status: 400 });
  }
  if (order.refundRequestedAt) {
    return NextResponse.json({ error: "Refund already requested" }, { status: 400 });
  }
  if (!order.stripePaymentIntentId) {
    return NextResponse.json(
      { error: "Cash orders cannot request a refund. You can cancel the order instead." },
      { status: 400 }
    );
  }

  const REFUND_REASONS = [
    "Changed my mind",
    "Didn't mean to order",
    "Order Arrived Damaged",
    "Wrong Item Delivered",
    "Other",
  ] as const;

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

  await prisma.storeOrder.update({
    where: { id: params.id },
    data: { refundRequestedAt: new Date(), refundReason: refundReason || undefined },
  });

  return NextResponse.json({ ok: true, message: "Refund request submitted. The seller will review." });
}
