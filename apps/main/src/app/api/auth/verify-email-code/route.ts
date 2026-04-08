import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "database";
import { checkRateLimit, getClientIdentifier } from "@/lib/rate-limit";
import { codesMatchStoredHash, normalizeEmailVerificationCodeInput } from "@/lib/email-verification";
import {
  issueMobileSessionForMemberRow,
  memberRowSelectForMobileSession,
} from "@/lib/issue-mobile-session";
import { awardMemberSignupBadges, type EarnedBadge } from "@/lib/badge-award";

function coerceIssueMobileSession(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  }
  return false;
}

const bodySchema = z.object({
  email: z.string().email("Please enter a valid email address."),
  code: z.string().min(4).max(32),
  /** When true (mobile app), return JWT + member payload like mobile-signin after verify. */
  issueMobileSession: z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform(coerceIssueMobileSession),
});

export async function POST(req: NextRequest) {
  const ipKey = `verify-email-code:${getClientIdentifier(req)}`;
  const { allowed: ipOk } = checkRateLimit(ipKey);
  if (!ipOk) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  try {
    const body = await req.json();
    const { email, code: rawCode, issueMobileSession } = bodySchema.parse(body);
    const normalized = normalizeEmailVerificationCodeInput(rawCode);
    if (!normalized) {
      return NextResponse.json({ error: "Enter the 6-digit code from your email." }, { status: 400 });
    }

    const loginId = email.trim();
    const emailKey = `verify-email-code:${loginId.toLowerCase()}`;
    const { allowed: emailOk } = checkRateLimit(emailKey);
    if (!emailOk) {
      return NextResponse.json({ error: "Too many attempts for this email. Try again shortly." }, { status: 429 });
    }

    const member = await prisma.member.findFirst({
      where: { email: { equals: loginId, mode: "insensitive" } },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        emailVerificationCodeHash: true,
        emailVerificationTokenHash: true,
        emailVerificationExpiresAt: true,
      },
    });

    if (!member) {
      return NextResponse.json({ error: "Invalid or expired code." }, { status: 400 });
    }

    /** First verify succeeded in DB but JWT failed; user retries with same code — guide them off “invalid code”. */
    if (member.emailVerifiedAt) {
      return NextResponse.json({
        ok: true,
        alreadyVerified: true,
        signInRequired: true,
        message:
          "This email is already verified. Sign in with your password. If you don’t have a password set, use Forgot password on the sign-in screen.",
      });
    }

    const hasCode = !!member.emailVerificationCodeHash;
    const hasToken = !!member.emailVerificationTokenHash;
    if (!hasCode && !hasToken) {
      return NextResponse.json({ error: "Invalid or expired code." }, { status: 400 });
    }

    if (
      !member.emailVerificationExpiresAt ||
      member.emailVerificationExpiresAt < new Date()
    ) {
      return NextResponse.json({ error: "That code has expired. Request a new one." }, { status: 400 });
    }

    if (hasCode && member.emailVerificationCodeHash) {
      const ok = codesMatchStoredHash(member.email, normalized, member.emailVerificationCodeHash);
      if (!ok) {
        return NextResponse.json({ error: "Invalid code." }, { status: 400 });
      }
    } else if (hasToken) {
      // Legacy: only link flow; codes are not accepted for token-only rows.
      return NextResponse.json({ error: "Use the verification link we emailed you, or request a new code." }, { status: 400 });
    }

    const verificationSnapshot = {
      emailVerifiedAt: member.emailVerifiedAt,
      emailVerificationCodeHash: member.emailVerificationCodeHash,
      emailVerificationTokenHash: member.emailVerificationTokenHash,
      emailVerificationExpiresAt: member.emailVerificationExpiresAt,
    };

    const updatedMember = await prisma.member.update({
      where: { id: member.id },
      data: {
        emailVerifiedAt: new Date(),
        emailVerificationTokenHash: null,
        emailVerificationCodeHash: null,
        emailVerificationExpiresAt: null,
      },
      select: memberRowSelectForMobileSession,
    });

    if (issueMobileSession) {
      const session = await issueMobileSessionForMemberRow(updatedMember);
      if ("error" in session) {
        // Leave verified if suspended; otherwise roll back so the same 6-digit code works on retry.
        if (session.error !== "Account suspended") {
          await prisma.member.update({
            where: { id: member.id },
            data: {
              emailVerifiedAt: verificationSnapshot.emailVerifiedAt,
              emailVerificationCodeHash: verificationSnapshot.emailVerificationCodeHash,
              emailVerificationTokenHash: verificationSnapshot.emailVerificationTokenHash,
              emailVerificationExpiresAt: verificationSnapshot.emailVerificationExpiresAt,
            },
          });
        }
        return NextResponse.json(
          {
            ok: false,
            error:
              session.error === "Account suspended"
                ? "Your account is suspended."
                : "We couldn’t finish signing you in. Tap Verify again with the same code.",
            code: session.error === "Account suspended" ? "ACCOUNT_SUSPENDED" : "SESSION_ISSUE",
            signInRequired: session.error === "Account suspended",
            message:
              session.error === "Account suspended"
                ? "Your account is suspended."
                : "Your email is still unverified until sign-in succeeds. Try Verify again.",
          },
          { status: 200 }
        );
      }
      if (!session.token || typeof session.token !== "string") {
        console.error("[verify-email-code] issueMobileSession success missing token");
        await prisma.member.update({
          where: { id: member.id },
          data: {
            emailVerifiedAt: verificationSnapshot.emailVerifiedAt,
            emailVerificationCodeHash: verificationSnapshot.emailVerificationCodeHash,
            emailVerificationTokenHash: verificationSnapshot.emailVerificationTokenHash,
            emailVerificationExpiresAt: verificationSnapshot.emailVerificationExpiresAt,
          },
        });
        return NextResponse.json(
          {
            ok: false,
            error: "Could not create your session. Tap Verify again with the same code, or sign in with your password.",
            code: "SESSION_ISSUE",
            signInRequired: false,
          },
          { status: 200 }
        );
      }
      const intentRow = await prisma.member.findUnique({
        where: { id: member.id },
        select: { signupIntent: true },
      });
      const earnedBadges = await awardMemberSignupBadges(
        member.id,
        intentRow?.signupIntent ?? "resident"
      ).catch((): EarnedBadge[] => []);
      return NextResponse.json({ ok: true, earnedBadges, ...session });
    }

    const intentRow = await prisma.member.findUnique({
      where: { id: member.id },
      select: { signupIntent: true },
    });
    const earnedBadges = await awardMemberSignupBadges(
      member.id,
      intentRow?.signupIntent ?? "resident"
    ).catch((): EarnedBadge[] => []);

    return NextResponse.json({ ok: true, earnedBadges });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors[0]?.message ?? "Invalid input." }, { status: 400 });
    }
    console.error("[verify-email-code]", e);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
