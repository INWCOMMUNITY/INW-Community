import type { Prisma } from "database";
import { prisma, durableCommerceFinancialNone } from "database";

/** Residents who never verify email are removed after this window (business/seller signups are excluded). */
export const UNVERIFIED_RESIDENT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Prisma filter: resident (or legacy null intent), never verified email, older than `cutoff`, and no
 * billing/commerce footprint so we do not delete someone who started checkout or created a listing.
 */
export function staleUnverifiedResidentWhere(cutoff: Date): Prisma.MemberWhereInput {
  return {
    emailVerifiedAt: null,
    OR: [{ signupIntent: null }, { signupIntent: "resident" }],
    createdAt: { lt: cutoff },
    status: { not: "closed" },
    businesses: { none: {} },
    posts: { none: {} },
    blogs: { none: {} },
    ...durableCommerceFinancialNone(),
  };
}

/**
 * Hard-deletes matching members (cascades related rows). Returns how many rows were removed.
 */
export async function deleteStaleUnverifiedResidents(now = new Date()): Promise<{ deleted: number }> {
  const cutoff = new Date(now.getTime() - UNVERIFIED_RESIDENT_RETENTION_MS);
  const result = await prisma.member.deleteMany({
    where: staleUnverifiedResidentWhere(cutoff),
  });
  return { deleted: result.count };
}
