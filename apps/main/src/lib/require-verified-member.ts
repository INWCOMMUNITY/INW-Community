import { NextResponse } from "next/server";
import { prisma } from "database";

export type VerifiedMemberRow = {
  id: string;
  emailVerifiedAt: Date | null;
  status: string;
};

/**
 * If set to an ISO-8601 instant, members with `createdAt` >= this time must have `emailVerifiedAt`
 * for routes that call this helper. Members created before this time are grandfathered (existing
 * accounts are not forced to verify retroactively).
 *
 * If unset, missing `emailVerifiedAt` never blocks here — sign-in still enforces verification for
 * new signups on mobile/web as configured elsewhere.
 */
function getEnforceEmailVerifiedSince(): Date | null {
  const raw = process.env.MEMBERS_ENFORCE_EMAIL_VERIFIED_SINCE?.trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Ensures the member exists, is not suspended, and (when configured) has verified email for
 * accounts created after {@link getEnforceEmailVerifiedSince}.
 */
export async function requireVerifiedActiveMember(
  memberId: string
): Promise<{ ok: true; member: VerifiedMemberRow } | { ok: false; response: NextResponse }> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true, emailVerifiedAt: true, status: true, createdAt: true },
  });

  if (!member) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Account not found.", code: "ACCOUNT_NOT_FOUND" },
        { status: 401 }
      ),
    };
  }

  if (member.status === "suspended") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Account suspended.", code: "ACCOUNT_SUSPENDED" },
        { status: 403 }
      ),
    };
  }

  const enforceSince = getEnforceEmailVerifiedSince();
  const mustVerifyEmail =
    !!enforceSince &&
    member.createdAt.getTime() >= enforceSince.getTime() &&
    !member.emailVerifiedAt;

  if (mustVerifyEmail) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Verify your email to use this feature.",
          code: "EMAIL_NOT_VERIFIED",
        },
        { status: 403 }
      ),
    };
  }

  return { ok: true, member };
}
