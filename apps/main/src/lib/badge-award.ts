/**
 * Badge award utilities. Call after relevant events (member/business/post/order created, etc.).
 * Uses badge slugs from seed. Safe to call multiple times - badges are unique per member/business.
 *
 * ensureMemberBadge returns all slugs newly awarded in one operation (including cascaded `badger_badge`).
 * ensureMemberBadgeWithInfo maps those to EarnedBadge[] for in-app popups and push (one notification per badge).
 *
 * Not auto-awarded here: `community_point_giver` (admin_only in seed).
 * `community_star_business` is awarded from reward offer totals (see `awardCommunityStarBusinessBadge`).
 */
import { prisma } from "database";
import { memberIsSiteVisible } from "@/lib/member-public-visibility";
import { awardPoints } from "@/lib/award-points";
import { memberHasActivePaidNwcPlan } from "@/lib/nwc-paid-subscription";
import { getAllCategoryScanMetrics, getDistinctScannedBusinessCount } from "@/lib/badge-scan-metrics";
import {
  COMMUNITY_STAR_REWARD_OFFER_THRESHOLD_CENTS,
  getBusinessRewardOfferValueCentsRolling,
} from "@/lib/business-reward-offer-value";

/** Returns slugs of member badges newly created (empty if already had the badge). Includes `badger_badge` when cascade triggers. */
async function ensureMemberBadge(memberId: string, badgeSlug: string): Promise<string[]> {
  const newly: string[] = [];
  if (!(await memberIsSiteVisible(memberId))) return newly;

  const badge = await prisma.badge.findUnique({ where: { slug: badgeSlug } });
  if (!badge) return newly;
  const existing = await prisma.memberBadge.findUnique({
    where: { memberId_badgeId: { memberId, badgeId: badge.id } },
  });
  if (existing) return newly;
  await prisma.memberBadge.create({
    data: { memberId, badgeId: badge.id },
  });
  newly.push(badgeSlug);
  const criteria = badge.criteria as Record<string, unknown> | null;
  const bonusPoints = typeof criteria?.bonusPoints === "number" ? criteria.bonusPoints : 0;
  if (bonusPoints > 0) {
    const paid = await memberHasActivePaidNwcPlan(memberId);
    const toAward = paid ? bonusPoints * 2 : bonusPoints;
    await awardPoints(memberId, toAward);
  }
  if (badgeSlug !== "badger_badge") {
    const count = await prisma.memberBadge.count({ where: { memberId } });
    if (count >= 10) {
      const nested = await ensureMemberBadge(memberId, "badger_badge");
      newly.push(...nested);
    }
  }
  return newly;
}

/**
 * Creates business_badge if missing; notifies the business owner's member account (push + EarnedBadge for popups).
 */
async function ensureBusinessBadgeWithInfo(businessId: string, badgeSlug: string): Promise<EarnedBadge[]> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { memberId: true },
  });
  if (!business) return [];

  const badge = await prisma.badge.findUnique({ where: { slug: badgeSlug } });
  if (!badge) return [];

  const existing = await prisma.businessBadge.findUnique({
    where: { businessId_badgeId: { businessId, badgeId: badge.id } },
  });
  if (existing) return [];

  await prisma.businessBadge.create({
    data: { businessId, badgeId: badge.id },
  });

  const earned: EarnedBadge = {
    slug: badge.slug,
    name: badge.name,
    description: badge.description ?? "",
  };

  import("@/lib/send-push-notification")
    .then(({ sendPushNotification }) =>
      sendPushNotification(business.memberId, {
        title: "Your business has earned a new badge!",
        body: `Nice work! — you unlocked the “${badge.name}” badge!`,
        data: { screen: "my-badges" },
        category: "badges",
      })
    )
    .catch(() => {});

  return [earned];
}

export interface EarnedBadge {
  slug: string;
  name: string;
  description: string;
}

async function ensureMemberBadgeWithInfo(memberId: string, badgeSlug: string): Promise<EarnedBadge[]> {
  const newSlugs = await ensureMemberBadge(memberId, badgeSlug);
  if (newSlugs.length === 0) return [];
  const earned: EarnedBadge[] = [];
  for (const slug of newSlugs) {
    const badge = await prisma.badge.findUnique({ where: { slug } });
    if (!badge) continue;
    earned.push({
      slug: badge.slug,
      name: badge.name,
      description: badge.description ?? "",
    });
    import("@/lib/send-push-notification")
      .then(({ sendPushNotification }) =>
        sendPushNotification(memberId, {
          title: "You’ve got a new badge! Great job!",
          body: `“${badge.name}” is live on your profile — tap to take a look!`,
          data: { screen: "my-badges" },
          category: "badges",
        })
      )
      .catch(() => {});
  }
  return earned;
}

/**
 * Call after the member’s email is verified (app signup) or when creating a member that is already verified.
 * signupIntent: resident | business | seller. Idempotent per badge. Returns badges newly awarded for this flow.
 */
export async function awardMemberSignupBadges(memberId: string, signupIntent?: string | null): Promise<EarnedBadge[]> {
  const earned: EarnedBadge[] = [];
  const intent = signupIntent ?? "resident";
  if (intent === "resident") {
    earned.push(...(await ensureMemberBadgeWithInfo(memberId, "community_member")));
    const residentCount = await prisma.member.count({
      where: { signupIntent: "resident" },
    });
    if (residentCount <= 1000) {
      earned.push(...(await ensureMemberBadgeWithInfo(memberId, "og_community_member")));
    }
  }
  return earned;
}

/** Call after Business create. Returns newly earned business badges for in-app popups and triggers push to the owner. */
export async function awardBusinessSignupBadges(businessId: string): Promise<EarnedBadge[]> {
  const earned: EarnedBadge[] = [];
  earned.push(...(await ensureBusinessBadgeWithInfo(businessId, "local_business")));
  const businessCount = await prisma.business.count();
  if (businessCount <= 100) {
    earned.push(...(await ensureBusinessBadgeWithInfo(businessId, "og_nwc_business")));
  }
  return earned;
}

/**
 * Community Star Business — when Σ (cash value × redemption limit) for qualifying rewards
 * in the rolling window reaches $1,000. Call after reward create/update.
 */
export async function awardCommunityStarBusinessBadge(businessId: string): Promise<EarnedBadge[]> {
  const total = await getBusinessRewardOfferValueCentsRolling(businessId);
  if (total < COMMUNITY_STAR_REWARD_OFFER_THRESHOLD_CENTS) return [];
  return ensureBusinessBadgeWithInfo(businessId, "community_star_business");
}

/** Call after StoreItem create (first item by member) */
export async function awardNwcSellerBadge(memberId: string): Promise<EarnedBadge[]> {
  const count = await prisma.storeItem.count({ where: { memberId } });
  if (count === 1) {
    return ensureMemberBadgeWithInfo(memberId, "nwc_seller");
  }
  return [];
}

/** Call when StoreOrder status becomes delivered */
export async function awardSellerTierBadges(sellerId: string): Promise<EarnedBadge[]> {
  const earned: EarnedBadge[] = [];
  const deliveredCount = await prisma.storeOrder.count({
    where: { sellerId, status: "delivered" },
  });
  const slugs = [
    [10, "bronze_seller"],
    [100, "silver_seller"],
    [500, "gold_seller"],
    [1000, "platinum_seller"],
  ] as const;
  for (const [threshold, slug] of slugs) {
    if (deliveredCount >= threshold) {
      earned.push(...(await ensureMemberBadgeWithInfo(sellerId, slug)));
    }
  }
  return earned;
}

/**
 * Community Writer — award once per member.
 * Called when: (1) a member shares any approved blog to the feed (`Post` type `shared_blog`),
 * or (2) their own blog is first approved by admin (author published without resharing).
 */
export async function awardCommunityWriterBadge(authorId: string): Promise<EarnedBadge[]> {
  return ensureMemberBadgeWithInfo(authorId, "community_writer");
}

/** Call after Group create — returns badge info when newly awarded (for in-app popup). */
export async function awardAdminBadge(createdById: string): Promise<EarnedBadge[]> {
  return ensureMemberBadgeWithInfo(createdById, "admin_badge");
}

/** Call after Event create by member - check if 5 events */
export async function awardCommunityPlannerBadge(memberId: string): Promise<EarnedBadge[]> {
  const eventCount = await prisma.event.count({
    where: { memberId },
  });
  if (eventCount >= 5) {
    return ensureMemberBadgeWithInfo(memberId, "community_planner");
  }
  return [];
}

/** Call after EventInvite create – Party Planner when 10+ invites */
export async function awardPartyPlannerBadge(inviterId: string): Promise<EarnedBadge[]> {
  const inviteCount = await prisma.eventInvite.count({
    where: { inviterId },
  });
  if (inviteCount >= 10) {
    return ensureMemberBadgeWithInfo(inviterId, "party_planner");
  }
  return [];
}

const LOCAL_BUSINESS_PRO_THRESHOLD_CENTS = 100_000;

/** Call when StoreOrder is paid (buyer) - Local Business Pro when total spent >= $1000 */
export async function awardLocalBusinessProBadge(buyerId: string): Promise<EarnedBadge[]> {
  const { _sum } = await prisma.storeOrder.aggregate({
    where: {
      buyerId,
      status: { in: ["paid", "shipped", "delivered"] },
    },
    _sum: { totalCents: true },
  });
  const totalCents = _sum?.totalCents ?? 0;
  if (totalCents >= LOCAL_BUSINESS_PRO_THRESHOLD_CENTS) {
    return ensureMemberBadgeWithInfo(buyerId, "local_business_pro");
  }
  return [];
}

/**
 * For post-checkout UI (success-summary with celebrate_badges=1): return Local Business Pro once if the
 * member just crossed $1000 lifetime storefront spend on these orders. Handles Stripe webhook racing
 * the client (award already applied → empty from awardLocalBusinessProBadge, then synthetic celebration).
 */
export async function resolveLocalBusinessProCheckoutCelebration(
  buyerId: string,
  orderIds: string[]
): Promise<EarnedBadge[]> {
  if (orderIds.length === 0) return [];

  const direct = await awardLocalBusinessProBadge(buyerId);
  if (direct.length > 0) return direct;

  const badge = await prisma.badge.findUnique({
    where: { slug: "local_business_pro" },
    select: { id: true, slug: true, name: true, description: true },
  });
  if (!badge) return [];

  const memberBadge = await prisma.memberBadge.findUnique({
    where: { memberId_badgeId: { memberId: buyerId, badgeId: badge.id } },
    select: { earnedAt: true },
  });
  if (!memberBadge) return [];

  const paidStatuses = ["paid", "shipped", "delivered"] as const;
  const orders = await prisma.storeOrder.findMany({
    where: {
      id: { in: orderIds },
      buyerId,
      status: { in: [...paidStatuses] },
    },
    select: { totalCents: true, updatedAt: true },
  });
  if (orders.length !== orderIds.length) return [];

  const batchCents = orders.reduce((s, o) => s + o.totalCents, 0);
  const latestOrderAt = Math.max(...orders.map((o) => o.updatedAt.getTime()));
  const celebrationWindowMs = 12 * 60 * 1000;
  if (Date.now() - latestOrderAt > celebrationWindowMs) return [];

  const { _sum } = await prisma.storeOrder.aggregate({
    where: {
      buyerId,
      status: { in: [...paidStatuses] },
      id: { notIn: orderIds },
    },
    _sum: { totalCents: true },
  });
  const spendExcludingBatch = _sum?.totalCents ?? 0;
  if (spendExcludingBatch >= LOCAL_BUSINESS_PRO_THRESHOLD_CENTS) return [];
  if (spendExcludingBatch + batchCents < LOCAL_BUSINESS_PRO_THRESHOLD_CENTS) return [];

  return [
    {
      slug: badge.slug,
      name: badge.name,
      description: badge.description ?? "",
    },
  ];
}

/** Call after in-app share (POST /api/me/app-share) — Spreading the Word at 5 completed shares */
export async function awardSpreadingTheWordBadge(memberId: string): Promise<EarnedBadge[]> {
  const count = await prisma.memberAppShare.count({
    where: { memberId },
  });
  if (count >= 5) {
    return ensureMemberBadgeWithInfo(memberId, "spreading_the_word");
  }
  return [];
}

/**
 * Call after QRScan create — Super Scanner (10), Elite Scanner (50).
 * Uses **distinct businesses** scanned (see prisma.qRScan groupBy businessId), not total scan count.
 */
export async function awardScannerBadges(memberId: string): Promise<EarnedBadge[]> {
  const earned: EarnedBadge[] = [];
  const count = await getDistinctScannedBusinessCount(memberId);
  if (count >= 10) {
    earned.push(...(await ensureMemberBadgeWithInfo(memberId, "super_scanner")));
  }
  if (count >= 50) {
    earned.push(...(await ensureMemberBadgeWithInfo(memberId, "elite_scanner")));
  }
  return earned;
}

/**
 * Call after QRScan create (or when reconciling). Evaluates **every** category_scan badge using
 * full scan history — not only the business categories from the latest scan (avoids missing awards).
 */
export async function awardCategoryScanBadges(memberId: string): Promise<EarnedBadge[]> {
  const earned: EarnedBadge[] = [];
  const metrics = await getAllCategoryScanMetrics(memberId);
  for (const m of metrics) {
    if (m.current >= m.target) {
      earned.push(...(await ensureMemberBadgeWithInfo(memberId, m.slug)));
    }
  }
  return earned;
}

/** Call after CouponRedeem create - Penny Pusher (10 redemptions) */
export async function awardCouponRedeemBadges(memberId: string): Promise<EarnedBadge[]> {
  const earned: EarnedBadge[] = [];
  const count = await prisma.couponRedeem.count({ where: { memberId } });
  if (count >= 10) {
    earned.push(...(await ensureMemberBadgeWithInfo(memberId, "penny_pusher")));
  }
  return earned;
}

/** Ensures the badge row exists even if production never ran full seed. */
async function ensureNwcFeedbackBadgeDefinition(): Promise<void> {
  await prisma.badge.upsert({
    where: { slug: "nwc_feedback" },
    create: {
      slug: "nwc_feedback",
      name: "NWC Feedback",
      description: "Submit a request through NWC Requests.",
      category: "member",
      order: 29,
      criteria: { type: "nwc_request_submit" },
    },
    update: {
      name: "NWC Feedback",
      description: "Submit a request through NWC Requests.",
      category: "member",
      order: 29,
      criteria: { type: "nwc_request_submit" },
    },
  });
}

/** First successful NWC Requests form submission (logged-in members only). */
export async function awardNwcFeedbackBadge(memberId: string): Promise<EarnedBadge[]> {
  await ensureNwcFeedbackBadgeDefinition();
  return ensureMemberBadgeWithInfo(memberId, "nwc_feedback");
}

/** Call when a local delivery order is completed */
export async function awardSellerDeliveryBadge(sellerId: string): Promise<EarnedBadge[]> {
  const earned: EarnedBadge[] = [];
  const deliveryCount = await prisma.storeOrder.count({
    where: {
      sellerId,
      deliveryConfirmedAt: { not: null },
      deliveryBuyerConfirmedAt: { not: null },
      items: { some: { fulfillmentType: "local_delivery" } },
    },
  });
  if (deliveryCount >= 3) {
    earned.push(...(await ensureMemberBadgeWithInfo(sellerId, "local_deliverer")));
  }
  return earned;
}

/** Call when a pickup order is completed */
export async function awardSellerPickupBadge(sellerId: string): Promise<EarnedBadge[]> {
  const earned: EarnedBadge[] = [];
  const pickupCount = await prisma.storeOrder.count({
    where: {
      sellerId,
      pickupSellerConfirmedAt: { not: null },
      pickupBuyerConfirmedAt: { not: null },
      items: { some: { fulfillmentType: "pickup" } },
    },
  });
  if (pickupCount >= 1) {
    earned.push(...(await ensureMemberBadgeWithInfo(sellerId, "here_in_town")));
  }
  return earned;
}

/**
 * Re-apply threshold-based **member** badges from live counts (signup / one-shot badges excluded).
 * Call after `refreshMemberBadgeProgress` when loading badges to heal missed awards if an earlier request failed.
 */
export async function reconcileThresholdMemberBadges(memberId: string): Promise<EarnedBadge[]> {
  const earned: EarnedBadge[] = [];
  const chunks = await Promise.all([
    awardScannerBadges(memberId),
    awardCategoryScanBadges(memberId),
    awardCouponRedeemBadges(memberId),
    awardSpreadingTheWordBadge(memberId),
    awardCommunityPlannerBadge(memberId),
    awardPartyPlannerBadge(memberId),
    awardLocalBusinessProBadge(memberId),
    awardSellerTierBadges(memberId),
    awardSellerDeliveryBadge(memberId),
    awardSellerPickupBadge(memberId),
  ]);
  for (const c of chunks) {
    earned.push(...c);
  }
  return earned;
}
