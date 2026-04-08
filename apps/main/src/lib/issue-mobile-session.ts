import type { Prisma } from "database";
import { prisma } from "database";
import { signMobileToken, type SubscriptionPlan } from "@/lib/mobile-auth";
import {
  prismaWhereMemberSubscribePlanAccess,
  prismaWhereMemberSubscribeTierPerksAccess,
} from "@/lib/subscribe-plan-access";
import { resolveEffectiveNwcPlan } from "@/lib/resolve-effective-nwc-plan";

/** Fields needed to build a mobile JWT + `/api/me`-style payload. */
export const memberRowSelectForMobileSession = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  profilePhotoUrl: true,
  bio: true,
  city: true,
  status: true,
  emailVerifiedAt: true,
  signupIntent: true,
} satisfies Prisma.MemberSelect;

export type MemberRowForMobileSession = Prisma.MemberGetPayload<{
  select: typeof memberRowSelectForMobileSession;
}>;

function memberRowHasAppAccess(
  m: Pick<MemberRowForMobileSession, "emailVerifiedAt" | "signupIntent">,
): boolean {
  if (m.emailVerifiedAt) return true;
  return m.signupIntent === "business" || m.signupIntent === "seller";
}

export type MobileSessionSuccess = {
  token: string;
  subscriptionPlan: SubscriptionPlan | null;
  member: {
    firstName: string;
    lastName: string;
    email: string;
    profilePhotoUrl: string | null;
    bio: string | null;
    city: string | null;
  };
};

export type MobileSessionFailure = { error: string; status: number };

/**
 * Issue a JWT from a member row (e.g. Prisma `update` return). Prefer this right after persisting
 * `emailVerifiedAt` so a follow-up read cannot lag behind replicas.
 */
export async function issueMobileSessionForMemberRow(
  member: MemberRowForMobileSession
): Promise<MobileSessionSuccess | MobileSessionFailure> {
  if (member.status === "suspended") {
    return { error: "Account suspended", status: 403 };
  }
  if (!memberRowHasAppAccess(member)) {
    return { error: "EMAIL_NOT_VERIFIED", status: 403 };
  }

  const [subTier, subResaleHub] = await Promise.all([
    prisma.subscription.findFirst({
      where: prismaWhereMemberSubscribeTierPerksAccess(member.id),
      select: { id: true },
    }),
    prisma.subscription.findFirst({
      where: prismaWhereMemberSubscribePlanAccess(member.id),
      select: { id: true },
    }),
  ]);

  const effectivePlan = await resolveEffectiveNwcPlan(member.id);

  try {
    await prisma.member.update({
      where: { id: member.id },
      data: { lastLogin: new Date() },
    });
  } catch {
    // non-fatal
  }

  const token = await signMobileToken({
    id: member.id,
    email: member.email,
    name: `${member.firstName} ${member.lastName}`,
    isSubscriber: !!subTier,
    hasResaleHubAccess: !!subResaleHub,
    subscriptionPlan: effectivePlan ?? undefined,
  });

  return {
    token,
    subscriptionPlan: effectivePlan,
    member: {
      firstName: member.firstName,
      lastName: member.lastName,
      email: member.email,
      profilePhotoUrl: member.profilePhotoUrl,
      bio: member.bio,
      city: member.city,
    },
  };
}

/**
 * Issue a JWT and payload for the mobile app after the member is allowed to use the app
 * (verified email, not suspended). Used by mobile sign-in and post–email-verify auto login.
 */
export async function issueMobileSessionForMemberId(
  memberId: string
): Promise<MobileSessionSuccess | MobileSessionFailure> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: memberRowSelectForMobileSession,
  });
  if (!member) {
    return { error: "Not found.", status: 404 };
  }
  return issueMobileSessionForMemberRow(member);
}
