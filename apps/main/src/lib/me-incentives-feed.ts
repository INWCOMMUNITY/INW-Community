import { prisma } from "database";

const TAKE = 40;

export type IncentiveNav =
  | { kind: "rewards" }
  | { kind: "business"; slug: string }
  | { kind: "buyer_order"; orderId: string }
  | { kind: "none" };

export type IncentiveFeedItem = {
  id: string;
  kind: "member_badge" | "business_badge" | "qr_scan" | "order_points" | "coupon_points";
  title: string;
  subtitle: string | null;
  occurredAt: string;
  imageUrl: string | null;
  /** Positive points earned when relevant (QR, order, coupon). */
  pointsDelta: number | null;
  nav: IncentiveNav;
};

function businessLabel(b: { name: string }): string {
  return b.name?.trim() || "Local business";
}

export async function getMeIncentivesFeed(memberId: string): Promise<IncentiveFeedItem[]> {
  const myBusinesses = await prisma.business.findMany({
    where: { memberId },
    select: { id: true },
  });
  const myBusinessIds = myBusinesses.map((b) => b.id);

  const [memberBadges, businessBadges, qrScans, buyerOrders, couponRedeems] = await Promise.all([
    prisma.memberBadge.findMany({
      where: { memberId },
      include: { badge: true },
      orderBy: { earnedAt: "desc" },
      take: TAKE,
    }),
    myBusinessIds.length
      ? prisma.businessBadge.findMany({
          where: { businessId: { in: myBusinessIds } },
          include: { badge: true, business: { select: { name: true, slug: true, logoUrl: true } } },
          orderBy: { earnedAt: "desc" },
          take: TAKE,
        })
      : Promise.resolve([]),
    prisma.qRScan.findMany({
      where: { memberId },
      include: { business: { select: { name: true, slug: true, logoUrl: true } } },
      orderBy: { scannedAt: "desc" },
      take: TAKE,
    }),
    prisma.storeOrder.findMany({
      where: { buyerId: memberId, pointsAwarded: { gt: 0 } },
      include: {
        seller: { select: { firstName: true, lastName: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: TAKE,
    }),
    prisma.couponRedeem.findMany({
      where: { memberId, pointsAwarded: { gt: 0 } },
      include: {
        coupon: {
          include: { business: { select: { name: true, slug: true, logoUrl: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: TAKE,
    }),
  ]);

  const out: IncentiveFeedItem[] = [];

  for (const mb of memberBadges) {
    const b = mb.badge;
    out.push({
      id: `member_badge:${mb.id}`,
      kind: "member_badge",
      title: "Badge earned",
      subtitle: b.description
        ? `${b.name} · ${b.description.replace(/\s+/g, " ").trim().slice(0, 100)}${b.description.length > 100 ? "…" : ""}`
        : b.name,
      occurredAt: mb.earnedAt.toISOString(),
      imageUrl: b.imageUrl ?? null,
      pointsDelta: null,
      nav: { kind: "rewards" },
    });
  }

  for (const bb of businessBadges) {
    const b = bb.badge;
    const biz = bb.business;
    out.push({
      id: `business_badge:${bb.id}`,
      kind: "business_badge",
      title: "Business badge",
      subtitle: `${businessLabel(biz)} · ${b.name}`,
      occurredAt: bb.earnedAt.toISOString(),
      imageUrl: b.imageUrl ?? biz.logoUrl ?? null,
      pointsDelta: null,
      nav: { kind: "business", slug: biz.slug },
    });
  }

  for (const scan of qrScans) {
    const biz = scan.business;
    const pts = scan.pointsAwarded;
    out.push({
      id: `qr_scan:${scan.id}`,
      kind: "qr_scan",
      title: `${pts} point${pts === 1 ? "" : "s"} earned`,
      subtitle: `Supporting ${businessLabel(biz)}`,
      occurredAt: scan.scannedAt.toISOString(),
      imageUrl: biz.logoUrl ?? null,
      pointsDelta: pts,
      nav: { kind: "business", slug: biz.slug },
    });
  }

  for (const ord of buyerOrders) {
    const pts = ord.pointsAwarded;
    const sellerName = [ord.seller.firstName, ord.seller.lastName].filter(Boolean).join(" ").trim() || "Seller";
    const when = ord.buyerPointsReleasedAt ?? ord.updatedAt;
    out.push({
      id: `order_points:${ord.id}`,
      kind: "order_points",
      title: `${pts} point${pts === 1 ? "" : "s"} earned`,
      subtitle: `From your purchase · ${sellerName}`,
      occurredAt: when.toISOString(),
      imageUrl: null,
      pointsDelta: pts,
      nav: { kind: "buyer_order", orderId: ord.id },
    });
  }

  for (const cr of couponRedeems) {
    const biz = cr.coupon.business;
    const pts = cr.pointsAwarded;
    out.push({
      id: `coupon_points:${cr.id}`,
      kind: "coupon_points",
      title: `${pts} point${pts === 1 ? "" : "s"} earned`,
      subtitle: `Coupon · ${businessLabel(biz)}`,
      occurredAt: cr.createdAt.toISOString(),
      imageUrl: cr.coupon.imageUrl ?? biz.logoUrl ?? null,
      pointsDelta: pts,
      nav: { kind: "business", slug: biz.slug },
    });
  }

  out.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  const seen = new Set<string>();
  const deduped: IncentiveFeedItem[] = [];
  for (const it of out) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    deduped.push(it);
  }
  return deduped.slice(0, 100);
}
