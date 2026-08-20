import { prisma } from "database";

export type BusinessHubLiveCounts = {
  posts: number;
  events: number;
  coupons: number;
};

export async function getBusinessHubLiveCounts(memberId: string): Promise<BusinessHubLiveCounts> {
  const businesses = await prisma.business.findMany({
    where: { memberId },
    select: { id: true },
  });
  const ids = businesses.map((b) => b.id);
  if (ids.length === 0) {
    return { posts: 0, events: 0, coupons: 0 };
  }

  const [posts, events, coupons] = await Promise.all([
    prisma.post.count({
      where: {
        authorId: memberId,
        type: "shared_business",
        sourceBusinessId: { in: ids },
      },
    }),
    prisma.event.count({
      where: {
        status: "approved",
        businessId: { in: ids },
      },
    }),
    prisma.coupon.count({
      where: { businessId: { in: ids } },
    }),
  ]);

  return { posts, events, coupons };
}
