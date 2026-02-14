import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma, Prisma } from "database";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function createBusinessFromMetadata(
  memberId: string,
  data: Record<string, unknown>
): Promise<void> {
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const city = typeof data.city === "string" ? data.city.trim() : "";
  const shortDescription = typeof data.shortDescription === "string" ? data.shortDescription.trim() : null;
  const fullDescription = typeof data.fullDescription === "string" ? data.fullDescription.trim() : null;
  const categories = Array.isArray(data.categories)
    ? (data.categories as string[]).filter((c) => typeof c === "string" && c.trim()).slice(0, 2)
    : [];

  if (!name || !city || categories.length === 0) return;

  const website = typeof data.website === "string" && data.website.trim()
    ? (data.website.startsWith("http") ? data.website : `https://${data.website}`)
    : null;
  const phone = typeof data.phone === "string" && data.phone.trim() ? data.phone.trim() : null;
  const email = typeof data.email === "string" && data.email.trim() ? data.email.trim() : null;
  const logoUrl = typeof data.logoUrl === "string" && data.logoUrl.trim() ? data.logoUrl.trim() : null;
  const address = typeof data.address === "string" && data.address.trim() ? data.address.trim() : null;
  const photos = Array.isArray(data.photos) ? (data.photos as string[]).filter(Boolean) : [];
  const hoursOfOperation = data.hoursOfOperation && typeof data.hoursOfOperation === "object"
    ? (data.hoursOfOperation as Record<string, string>)
    : undefined;

  const existingCount = await prisma.business.count({ where: { memberId } });
  if (existingCount >= 2) return;

  let slug = slugify(name);
  let suffix = 0;
  while (await prisma.business.findUnique({ where: { slug } })) {
    slug = `${slugify(name)}-${++suffix}`;
  }

  const business = await prisma.business.create({
    data: {
      memberId,
      name,
      shortDescription,
      fullDescription,
      website,
      phone,
      email,
      logoUrl,
      address,
      city,
      categories,
      slug,
      photos,
      hoursOfOperation,
    },
  });
  const { awardBusinessSignupBadges } = await import("@/lib/badge-award");
  awardBusinessSignupBadges(business.id).catch(() => {});
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature or webhook secret" }, { status: 400 });
  }
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const memberId = session.metadata?.memberId;
    const planId = session.metadata?.planId as "subscribe" | "sponsor" | "seller" | undefined;
    const subId = session.subscription as string | null;

    if (memberId && planId && subId) {
      await prisma.subscription.create({
        data: {
          memberId,
          plan: planId,
          stripeSubscriptionId: subId,
          stripeCustomerId: session.customer as string | null,
          status: "active",
        },
      });
      const businessDataRaw = session.metadata?.businessData;
      if (planId === "sponsor" && businessDataRaw && typeof businessDataRaw === "string") {
        try {
          const businessData = JSON.parse(businessDataRaw) as Record<string, unknown>;
          await createBusinessFromMetadata(memberId, businessData);
        } catch (bErr) {
          console.error("[webhook] business create from checkout metadata:", bErr);
        }
      }
    }

    const orderIdsRaw = session.metadata?.orderIds;
    const orderIdsList: string[] =
      orderIdsRaw && typeof orderIdsRaw === "string" && orderIdsRaw.trim()
        ? orderIdsRaw.split(",").map((id) => id.trim()).filter(Boolean)
        : [];
    const singleOrderId = session.metadata?.orderId;

    const toProcess: string[] = orderIdsList.length > 0 ? orderIdsList : singleOrderId ? [singleOrderId] : [];

    if (session.mode === "payment" && toProcess.length > 0) {
      const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null;

      for (const orderId of toProcess) {
        const order = await prisma.storeOrder.findFirst({
          where: { id: orderId, status: "pending" },
          include: { items: true },
        });
        if (!order) continue;

        const totalCents = order.totalCents;
        const platformFeeCents = Math.max(50, Math.floor(totalCents * 0.05));
        const sellerCreditsCents = totalCents - platformFeeCents;
        let pointsAwarded = Math.round(totalCents / 200);
        const subscriber = await prisma.subscription.findFirst({
          where: { memberId: order.buyerId, plan: "subscribe", status: "active" },
        });
        if (subscriber) pointsAwarded *= 2;

        await prisma.storeOrder.update({
          where: { id: order.id },
          data: {
            status: "paid",
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: paymentIntentId,
            pointsAwarded,
          },
        });

        for (const oi of order.items) {
          await prisma.storeItem.update({
            where: { id: oi.storeItemId },
            data: { quantity: { decrement: oi.quantity } },
          });
        }

        await prisma.member.update({
          where: { id: order.buyerId },
          data: { points: { increment: pointsAwarded } },
        });

        const { awardLocalBusinessProBadge } = await import("@/lib/badge-award");
        awardLocalBusinessProBadge(order.buyerId).catch(() => {});

        await prisma.sellerBalance.upsert({
          where: { memberId: order.sellerId },
          create: {
            memberId: order.sellerId,
            balanceCents: sellerCreditsCents,
            totalEarnedCents: sellerCreditsCents,
          },
          update: {
            balanceCents: { increment: sellerCreditsCents },
            totalEarnedCents: { increment: sellerCreditsCents },
          },
        });
        await prisma.sellerBalanceTransaction.create({
          data: {
            memberId: order.sellerId,
            type: "sale",
            amountCents: sellerCreditsCents,
            orderId: order.id,
            description: `Sale: Order #${order.id.slice(-6)}`,
          },
        });

        const storeItemIds = order.items.map((oi) => oi.storeItemId);
        const storeItems = await prisma.storeItem.findMany({
          where: { id: { in: storeItemIds } },
          select: { listingType: true },
        });
        const allResale =
          storeItems.length === storeItemIds.length &&
          storeItems.every((s) => s.listingType === "resale");
        if (allResale) {
          const sellerPoints = Math.round(totalCents / 100);
          await prisma.member.update({
            where: { id: order.sellerId },
            data: { points: { increment: sellerPoints } },
          });
        }

        if (order.shippingCostCents > 0) {
          try {
            await stripe.payouts.create({
              amount: order.shippingCostCents,
              currency: "usd",
              method: "instant",
              metadata: { orderId: order.id, reason: "shipping" },
            });
          } catch (payoutErr) {
            console.error("[webhook] Instant payout for shipping failed:", payoutErr);
          }
        }
      }
    }

    const buyerId = session.metadata?.buyerId;
    const sellerId = session.metadata?.sellerId;
    if (buyerId && sellerId && session.mode === "payment") {
      const existing = await prisma.storeOrder.findFirst({
        where: { stripeCheckoutSessionId: session.id },
      });
      if (!existing) {
        const subtotalCents = parseInt(session.metadata?.subtotalCents ?? "0", 10);
        const shippingCostCents = parseInt(session.metadata?.shippingCostCents ?? "0", 10);
        const totalCents =
          parseInt(session.metadata?.totalCents ?? "0", 10) || subtotalCents + shippingCostCents;
        const platformFeeCents = parseInt(session.metadata?.platformFeeCents ?? "0", 10);
        let pointsAwarded = Math.round(totalCents / 200);
        const subscriber = await prisma.subscription.findFirst({
          where: { memberId: buyerId, plan: "subscribe", status: "active" },
        });
        if (subscriber) pointsAwarded *= 2;
        const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null;
        let shippingAddress: unknown = null;
        try {
          const sa = session.metadata?.shippingAddress;
          if (sa) shippingAddress = JSON.parse(sa) as unknown;
        } catch {
          /* ignore */
        }
        let localDeliveryDetails: unknown = null;
        try {
          const ld = session.metadata?.localDeliveryDetails;
          if (ld) localDeliveryDetails = JSON.parse(ld) as unknown;
        } catch {
          /* ignore */
        }
        const itemsJson = session.metadata?.items ?? "[]";
        let orderItems: {
          storeItemId: string;
          quantity: number;
          priceCentsAtPurchase: number;
          variant?: unknown;
          fulfillmentType?: string;
        }[];
        try {
          orderItems = JSON.parse(itemsJson) as typeof orderItems;
        } catch {
          orderItems = [];
        }

        const order = await prisma.storeOrder.create({
          data: {
            buyerId,
            sellerId,
            subtotalCents,
            shippingCostCents,
            totalCents,
            status: "paid",
            shippingAddress: shippingAddress === null ? Prisma.JsonNull : (shippingAddress as object),
            localDeliveryDetails: localDeliveryDetails === null ? Prisma.JsonNull : (localDeliveryDetails as object),
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: paymentIntentId,
            pointsAwarded,
          },
        });

        for (const oi of orderItems) {
          await prisma.orderItem.create({
            data: {
              orderId: order.id,
              storeItemId: oi.storeItemId,
              quantity: oi.quantity,
              priceCentsAtPurchase: oi.priceCentsAtPurchase,
              variant: oi.variant === null || oi.variant === undefined ? Prisma.JsonNull : (oi.variant as object),
              fulfillmentType: oi.fulfillmentType ?? null,
            },
          });
          await prisma.storeItem.update({
            where: { id: oi.storeItemId },
            data: { quantity: { decrement: oi.quantity } },
          });
        }

        await prisma.member.update({
          where: { id: buyerId },
          data: { points: { increment: pointsAwarded } },
        });

        const { awardLocalBusinessProBadge } = await import("@/lib/badge-award");
        awardLocalBusinessProBadge(buyerId).catch(() => {});

        const sellerCreditsCents = totalCents - platformFeeCents;
        await prisma.sellerBalance.upsert({
          where: { memberId: sellerId },
          create: {
            memberId: sellerId,
            balanceCents: sellerCreditsCents,
            totalEarnedCents: sellerCreditsCents,
          },
          update: {
            balanceCents: { increment: sellerCreditsCents },
            totalEarnedCents: { increment: sellerCreditsCents },
          },
        });
        await prisma.sellerBalanceTransaction.create({
          data: {
            memberId: sellerId,
            type: "sale",
            amountCents: sellerCreditsCents,
            orderId: order.id,
            description: `Sale: Order #${order.id.slice(-6)}`,
          },
        });

        const storeItemIds = orderItems.map((oi) => oi.storeItemId);
        const storeItems = await prisma.storeItem.findMany({
          where: { id: { in: storeItemIds } },
          select: { listingType: true },
        });
        const allResale =
          storeItems.length === storeItemIds.length &&
          storeItems.every((s) => s.listingType === "resale");
        if (allResale) {
          const sellerPoints = Math.round(totalCents / 100);
          await prisma.member.update({
            where: { id: sellerId },
            data: { points: { increment: sellerPoints } },
          });
        }

        if (shippingCostCents > 0) {
          try {
            await stripe.payouts.create({
              amount: shippingCostCents,
              currency: "usd",
              method: "instant",
              metadata: { orderId: order.id, reason: "shipping" },
            });
          } catch (payoutErr) {
            console.error("[webhook] Instant payout for shipping failed:", payoutErr);
          }
        }
      }
    }
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const orderIdsRaw = paymentIntent.metadata?.orderIds;
    const orderIdsList: string[] =
      orderIdsRaw && typeof orderIdsRaw === "string" && orderIdsRaw.trim()
        ? orderIdsRaw.split(",").map((id) => id.trim()).filter(Boolean)
        : [];
    for (const orderId of orderIdsList) {
      const order = await prisma.storeOrder.findFirst({
        where: { id: orderId, status: "pending" },
        include: { items: true },
      });
      if (!order) continue;

      const totalCents = order.totalCents;
      const platformFeeCents = Math.max(50, Math.floor(totalCents * 0.05));
      const sellerCreditsCents = totalCents - platformFeeCents;
      let pointsAwarded = Math.round(totalCents / 200);
      const subscriber = await prisma.subscription.findFirst({
        where: { memberId: order.buyerId, plan: "subscribe", status: "active" },
      });
      if (subscriber) pointsAwarded *= 2;

      await prisma.storeOrder.update({
        where: { id: order.id },
        data: {
          status: "paid",
          stripePaymentIntentId: paymentIntent.id,
          pointsAwarded,
        },
      });

      for (const oi of order.items) {
        await prisma.storeItem.update({
          where: { id: oi.storeItemId },
          data: { quantity: { decrement: oi.quantity } },
        });
      }

      await prisma.member.update({
        where: { id: order.buyerId },
        data: { points: { increment: pointsAwarded } },
      });

      await prisma.sellerBalance.upsert({
        where: { memberId: order.sellerId },
        create: {
          memberId: order.sellerId,
          balanceCents: sellerCreditsCents,
          totalEarnedCents: sellerCreditsCents,
        },
        update: {
          balanceCents: { increment: sellerCreditsCents },
          totalEarnedCents: { increment: sellerCreditsCents },
        },
      });
      await prisma.sellerBalanceTransaction.create({
        data: {
          memberId: order.sellerId,
          type: "sale",
          amountCents: sellerCreditsCents,
          orderId: order.id,
          description: `Sale: Order #${order.id.slice(-6)}`,
        },
      });

      const storeItemIds = order.items.map((oi) => oi.storeItemId);
      const storeItems = await prisma.storeItem.findMany({
        where: { id: { in: storeItemIds } },
        select: { listingType: true },
      });
      const allResale =
        storeItems.length === storeItemIds.length &&
        storeItems.every((s) => s.listingType === "resale");
      if (allResale) {
        const sellerPoints = Math.round(totalCents / 100);
        await prisma.member.update({
          where: { id: order.sellerId },
          data: { points: { increment: sellerPoints } },
        });
      }

      if (order.shippingCostCents > 0) {
        try {
          await stripe.payouts.create({
            amount: order.shippingCostCents,
            currency: "usd",
            method: "instant",
            metadata: { orderId: order.id, reason: "shipping" },
          });
        } catch (payoutErr) {
          console.error("[webhook] Instant payout for shipping failed:", payoutErr);
        }
      }
    }
  }

  if (event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object as Stripe.Invoice;
    const subId = invoice.subscription;
    if (subId) {
      const subIdStr = typeof subId === "string" ? subId : subId.id;
      const existing = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: subIdStr },
      });
      if (!existing) {
        try {
          const sub = await stripe.subscriptions.retrieve(subIdStr);
          const memberId = sub.metadata?.memberId;
          const planId = sub.metadata?.planId as "sponsor" | "seller" | undefined;
          if (memberId && planId) {
            await prisma.subscription.create({
              data: {
                memberId,
                plan: planId,
                stripeSubscriptionId: subIdStr,
                stripeCustomerId: typeof invoice.customer === "string" ? invoice.customer : null,
                status: "active",
              },
            });
            const businessDataRaw = sub.metadata?.businessData;
            if (planId === "sponsor" && businessDataRaw && typeof businessDataRaw === "string") {
              try {
                const businessData = JSON.parse(businessDataRaw) as Record<string, unknown>;
                await createBusinessFromMetadata(memberId, businessData);
              } catch (bErr) {
                console.error("[webhook] business create from invoice metadata:", bErr);
              }
            }
          }
        } catch (err) {
          console.error("[webhook] invoice.payment_succeeded subscription handle:", err);
        }
      }
    }
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    await prisma.subscription.updateMany({
      where: { stripeSubscriptionId: sub.id },
      data: {
        status: sub.status === "active" ? "active" : sub.status === "trialing" ? "active" : "canceled",
        currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
      },
    });
  }
  return NextResponse.json({ received: true });
}
