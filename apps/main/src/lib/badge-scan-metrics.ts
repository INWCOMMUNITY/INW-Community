import { prisma } from "database";

/** Distinct businesses the member has at least one QR scan at (all time). */
export async function getDistinctScannedBusinessCount(memberId: string): Promise<number> {
  const rows = await prisma.qRScan.groupBy({
    by: ["businessId"],
    where: { memberId },
  });
  return rows.length;
}

export interface CategoryScanMetric {
  slug: string;
  current: number;
  target: number;
  bonusPoints?: number;
}

/**
 * Per category_scan badge: total QR scans at any business whose categories intersect the badge's criteria.
 * Must stay aligned with award rules in badge-award (category_scan).
 */
export async function getAllCategoryScanMetrics(memberId: string): Promise<CategoryScanMetric[]> {
  const catBadges = await prisma.badge.findMany({
    where: { criteria: { path: ["type"], equals: "category_scan" } },
  });
  const out: CategoryScanMetric[] = [];

  for (const badge of catBadges) {
    const criteria = badge.criteria as {
      type?: string;
      categories?: string[];
      scanCount?: number;
      bonusPoints?: number;
    } | null;
    if (!criteria?.categories?.length || !criteria.scanCount) continue;

    const matchingBusinesses = await prisma.business.findMany({
      where: {
        OR: criteria.categories.map((cat) => ({
          categories: { has: cat },
        })),
      },
      select: { id: true },
    });

    const totalScans =
      matchingBusinesses.length === 0
        ? 0
        : await prisma.qRScan.count({
            where: {
              memberId,
              businessId: { in: matchingBusinesses.map((b) => b.id) },
            },
          });

    out.push({
      slug: badge.slug,
      current: totalScans,
      target: criteria.scanCount,
      bonusPoints: criteria.bonusPoints,
    });
  }

  return out;
}
