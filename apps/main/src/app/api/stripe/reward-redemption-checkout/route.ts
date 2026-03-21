import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getStripeCheckoutBranding } from "@/lib/stripe-branding";
import { resolveAllowedCheckoutBaseUrl } from "@/lib/checkout-base-url";
import { ensureRewardFulfillmentStoreItem } from "@/lib/reward-fulfillment-store-item";

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey?.startsWith("sk_") || stripeSecretKey.includes("...")) {
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  }
  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2024-11-20.acacia" as "2023-10-16",
  });

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
          imageUrl: true,
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
    return NextResponse.json({ error: "This reward does not use shipping checkout" }, { status: 400 });
  }
  if (redemption.fulfillmentStatus && redemption.fulfillmentStatus !== "pending_checkout") {
    return NextResponse.json({ error: "This redemption is not awaiting checkout" }, { status: 400 });
  }

  const sellerId = redemption.reward.business.memberId;
  const { id: storeItemId, shippingCostCents } = await ensureRewardFulfillmentStoreItem(sellerId);
  if (shippingCostCents < 1) {
    return NextResponse.json({ error: "Seller shipping rate is not configured for reward checkout." }, { status: 400 });
  }

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

  await prisma.$transaction(async (tx) => {
    if (redemption.storeOrderId) {
      const existing = await tx.storeOrder.findFirst({
        where: { id: redemption.storeOrderId, buyerId: session.user.id, status: "pending" },
      });
      if (existing) {
        await tx.storeOrder.delete({ where: { id: existing.id } });
      }
      await tx.rewardRedemption.update({
        where: { id: redemption.id },
        data: { storeOrderId: null },
      });
    }
  });

  const subtotalCents = 0;
  const orderShippingCents = shippingCostCents;
  const totalCents = subtotalCents + orderShippingCents;

  const order = await prisma.storeOrder.create({
    data: {
      buyerId: session.user.id,
      sellerId,
      subtotalCents,
      shippingCostCents: orderShippingCents,
      totalCents,
      status: "pending",
      shippingAddress: shippingAddress as object,
      orderKind: "reward_redemption",
    },
  });

  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      storeItemId,
      quantity: 1,
      priceCentsAtPurchase: 0,
      fulfillmentType: "ship",
    },
  });

  await prisma.rewardRedemption.update({
    where: { id: redemption.id },
    data: { storeOrderId: order.id },
  });

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      price_data: {
        currency: "usd",
        unit_amount: orderShippingCents,
        product_data: {
          name: `Shipping — reward: ${redemption.reward.title}`,
          description: `Community Points redemption at ${redemption.reward.business.name}. Item cost covered by points; this charge is shipping and tax only.`,
          images: redemption.reward.imageUrl ? [redemption.reward.imageUrl] : undefined,
        },
      },
      quantity: 1,
    },
  ];

  try {
    const branding = getStripeCheckoutBranding();
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      payment_method_types: ["card"],
      success_url: `${baseUrl}/storefront/order-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/rewards?canceled=1`,
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
      metadata: { orderIds: order.id },
      ...(branding && { branding_settings: branding }),
    } as Stripe.Checkout.SessionCreateParams);

    return NextResponse.json({ url: checkoutSession.url });
  } catch (e) {
    await prisma.$transaction([
      prisma.orderItem.deleteMany({ where: { orderId: order.id } }),
      prisma.storeOrder.delete({ where: { id: order.id } }),
      prisma.rewardRedemption.update({
        where: { id: redemption.id },
        data: { storeOrderId: null },
      }),
    ]);
    const message = e instanceof Error ? e.message : "Checkout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
