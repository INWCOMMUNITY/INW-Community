import type { Prisma } from "database";

/** Coupon is shown in the public coupon book / redeemable when true. */
export function isCouponActiveByExpiresAt(expiresAt: Date | null | undefined): boolean {
  if (expiresAt == null) return true;
  return expiresAt.getTime() > Date.now();
}

/** Prisma filter: not past expiration (null = never expires). */
export function couponPublicActiveWhere(): Prisma.CouponWhereInput {
  return {
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  };
}
