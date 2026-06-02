import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { fulfillStoreOrdersFromCheckoutSession } from "@/lib/stripe/fulfill-storefront-orders";

export const maxDuration = 60;

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith("sk_")) return null;
  return new Stripe(key, { apiVersion: "2024-11-20.acacia" as "2023-10-16" });
}

/** Fulfill paid Checkouts before canceling stale pending orders (webhook may have been missed). */
async function fulfillPaidSessionsBeforeCancel(sessionIds: string[]): Promise<number> {
  const stripe = stripeClient();
  if (!stripe || sessionIds.length === 0) return 0;

  let repaired = 0;
  for (const sessionId of sessionIds) {
    try {
      const cs = await stripe.checkout.sessions.retrieve(sessionId);
      if (cs.payment_status !== "paid" || cs.mode !== "payment") continue;

      const reset = await prisma.storeOrder.updateMany({
        where: {
          stripeCheckoutSessionId: sessionId,
          status: "canceled",
          cancelReason: null,
        },
        data: { status: "pending" },
      });
      if (reset.count > 0) {
        console.info("[expire-pending-orders] re-opened canceled orders for paid session", {
          sessionId,
          count: reset.count,
        });
      }

      await fulfillStoreOrdersFromCheckoutSession(stripe, cs, {
        logPrefix: "[expire-pending-orders]",
      });
      repaired += 1;
    } catch (e) {
      console.error("[expire-pending-orders] fulfill paid session failed:", sessionId, e);
    }
  }
  return repaired;
}

/**
 * Cancel store orders that have been pending too long (abandoned checkout).
 * Never cancel orders whose Stripe Checkout Session is already paid — fulfill them instead.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 25 * 60 * 1000);
  const stripe = stripeClient();

  const pendingOld = await prisma.storeOrder.findMany({
    where: { status: "pending", createdAt: { lt: cutoff } },
    select: { id: true, stripeCheckoutSessionId: true },
  });

  const sessionIds = [
    ...new Set(
      pendingOld
        .map((o) => o.stripeCheckoutSessionId?.trim())
        .filter((id): id is string => Boolean(id))
    ),
  ];

  let fulfilledSessions = 0;
  if (stripe && sessionIds.length > 0) {
    fulfilledSessions = await fulfillPaidSessionsBeforeCancel(sessionIds);
  }

  const pendingIdsStillCancel = pendingOld
    .filter((o) => {
      if (!o.stripeCheckoutSessionId?.trim()) return true;
      return false;
    })
    .map((o) => o.id);

  const pendingWithSession = pendingOld.filter((o) => o.stripeCheckoutSessionId?.trim());
  const cancelIds: string[] = [...pendingIdsStillCancel];

  if (stripe) {
    for (const o of pendingWithSession) {
      const sid = o.stripeCheckoutSessionId!.trim();
      try {
        const cs = await stripe.checkout.sessions.retrieve(sid);
        if (cs.payment_status === "paid") {
          await fulfillStoreOrdersFromCheckoutSession(stripe, cs, {
            logPrefix: "[expire-pending-orders]",
          });
          continue;
        }
      } catch {
        /* fall through to cancel */
      }
      cancelIds.push(o.id);
    }
  } else {
    cancelIds.push(...pendingWithSession.map((o) => o.id));
  }

  const result =
    cancelIds.length > 0
      ? await prisma.storeOrder.updateMany({
          where: { id: { in: cancelIds }, status: "pending" },
          data: { status: "canceled" },
        })
      : { count: 0 };

  const repairOrphans = await prisma.storeOrder.findMany({
    where: {
      status: "canceled",
      cancelReason: null,
      stripeCheckoutSessionId: { not: null },
      stripePaymentIntentId: null,
      createdAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
    },
    select: { stripeCheckoutSessionId: true },
    distinct: ["stripeCheckoutSessionId"],
  });
  const orphanSessionIds = repairOrphans
    .map((r) => r.stripeCheckoutSessionId?.trim())
    .filter((id): id is string => Boolean(id));
  const repairedOrphans = await fulfillPaidSessionsBeforeCancel(orphanSessionIds);

  return NextResponse.json({
    ok: true,
    canceled: result.count,
    fulfilledSessions,
    repairedOrphanSessions: repairedOrphans,
  });
}
