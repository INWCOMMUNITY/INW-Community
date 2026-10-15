import type { Prisma } from "database";
import { prisma, durableCommerceFinancialNone } from "database";

/** Abandoned signups are removed after this window. */
export const PENDING_ACCOUNT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** @deprecated Use PENDING_ACCOUNT_RETENTION_MS. Kept so older imports still compile. */
export const UNVERIFIED_RESIDENT_RETENTION_MS = PENDING_ACCOUNT_RETENTION_MS;

/**
 * Pending accounts older than `cutoff`:
 * - residents who never verified email
 * - seller/business signups that never gained a subscription or other commerce footprint
 * Admin-granted businesses are kept. Paid or in-progress payout/shipping setup is kept.
 */
export function staleUnverifiedResidentWhere(cutoff: Date): Prisma.MemberWhereInput {
  return {
    createdAt: { lt: cutoff },
    status: { not: "closed" },
    posts: { none: {} },
    blogs: { none: {} },
    businesses: { none: { adminGrantedAt: { not: null } } },
    AND: [
      {
        OR: [
          {
            emailVerifiedAt: null,
            OR: [{ signupIntent: null }, { signupIntent: "resident" }],
          },
          { signupIntent: { in: ["business", "seller"] } },
        ],
      },
    ],
    ...durableCommerceFinancialNone(),
  };
}

/**
 * Hard-deletes matching members. Draft businesses are removed first so unfinished
 * seller profiles do not block the member delete. Returns how many members were removed.
 */
export async function deleteStaleUnverifiedResidents(now = new Date()): Promise<{ deleted: number }> {
  const cutoff = new Date(now.getTime() - PENDING_ACCOUNT_RETENTION_MS);
  const where = staleUnverifiedResidentWhere(cutoff);
  const pending = await prisma.member.findMany({
    where,
    select: { id: true },
  });
  if (pending.length === 0) return { deleted: 0 };
  const ids = pending.map((row) => row.id);
  await prisma.business.deleteMany({
    where: { memberId: { in: ids }, adminGrantedAt: null },
  });
  const result = await prisma.member.deleteMany({
    where: { id: { in: ids }, ...where },
  });
  return { deleted: result.count };
}
