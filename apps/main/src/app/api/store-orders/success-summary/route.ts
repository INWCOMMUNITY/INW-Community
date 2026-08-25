import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSessionForApi } from "@/lib/mobile-auth";
import { orderIdsFromCheckoutSessionMetadata } from "@/lib/stripe-checkout-order-ids";
import { fulfillStoreOrdersFromCheckoutSession } from "@/lib/stripe/fulfill-storefront-orders";
import { isSoldWhilePayingCancel } from "@/lib/store-order-cancel-reasons";

export const dynamic = "force-dynamic";

function stripeClient(): Stripe | null {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey?.startsWith("sk_")) return null;
  return new Stripe(stripeSecretKey, {
    apiVersion: "2024-11-20.acacia" as "2023-10-16",
  });
}

/**
 * GET ?order_ids=id1,id2 (optional)
 * Or ?session_id=cs_xxx (Stripe Checkout return) when order_ids are not on the success URL.
 * Returns order IDs for the successful checkout.
 */
export async function GET(req: NextRequest) {
  const session =
    (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const orderIdsParam = searchParams.get("order_ids");
  const sessionIdParam = searchParams.get("session_id")?.trim() || null;
  let orderIds = orderIdsParam
    ? orderIdsParam.split(",").map((id) => id.trim()).filter(Boolean)
    : [];

  if (sessionIdParam) {
    const stripe = stripeClient();
    if (stripe) {
      try {
        const cs = await stripe.checkout.sessions.retrieve(sessionIdParam);
        if (cs.payment_status === "paid") {
          if (orderIds.length === 0 && cs.metadata) {
            orderIds = orderIdsFromCheckoutSessionMetadata(
              cs.metadata as Record<string, string | null | undefined>
            );
          }
          if (orderIds.length === 0) {
            const pendingForSession = await prisma.storeOrder.findMany({
              where: {
                buyerId: session.user.id,
                status: "pending",
                stripeCheckoutSessionId: sessionIdParam,
              },
              select: { id: true },
            });
            orderIds = pendingForSession.map((o) => o.id);
          }
          // Safety net when checkout.session.completed webhook is delayed or missing.
          await fulfillStoreOrdersFromCheckoutSession(stripe, cs, {
            buyerId: session.user.id,
            logPrefix: "[success-summary]",
          });
        }
      } catch (fulfillErr) {
        console.error("[success-summary] Stripe session fulfill failed:", fulfillErr);
      }
    }
  }

  const orders = orderIds.length
    ? await prisma.storeOrder.findMany({
        where: { id: { in: orderIds }, buyerId: session.user.id },
        select: { id: true, status: true, cancelReason: true },
      })
    : [];

  const soldWhilePaying = orders.some(
    (o) => o.status === "canceled" && isSoldWhilePayingCancel(o.cancelReason)
  );

  return NextResponse.json({ orderIds, orders, soldWhilePaying });
}
