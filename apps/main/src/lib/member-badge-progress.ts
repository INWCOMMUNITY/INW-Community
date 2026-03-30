import { prisma } from "database";
import { getAllCategoryScanMetrics, getDistinctScannedBusinessCount } from "@/lib/badge-scan-metrics";

/** Stable keys for member_badge_progress.progress_key */
export const MEMBER_BADGE_PROGRESS_KEYS = {
  SCANNER_DISTINCT: "scanner:distinct_businesses",
  SCANNER_SUPER_TARGET: 10,
  SCANNER_ELITE_TARGET: 50,
  COUPON_REDEMPTIONS: "coupon:redemptions",
  COUPON_PENNY_PUSHER_TARGET: 10,
  /** Progress for Spreading the Word — in-app share completions (MemberAppShare), not referral signups */
  REFERRAL_SIGNUPS: "referral:qualified_signups",
  SPREADING_WORD_TARGET: 5,
  EVENTS_CREATED: "events:created",
  COMMUNITY_PLANNER_TARGET: 5,
  EVENT_INVITES_SENT: "event_invites:sent",
  PARTY_PLANNER_TARGET: 10,
  BUYER_STORE_SPEND_CENTS: "buyer:store_spend_cents",
  LOCAL_BUSINESS_PRO_TARGET_CENTS: 100_000,
  SELLER_DELIVERED_ORDERS: "seller:delivered_orders",
  SELLER_LOCAL_DELIVERY_COMPLETED: "seller:local_delivery_completed",
  LOCAL_DELIVERER_TARGET: 3,
  SELLER_PICKUP_COMPLETED: "seller:pickup_completed",
  HERE_IN_TOWN_TARGET: 1,
} as const;

function categoryScanKey(slug: string): string {
  return `category_scan:${slug}`;
}

async function upsertProgress(
  memberId: string,
  progressKey: string,
  current: number,
  target: number | null
): Promise<void> {
  await prisma.memberBadgeProgress.upsert({
    where: {
      memberId_progressKey: { memberId, progressKey },
    },
    create: { memberId, progressKey, current, target },
    update: { current, target },
  });
}

/**
 * Recomputes progress from source tables (QRScan, CouponRedeem, orders, etc.).
 * Safe to call on every badges fetch and after scan / redeem so UI and audits stay aligned.
 */
export async function refreshMemberBadgeProgress(memberId: string): Promise<void> {
  const [
    distinctBiz,
    categoryMetrics,
    couponRedemptions,
    referralCount,
    eventCount,
    inviteCount,
    buyerSpend,
    sellerDelivered,
    sellerLocalDelivery,
    sellerPickup,
  ] = await Promise.all([
    getDistinctScannedBusinessCount(memberId),
    getAllCategoryScanMetrics(memberId),
    prisma.couponRedeem.count({ where: { memberId } }),
    prisma.memberAppShare.count({ where: { memberId } }),
    prisma.event.count({ where: { memberId } }),
    prisma.eventInvite.count({ where: { inviterId: memberId } }),
    prisma.storeOrder.aggregate({
      where: {
        buyerId: memberId,
        status: { in: ["paid", "shipped", "delivered"] },
      },
      _sum: { totalCents: true },
    }),
    prisma.storeOrder.count({
      where: { sellerId: memberId, status: "delivered" },
    }),
    prisma.storeOrder.count({
      where: {
        sellerId: memberId,
        deliveryConfirmedAt: { not: null },
        deliveryBuyerConfirmedAt: { not: null },
        items: { some: { fulfillmentType: "local_delivery" } },
      },
    }),
    prisma.storeOrder.count({
      where: {
        sellerId: memberId,
        pickupSellerConfirmedAt: { not: null },
        pickupBuyerConfirmedAt: { not: null },
        items: { some: { fulfillmentType: "pickup" } },
      },
    }),
  ]);

  const spendCents = buyerSpend._sum?.totalCents ?? 0;

  const upserts: Promise<void>[] = [
    upsertProgress(memberId, MEMBER_BADGE_PROGRESS_KEYS.SCANNER_DISTINCT, distinctBiz, MEMBER_BADGE_PROGRESS_KEYS.SCANNER_ELITE_TARGET),
    upsertProgress(
      memberId,
      MEMBER_BADGE_PROGRESS_KEYS.COUPON_REDEMPTIONS,
      couponRedemptions,
      MEMBER_BADGE_PROGRESS_KEYS.COUPON_PENNY_PUSHER_TARGET
    ),
    upsertProgress(
      memberId,
      MEMBER_BADGE_PROGRESS_KEYS.REFERRAL_SIGNUPS,
      referralCount,
      MEMBER_BADGE_PROGRESS_KEYS.SPREADING_WORD_TARGET
    ),
    upsertProgress(
      memberId,
      MEMBER_BADGE_PROGRESS_KEYS.EVENTS_CREATED,
      eventCount,
      MEMBER_BADGE_PROGRESS_KEYS.COMMUNITY_PLANNER_TARGET
    ),
    upsertProgress(
      memberId,
      MEMBER_BADGE_PROGRESS_KEYS.EVENT_INVITES_SENT,
      inviteCount,
      MEMBER_BADGE_PROGRESS_KEYS.PARTY_PLANNER_TARGET
    ),
    upsertProgress(
      memberId,
      MEMBER_BADGE_PROGRESS_KEYS.BUYER_STORE_SPEND_CENTS,
      spendCents,
      MEMBER_BADGE_PROGRESS_KEYS.LOCAL_BUSINESS_PRO_TARGET_CENTS
    ),
    upsertProgress(memberId, MEMBER_BADGE_PROGRESS_KEYS.SELLER_DELIVERED_ORDERS, sellerDelivered, null),
    upsertProgress(
      memberId,
      MEMBER_BADGE_PROGRESS_KEYS.SELLER_LOCAL_DELIVERY_COMPLETED,
      sellerLocalDelivery,
      MEMBER_BADGE_PROGRESS_KEYS.LOCAL_DELIVERER_TARGET
    ),
    upsertProgress(
      memberId,
      MEMBER_BADGE_PROGRESS_KEYS.SELLER_PICKUP_COMPLETED,
      sellerPickup,
      MEMBER_BADGE_PROGRESS_KEYS.HERE_IN_TOWN_TARGET
    ),
  ];

  for (const m of categoryMetrics) {
    upserts.push(upsertProgress(memberId, categoryScanKey(m.slug), m.current, m.target));
  }

  const results = await Promise.allSettled(upserts);
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    const first = failed[0] as PromiseRejectedResult;
    const msg = first.reason instanceof Error ? first.reason.message : String(first.reason);
    if (process.env.NODE_ENV === "development") {
      console.error(
        `[refreshMemberBadgeProgress] ${failed.length}/${results.length} upserts failed; first:`,
        msg
      );
    }
    if (failed.length === results.length) {
      throw first.reason instanceof Error ? first.reason : new Error(msg);
    }
  }
}

/**
 * Subset of `refreshMemberBadgeProgress` — QR scans, category_scan badges, and event/invite
 * counts for planner badges. Used when the full refresh fails so progress UIs still get rows
 * (otherwise `events:created` is missing and Community Planner stays at 0/5).
 */
export async function ensureScanRelatedBadgeProgress(memberId: string): Promise<void> {
  const [distinctBiz, categoryMetrics, eventCount, inviteCount] = await Promise.all([
    getDistinctScannedBusinessCount(memberId),
    getAllCategoryScanMetrics(memberId),
    prisma.event.count({ where: { memberId } }),
    prisma.eventInvite.count({ where: { inviterId: memberId } }),
  ]);
  const upserts: Promise<void>[] = [
    upsertProgress(
      memberId,
      MEMBER_BADGE_PROGRESS_KEYS.SCANNER_DISTINCT,
      distinctBiz,
      MEMBER_BADGE_PROGRESS_KEYS.SCANNER_ELITE_TARGET
    ),
    upsertProgress(
      memberId,
      MEMBER_BADGE_PROGRESS_KEYS.EVENTS_CREATED,
      eventCount,
      MEMBER_BADGE_PROGRESS_KEYS.COMMUNITY_PLANNER_TARGET
    ),
    upsertProgress(
      memberId,
      MEMBER_BADGE_PROGRESS_KEYS.EVENT_INVITES_SENT,
      inviteCount,
      MEMBER_BADGE_PROGRESS_KEYS.PARTY_PLANNER_TARGET
    ),
  ];
  for (const m of categoryMetrics) {
    upserts.push(upsertProgress(memberId, categoryScanKey(m.slug), m.current, m.target));
  }
  await Promise.allSettled(upserts);
}
