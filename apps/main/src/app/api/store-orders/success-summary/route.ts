import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSessionForApi } from "@/lib/mobile-auth";
import { orderQualifiesForDeferredBuyerPoints } from "@/lib/store-order-buyer-points";
import { orderIdsFromCheckoutSessionMetadata } from "@/lib/stripe-checkout-order-ids";

export const dynamic = "force-dynamic";

/**
 * GET ?order_ids=id1,id2&celebrate_badges=1 (optional)
 * Or ?session_id=cs_xxx (Stripe Checkout return) when order_ids are not on the success URL.
 * Returns total points awarded for the given orders (buyer must own them, orders must be paid).
 * When celebrate_badges=1, also returns earnedBadges for checkout popups (e.g. Local Business Pro).
 * Points-only callers should omit celebrate_badges so badge celebration is not repeated after dismiss.
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
  const celebrateBadges = searchParams.get("celebrate_badges") === "1";
  let orderIds = orderIdsParam
    ? orderIdsParam.split(",").map((id) => id.trim()).filter(Boolean)
    : [];

  if (orderIds.length === 0 && sessionIdParam) {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (stripeSecretKey?.startsWith("sk_")) {
      try {
        const stripe = new Stripe(stripeSecretKey, {
          apiVersion: "2024-11-20.acacia" as "2023-10-16",
        });
        const cs = await stripe.checkout.sessions.retrieve(sessionIdParam);
        if (cs.payment_status === "paid" && cs.metadata) {
          orderIds = orderIdsFromCheckoutSessionMetadata(
            cs.metadata as Record<string, string | null | undefined>
          );
        }
      } catch {
        orderIds = [];
      }
    }
  }

  if (orderIds.length === 0) {
    return NextResponse.json({ orderIds: [], pointsAwarded: 0, pointsPendingFulfillment: 0 });
  }

  const orders = await prisma.storeOrder.findMany({
    where: {
      id: { in: orderIds },
      buyerId: session.user.id,
      status: "paid",
    },
    select: {
      pointsAwarded: true,
      buyerPointsReleasedAt: true,
      items: { select: { fulfillmentType: true } },
    },
  });

  let pointsAwarded = 0;
  let pointsPendingFulfillment = 0;
  for (const o of orders) {
    const deferred = orderQualifiesForDeferredBuyerPoints(o.items);
    const pts = o.pointsAwarded ?? 0;
    if (deferred && !o.buyerPointsReleasedAt) {
      pointsPendingFulfillment += pts;
    } else {
      pointsAwarded += pts;
    }
  }

  const base = { orderIds, pointsAwarded, pointsPendingFulfillment };

  if (!celebrateBadges) {
    return NextResponse.json(base);
  }

  let earnedBadges: { slug: string; name: string; description: string }[] = [];
  try {
    const { resolveLocalBusinessProCheckoutCelebration } = await import("@/lib/badge-award");
    earnedBadges = await resolveLocalBusinessProCheckoutCelebration(session.user.id, orderIds);
  } catch {
    /* best-effort */
  }
  return NextResponse.json({
    ...base,
    ...(earnedBadges.length > 0 ? { earnedBadges } : {}),
  });
}
