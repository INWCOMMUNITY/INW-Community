import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { resolveAllowedCheckoutBaseUrl } from "@/lib/checkout-base-url";
import { ensureRewardFulfillmentStoreItem } from "@/lib/reward-fulfillment-store-item";

/**
 * Saves shipping address for a points redemption and opens a $0 seller order for fulfillment.
 * Members are never charged shipping for rewards; the business fulfills via Seller Hub / Shippo.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    redemptionId: string;
    shippingAddress: { street: string; aptOrSuite?: string; city: string; state: string; zip: string };
    returnBaseUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { redemptionId, shippingAddress, returnBaseUrl } = body;
  const baseUrl = resolveAllowedCheckoutBaseUrl(returnBaseUrl);

  if (
    !redemptionId ||
    !shippingAddress ||
    !shippingAddress.street?.trim() ||
    !shippingAddress.city?.trim() ||
    !shippingAddress.state?.trim() ||
    !shippingAddress.zip?.trim()
  ) {
    return NextResponse.json({ error: "redemptionId and full shipping address are required." }, { status: 400 });
  }

  const redemption = await prisma.rewardRedemption.findFirst({
    where: { id: redemptionId, memberId: session.user.id },
    select: {
      id: true,
      storeOrderId: true,
      fulfillmentStatus: true,
      reward: {
        select: {
          title: true,
          needsShipping: true,
          business: { select: { memberId: true, name: true } },
        },
      },
    },
  });

  if (!redemption) {
    return NextResponse.json({ error: "Redemption not found" }, { status: 404 });
  }
  if (!redemption.reward.needsShipping) {
    return NextResponse.json({ error: "This reward does not require a shipping address." }, { status: 400 });
  }
  if (redemption.fulfillmentStatus && redemption.fulfillmentStatus !== "pending_checkout") {
    return NextResponse.json({ error: "This redemption is not awaiting a shipping address." }, { status: 400 });
  }

  const sellerId = redemption.reward.business.memberId;
  const { id: storeItemId } = await ensureRewardFulfillmentStoreItem(sellerId);

  if (redemption.storeOrderId) {
    const linkedOrder = await prisma.storeOrder.findFirst({
      where: { id: redemption.storeOrderId, buyerId: session.user.id },
      select: { id: true, status: true },
    });
    if (linkedOrder && linkedOrder.status !== "pending" && linkedOrder.status !== "canceled") {
      return NextResponse.json(
        { error: "This redemption already has a completed order. Contact support if you need help." },
        { status: 409 }
      );
    }
  }

  try {
    const orderId = await prisma.$transaction(async (tx) => {
      if (redemption.storeOrderId) {
        const existing = await tx.storeOrder.findFirst({
          where: { id: redemption.storeOrderId, buyerId: session.user.id, status: "pending" },
        });
        if (existing) {
          await tx.orderItem.deleteMany({ where: { orderId: existing.id } });
          await tx.storeOrder.delete({ where: { id: existing.id } });
        }
        await tx.rewardRedemption.update({
          where: { id: redemption.id },
          data: { storeOrderId: null },
        });
      }

      const order = await tx.storeOrder.create({
        data: {
          buyerId: session.user.id,
          sellerId,
          subtotalCents: 0,
          shippingCostCents: 0,
          totalCents: 0,
          status: "paid",
          shippingAddress: shippingAddress as object,
          orderKind: "reward_redemption",
          pointsAwarded: 0,
          taxCents: 0,
        },
      });

      await tx.orderItem.create({
        data: {
          orderId: order.id,
          storeItemId,
          quantity: 1,
          priceCentsAtPurchase: 0,
          fulfillmentType: "ship",
        },
      });

      await tx.rewardRedemption.update({
        where: { id: redemption.id },
        data: { storeOrderId: order.id, fulfillmentStatus: "paid" },
      });

      return order.id;
    });

    const redirectUrl = `${baseUrl}/storefront/order-success?order_ids=${encodeURIComponent(orderId)}&reward_shipping=1`;
    return NextResponse.json({ redirectUrl });
  } catch (e) {
    console.error("[reward-redemption-checkout]", e);
    return NextResponse.json({ error: "Could not save shipping details. Please try again." }, { status: 500 });
  }
}
