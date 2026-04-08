import type { Prisma } from "database";
import { prisma } from "database";
import { NWC_PAID_PLAN_ACCESS_STATUSES } from "@/lib/nwc-paid-subscription";

/**
 * "Site-visible" members: verified email, **or** business/seller intent with active Business/Seller-style
 * access (paid sponsor/seller subscription or admin-granted business). Residents still need email verification.
 */
export const verifiedMemberWhere: Prisma.MemberWhereInput = {
  OR: [
    { emailVerifiedAt: { not: null } },
    {
      AND: [
        { signupIntent: { in: ["business", "seller"] } },
        {
          OR: [
            {
              subscriptions: {
                some: {
                  plan: { in: ["sponsor", "seller"] },
                  status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] },
                },
              },
            },
            {
              businesses: {
                some: { adminGrantedAt: { not: null } },
              },
            },
          ],
        },
      ],
    },
  ],
};

/**
 * Whether the member counts as verified for feeds, profiles, points, and badges (matches {@link verifiedMemberWhere}).
 */
export async function memberIsSiteVisible(memberId: string): Promise<boolean> {
  const row = await prisma.member.findFirst({
    where: { id: memberId, ...verifiedMemberWhere },
    select: { id: true },
  });
  return row != null;
}

/**
 * Sign-in and /api/me: residents need a verified email; business/seller accounts use password only (no inbox step).
 * Public visibility, points, and badges still require email **or** paid Business/Seller access — see {@link memberIsSiteVisible}.
 */
export async function memberHasAppAccess(memberId: string): Promise<boolean> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { emailVerifiedAt: true, signupIntent: true },
  });
  if (!member) return false;
  if (member.emailVerifiedAt) return true;
  return member.signupIntent === "business" || member.signupIntent === "seller";
}
