import { NextResponse } from "next/server";
import { prisma } from "database";

/** Shown when a resident tries social/profile features before verifying email. */
export const ACCOUNT_SETUP_INCOMPLETE_MESSAGE =
  "Verify your email to finish setting up your account. Until then, your profile is not public and you can’t use messaging, friends, likes, or comments.";

export type VerifiedMemberRow = {
  id: string;
  emailVerifiedAt: Date | null;
  status: string;
};

/**
 * For messaging, posting, events, blogs, group requests, and similar actions:
 * **Residents** (signup intent missing or `resident`) must have verified email.
 * **Business / seller** signups are not required to complete inbox verification.
 */
export async function requireVerifiedActiveMember(
  memberId: string
): Promise<{ ok: true; member: VerifiedMemberRow } | { ok: false; response: NextResponse }> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true, emailVerifiedAt: true, status: true, signupIntent: true },
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

  const isBizOrSeller =
    member.signupIntent === "business" || member.signupIntent === "seller";

  if (!isBizOrSeller && !member.emailVerifiedAt) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: ACCOUNT_SETUP_INCOMPLETE_MESSAGE,
          code: "EMAIL_NOT_VERIFIED",
        },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true,
    member: {
      id: member.id,
      emailVerifiedAt: member.emailVerifiedAt,
      status: member.status,
    },
  };
}
