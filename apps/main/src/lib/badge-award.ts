/**
 * Badge award utilities. Call after relevant events (member/business/post/order created, etc.).
 * Uses badge slugs from seed. Safe to call multiple times - badges are unique per member/business.
 *
 * Not auto-awarded here: `community_star_business` (planned / TBD), `community_point_giver` (admin_only in seed).
 */
import { prisma } from "database";
import { awardPoints } from "@/lib/award-points";

async function ensureMemberBadge(memberId: string, badgeSlug: string): Promise<boolean> {
  const badge = await prisma.badge.findUnique({ where: { slug: badgeSlug } });
  if (!badge) return false;
  const existing = await prisma.memberBadge.findUnique({
    where: { memberId_badgeId: { memberId, badgeId: badge.id } },
  });
  if (existing) return false;
  await prisma.memberBadge.create({
    data: { memberId, badgeId: badge.id },
  });
  // Award bonus points defined in badge criteria
  const criteria = badge.criteria as Record<string, unknown> | null;
  const bonusPoints = typeof criteria?.bonusPoints === "number" ? criteria.bonusPoints : 0;
  if (bonusPoints > 0) {
    await awardPoints(memberId, bonusPoints);
  }
  // The Badger Badge: earn 10 badges
  if (badgeSlug !== "badger_badge") {
    const count = await prisma.memberBadge.count({ where: { memberId } });
    if (count >= 10) {
      await ensureMemberBadge(memberId, "badger_badge");
    }
  }
  return true;
}

async function ensureBusinessBadge(businessId: string, badgeSlug: string): Promise<boolean> {
  const badge = await prisma.badge.findUnique({ where: { slug: badgeSlug } });
  if (!badge) return false;
  const existing = await prisma.businessBadge.findUnique({
    where: { businessId_badgeId: { businessId, badgeId: badge.id } },
  });
  if (existing) return false;
  await prisma.businessBadge.create({
    data: { businessId, badgeId: badge.id },
  });
  return true;
}

/** Call after Member create (signup). signupIntent: resident | business | seller. Returns badges just awarded for this signup. */
export async function awardMemberSignupBadges(memberId: string, signupIntent?: string | null): Promise<EarnedBadge[]> {
  const earned: EarnedBadge[] = [];
  const intent = signupIntent ?? "resident";
  if (intent === "resident") {
    const b1 = await ensureMemberBadgeWithInfo(memberId, "community_member");
    if (b1) earned.push(b1);
    const residentCount = await prisma.member.count({
      where: { signupIntent: "resident" },
    });
    if (residentCount <= 1000) {
      const b2 = await ensureMemberBadgeWithInfo(memberId, "og_community_member");
      if (b2) earned.push(b2);
    }
  }
  return earned;
}

/** Call after Business create */
export async function awardBusinessSignupBadges(businessId: string) {
  await ensureBusinessBadge(businessId, "local_business");
  const businessCount = await prisma.business.count();
  if (businessCount <= 100) {
    await ensureBusinessBadge(businessId, "og_nwc_business");
  }
}

/** Call after StoreItem create (first item by member) */
export async function awardNwcSellerBadge(memberId: string) {
  const count = await prisma.storeItem.count({ where: { memberId } });
  if (count === 1) {
    await ensureMemberBadge(memberId, "nwc_seller");
  }
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
      const b = await ensureMemberBadgeWithInfo(sellerId, slug);
      if (b) earned.push(b);
    }
  }
  return earned;
}

/** Call after Post create with type=shared_blog */
export async function awardCommunityWriterBadge(authorId: string) {
  await ensureMemberBadge(authorId, "community_writer");
}

/** Call after Group create */
export async function awardAdminBadge(createdById: string) {
  await ensureMemberBadge(createdById, "admin_badge");
}

/** Call after Event create by member - check if 5 events */
export async function awardCommunityPlannerBadge(memberId: string) {
  const eventCount = await prisma.event.count({
    where: { memberId },
  });
  if (eventCount >= 5) {
    await ensureMemberBadge(memberId, "community_planner");
  }
}

/** Call after EventInvite create – Party Planner when 10+ invites */
export async function awardPartyPlannerBadge(inviterId: string) {
  const inviteCount = await prisma.eventInvite.count({
    where: { inviterId },
  });
  if (inviteCount >= 10) {
    await ensureMemberBadge(inviterId, "party_planner");
  }
}

/** Call when StoreOrder is paid (buyer) - Local Business Pro when total spent >= $1000 */
export async function awardLocalBusinessProBadge(buyerId: string) {
  const { _sum } = await prisma.storeOrder.aggregate({
    where: {
      buyerId,
      status: { in: ["paid", "shipped", "delivered"] },
    },
    _sum: { totalCents: true },
  });
  const totalCents = _sum?.totalCents ?? 0;
  if (totalCents >= 100000) {
    await ensureMemberBadge(buyerId, "local_business_pro");
  }
}

/** Call after signup via referral - Spreading the Word when referrer has 5+ signups */
export async function awardSpreadingTheWordBadge(referrerId: string) {
  const count = await prisma.referralSignup.count({
    where: { referrerId },
  });
  if (count >= 5) {
    await ensureMemberBadge(referrerId, "spreading_the_word");
  }
}

export interface EarnedBadge {
  slug: string;
  name: string;
  description: string;
}

async function ensureMemberBadgeWithInfo(memberId: string, badgeSlug: string): Promise<EarnedBadge | null> {
  const badge = await prisma.badge.findUnique({ where: { slug: badgeSlug } });
  if (!badge) return null;
  const awarded = await ensureMemberBadge(memberId, badgeSlug);
  if (!awarded) return null;
  import("@/lib/send-push-notification")
    .then(({ sendPushNotification }) =>
      sendPushNotification(memberId, {
        title: "Badge earned",
        body: `You earned the ${badge.name} badge!`,
        data: { screen: "my-badges" },
      })
    )
    .catch(() => {});
  return { slug: badge.slug, name: badge.name, description: badge.description };
}

/**
 * Call after QRScan create — Super Scanner (10), Elite Scanner (50).
 * Uses **distinct businesses** scanned (see prisma.qRScan groupBy businessId), not total scan count.
 */
export async function awardScannerBadges(memberId: string): Promise<EarnedBadge[]> {
  const earned: EarnedBadge[] = [];
  const distinctBizCount = await prisma.qRScan.groupBy({
    by: ["businessId"],
    where: { memberId },
  });
  const count = distinctBizCount.length;
  if (count >= 10) {
    const b = await ensureMemberBadgeWithInfo(memberId, "super_scanner");
    if (b) earned.push(b);
  }
  if (count >= 50) {
    const b = await ensureMemberBadgeWithInfo(memberId, "elite_scanner");
    if (b) earned.push(b);
  }
  return earned;
}

interface CategoryScanCriteria {
  type: "category_scan";
  categories: string[];
  scanCount: number;
  bonusPoints?: number;
}

/** Call after QRScan create - checks all category_scan badges (total scans, not distinct) */
export async function awardCategoryScanBadges(memberId: string, businessCategories: string[]): Promise<EarnedBadge[]> {
  const earned: EarnedBadge[] = [];
  if (!businessCategories.length) return earned;

  const catBadges = await prisma.badge.findMany({
    where: { criteria: { path: ["type"], equals: "category_scan" } },
  });

  const bizCatsLower = businessCategories.map((c) => c.toLowerCase());

  for (const badge of catBadges) {
    const criteria = badge.criteria as unknown as CategoryScanCriteria | null;
    if (!criteria?.categories?.length || !criteria.scanCount) continue;

    const badgeCatsLower = criteria.categories.map((c) => c.toLowerCase());
    if (!bizCatsLower.some((c) => badgeCatsLower.includes(c))) continue;

    const matchingBusinesses = await prisma.business.findMany({
      where: {
        OR: criteria.categories.map((cat) => ({
          categories: { has: cat },
        })),
      },
      select: { id: true },
    });

    if (!matchingBusinesses.length) continue;

    const totalScans = await prisma.qRScan.count({
      where: {
        memberId,
        businessId: { in: matchingBusinesses.map((b) => b.id) },
      },
    });

    if (totalScans >= criteria.scanCount) {
      const b = await ensureMemberBadgeWithInfo(memberId, badge.slug);
      if (b) earned.push(b);
    }
  }
  return earned;
}

/** Call after CouponRedeem create - Penny Pusher (10 redemptions) */
export async function awardCouponRedeemBadges(memberId: string): Promise<EarnedBadge[]> {
  const earned: EarnedBadge[] = [];
  const count = await prisma.couponRedeem.count({ where: { memberId } });
  if (count >= 10) {
    const b = await ensureMemberBadgeWithInfo(memberId, "penny_pusher");
    if (b) earned.push(b);
  }
  return earned;
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
    const b = await ensureMemberBadgeWithInfo(sellerId, "local_deliverer");
    if (b) earned.push(b);
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
    const b = await ensureMemberBadgeWithInfo(sellerId, "here_in_town");
    if (b) earned.push(b);
  }
  return earned;
}
