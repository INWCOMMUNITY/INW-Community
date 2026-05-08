import { prisma } from "database";
import { NWC_PAID_PLAN_ACCESS_STATUSES } from "@/lib/nwc-paid-subscription";

/**
 * Keeps only IDs that appear in the public Support Local directory (same rules as GET /api/businesses).
 * Used when validating post tags so members can mention any listed business, not only saved ones.
 */
export async function filterToPublicDirectoryBusinessIds(candidateIds: string[]): Promise<string[]> {
  const uniq = [...new Set(candidateIds.filter((id) => typeof id === "string" && id.length > 0))].slice(
    0,
    10
  );
  if (uniq.length === 0) return [];

  const activeSubs = await prisma.subscription.findMany({
    where: { plan: { in: ["sponsor", "seller"] }, status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] } },
    select: { memberId: true },
  });
  const activeMemberIds = activeSubs.map((s) => s.memberId);

  const rows = await prisma.business.findMany({
    where: {
      id: { in: uniq },
      nameApprovalStatus: "approved",
      OR: [
        ...(activeMemberIds.length > 0 ? [{ memberId: { in: activeMemberIds } }] : []),
        { adminGrantedAt: { not: null } },
      ],
    },
    select: { id: true },
  });
  const allowed = new Set(rows.map((r) => r.id));
  return uniq.filter((id) => allowed.has(id));
}
