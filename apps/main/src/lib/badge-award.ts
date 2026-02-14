/**
 * Badge award utilities. Call after relevant events (member/business/post/order created, etc.).
 * Uses badge slugs from seed. Safe to call multiple times - badges are unique per member/business.
 */
import { prisma } from "database";

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

/** Call after Member create (signup). signupIntent: resident | business | seller */
export async function awardMemberSignupBadges(memberId: string, signupIntent?: string | null) {
  const intent = signupIntent ?? "resident";
  if (intent === "resident") {
    await ensureMemberBadge(memberId, "community_member");
    const residentCount = await prisma.member.count({
      where: { signupIntent: "resident" },
    });
    if (residentCount <= 1000) {
      await ensureMemberBadge(memberId, "og_community_member");
    }
  }
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
export async function awardSellerTierBadges(sellerId: string) {
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
      await ensureMemberBadge(sellerId, slug);
    }
  }
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

/** Call after QRScan create - Super Scanner (10), Elite Scanner (50) */
export async function awardScannerBadges(memberId: string) {
  const distinctBizCount = await prisma.qRScan.groupBy({
    by: ["businessId"],
    where: { memberId },
  });
  const count = distinctBizCount.length;
  if (count >= 10) await ensureMemberBadge(memberId, "super_scanner");
  if (count >= 50) await ensureMemberBadge(memberId, "elite_scanner");
}
